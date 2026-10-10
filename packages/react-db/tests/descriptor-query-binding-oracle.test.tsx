/**
 * A Query assembled with a Collection descriptor is a reusable query plan.
 * Its source Collection belongs to the DbClient that later consumes it, so
 * construction outside DbProvider succeeds and two providers can consume the
 * same plan without sharing rows. This follows the standalone Query contract
 * and the SSR guide's factory-descriptor promise. Concrete-config descriptors
 * are intentionally outside the two-client law. A committed Effect that first
 * acquires a descriptor Collection also makes that source eligible for the
 * DbClient's public dehydration snapshot.
 *
 * Model: each client owns a plain map of rows. A write to one map changes
 * only that client's expected result. An Effect reports that client's row on
 * entry, including after a mounted provider switch. The model never calls the
 * query builder, materializer, or live-query engine to calculate expected rows.
 *
 * Legal histories: one has disjoint row keys across clients; the other has the
 * same key with different values in both clients. Build once, mount under two
 * clients, write independently to each, then switch one mounted hook to the
 * other client and back. After an Effect switches providers, an old-source
 * write produces no update event, while a new-source write produces one. The
 * public observation at each settled cut is the
 * complete projected row bag and row key from each useLiveQuery hook. A separate
 * Effect history checks enter events from two clients with the same row key,
 * then switches one mounted Effect to the other client. The
 * colliding-key history rejects a row-ID-only cross-client cache that the
 * disjoint history could miss. This bounded driver does not prove every query
 * clause, on-demand load, or framework adapter. A separate Effect history
 * observes dehydration after the committed Effect has reported its first row.
 * A no-client history changes one mounted hook from a concrete query to a
 * descriptor query with the same semantic hash. It must reject the unbound
 * source before reusing the old live-query Collection. The React error names
 * DbProvider as the remedy; the core error remains framework neutral.
 * A server-streaming history begins with a pending concrete-source hook and
 * then preloads a descriptor with the same query hash over another source
 * object. The client must reject that local source substitution before the
 * stream's result can answer the second preload. This is one local hook-first
 * order. A separate hydration-first history receives a server result whose
 * Collection objects cannot cross the wire. The first committed browser hook
 * claims its local source objects while the browser source is still loading;
 * a later same-hash preload over another object must reject. The model expects
 * the server row before browser readiness and the browser row after handoff.
 * A hostile observer that omits the committed claim fails at the conflicting
 * preload assertion while the source remains unready.
 * A Suspense read is itself a preload, even if React abandons its render. With
 * a pending hydrated stream, that first local preload starts the source and
 * claims its object identity before commit. A later same-source preload is
 * accepted and a different same-hash source is rejected at that cut. This
 * demand is distinct from an ordinary hook's commit-owned subscription.
 * A finite two-source grammar places the same standalone parent and child
 * descriptors in a join, nested FROM, union, or include. Two clients supply
 * different values under equal row keys. A plain per-client value model
 * predicts the complete selected rows after initial publication, a first-
 * client child write, and a second-client parent write. This detects binding
 * either source to the wrong provider; it does not observe on-demand requests
 * or arbitrary interleavings of source writes.
 * A receiving include repeats those checkpoints with a child alias that
 * shadows the parent alias and a renamed control. The child's projection
 * includes the captured parent value, so alias-only lookup changes an
 * observable field even when the correlation still admits the child. Its
 * stable identity must also survive descriptor binding: changing source
 * binding IDs while retaining captured references changes the public hash.
 * A second receiving history combines descriptor binding with RIGHT/FULL
 * outer joins, both correlation sides, shadowed and renamed aliases, and
 * eager/on-demand source modes. Plain per-client maps predict joined rows,
 * including an undefined missing side. Both clients use equal row IDs but
 * distinct values. The public check runs after initial acquisition and each
 * authored source write; source starts and on-demand requests are observed
 * after acquisition. The finite grammar does not cover every join chain or
 * arbitrary write order.
 *
 * A prepared query is a bound snapshot, not a lasting render resolver. Adding
 * a descriptor source later changes the plan without starting a sync run. The
 * next client-aware consumer binds that source. The independent start model is
 * zero for an unconsumed continuation or a render that never commits, and one
 * for the source after a committed hook consumes it. A fixed history prepares
 * a base query, releases its render deferral, then extends and mounts it. A
 * neighboring Suspense history extends a query during a render that is never
 * committed. The sync callback count and public rows are checked at those
 * cuts. Another suspended render leaves a source shared with a later direct
 * reader. That reader's preload is an independent demand for data: it may
 * start the source even though the earlier render never committed. These
 * histories do not cover arbitrary concurrent render schedules.
 */
import { act, render, renderHook, waitFor } from '@testing-library/react'
import {
  DbClient,
  Query,
  collectionOptions,
  createCollection,
  eq,
  getStableQueryBuilderHash,
  isUndefined,
  prepareLiveQueryValue,
  toArray,
} from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { Suspense } from 'react'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveQueryEffect } from '../src/useLiveQueryEffect'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type {
  Context,
  DeferredLiveQueryCollections,
  QueryBuilder,
} from '@tanstack/db'
import type { ReactNode } from 'react'

type Row = { id: string; value: string }

const histories = [
  {
    name: `disjoint keys`,
    initial: {
      first: { id: `a`, value: `first` },
      second: { id: `b`, value: `second` },
    },
    writes: {
      first: { id: `c`, value: `first write` },
      second: { id: `d`, value: `second write` },
    },
  },
  {
    name: `colliding keys`,
    initial: {
      first: { id: `shared`, value: `first` },
      second: { id: `shared`, value: `second` },
    },
    writes: {
      first: { id: `shared`, value: `first write` },
      second: { id: `shared`, value: `second write` },
    },
  },
] satisfies ReadonlyArray<{
  name: string
  initial: { first: Row; second: Row }
  writes: { first: Row; second: Row }
}>

