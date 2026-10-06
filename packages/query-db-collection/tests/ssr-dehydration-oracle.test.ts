import { createContext, runInContext } from 'node:vm'
import { QueryClient, dehydrate, hydrate } from '@tanstack/query-core'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { crossSerializeStream, getCrossReferenceHeader } from 'seroval'
import { describe, expect, it } from 'vitest'
import { queryCollectionOptions } from '../src/query.js'
import type { DehydratedState } from '@tanstack/query-core'
import type { LoadSubsetOptions } from '@tanstack/db'

/**
 * # Can an on-demand Query cache entry enter a TanStack Start SSR payload?
 *
 * A successful QueryClient cache entry must survive `dehydrate` and Seroval's
 * router stream serialization. This is the SSR boundary reported in #1950.
 * The independent expected result is simple: both an ordinary cached query and
 * an on-demand query with the same plain row are serializable. The latter's
 * request metadata may describe its predicate, but it cannot make the router
 * payload unserializable.
 *
 * The fixed grammar has a plain cached-query control, a live query with two
 * `where` clauses, a direct subset request carrying only a cancellation
 * signal, and an ordered cursor request with a custom comparator. These forms
 * isolate the unsupported values and adjacent request shapes. After
 * successful loading, the driver dehydrates the cache and passes it to
 * `crossSerializeStream`, as the router integration does. The check observes
 * the retained row, reconstructed stream payload, and Query Core hydration
 * from that payload. This partial oracle does not run TanStack Start or prove
 * that a browser Collection resumes the query.
 *
 * Review: ORC-001–003 and ORC-005 are supplied by the law, fixed forms, real
 * entry points, and cache/stream observations above. The original production
 * failure and a stream-only leak mutant calibrate the comparison (ORC-006).
 * Cleanup preserves a primary failure if teardown also fails (ORC-010). ORC-004, ORC-007, and ORC-008 do not apply
 * to fixed, stateless cases. ORC-009 adds no model-only vocabulary. ORC-011 has
 * no named shared semantic fault; the plain cache control is a second path.
 */

type Row = { id: string; category: string }

const row: Row = { id: `1`, category: `A` }

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  })
}

type RouterPayload = {
  dehydratedData: { query: { initial: DehydratedState } }
}

function serializeRouterPayload(
  initial: DehydratedState,
): Promise<DehydratedState> {
  return new Promise((resolve, reject) => {
    const context = createContext({
      self: {} as { $R?: unknown },
      $R: undefined as unknown,
    })
    // Router installs this reference header before the streamed script chunks.
    const scopeId = `tsr`
    runInContext(getCrossReferenceHeader(scopeId), context)
    context.$R = context.self.$R
    let payload: RouterPayload | undefined
    crossSerializeStream(
      { dehydratedData: { query: { initial } } },
      {
        scopeId,
        onSerialize: (chunk, isInitial) => {
          try {
            const value: unknown = runInContext(chunk, context)
            if (isInitial) payload = value as RouterPayload
          } catch (error) {
            reject(error)
          }
        },
        onError: reject,
        onDone: () => {
          if (payload) resolve(payload.dehydratedData.query.initial)
          else
            reject(new Error(`Router stream did not emit an initial payload`))
        },
      },
    )
  })
}

function expectDehydratedRow(initial: DehydratedState): void {
  expect(initial.queries).toHaveLength(1)
  expect(initial.queries[0]?.state.data).toEqual([row])
}

function expectHydratedRow(
  initial: DehydratedState,
  restored: DehydratedState,
  expectedMeta?: Record<string, unknown>,
): void {
  const browserClient = createQueryClient()
  expectDehydratedRow(restored)
  expect(
    Object.hasOwn(restored.queries[0]?.meta ?? {}, `loadSubsetOptions`),
  ).toBe(false)
  if (expectedMeta) expect(restored.queries[0]?.meta).toEqual(expectedMeta)
  hydrate(browserClient, restored)
  const queryKey = initial.queries[0]!.queryKey
  expect(browserClient.getQueryData(queryKey)).toEqual([row])
  const hydratedMeta = browserClient.getQueryCache().find({ queryKey })?.meta
  expect(Object.hasOwn(hydratedMeta ?? {}, `loadSubsetOptions`)).toBe(false)
  if (expectedMeta) expect(hydratedMeta).toEqual(expectedMeta)
  browserClient.clear()
}

async function checkWithCleanup(
  check: () => Promise<void>,
  cleanups: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  let primaryFailure: unknown
  let hasPrimaryFailure = false
  try {
    await check()
  } catch (error) {
    primaryFailure = error
    hasPrimaryFailure = true
  }

  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }

  if (hasPrimaryFailure) {
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, `Cleanup failed`, {
        cause: primaryFailure,
      })
    }
    throw primaryFailure
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `Cleanup failed`)
  }
}

