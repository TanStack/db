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
 * order; hydration from another process has no comparable object identity.
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
  prepareLiveQueryValue,
} from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { Suspense } from 'react'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveQueryEffect } from '../src/useLiveQueryEffect'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { DeferredLiveQueryCollections } from '@tanstack/db'
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
})