function expectedRows(rows: ReadonlyMap<string, Row>): Array<Row> {
  return [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

describe(`standalone descriptor query binding`, () => {
  it(`binds a continued query for the next committed client-aware hook`, async () => {
    const client = new DbClient()
    const baseDescriptor = collectionOptions(`continued-react-base`, () => ({
      id: `continued-react-base`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `one`, value: `base` } })
          commit()
          markReady()
        },
      },
    }))
    let lateStarts = 0
    const lateDescriptor = collectionOptions(`continued-react-late`, () => ({
      id: `continued-react-late`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          lateStarts++
          begin()
          write({ type: `insert`, value: { id: `one`, value: `late` } })
          commit()
          markReady()
        },
      },
    }))
    const original = new Query().from({ base: baseDescriptor })
    const firstRenderDeferrals: DeferredLiveQueryCollections = new Set()
    const prepared = prepareLiveQueryValue(
      original,
      client,
      firstRenderDeferrals,
    ) as typeof original
    for (const source of firstRenderDeferrals) source._resumeSyncStart()
    firstRenderDeferrals.clear()

    const continued = prepared
      .join({ late: lateDescriptor }, ({ base, late }) => eq(base.id, late.id))
      .select(({ base, late }) => ({ id: base.id, value: late.value }))
    expect(lateStarts).toBe(0)

    const mounted = renderHook(() => useLiveQuery({ client, query: continued }))
    await waitFor(() => {
      expect(
        mounted.result.current.data.map(({ id, value }) => ({ id, value })),
      ).toEqual([{ id: `one`, value: `late` }])
    })
    expect(lateStarts).toBe(1)
    mounted.unmount()
  })

  it(`does not start a continued descriptor in a render that never commits`, async () => {
    const client = new DbClient()
    const baseDescriptor = collectionOptions(`abandoned-react-base`, () => ({
      id: `abandoned-react-base`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    let lateMaterializations = 0
    let lateStarts = 0
    const lateDescriptor = collectionOptions(`abandoned-react-late`, () => {
      lateMaterializations++
      return {
        id: `abandoned-react-late`,
        getKey: (row: Row) => row.id,
        startSync: true,
        sync: {
          sync: ({ markReady }) => {
            lateStarts++
            markReady()
          },
        },
      }
    })
    const original = new Query().from({ base: baseDescriptor })
    const never = new Promise<void>(() => {})

    function Abandoned(): ReactNode {
      const deferrals: DeferredLiveQueryCollections = new Set()
      const prepared = prepareLiveQueryValue(
        original,
        client,
        deferrals,
      ) as typeof original
      prepared.join({ late: lateDescriptor }, ({ base, late }) =>
        eq(base.id, late.id),
      )
      throw never
    }

    const mounted = render(
      <Suspense fallback={<div>Waiting</div>}>
        <Abandoned />
      </Suspense>,
    )
    expect(mounted.getByText(`Waiting`)).toBeDefined()
    await act(async () => {})
    expect(lateMaterializations).toBe(0)
    expect(lateStarts).toBe(0)
    mounted.unmount()
  })

  it(`lets a direct reader start a source after a descriptor render suspends`, async () => {
    const client = new DbClient()
    let starts = 0
    const descriptor = collectionOptions(`suspended-direct-reader`, () => ({
      id: `suspended-direct-reader`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
        },
      },
    }))
    const query = new Query().from({ item: descriptor })
    const never = new Promise<void>(() => {})

    function Suspended(): ReactNode {
      useLiveQuery({ query })
      throw never
    }

    const mounted = render(
      <DbProvider client={client}>
        <Suspense fallback={<div>Waiting</div>}>
          <Suspended />
        </Suspense>
      </DbProvider>,
    )
    const source = client.collection(descriptor)
    let directRead: Promise<void> | undefined
    try {
      expect(mounted.getByText(`Waiting`)).toBeDefined()
      expect(starts, `before commit or direct demand`).toBe(0)

      directRead = source.preload()
      void directRead.catch(() => {})
      expect(starts, `direct demand starts the source`).toBe(1)
      await directRead
      expect(source.status).toBe(`ready`)
    } finally {
      mounted.unmount()
      await client.cleanup()
      await directRead?.catch(() => {})
    }
  })

  it(`rejects an unbound descriptor after a same-hash concrete query`, async () => {
    const id = `standalone-descriptor-unbound-transition`
    const concrete = createCollection(
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, value: `concrete` }],
      }),
    )
    const descriptor = collectionOptions(id, () =>
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, value: `descriptor` }],
      }),
    )
    const concreteQuery = new Query()
      .from({ item: concrete })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const unboundQuery = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    expect(getStableQueryBuilderHash(unboundQuery)).toBe(
      getStableQueryBuilderHash(concreteQuery),
    )

    let query = concreteQuery
    const mounted = renderHook(() => useLiveQuery({ query }))
    await waitFor(() => {
      expect(mounted.result.current.data[0]?.value).toBe(`concrete`)
    })

    // The public error is the observation at the attempted consumption cut.
    // Returning the previous row would conceal the missing DbClient.
    query = unboundQuery
    expect(() => mounted.rerender()).toThrow(/requires a DbClient.*DbProvider/)
    mounted.unmount()

    // An explicit identity changes when preparation runs, not the need for a
    // client. Both supported identity forms still owe the React-specific fix.
    expect(() =>
      renderHook(() =>
        useLiveQuery({ query: unboundQuery, queryKey: [`unbound`] }),
      ),
    ).toThrow(/requires a DbClient.*DbProvider/)
    expect(() =>
      renderHook(() => useLiveQuery({ query: unboundQuery }, [])),
    ).toThrow(/requires a DbClient.*DbProvider/)
  })

  it(`rejects a different source after a hook registered the same stream hash`, async () => {
    const id = `hook-first-preload-source`
    let finishFirst!: () => void
    const first = createCollection({
      id,
      getKey: (row: Row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          finishFirst = markReady
        },
      },
    })
    const second = collectionOptions(id, () =>
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, value: `second` }],
      }),
    )
    const firstQuery = new Query()
      .from({ item: first })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const secondQuery = new Query()
      .from({ item: second })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    expect(getStableQueryBuilderHash(firstQuery)).toBe(
      getStableQueryBuilderHash(secondQuery),
    )
    const client = new DbClient()
    client._setSsrStreamingEnabled(true)
    client._setSsrServerCleanupEnabled(true)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbProvider client={client}>
        <Suspense fallback={null}>{children}</Suspense>
      </DbProvider>
    )
    const mounted = renderHook(
      () => useLiveSuspenseQuery({ query: firstQuery }),
      { wrapper },
    )

    try {
      expect(
        client.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toHaveLength(1)
      expect(() => client.preloadLiveQuery({ query: firstQuery })).not.toThrow()
      expect(() => client.preloadLiveQuery({ query: secondQuery })).toThrow(
        /different source Collections/,
      )
    } finally {
      await act(async () => {
        finishFirst()
        await Promise.resolve()
      })
      mounted.unmount()
      await client.cleanup()
      await first.cleanup()
    }
  })

  it(`keeps a hydration-first hook's local source claim for later preloads`, async () => {
    const id = `hydration-first-hook-source`
    let finishBrowser!: () => void
    const descriptor = collectionOptions(id, (client) => ({
      id,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          const publish = () => {
            begin()
            for (const row of client.requireDependency<Array<Row>>(`rows`)) {
              write({ type: `insert`, value: row })
            }
            commit()
            markReady()
          }
          if (client.getDependency<boolean>(`deferReady`)) {
            finishBrowser = publish
          } else {
            publish()
          }
        },
      },
    }))
    const query = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const server = new DbClient({
      rows: [{ id: `one`, value: `server` }],
    })
    const browser = new DbClient({
      rows: [{ id: `one`, value: `browser` }],
      deferReady: true,
    })
    const other = createCollection(
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, value: `other` }],
      }),
    )
    const otherQuery = new Query()
      .from({ item: other })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    let mounted: ReturnType<typeof renderHook> | undefined
    const browserRows = () =>
      (mounted!.result.current as { data: Array<Row> }).data.map((row) => ({
        id: row.id,
        value: row.value,
      }))

    try {
      await server.preloadLiveQuery({ query })
      browser.hydrate(server.dehydrate())
      expect(getStableQueryBuilderHash(query)).toBe(
        getStableQueryBuilderHash(otherQuery),
      )

      mounted = renderHook(() => useLiveQuery({ query }), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={browser}>{children}</DbProvider>
        ),
      })
      await waitFor(() => {
        expect(browserRows()).toEqual([{ id: `one`, value: `server` }])
      })
      expect(
        browser.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toHaveLength(1)
      expect(() => browser.preloadLiveQuery({ query: otherQuery })).toThrow(
        /different source Collections/,
      )
      act(() => finishBrowser())
      await waitFor(() => {
        expect(browserRows()).toEqual([{ id: `one`, value: `browser` }])
      })
    } finally {
      mounted?.unmount()
      await browser.cleanup()
      await server.cleanup()
      await other.cleanup()
    }
  })

  /**
   * Suspense requests data during render so that React has a promise to retry.
   * That preload is local demand even if React never commits the render. The
   * independent ownership rule is first local preload wins: another source
   * object with the same query hash cannot borrow its hydrated stream. The
   * fallback, source start, same-source acceptance, and conflicting-preload
   * error are observed before the held server result settles.
   */
  it(`keeps a hydrated stream's source claim from an abandoned Suspense preload`, async () => {
    const client = new DbClient()
    client._setSsrServerCleanupEnabled(true)
    const server = new DbClient()
    let firstStarts = 0
    let finishFirst: (() => void) | undefined
    let finishSecond: (() => void) | undefined
    const source = (started: (markReady: () => void) => void) =>
      createCollection({
        id: `hydrated-suspense-claim`,
        getKey: (row: Row) => row.id,
        sync: { sync: ({ markReady }) => started(markReady) },
      })
    const first = source((markReady) => {
      firstStarts++
      finishFirst = markReady
    })
    const second = source((markReady) => {
      finishSecond = markReady
    })
    const serverSource = source((markReady) => markReady())
    const queryFor = (collection: typeof first) =>
      new Query()
        .from({ item: collection })
        .select(({ item }) => ({ id: item.id, value: item.value }))
    const firstQuery = queryFor(first)
    const secondQuery = queryFor(second)
    let settle!: (value: { rows: Array<{ key: string; value: Row }> }) => void
    const pending = new Promise<{ rows: Array<{ key: string; value: Row }> }>(
      (resolve) => {
        settle = resolve
      },
    )
    let mounted: ReturnType<typeof render> | undefined

    try {
      expect(getStableQueryBuilderHash(secondQuery)).toBe(
        getStableQueryBuilderHash(firstQuery),
      )
      await server.preloadLiveQuery({ query: queryFor(serverSource) })
      const queryHash = server.dehydrate().liveQueries![0]!.queryHash
      client.hydrate({
        collections: [],
        liveQueries: [{ queryHash, dehydratedAt: 1, promise: pending }],
      })
      const never = new Promise<void>(() => {})
      function Abandoned(): ReactNode {
        useLiveSuspenseQuery({ query: firstQuery })
        throw never
      }

      mounted = render(
        <DbProvider client={client}>
          <Suspense fallback={<div>Waiting</div>}>
            <Abandoned />
          </Suspense>
        </DbProvider>,
      )
      expect(mounted.getByText(`Waiting`)).toBeDefined()
      expect(firstStarts, `Suspense preload begins before commit`).toBe(1)
      expect(() => client.preloadLiveQuery({ query: secondQuery })).toThrow(
        /different source Collections/,
      )
      expect(() => client.preloadLiveQuery({ query: firstQuery })).not.toThrow()
    } finally {
      mounted?.unmount()
      settle({ rows: [] })
      finishFirst?.()
      finishSecond?.()
      await act(async () => {
        await pending
      })
      await client.cleanup()
      await server.cleanup()
      await first.cleanup()
      await second.cleanup()
      await serverSource.cleanup()
    }
  })

  it(`dehydrates a descriptor source first consumed by a committed Effect`, async () => {
    const id = `standalone-descriptor-effect-dehydration`
    const expected = { id: `one`, value: `first` }
    const descriptor = collectionOptions(id, (client) =>
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: client.requireDependency<Array<Row>>(`rows`),
      }),
    )
    const query = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const client = new DbClient({ rows: [{ ...expected }] })
    const observed: Array<Row> = []

    const mounted = renderHook(
      () =>
        useLiveQueryEffect<Row, string>({
          query,
          onEnter: ({ value }) => {
            observed.push({ id: value.id, value: value.value })
          },
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={client}>{children}</DbProvider>
        ),
      },
    )

    // The plain expected row is independent of the Effect and dehydration code.
    // Compare at the settled enter cut, then at the public dehydrate() call.
    await waitFor(() => expect(observed).toEqual([expected]))
    const chunk = client
      .dehydrate()
      .collections.find((collection) => collection.collectionId === id)
    expect(chunk?.rows.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: expected.id, value: expected },
    ])
    mounted.unmount()
  })

  it(`binds an Effect's prebuilt query to its receiving provider`, async () => {
    const descriptor = collectionOptions(
      `standalone-descriptor-effect-rows`,
      (client) =>
        mockSyncCollectionOptions<Row>({
          id: `standalone-descriptor-effect-rows`,
          getKey: (row) => row.id,
          initialData: client.requireDependency<Array<Row>>(`rows`),
        }),
    )
    const query = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const expected = [
      { id: `shared`, value: `first` },
      { id: `shared`, value: `second` },
    ]
    const observed: Array<Array<Row>> = [[], []]
    const updates: Array<Array<Row>> = [[], []]
    const clients = expected.map((row) => new DbClient({ rows: [{ ...row }] }))
    const oldClient = clients[0]!
    const mounted = expected.map((_, index) => {
      return renderHook(
        () =>
          useLiveQueryEffect<Row, string>({
            query,
            onEnter: ({ value }) => {
              observed[index]!.push({ id: value.id, value: value.value })
            },
            onUpdate: ({ value }) => {
              updates[index]!.push({ id: value.id, value: value.value })
            },
          }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <DbProvider client={clients[index]!}>{children}</DbProvider>
          ),
        },
      )
    })

    // At initial publication, each Effect must report its own client's row.
    await waitFor(() => {
      expect(observed).toEqual(expected.map((row) => [row]))
    })

    clients[0] = clients[1]!
    mounted[0]!.rerender()
    await waitFor(() => {
      expect(observed[0]).toEqual([expected[0], expected[1]])
    })

    act(() => {
      oldClient.collection(descriptor).update(`shared`, (draft) => {
        draft.value = `old write`
      })
    })
    await act(async () => {})
    expect(observed[0]).toEqual([expected[0], expected[1]])
    expect(updates[0]).toEqual([])

    act(() => {
      clients[1]!.collection(descriptor).update(`shared`, (draft) => {
        draft.value = `new write`
      })
    })
    await waitFor(() => {
      expect(updates[0]).toEqual([{ id: `shared`, value: `new write` }])
    })

    mounted.forEach((hook) => hook.unmount())
  })

  it.each(histories)(
    `binds one prebuilt Query to each receiving DbClient with $name`,
    async ({ name, initial, writes }) => {
      const descriptor = collectionOptions(
        `standalone-descriptor-rows-${name}`,
        (client) =>
          mockSyncCollectionOptions<Row>({
            id: `standalone-descriptor-rows-${name}`,
            getKey: (row) => row.id,
            initialData: client.requireDependency<Array<Row>>(`rows`),
          }),
      )
      // Definition happens outside React and before either DbClient exists.
      const query = new Query()
        .from({ item: descriptor })
        .select(({ item }) => ({ id: item.id, value: item.value }))
      const firstModel = new Map<string, Row>([
        [initial.first.id, initial.first],
      ])
      const secondModel = new Map<string, Row>([
        [initial.second.id, initial.second],
      ])
      const seedRows = (model: ReadonlyMap<string, Row>) =>
        expectedRows(model).map((row) => ({ ...row }))
      const firstClient = new DbClient({ rows: seedRows(firstModel) })
      const secondClient = new DbClient({ rows: seedRows(secondModel) })
      const planIdentity = getStableQueryBuilderHash(query)
      const boundShape = (client: DbClient) =>
        new Query()
          .from({ item: client.collection(descriptor) })
          .select(({ item }) => ({ id: item.id, value: item.value }))
      expect(planIdentity).toBe(
        getStableQueryBuilderHash(boundShape(firstClient)),
      )
      expect(planIdentity).toBe(
        getStableQueryBuilderHash(boundShape(secondClient)),
      )
      let firstReceivingClient = firstClient
      const first = renderHook(() => useLiveQuery({ query }), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={firstReceivingClient}>{children}</DbProvider>
        ),
      })
      const second = renderHook(() => useLiveQuery({ query }), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={secondClient}>{children}</DbProvider>
        ),
      })

      // Compare after each publication. The same descriptor ID and query shape
      // must not make either provider observe the other provider's Collection.
      const check = async (
        firstScopeModel: ReadonlyMap<string, Row> = firstModel,
      ) => {
        await waitFor(() => {
          for (const [observed, model] of [
            [first.result.current.data, firstScopeModel],
            [second.result.current.data, secondModel],
          ] as const) {
            expect(
              observed
                .map(({ id, value }) => ({ id, value }))
                .sort((left, right) => left.id.localeCompare(right.id)),
            ).toEqual(expectedRows(model))
            for (const row of observed) {
              expect(row.$key).toBe(row.id)
              expect(Object.keys(row).sort()).toEqual(
                [
                  `$collectionId`,
                  `$hasPendingWrites`,
                  `$key`,
                  `$origin`,
                  `$synced`,
                  `id`,
                  `value`,
                ].sort(),
              )
            }
          }
        })
      }
      await check()
      expect(firstClient.collection(descriptor)).not.toBe(
        secondClient.collection(descriptor),
      )

      const write = (client: DbClient, model: Map<string, Row>, next: Row) => {
        act(() => {
          const collection = client.collection(descriptor)
          if (model.has(next.id)) {
            collection.update(next.id, (draft) => {
              draft.value = next.value
            })
          } else {
            collection.insert({ ...next })
          }
        })
        model.set(next.id, { ...next })
      }

      write(firstClient, firstModel, writes.first)
      await check()

      write(secondClient, secondModel, writes.second)
      await check()

      firstReceivingClient = secondClient
      first.rerender()
      await check(secondModel)
      firstReceivingClient = firstClient
      first.rerender()
      await check()

      first.unmount()
      second.unmount()
    },
  )

  it.each([`join`, `nestedFrom`, `union`, `include`] as const)(
    `keeps two descriptor sources local to each provider in a %s query`,
    async (form) => {
      type Parent = { id: string; value: string }
      type Child = { id: string; parentId: string; value: string }
      const parentDescriptor = collectionOptions(
        `two-source-parent-${form}`,
        (client) =>
          mockSyncCollectionOptions<Parent>({
            id: `two-source-parent-${form}`,
            getKey: (row) => row.id,
            initialData: client.requireDependency<Array<Parent>>(`parents`),
          }),
      )
      const childDescriptor = collectionOptions(
        `two-source-child-${form}`,
        (client) =>
          mockSyncCollectionOptions<Child>({
            id: `two-source-child-${form}`,
            getKey: (row) => row.id,
            initialData: client.requireDependency<Array<Child>>(`children`),
          }),
      )

      // One plan is built before either client. Each client supplies two
      // distinct source rows; aliases and query identity are shared.
      const joined = () =>
        new Query()
          .from({ parent: parentDescriptor })
          .innerJoin({ child: childDescriptor }, ({ parent, child }) =>
            eq(parent.id, child.parentId),
          )
          .select(({ parent, child }) => ({
            id: parent.id,
            value: parent.value,
            childValue: child.value,
          }))
      const query =
        form === `join`
          ? joined()
          : form === `nestedFrom`
            ? new Query().from({ wrapper: joined() }).select(({ wrapper }) => ({
                id: wrapper.id,
                value: wrapper.value,
                childValue: wrapper.childValue,
              }))
            : form === `union`
              ? new Query().unionAll(
                  new Query()
                    .from({ parent: parentDescriptor })
                    .select(({ parent }) => ({
                      id: parent.id,
                      value: parent.value,
                    })),
                  new Query()
                    .from({ child: childDescriptor })
                    .select(({ child }) => ({
                      id: child.id,
                      value: child.value,
                    })),
                )
              : new Query()
                  .from({ parent: parentDescriptor })
                  .select(({ parent }) => ({
                    id: parent.id,
                    value: parent.value,
                    children: toArray(
                      new Query()
                        .from({ child: childDescriptor })
                        .where(({ child }) => eq(child.parentId, parent.id))
                        .select(({ child }) => ({
                          id: child.id,
                          value: child.value,
                        })),
                    ),
                  }))
      const hookQuery = query as QueryBuilder<Context>
      const first = new DbClient({
        parents: [{ id: `parent`, value: `FIRST PARENT` }],
        children: [{ id: `child`, parentId: `parent`, value: `FIRST CHILD` }],
      })
      const second = new DbClient({
        parents: [{ id: `parent`, value: `SECOND PARENT` }],
        children: [{ id: `child`, parentId: `parent`, value: `SECOND CHILD` }],
      })
      const models = new Map([
        [first, { parent: `FIRST PARENT`, child: `FIRST CHILD` }],
        [second, { parent: `SECOND PARENT`, child: `SECOND CHILD` }],
      ])
      const mounted = [first, second].map((client) => ({
        client,
        hook: renderHook(() => useLiveQuery({ query: hookQuery }), {
          wrapper: ({ children }: { children: ReactNode }) => (
            <DbProvider client={client}>{children}</DbProvider>
          ),
        }),
      }))

      /** The model recomputes rows from each client's two plain values. */
      const expected = (client: DbClient) => {
        const values = models.get(client)!
        return form === `union`
          ? [
              { id: `child`, value: values.child },
              { id: `parent`, value: values.parent },
            ]
          : form === `join` || form === `nestedFrom`
            ? [
                {
                  id: `parent`,
                  value: values.parent,
                  childValue: values.child,
                },
              ]
            : [
                {
                  id: `parent`,
                  value: values.parent,
                  children: [{ id: `child`, value: values.child }],
                },
              ]
      }
      const check = async (cut: string) => {
        await waitFor(() => {
          for (const { client, hook } of mounted) {
            const rows = (
              hook.result.current.data as Array<{
                id: string
                value: string
                childValue?: string
                children?: Array<{ id: string; value: string }>
              }>
            )
              .map((row) => ({
                id: row.id,
                value: row.value,
                ...(form === `join` || form === `nestedFrom`
                  ? { childValue: row.childValue }
                  : {}),
                ...(form === `include`
                  ? {
                      children: (row.children ?? []).map((child) => ({
                        id: child.id,
                        value: child.value,
                      })),
                    }
                  : {}),
              }))
              .sort((a, b) => a.id.localeCompare(b.id))
            expect(
              rows,
              `${cut}: ${client === first ? `first` : `second`}`,
            ).toEqual(expected(client))
          }
        })
      }

      try {
        await check(`initial publication`)
        act(() => {
          first.collection(childDescriptor).update(`child`, (draft) => {
            draft.value = `FIRST CHILD 2`
          })
        })
        models.get(first)!.child = `FIRST CHILD 2`
        await check(`first child write`)

        act(() => {
          second.collection(parentDescriptor).update(`parent`, (draft) => {
            draft.value = `SECOND PARENT 2`
          })
        })
        models.get(second)!.parent = `SECOND PARENT 2`
        await check(`second parent write`)
      } finally {
        for (const { hook } of mounted) {
          hook.unmount()
          await hook.result.current.collection.cleanup()
        }
        await first.cleanup()
        await second.cleanup()
      }
    },
  )

  it.each([`shadowed`, `renamed`] as const)(
    `keeps client and lexical source identity in a %s descriptor include`,
    async (aliasForm) => {
      type Parent = { id: string; value: string }
      type Child = { id: string; parentId: string; value: string }
      const parentDescriptor = collectionOptions(
        `combined-parent-${aliasForm}`,
        (client) =>
          mockSyncCollectionOptions<Parent>({
            id: `combined-parent-${aliasForm}`,
            getKey: (row) => row.id,
            initialData: client.requireDependency<Array<Parent>>(`parents`),
          }),
      )
      const childDescriptor = collectionOptions(
        `combined-child-${aliasForm}`,
        (client) =>
          mockSyncCollectionOptions<Child>({
            id: `combined-child-${aliasForm}`,
            getKey: (row) => row.id,
            initialData: client.requireDependency<Array<Child>>(`children`),
          }),
      )

      // Both branches promise the same rows. Renaming only the child alias
      // must not change which client or lexical source supplies either value.
      const query =
        aliasForm === `shadowed`
          ? new Query()
              .from({ issue: parentDescriptor })
              .select(({ issue }) => ({
                id: issue.id,
                value: issue.value,
                children: toArray(
                  new Query()
                    .from({ issue: childDescriptor })
                    .where(({ issue: child }) => eq(child.parentId, issue.id))
                    .select(({ issue: child }) => ({
                      id: child.id,
                      value: child.value,
                      parentValue: issue.value,
                    })),
                ),
              }))
          : new Query()
              .from({ issue: parentDescriptor })
              .select(({ issue }) => ({
                id: issue.id,
                value: issue.value,
                children: toArray(
                  new Query()
                    .from({ child: childDescriptor })
                    .where(({ child }) => eq(child.parentId, issue.id))
                    .select(({ child }) => ({
                      id: child.id,
                      value: child.value,
                      parentValue: issue.value,
                    })),
                ),
              }))
      const first = new DbClient({
        parents: [{ id: `p`, value: `FIRST PARENT` }],
        children: [{ id: `c`, parentId: `p`, value: `FIRST CHILD` }],
      })
      const second = new DbClient({
        parents: [{ id: `p`, value: `SECOND PARENT` }],
        children: [{ id: `c`, parentId: `p`, value: `SECOND CHILD` }],
      })
      const model = new Map([
        [first, { parent: `FIRST PARENT`, child: `FIRST CHILD` }],
        [second, { parent: `SECOND PARENT`, child: `SECOND CHILD` }],
      ])
      const mounted = [first, second].map((client) => ({
        client,
        hook: renderHook(
          () => useLiveQuery({ query: query as QueryBuilder<Context> }),
          {
            wrapper: ({ children }: { children: ReactNode }) => (
              <DbProvider client={client}>{children}</DbProvider>
            ),
          },
        ),
      }))
      const check = async (cut: string) => {
        await waitFor(() => {
          for (const { client, hook } of mounted) {
            const values = model.get(client)!
            const rows = (
              hook.result.current.data as Array<{
                id: string
                value: string
                children: Array<{
                  id: string
                  value: string
                  parentValue: string
                }>
              }>
            ).map((row) => ({
              id: row.id,
              value: row.value,
              children: row.children.map((child) => ({
                id: child.id,
                value: child.value,
                parentValue: child.parentValue,
              })),
            }))
            expect(rows, `${cut}: public rows`).toEqual([
              {
                id: `p`,
                value: values.parent,
                children: [
                  {
                    id: `c`,
                    value: values.child,
                    parentValue: values.parent,
                  },
                ],
              },
            ])
          }
        })
      }

      try {
        await check(`initial publication`)
        const bound = prepareLiveQueryValue(
          query,
          first,
        ) as QueryBuilder<Context>
        expect(getStableQueryBuilderHash(bound)).toBe(
          getStableQueryBuilderHash(query),
        )
        act(() => {
          first.collection(childDescriptor).update(`c`, (draft) => {
            draft.value = `FIRST CHILD 2`
          })
        })
        model.get(first)!.child = `FIRST CHILD 2`
        await check(`first child write`)
        act(() => {
          second.collection(parentDescriptor).update(`p`, (draft) => {
            draft.value = `SECOND PARENT 2`
          })
        })
        model.get(second)!.parent = `SECOND PARENT 2`
        await check(`second parent write`)
      } finally {
        for (const { hook } of mounted) {
          hook.unmount()
          await hook.result.current.collection.cleanup()
        }
        await first.cleanup()
        await second.cleanup()
      }
    },
  )

  /**
   * A descriptor plan keeps both its receiving client and each source's
   * lexical binding. The plain model pairs main and joined rows by ID, then
   * restricts the pair to its parent. A missing join side stays undefined even
   * when the parent and local main sources both spell their alias `issue`.
   * RIGHT/FULL, correlation side, alias spelling, and source mode are legal
   * dimensions. Two clients have the same row IDs but distinct values. The
   * public comparison runs after initial acquisition and every authored write;
   * on-demand cells also observe each client's provider requests.
   */
  const outerJoinHistories = [
    { kind: `right`, correlation: `joined` },
    { kind: `right`, correlation: `main` },
    { kind: `full`, correlation: `joined` },
    { kind: `full`, correlation: `main` },
  ] as const
  for (const { kind, correlation } of outerJoinHistories) {
    for (const mode of [`eager`, `onDemand`] as const) {
      it(`${kind} join with ${correlation} correlation binds shadowed and renamed descriptors per client in ${mode} mode`, async () => {
        type Parent = { id: number; marker: string }
        type Main = {
          id: number
          parentId: number
          anchorId: number
          label: string
        }
        type Anchor = { id: number; parentId: number }
        type Sources = {
          parents: Map<number, Parent>
          mains: Map<number, Main>
          anchors: Map<number, Anchor>
        }
        type Role = keyof Sources
        type Expected = {
          parentId: number
          mainId: number | undefined
          anchorId: number | undefined
          label: string | undefined
          marker: string
          missingMain: boolean
          missingAnchor: boolean
        }

        const initial = (marker: string): Sources => ({
          parents: new Map([[1, { id: 1, marker }]]),
          mains: new Map([
            [
              10,
              { id: 10, parentId: 1, anchorId: 7, label: `${marker} MATCH` },
            ],
            [
              11,
              {
                id: 11,
                parentId: 1,
                anchorId: 9,
                label: `${marker} MAIN ONLY`,
              },
            ],
          ]),
          anchors: new Map([
            [7, { id: 7, parentId: 1 }],
            [8, { id: 8, parentId: 1 }],
          ]),
        })
        const first = new DbClient({ marker: `FIRST` })
        const second = new DbClient({ marker: `SECOND` })
        const models = new Map<DbClient, Sources>([
          [first, initial(`FIRST`)],
          [second, initial(`SECOND`)],
        ])
        const counters = new Map<
          DbClient,
          Map<Role, { starts: number; requests: number }>
        >()
        const writers = new Map<
          DbClient,
          Map<
            Role,
            (type: `insert` | `update` | `delete`, row: unknown) => void
          >
        >()

        /** The adapter reads authored source rows; expected rows use only maps. */
        const descriptor = <T extends { id: number }>(
          role: Role,
          suffix: string,
        ) =>
          collectionOptions(
            `combined-outer-${kind}-${correlation}-${mode}-${suffix}`,
            (client) => ({
              id: `combined-outer-${kind}-${correlation}-${mode}-${suffix}`,
              getKey: (row: T) => row.id,
              startSync: true,
              ...(role !== `parents` && mode === `onDemand`
                ? { syncMode: `on-demand` as const }
                : {}),
              sync: {
                sync: ({ begin, write, commit, markReady }) => {
                  const clientCounters = counters.get(client) ?? new Map()
                  counters.set(client, clientCounters)
                  const count = clientCounters.get(role) ?? {
                    starts: 0,
                    requests: 0,
                  }
                  clientCounters.set(role, count)
                  count.starts++
                  const installed = new Set<number>()
                  const send = (
                    type: `insert` | `update` | `delete`,
                    row: T,
                  ) => {
                    begin()
                    write({ type, value: { ...row } })
                    commit()
                    if (type === `delete`) installed.delete(row.id)
                    else installed.add(row.id)
                  }
                  const clientWriters =
                    writers.get(client) ??
                    new Map<
                      Role,
                      (
                        type: `insert` | `update` | `delete`,
                        row: unknown,
                      ) => void
                    >()
                  writers.set(client, clientWriters)
                  clientWriters.set(role, (type, row) => send(type, row as T))
                  const rows = () =>
                    [
                      ...models.get(client)![role].values(),
                    ] as unknown as Array<T>
                  if (role === `parents` || mode === `eager`) {
                    for (const row of rows()) send(`insert`, row)
                  }
                  markReady()
                  if (role !== `parents` && mode === `onDemand`) {
                    return {
                      loadSubset: () => {
                        count.requests++
                        for (const row of rows()) {
                          if (!installed.has(row.id)) send(`insert`, row)
                        }
                        return Promise.resolve()
                      },
                    }
                  }
                  return undefined
                },
              },
            }),
          )

        const parents = descriptor<Parent>(`parents`, `parent`)
        const mains = descriptor<Main>(`mains`, `main`)
        const anchors = descriptor<Anchor>(`anchors`, `anchor`)
        const cases = ([`issue`, `child`] as const).map((alias) => {
          const query = new Query()
            .from({ issue: parents })
            .select(({ issue: parent }) => {
              const joinedSource =
                correlation === `joined`
                  ? new Query()
                      .from({ source: anchors })
                      .where(({ source }) => eq(source.parentId, parent.id))
                      .select(({ source }) => ({
                        id: source.id,
                        parentId: source.parentId,
                      }))
                  : anchors
              const child = new Query()
                .from({ [alias]: mains })
                .join(
                  { anchor: joinedSource },
                  (context: Record<string, unknown>) =>
                    eq(
                      (context[alias] as Main).anchorId,
                      (context.anchor as Anchor).id,
                    ),
                  kind,
                )
                .where((context: Record<string, unknown>) =>
                  correlation === `joined`
                    ? eq((context.anchor as Anchor).parentId, parent.id)
                    : eq((context[alias] as Main).parentId, parent.id),
                )
                .select((context: Record<string, unknown>) => ({
                  mainId: (context[alias] as Main).id,
                  anchorId: (context.anchor as Anchor).id,
                  label: (context[alias] as Main).label,
                  marker: parent.marker,
                  missingMain: isUndefined((context[alias] as Main).id),
                  missingAnchor: isUndefined((context.anchor as Anchor).id),
                }))
              return { id: parent.id, rows: toArray(child) }
            })
          return {
            alias,
            query,
            mounted: [first, second].map((client) => ({
              client,
              hook: renderHook(
                () => useLiveQuery({ query: query as QueryBuilder<Context> }),
                {
                  wrapper: ({ children }: { children: ReactNode }) => (
                    <DbProvider client={client}>{children}</DbProvider>
                  ),
                },
              ),
            })),
          }
        })

        /** The model uses source roles and values, never lexical alias text. */
        const expected = (sources: Sources): Array<Expected> => {
          const mainsNow = [...sources.mains.values()]
          const anchorsNow = [...sources.anchors.values()]
          const pairs: Array<[Main | undefined, Anchor | undefined]> = []
          for (const anchor of anchorsNow) {
            const matches = mainsNow.filter(
              (main) => main.anchorId === anchor.id,
            )
            if (matches.length === 0) pairs.push([undefined, anchor])
            else for (const main of matches) pairs.push([main, anchor])
          }
          if (kind === `full`) {
            for (const main of mainsNow) {
              if (!anchorsNow.some((anchor) => anchor.id === main.anchorId)) {
                pairs.push([main, undefined])
              }
            }
          }
          return [...sources.parents.values()]
            .flatMap((parent) =>
              pairs
                .filter(([main, anchor]) =>
                  correlation === `joined`
                    ? anchor?.parentId === parent.id
                    : main?.parentId === parent.id,
                )
                .map(([main, anchor]) => ({
                  parentId: parent.id,
                  mainId: main?.id,
                  anchorId: anchor?.id,
                  label: main?.label,
                  marker: parent.marker,
                  missingMain: main === undefined,
                  missingAnchor: anchor === undefined,
                })),
            )
            .sort(
              (a, b) =>
                a.parentId - b.parentId ||
                (a.anchorId ?? Infinity) - (b.anchorId ?? Infinity) ||
                (a.mainId ?? Infinity) - (b.mainId ?? Infinity),
            )
        }
        const observe = (
          data: ReadonlyArray<{
            id: number
            rows: Array<Omit<Expected, `parentId`>>
          }>,
        ): Array<Expected> =>
          data
            .flatMap((parent) =>
              parent.rows.map((row) => ({ parentId: parent.id, ...row })),
            )
            .sort(
              (a, b) =>
                a.parentId - b.parentId ||
                (a.anchorId ?? Infinity) - (b.anchorId ?? Infinity) ||
                (a.mainId ?? Infinity) - (b.mainId ?? Infinity),
            )
        const check = async (cut: string) => {
          await waitFor(() => {
            for (const entry of cases) {
              for (const { client, hook } of entry.mounted) {
                const rows = hook.result.current.data as unknown as Array<{
                  id: number
                  rows: Array<Omit<Expected, `parentId`>>
                }>
                expect(observe(rows), `${entry.alias}, ${cut}`).toEqual(
                  expected(models.get(client)!),
                )
              }
            }
          })
        }
        const change = <T extends { id: number }>(
          client: DbClient,
          role: Role,
          type: `insert` | `update` | `delete`,
          row: T,
        ) => {
          const source = models.get(client)![role] as unknown as Map<number, T>
          if (type === `delete`) source.delete(row.id)
          else source.set(row.id, row)
          act(() => {
            writers.get(client)!.get(role)!(type, row)
          })
        }

        try {
          await check(`initial acquisition`)
          for (const client of [first, second]) {
            for (const role of [`parents`, `mains`, `anchors`] as const) {
              expect(counters.get(client)?.get(role)?.starts).toBe(1)
              if (role !== `parents` && mode === `onDemand`) {
                expect(
                  counters.get(client)?.get(role)?.requests,
                ).toBeGreaterThan(0)
              }
            }
          }
          for (const entry of cases) {
            expect(
              getStableQueryBuilderHash(
                prepareLiveQueryValue(
                  entry.query,
                  first,
                ) as QueryBuilder<Context>,
              ),
            ).toBe(getStableQueryBuilderHash(entry.query))
            expect(
              getStableQueryBuilderHash(
                prepareLiveQueryValue(
                  entry.query,
                  second,
                ) as QueryBuilder<Context>,
              ),
            ).toBe(getStableQueryBuilderHash(entry.query))
          }

          change(first, `mains`, `update`, {
            id: 10,
            parentId: 1,
            anchorId: 7,
            label: `FIRST UPDATED`,
          })
          await check(`first client main update`)
          change(second, `mains`, `delete`, models.get(second)!.mains.get(10)!)
          await check(`second client main becomes absent`)
          change(second, `mains`, `insert`, {
            id: 10,
            parentId: 1,
            anchorId: 7,
            label: `SECOND RETURNED`,
          })
          await check(`second client main returns`)
          change(first, `anchors`, `delete`, models.get(first)!.anchors.get(7)!)
          await check(`first client joined side becomes absent`)
          change(second, `parents`, `update`, {
            id: 1,
            marker: `SECOND UPDATED`,
          })
          await check(`second client parent update`)
        } finally {
          for (const entry of cases) {
            for (const { hook } of entry.mounted) {
              hook.unmount()
              await hook.result.current.collection.cleanup()
            }
          }
          await first.cleanup()
          await second.cleanup()
        }
      })
    }
  }
})