describe(`Query collection SSR dehydration oracle`, () => {
  it(`serializes an ordinary successful Query cache entry`, async () => {
    const queryClient = createQueryClient()
    await checkWithCleanup(async () => {
      queryClient.setQueryData([`plain-ssr-control`], [row])
      const initial = dehydrate(queryClient)
      expectDehydratedRow(initial)
      const streamed = await serializeRouterPayload(initial)
      expectHydratedRow(initial, streamed)
    }, [() => queryClient.clear()])
  })

  it(`serializes a successful on-demand entry with a compound predicate`, async () => {
    const queryClient = createQueryClient()
    let receivedWhere: LoadSubsetOptions[`where`]
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id: `on-demand-ssr-oracle`,
        queryClient,
        queryKey: [`on-demand-ssr-oracle`],
        meta: { origin: `user` },
        queryFn: (context) => {
          receivedWhere = context.meta?.loadSubsetOptions?.where
          return Promise.resolve([row])
        },
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ item: collection })
        .where(({ item }) => eq(item.category, `A`))
        .where(({ item }) => eq(item.id, `1`))
        .select(({ item }) => ({ id: item.id, category: item.category })),
    )

    await checkWithCleanup(async () => {
      await live.preload()
      expect(receivedWhere).toMatchObject({ type: `func`, name: `and` })
      expect(receivedWhere).toBeInstanceOf(IR.Func)
      expect(live.toArray.map((item) => item.id)).toEqual([row.id])

      const initial = dehydrate(queryClient)
      expectDehydratedRow(initial)
      const streamed = await serializeRouterPayload(initial)
      expectHydratedRow(initial, streamed, { origin: `user` })
    }, [
      () => live.cleanup(),
      () => collection.cleanup(),
      () => queryClient.clear(),
    ])
  })

  it(`serializes a successful on-demand entry with a cancellation signal`, async () => {
    const queryClient = createQueryClient()
    const requestSignal = new AbortController().signal
    let receivedSignal: AbortSignal | undefined
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id: `on-demand-ssr-signal-oracle`,
        queryClient,
        queryKey: [`on-demand-ssr-signal-oracle`],
        queryFn: (context) => {
          receivedSignal = context.meta?.loadSubsetOptions?.signal
          return Promise.resolve([row])
        },
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )

    await checkWithCleanup(async () => {
      await collection._sync.loadSubset({
        signal: requestSignal,
      })
      expect(receivedSignal).toBe(requestSignal)
      const initial = dehydrate(queryClient)
      expectDehydratedRow(initial)
      const streamed = await serializeRouterPayload(initial)
      expectHydratedRow(initial, streamed)
    }, [() => collection.cleanup(), () => queryClient.clear()])
  })

  it(`serializes an ordered cursor request with a custom comparator`, async () => {
    const queryClient = createQueryClient()
    const compare = (a: string, b: string): number => a.localeCompare(b)
    const orderBy: NonNullable<LoadSubsetOptions[`orderBy`]> = [
      {
        expression: new IR.PropRef([`id`]),
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `custom`,
          compare,
        },
      },
    ]
    const cursor: NonNullable<LoadSubsetOptions[`cursor`]> = {
      whereFrom: new IR.Func(`gt`, [new IR.PropRef([`id`]), new IR.Value(`0`)]),
      whereCurrent: new IR.Func(`eq`, [
        new IR.PropRef([`id`]),
        new IR.Value(`1`),
      ]),
    }
    let receivedOptions: LoadSubsetOptions | undefined
    const collection = createCollection(
      queryCollectionOptions<Row>({
        id: `on-demand-ssr-cursor-oracle`,
        queryClient,
        queryKey: [`on-demand-ssr-cursor-oracle`],
        queryFn: (context) => {
          receivedOptions = context.meta?.loadSubsetOptions
          return Promise.resolve([row])
        },
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        startSync: true,
      }),
    )

    await checkWithCleanup(async () => {
      await collection._sync.loadSubset({ orderBy, cursor })
      expect(receivedOptions?.orderBy?.[0]?.compareOptions).toMatchObject({
        compare,
      })
      expect(receivedOptions?.cursor?.whereFrom).toBe(cursor.whereFrom)
      const initial = dehydrate(queryClient)
      expectDehydratedRow(initial)
      const streamed = await serializeRouterPayload(initial)
      expectHydratedRow(initial, streamed)
    }, [() => collection.cleanup(), () => queryClient.clear()])
  })
})
