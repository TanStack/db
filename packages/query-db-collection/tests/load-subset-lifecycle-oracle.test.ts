import { QueryClient } from '@tanstack/query-core'
import { IR, createCollection, createLiveQueryCollection } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { expectAssertionFailure } from '../../db/tests/expected-failure.js'
import { TraceAssertionError } from '../../db/tests/trace-runner.js'
import { queryCollectionOptions } from '../src/query.js'
import type { QueryFunctionContext } from '@tanstack/query-core'

type Row = {
  id: string
  group?: string
}

let collectionSequence = 0

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  })
}

async function expectInitialQueryFailureStatus(): Promise<void> {
  const error = new Error(`initial query failed`)
  const queryClient = createQueryClient()
  const id = `load-subset-error-status-${collectionSequence++}`
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: () => Promise.reject(error),
      getKey: (row) => row.id,
      startSync: true,
      retry: false,
    }),
  )

  try {
    await vi.waitFor(() => {
      expect(collection.utils.lastError).toBe(error)
      expect(collection.utils.isError).toBe(true)
    })
    expect(loggedError).toHaveBeenCalled()
    try {
      expect(collection.status).toBe(`error`)
    } catch (caught) {
      throw new TraceAssertionError(0, caught)
    }
  } finally {
    await collection.cleanup()
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectEquivalentPredicatesShareOneLoad(
  form: `commutative-and` | `reversed-equality`,
): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-canonical-predicate-${collectionSequence++}`
  const queryFn = vi.fn().mockResolvedValue([{ id: `a`, group: `x` }])
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const firstComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`id`]),
    new IR.Value(`a`),
  ])
  const secondComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`x`),
  ])
  const first =
    form === `commutative-and`
      ? new IR.Func(`and`, [firstComparison, secondComparison])
      : firstComparison
  const second =
    form === `commutative-and`
      ? new IR.Func(`and`, [secondComparison, firstComparison])
      : new IR.Func<boolean>(`eq`, [new IR.Value(`a`), new IR.PropRef([`id`])])

  try {
    await collection._sync.loadSubset({ where: first })
    await collection._sync.loadSubset({ where: second })
    try {
      expect(queryFn.mock.calls.length).toBe(1)
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    await collection.cleanup()
    queryClient.clear()
  }
}

async function expectFinalOwnerCleanupAbortsQuery(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-cancel-final-owner-${collectionSequence++}`
  let capturedSignal: AbortSignal | undefined
  let resolveStarted!: () => void
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    capturedSignal = context.signal
    resolveStarted()
    return new Promise<Array<Row>>((_resolve, reject) => {
      context.signal.addEventListener(`abort`, () => {
        const error = new Error(`query aborted`)
        error.name = `AbortError`
        reject(error)
      })
    })
  })
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query.from({ row: source }).select(({ row }) => ({ id: row.id })),
  )
  const preloadOutcome = live.preload().catch((error: unknown) => error)

  try {
    await started
    expect(queryFn).toHaveBeenCalledOnce()
    expect(capturedSignal?.aborted).toBe(false)

    await live.cleanup()
    await Promise.resolve()
    expect(capturedSignal?.aborted).toBe(true)
  } finally {
    await live.cleanup()
    await source.cleanup()
    queryClient.clear()
    await preloadOutcome
  }
}

async function expectRemountAfterAbortStartsFreshQuery(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-remount-after-abort-${collectionSequence++}`
  let resolveFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    resolveFirstStarted = resolve
  })
  const queryFn = vi
    .fn<(context: QueryFunctionContext) => Promise<Array<Row>>>()
    .mockImplementationOnce((context) => {
      resolveFirstStarted()
      return new Promise<Array<Row>>((_resolve, reject) => {
        context.signal.addEventListener(`abort`, () => {
          const error = new Error(`first query aborted`)
          error.name = `AbortError`
          reject(error)
        })
      })
    })
    .mockResolvedValueOnce([{ id: `fresh` }])
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const buildLive = () =>
    createLiveQueryCollection((query) =>
      query.from({ row: source }).select(({ row }) => ({ id: row.id })),
    )
  const first = buildLive()
  const firstOutcome = first.preload().catch((error: unknown) => error)
  let second: ReturnType<typeof buildLive> | undefined

  try {
    await firstStarted
    await first.cleanup()
    await firstOutcome

    second = buildLive()
    const rows = await second.toArrayWhenReady()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([`fresh`])
  } finally {
    await first.cleanup()
    await second?.cleanup()
    await source.cleanup()
    queryClient.clear()
  }
}

describe(`loadSubset lifecycle oracle`, () => {
  it(`reports an initial query failure through collection status`, async () => {
    await expectAssertionFailure(expectInitialQueryFailureStatus, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        actual === `ready` && expected === `error`,
    })()
  })

  it(`commutative predicate forms share one query-db transport load`, async () => {
    await expectAssertionFailure(expectEquivalentPredicatesShareOneLoad, {
      checkpoint: 0,
      classify: ({ actual, expected }) => actual === 2 && expected === 1,
    })(`commutative-and`)
  })

  it(`reversed equality operands share one query-db transport load`, async () => {
    await expectAssertionFailure(expectEquivalentPredicatesShareOneLoad, {
      checkpoint: 0,
      classify: ({ actual, expected }) => actual === 2 && expected === 1,
    })(`reversed-equality`)
  })

  it(`aborts an in-flight query when its final live-query owner cleans up`, async () => {
    await expectFinalOwnerCleanupAbortsQuery()
  })

  it(`starts a fresh query after an aborted owner immediately remounts`, async () => {
    await expectRemountAfterAbortStartsFreshQuery()
  })
})
