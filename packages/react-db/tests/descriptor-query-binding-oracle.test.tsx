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
 * source before reusing the old live-query Collection. Both explicit identity
 * forms of the ordinary and Suspense hooks owe the same React error naming
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
 * reader. An ordinary subscription or preload is independent demand for data:
 * it starts the source even though the earlier render never committed. A
 * deferring subscription retains the zero-start cut. The finite grammar crosses
 * all four readers with startSync true/false and eager/on-demand sources. It
 * extends ordinary admission with loading/ready callback cleanup, including
 * held resource cleanup. The shared lifecycle judgment predicts adapter entries
 * and the complete status trace at admission return and cleanup settlement.
 * Later demand restarts a retired source or reuses its existing run. Rows are
 * checked only without callback cleanup; on-demand source preload alone does
 * not request rows. These histories do not cover arbitrary concurrent render
 * schedules or Electric transaction evidence.
 */
import { Writable } from 'node:stream'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import {
  BTreeIndex,
  DbClient,
  Query,
  UnhashableQueryIRError,
  collectionOptions,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLiveQueryHash,
  getStableQueryBuilderHash,
  isUndefined,
  prepareLiveQueryValue,
  toArray,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { Component, Suspense } from 'react'
import { renderToPipeableStream, renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { routerWithDbClient } from '../../react-router-with-db/src'
import {
  expectedSsrSnapshot,
  ssrSnapshotExamples,
  ssrSnapshotHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import { ssrStreamHydrationMismatches } from '../../db/tests/ssr-stream-view-oracle'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveQueryEffect } from '../src/useLiveQueryEffect'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { createDeferred } from '../../db/src/deferred'
import {
  expectedStartHandoff,
  modelSubscriberStartCleanup,
  subscriberStartCleanupHistories,
} from '../../db/tests/collection-subscription-lifecycle-grammar-oracle'
import type { DehydratedRouterDbState } from '../../react-router-with-db/src'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'
import type { SsrStreamHistory } from '../../db/tests/ssr-stream-view-oracle'
import type {
  Context,
  DeferredLiveQueryCollections,
  QueryBuilder,
} from '@tanstack/db'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

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

  // A suspended render owns no provider demand. A later independent reader
  // does: ordinary subscriptions and preloads start exactly one sync run,
  // while a deferring subscription preserves the zero-start cut. Ordinary
  // admission also crosses startup cleanup: cleanup retires this start, and
  // only fresh later demand can restart it. Both startSync settings must work.
  it.each(
    (
      [
        { reader: `preload`, startSync: true },
        { reader: `preload`, startSync: false },
        { reader: `subscriber`, startSync: true },
        { reader: `subscriber`, startSync: false },
        { reader: `resumed subscriber`, startSync: true },
        { reader: `resumed subscriber`, startSync: false },
        { reader: `deferring subscriber`, startSync: true },
        { reader: `deferring subscriber`, startSync: false },
      ] as const
    ).flatMap((history) =>
      ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
        (history.reader === `subscriber` ||
        history.reader === `resumed subscriber`
          ? subscriberStartCleanupHistories
          : [subscriberStartCleanupHistories[0]]
        ).map((cleanupHistory) => ({
          ...history,
          syncMode,
          ...cleanupHistory,
        })),
      ),
    ),
  )(
    `$reader after an abandoned render (startSync=$startSync, $syncMode, cleanup=$cleanupAt, pending=$cleanupPending)`,
    async (history) => {
      const { reader, startSync, syncMode, cleanupAt, cleanupPending } = history
      const expected = modelSubscriberStartCleanup(history)
      const pendingCleanup = createDeferred<void>()
      const client = new DbClient()
      let starts = 0
      let cleanups = 0
      const descriptor = collectionOptions(`suspended-direct-reader`, () => ({
        id: `suspended-direct-reader`,
        getKey: (row: Row) => row.id,
        startSync,
        syncMode,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            starts++
            const publish = () => {
              begin()
              write({ type: `insert`, value: { id: `one`, value: `live` } })
              commit()
              return true as const
            }
            if (syncMode === `eager`) publish()
            markReady()
            return {
              loadSubset: publish,
              cleanup: () => {
                cleanups++
                return cleanupPending ? pendingCleanup.promise : undefined
              },
            }
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
      const statuses: Array<string> = []
      let cleanup: Promise<void> | undefined
      let cleanupRequested = false
      const removeStatusListener = source.on(`status:change`, ({ status }) => {
        statuses.push(status)
        if (!cleanupRequested && status === cleanupAt) {
          cleanupRequested = true
          cleanup = source.cleanup()
        }
      })
      let directRead: Promise<void> | undefined
      let subscription: ReturnType<typeof source.subscribeChanges> | undefined
      let peer: ReturnType<typeof source.subscribeChanges> | undefined
      try {
        expect(mounted.getByText(`Waiting`)).toBeDefined()
        expect(starts, `before commit or direct demand`).toBe(0)

        if (reader === `preload`) {
          directRead = source.preload()
          void directRead.catch(() => {})
        } else {
          subscription = source.subscribeChanges(() => {}, {
            deferAcquisition:
              reader === `deferring subscriber` ||
              reader === `resumed subscriber`,
            includeInitialState: true,
          })
          if (reader === `resumed subscriber`) {
            expect(
              starts,
              `deferred demand preserves the abandoned-render cut`,
            ).toBe(0)
            subscription.resumeDeferredAcquisition()
          }
        }
        expect(starts, `direct demand starts the source`).toBe(
          reader === `deferring subscriber` ? 0 : expected.starts,
        )
        expect(cleanups).toBe(expected.cleanups)
        expect(source.status).toBe(
          reader === `deferring subscriber` ? `idle` : expected.statusOnReturn,
        )
        expect(statuses).toEqual(
          reader === `deferring subscriber` ? [] : expected.statusesOnReturn,
        )
        pendingCleanup.resolve()
        await cleanup
        await directRead
        expect(source.status).toBe(
          reader === `deferring subscriber`
            ? `idle`
            : expected.statusAfterCleanup,
        )
        expect(statuses).toEqual(
          reader === `deferring subscriber`
            ? []
            : expected.statusesAfterCleanup,
        )
        if (cleanupAt === `none`) {
          const expectsRow =
            reader !== `deferring subscriber` &&
            (syncMode === `eager` ||
              reader === `subscriber` ||
              reader === `resumed subscriber`)
          expect(source.get(`one`)?.value).toBe(expectsRow ? `live` : undefined)
        }
        removeStatusListener()
        if (reader !== `deferring subscriber`) {
          peer = source.subscribeChanges(() => {})
          expect(starts, `later demand reuses or restarts the source`).toBe(
            expected.starts + (cleanupAt === `none` ? 0 : 1),
          )
          expect(source.status).toBe(`ready`)
        }
      } finally {
        removeStatusListener()
        pendingCleanup.resolve()
        await cleanup
        peer?.unsubscribe()
        subscription?.unsubscribe()
        mounted.unmount()
        await client.cleanup()
        await directRead?.catch(() => {})
      }
    },
  )

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
    expect(() =>
      renderHook(() =>
        useLiveSuspenseQuery({
          query: unboundQuery,
          queryKey: [`unbound-suspense`],
        }),
      ),
    ).toThrow(/requires a DbClient.*DbProvider/)
    expect(() =>
      renderHook(() => useLiveSuspenseQuery(() => unboundQuery, [])),
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

/**
 * React receives the source-error premise through actual descriptor startup.
 * The shared conformance contract exposes ordinary hook errors as a readable
 * status. The start-handoff judgment distinguishes a returned markError from
 * a synchronous throw; neither permits a failed commit to retain ownership.
 * Each hook has independent campaigns and reach checks. The grammar varies
 * defined/absent causes, callback return/throw, and failure before/during commit.
 * Before-commit failures come from independent DbClient startup, whose throw
 * belongs to that caller. We observe the boundary and result after commit,
 * and Collection ownership immediately after unmount, before GC can hide a leak.
 */
describe(`descriptor error handoff at React commit`, () => {
  class Boundary extends Component<
    { children: ReactNode; caught: Array<unknown> },
    { failed: boolean }
  > {
    state = { failed: false }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    componentDidCatch(error: unknown) {
      this.props.caught.push(error)
    }
    render() {
      return this.state.failed ? null : this.props.children
    }
  }
  const properties = {
    'error-surface': `react.descriptor-error-surface`,
    ownership: `react.descriptor-ownership`,
  } as const
  for (const hook of [`ordinary`, `infinite`] as const) {
    for (const observation of [`error-surface`, `ownership`] as const) {
      for (const campaign of [`fixed`, `random`] as const) {
        it(`${hook} ${observation} after descriptor failure (${campaign})`, async () => {
          const reach = createOracleReach(`react-error-handoff-${hook}`, [
            `mark-error-before-release`,
            `mark-error-during-release`,
            `throw-before-release`,
            `throw-during-release`,
            `undefined-cause`,
          ])
          await fc.assert(
            fc.asyncProperty(
              fc.record({
                outcome: fc.constantFrom(
                  `mark-error` as const,
                  `throw` as const,
                ),
                cause: fc.constantFrom(`error` as const, `undefined` as const),
                timing: fc.constantFrom(
                  `before-release` as const,
                  `during-release` as const,
                ),
              }),
              async (history) => {
                reach.beginHistory()
                const failure =
                  history.cause === `error`
                    ? new Error(`source startup`)
                    : undefined
                const client = new DbClient()
                let starts = 0
                const descriptor = collectionOptions(
                  `react-handoff-error`,
                  () => ({
                    id: `react-handoff-error`,
                    syncMode: `eager`,
                    autoIndex: `eager`,
                    defaultIndexType: BTreeIndex,
                    getKey: (row: Row) => row.id,
                    startSync: true,
                    gcTime: 0,
                    sync: {
                      sync: ({ markError }) => {
                        starts++
                        if (history.outcome === `throw`) throw failure
                        markError(failure)
                      },
                    },
                  }),
                )
                const query = new Query()
                  .from({ item: descriptor })
                  .orderBy(({ item }) => item.id)
                const caught: Array<unknown> = []
                let current:
                  | {
                      isError?: boolean
                      status: string
                      collection?: {
                        subscriberCount: number
                        cleanup: () => Promise<void>
                      }
                    }
                  | undefined
                function Consumer() {
                  current =
                    hook === `ordinary`
                      ? useLiveQuery({ query })
                      : useLiveInfiniteQuery(() => query, { pageSize: 1 })
                  return null
                }
                const consoleError = vi
                  .spyOn(console, `error`)
                  .mockImplementation(() => {})
                let mounted: ReturnType<typeof render> | undefined
                try {
                  if (history.timing === `before-release`) {
                    let threw = false
                    try {
                      client.collection(descriptor)
                    } catch (error) {
                      threw = true
                      expect(error).toBe(failure)
                    }
                    expect(
                      threw,
                      `independent startup owns its exception`,
                    ).toBe(history.outcome === `throw`)
                    expect(client.collection(descriptor).status).toBe(`error`)
                    expect(starts).toBe(1)
                  }
                  mounted = render(
                    <DbProvider client={client}>
                      <Boundary caught={caught}>
                        <Consumer />
                      </Boundary>
                    </DbProvider>,
                  )
                  await act(async () => {})
                  expect(starts, `commit does not repeat source startup`).toBe(
                    expectedStartHandoff(history).starts,
                  )
                  reach.reach(`${history.outcome}-${history.timing}`)
                  if (history.cause === `undefined`)
                    reach.reach(`undefined-cause`)
                  if (observation === `error-surface`) {
                    const expected = expectedStartHandoff(history)
                    if (!expected.throws) {
                      expect(caught, `ordinary errors remain readable`).toEqual(
                        [],
                      )
                      expect(current?.status).toBe(expected.status)
                      expect(current?.isError).toBe(true)
                    } else {
                      expect(
                        caught,
                        `a thrown start remains fail-fast`,
                      ).toHaveLength(1)
                    }
                  }
                  mounted.unmount()
                  expect(current?.collection).toBeDefined()
                  if (current?.collection)
                    expect(
                      current.collection.subscriberCount,
                      `commit/unmount releases every hook owner`,
                    ).toBe(0)
                } finally {
                  mounted?.unmount()
                  consoleError.mockRestore()
                  await current?.collection?.cleanup()
                  await client.cleanup()
                }
              },
            ),
            campaign === `fixed`
              ? { numRuns: oracleRuns(30), seed: 2229 }
              : oraclePropertyOptions(30, properties[observation]),
          )
          reach.assertReached()
          console.info(
            `react-error-handoff ${hook} ${observation} ${campaign}`,
            Object.fromEntries(reach.counts()),
          )
        })
      }
    }
  }
})

/**
 * The shared SSR admission judgment rejects server-only rows/readiness, while
 * cold loading, completed query results and normalized sources remain legal.
 * Each hook independently generates the same preparation histories. Both real
 * React server renders compare before browser commit; hydrateRoot must then
 * report no recovery, and committed sync must replace the seed normally.
 * Query-only infinite preparation includes its first-page peek-ahead window.
 * This driver supplies host scheduling, not another expected-result model.
 */
// React's server renderer runs in this jsdom test process. Remove the browser
// global only for that host call; hydrateRoot retains the real browser globals.
function renderSsr(node: ReactNode): string {
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    return renderToString(node)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
  }
}

describe(`SSR snapshot admission`, () => {
  const properties = {
    ordinary: `react.ssr-ordinary`,
    infinite: `react.ssr-infinite`,
  } as const
  for (const hook of [`ordinary`, `infinite`] as const) {
    const makeReach = () =>
      createOracleReach(`ssr-${hook}`, [
        `cold-loading`,
        `unbacked-ready-empty`,
        `unbacked-rows`,
        `query-result`,
        `normalized-ready`,
        `normalized-partial`,
        `pending-query`,
        `server-write`,
        `browser-write`,
        `same-query-preload`,
      ])
    async function checkHistory(
      history: SsrSnapshotHistory,
      reach: ReturnType<typeof makeReach>,
    ) {
      reach.beginHistory()
      const expected = expectedSsrSnapshot(history)
      const starts = { server: 0, browser: 0 }
      const writers = new Map<`server` | `browser`, (name: string) => void>()
      const descriptor = collectionOptions(`ssr-admission`, (client) => ({
        id: `ssr-admission`,
        getKey: (row: { id: string; name: string }) => row.id,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            const runtime = client.requireDependency<`server` | `browser`>(
              `runtime`,
            )
            starts[runtime]++
            writers.set(runtime, (name) => {
              begin()
              write({ type: `insert`, value: { id: `late`, name } })
              commit()
            })
            begin()
            for (const row of history.rows)
              write({
                type: `insert`,
                value: {
                  ...row,
                  name: runtime === `server` ? row.name : `browser ${row.id}`,
                },
              })
            commit()
            if (runtime === `browser` || history.sourceState === `ready`)
              markReady()
          },
        },
      }))
      const query = new Query()
        .from({ person: descriptor })
        .orderBy(({ person }) => person.id)
        .select(({ person }) => ({ id: person.id, name: person.name }))
      const server = new DbClient({ runtime: `server` })
      const browser = new DbClient({ runtime: `browser` })
      server._setSsrServerCleanupEnabled(true)
      browser._setSsrServerCleanupEnabled(true)
      let root: Root | undefined
      const host = document.createElement(`div`)
      const recoveries: Array<unknown> = []
      let unmount: (() => void) | undefined
      const useResult = () =>
        hook === `ordinary`
          ? useLiveQuery({ query })
          : useLiveInfiniteQuery(() => query, { pageSize: 1 })
      function Consumer() {
        const result = useResult()
        return (
          <output
            data-status={result.status}
            data-ready={result.isReady}
            data-loading={result.isLoading}
            data-idle={result.isIdle}
            data-error={result.isError}
            data-persisted={result.persistedStatus}
          >
            {result.data.map((row) => (
              <span key={row.id}>{row.name}</span>
            ))}
          </output>
        )
      }
      const app = (client: DbClient) => (
        <DbProvider client={client}>
          <Consumer />
        </DbProvider>
      )
      try {
        if (history.sourceState !== `idle`) {
          const warming = server.preloadLiveQuery({
            query: new Query()
              .from({ person: descriptor })
              .select(({ person }) => ({ id: person.id })),
          })
          if (history.sourceState === `ready`) await warming
          else void warming.catch(() => {})
        }
        // Explicit materialization registers normalized source rows for
        // dehydration. The warming query established this fixture's rows;
        // registration, rather than a second preload, makes them portable.
        if (history.preparation === `source`) server.collection(descriptor)
        if (
          history.preparation === `query` ||
          history.preparation === `pending-query`
        ) {
          const preload = server.preloadLiveQuery({
            query: hook === `ordinary` ? query : query.limit(2).offset(0),
          })
          if (history.preparation === `query`) await preload
          else void preload.catch(() => {})
        }
        let html: string | undefined
        let failure: unknown
        try {
          html = renderSsr(app(server))
        } catch (error) {
          failure = error
        }
        if (expected.rejects) {
          expect(
            failure,
            `SSR must reject untransported rows or readiness`,
          ).toBeInstanceOf(Error)
          expect(String(failure)).toMatch(/SSR.*(?:preload|hydrat)/i)
          // The same warm source is ordinary valid browser usage.
          const mounted = renderHook(useResult, {
            wrapper: ({ children }: { children: ReactNode }) => (
              <DbProvider client={server}>{children}</DbProvider>
            ),
          })
          unmount = mounted.unmount
          expect(
            mounted.result.current.data.map((row) => ({
              id: row.id,
              name: row.name,
            })),
          ).toEqual(
            hook === `ordinary` ? history.rows : history.rows.slice(0, 1),
          )
          reach.reach(
            history.rows.length ? `unbacked-rows` : `unbacked-ready-empty`,
          )
        } else {
          expect(failure, `prepared and cold SSR remain legal`).toBeUndefined()
          if (history.serverWrite && history.sourceState !== `idle`) {
            writers.get(`server`)!(`late server`)
            reach.reach(`server-write`)
          }
          browser.hydrate(server.dehydrate())
          if (history.browserWrite) {
            if (history.browserPreload) {
              await browser.preloadLiveQuery({
                query: hook === `infinite` ? query.limit(2).offset(0) : query,
              })
              reach.reach(`same-query-preload`)
            }
            await browser.collection(descriptor).preload()
            writers.get(`browser`)!(`late browser`)
            reach.reach(`browser-write`)
          }
          let initialBrowserHtml: string | undefined, hydrationError: unknown
          try {
            initialBrowserHtml = renderToString(app(browser))
          } catch (error) {
            hydrationError = error
          }
          host.innerHTML = html!
          expect(
            host.querySelector(`output`)?.getAttribute(`data-status`),
          ).toBe(expected.status)
          expect(
            [...host.querySelectorAll(`span`)].map((span) => span.textContent),
          ).toEqual(
            (hook === `ordinary`
              ? expected.rows
              : expected.rows.slice(0, 1)
            ).map((row) => row.name),
          )
          expect(
            starts.browser,
            `hydration read starts no additional source`,
          ).toBe(history.browserWrite ? 1 : 0)
          document.body.append(host)
          await act(async () => {
            root = hydrateRoot(host, app(browser), {
              onRecoverableError: (error) => recoveries.push(error),
            })
            await Promise.resolve()
          })
          expect(
            hydrationError,
            `browser activity cannot become an SSR programming error`,
          ).toBeUndefined()
          expect(
            initialBrowserHtml,
            `initial rows and every rendered status flag match`,
          ).toBe(html)
          expect(
            recoveries,
            `React receives the same snapshot without recovery`,
          ).toEqual([])
          expect(
            starts.browser,
            `committed browser demand starts the source`,
          ).toBe(1)
          expect(
            host.querySelector(`output`)?.getAttribute(`data-status`),
          ).toBe(`ready`)
          expect(
            [...host.querySelectorAll(`span`)].map((span) => span.textContent),
          ).toEqual(
            hook === `ordinary`
              ? [
                  ...history.rows.map((row) => `browser ${row.id}`),
                  ...(history.browserWrite
                    ? [`late browser`]
                    : history.preparation === `source` &&
                        history.serverWrite &&
                        history.sourceState !== `idle`
                      ? [`late server`]
                      : []),
                ]
              : [
                  ...history.rows.map((row) => `browser ${row.id}`),
                  ...(history.browserWrite
                    ? [`late browser`]
                    : history.preparation === `source` &&
                        history.serverWrite &&
                        history.sourceState !== `idle`
                      ? [`late server`]
                      : []),
                ].slice(0, 1),
          )
          if (history.preparation === `query`) reach.reach(`query-result`)
          else if (
            history.preparation === `source` &&
            history.sourceState !== `idle`
          )
            reach.reach(
              history.sourceState === `loading`
                ? `normalized-partial`
                : `normalized-ready`,
            )
          else reach.reach(`cold-loading`)
        }
        if (history.preparation === `pending-query`)
          reach.reach(`pending-query`)
      } finally {
        unmount?.()
        act(() => root?.unmount())
        host.remove()
        await browser.cleanup()
        await server.cleanup()
      }
    }
    for (const history of ssrSnapshotExamples) {
      it(`replays ${hook} SSR ${history.preparation}/${history.sourceState}/${history.rows.length}`, async () => {
        await checkHistory(history, makeReach())
      })
    }
    for (const campaign of [`fixed`, `random`] as const) {
      it(`${hook} admits reproducible SSR snapshots (${campaign})`, async () => {
        const reach = makeReach()
        await fc.assert(
          fc.asyncProperty(ssrSnapshotHistoryArbitrary, (history) =>
            checkHistory(history, reach),
          ),
          {
            ...(campaign === `fixed`
              ? { numRuns: oracleRuns(120), seed: 2229 }
              : oraclePropertyOptions(120, properties[hook])),
            examples: ssrSnapshotExamples.map((history) => [history]),
          },
        )
        reach.assertReached()
        console.info(
          `ssr-admission ${hook} ${campaign}`,
          Object.fromEntries(reach.counts()),
        )
      })
    }
  }
})

// Suspense discovery is explicit data demand in streaming mode. A warm source
// must still register this query, rather than bypassing transport because its
// live-query Collection happens to be ready before the wrapper reads it.
describe(`SSR Suspense discovery`, () => {
  for (const warm of [false, true]) {
    it(`streams a render-discovered result with warm=${warm}`, async () => {
      const descriptor = collectionOptions(`ssr-suspense-discovery`, () => ({
        id: `ssr-suspense-discovery`,
        getKey: (row: { id: string; name: string }) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: `1`, name: `server 1` } })
            commit()
            markReady()
          },
        },
      }))
      const client = new DbClient()
      client._setSsrStreamingEnabled(true)
      const query = new Query()
        .from({ person: descriptor })
        .select(({ person }) => ({ name: person.name }))
      function Consumer() {
        const result = useLiveSuspenseQuery({ query })
        return <span>{result.data.map((row) => row.name).join(`,`)}</span>
      }
      // This driver invokes React's Node server host inside jsdom. Match the
      // actual host's globals so the hydration getter cannot mistake it for a
      // browser receiver waiting for a record the server has not produced yet.
      const originalWindow = globalThis.window
      vi.stubGlobal(`window`, undefined)
      try {
        if (warm)
          await client.preloadLiveQuery({
            query: new Query()
              .from({ person: descriptor })
              .select(({ person }) => ({ id: person.id })),
          })
        const errors: Array<unknown> = []
        const html = await new Promise<string>((resolve, reject) => {
          let text = ``
          const sink = new Writable({
            write(chunk, _encoding, done) {
              text += chunk.toString()
              done()
            },
          })
          sink.on(`finish`, () => resolve(text))
          sink.on(`error`, reject)
          const stream = renderToPipeableStream(
            <DbProvider client={client}>
              <Suspense fallback={<span>loading</span>}>
                <Consumer />
              </Suspense>
            </DbProvider>,
            {
              onAllReady() {
                stream.pipe(sink)
              },
              onError(error) {
                errors.push(error)
              },
            },
          )
        })
        expect(errors).toEqual([])
        expect(html).toContain(`<span>server 1</span>`)
        const hash = getLiveQueryHash({ query })
        const result = client
          .dehydrate({ shouldDehydrateLiveQuery: () => true })
          .liveQueries?.find((entry) => entry.queryHash === hash)
        expect(
          result,
          `render-discovered warm and cold results enter transport`,
        ).toBeDefined()
        const snapshot = result?.snapshot ?? (await result?.promise)
        expect(snapshot?.rows.map((row) => row.value)).toEqual([
          expect.objectContaining({ name: `server 1` }),
        ])
      } finally {
        vi.stubGlobal(`window`, originalWindow)
        await client.cleanup()
      }
    })
  }
})

/** Prepared Suspense results must render on either React server host. Streaming
 * is explicit demand; opaque logic still requires a portable identity even
 * when warm. This bounded grammar crosses source/query preparation, empty/nonempty
 * results, streaming on/off, and keyed/unkeyed opaque discovery. The observation
 * is final server markup and server errors, before any browser can repair it.
 */
describe(`SSR Suspense receiving matrix`, () => {
  for (const streaming of [false, true]) {
    for (const preparation of [`source`, `query`] as const) {
      for (const count of [0, 2]) {
        it(`renders prepared ${preparation} count=${count} streaming=${streaming}`, async () => {
          const descriptor = collectionOptions(`suspense-prepared`, () => ({
            id: `suspense-prepared`,
            getKey: (row: { id: string; name: string }) => row.id,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                begin()
                for (let i = 0; i < count; i++)
                  write({
                    type: `insert`,
                    value: { id: String(i), name: `server ${i}` },
                  })
                commit()
                markReady()
              },
            },
          }))
          const client = new DbClient()
          client._setSsrStreamingEnabled(streaming)
          const query = new Query()
            .from({ person: descriptor })
            .select(({ person }) => ({ name: person.name }))
          function Consumer() {
            const { data } = useLiveSuspenseQuery({ query })
            return (
              <output>
                {data.map((row) => row.name).join(`,`) || `empty ready`}
              </output>
            )
          }
          const app = (
            <DbProvider client={client}>
              <Suspense fallback={<span>loading</span>}>
                <Consumer />
              </Suspense>
            </DbProvider>
          )
          const browserWindow = globalThis.window
          try {
            if (preparation === `source`)
              await client.collection(descriptor).preload()
            else await client.preloadLiveQuery({ query })
            vi.stubGlobal(`window`, undefined)
            let html: string
            const errors: Array<unknown> = []
            if (!streaming) html = renderToString(app)
            else
              html = await new Promise<string>((resolve, reject) => {
                let result = ``
                const sink = new Writable({
                  write(chunk, _encoding, done) {
                    result += chunk.toString()
                    done()
                  },
                })
                sink.on(`finish`, () => resolve(result))
                sink.on(`error`, reject)
                const stream = renderToPipeableStream(app, {
                  onAllReady() {
                    stream.pipe(sink)
                  },
                  onError(error) {
                    errors.push(error)
                  },
                })
              })
            expect(errors).toEqual([])
            expect(
              html,
              `prepared results finish rather than suspend forever`,
            ).toContain(
              `<output>${count ? `server 0,server 1` : `empty ready`}</output>`,
            )
          } finally {
            vi.stubGlobal(`window`, browserWindow)
            await client.cleanup()
          }
        })
      }
    }
  }
  for (const warm of [false, true])
    for (const keyed of [false, true]) {
      it(`checks opaque streaming identity warm=${warm} keyed=${keyed}`, async () => {
        const descriptor = collectionOptions(`opaque-ssr`, () => ({
          id: `opaque-ssr`,
          getKey: (row: { id: string }) => row.id,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              begin()
              write({ type: `insert`, value: { id: `server` } })
              commit()
              markReady()
            },
          },
        }))
        const client = new DbClient()
        client._setSsrStreamingEnabled(true)
        const query = new Query()
          .from({ row: descriptor })
          .fn.where(({ row }) => row.id.length > 0)
        function Consumer() {
          const { data } = useLiveSuspenseQuery({
            query,
            ...(keyed ? { queryKey: [`opaque`] } : {}),
          })
          return <output>{data.map((row) => row.id).join(`,`)}</output>
        }
        const browserWindow = globalThis.window
        try {
          if (warm)
            await client.preloadLiveQuery({
              query: new Query()
                .from({ row: descriptor })
                .select(({ row }) => ({ id: row.id })),
            })
          vi.stubGlobal(`window`, undefined)
          const errors: Array<unknown> = []
          const html = await new Promise<string>((resolve, reject) => {
            let result = ``
            const sink = new Writable({
              write(chunk, _encoding, done) {
                result += chunk.toString()
                done()
              },
            })
            sink.on(`finish`, () => resolve(result))
            sink.on(`error`, reject)
            const stream = renderToPipeableStream(
              <DbProvider client={client}>
                <Suspense fallback={<span>loading</span>}>
                  <Consumer />
                </Suspense>
              </DbProvider>,
              {
                onAllReady() {
                  stream.pipe(sink)
                },
                onError(error) {
                  errors.push(error)
                },
              },
            )
          })
          if (keyed) {
            expect(errors).toEqual([])
            expect(html).toContain(`<output>server</output>`)
            expect(
              client
                .dehydrate()
                .liveQueries?.some(
                  (q) =>
                    q.queryHash === getLiveQueryHash({ query }, [`opaque`]),
                ),
            ).toBe(true)
          } else {
            expect(
              errors,
              `warm rows do not waive transport identity`,
            ).toHaveLength(1)
            // The shared conformance identity law rejects an unkeyed opaque
            // React query during preparation, before SSR stream admission.
            // Warming the source does not change that programming error.
            expect(errors[0]).toBeInstanceOf(UnhashableQueryIRError)
          }
        } finally {
          vi.stubGlobal(`window`, browserWindow)
          await client.cleanup()
        }
      })
    }
})

/** Result identity includes the caller's current input and its initial window.
 * The reference is authored rows sliced by page size, never transport records.
 * Browser replacement crosses builder -> callback Collection, with a distinct
 * explicit key or derived identity. Server preload checks both matching and
 * unbounded windows under one key; their portable result identities must differ.
 */
function useRuntimeWindow(
  input: unknown,
  config: { pageSize: number; queryKey?: Array<string> },
) {
  // Exercise the callback-returned Collection runtime path without extending
  // TypeScript's current QueryBuilder-only callback overload.
  return Reflect.apply(useLiveInfiniteQuery, undefined, [input, config]) as {
    data: Array<{ id: string; name: string }>
  }
}
describe(`infinite hydration identity`, () => {
  for (const keyed of [false, true])
    it(`switches to callback Collection keyed=${keyed}`, async () => {
      const source = createCollection(
        mockSyncCollectionOptions<{ id: string; name: string }>({
          id: `infinite-identity-source`,
          getKey: (row) => row.id,
          initialData: [
            { id: `a`, name: `old` },
            { id: `b`, name: `new` },
          ],
        }),
      )
      const client = new DbClient()
      const oldQuery = new Query()
        .from({ row: source })
        .where(({ row }) => eq(row.id, `a`))
        .orderBy(({ row }) => row.id)
      const supplied = createLiveQueryCollection({
        query: new Query()
          .from({ row: source })
          .where(({ row }) => eq(row.id, `b`))
          .orderBy(({ row }) => row.id)
          .limit(2),
      })
      let unmount: (() => void) | undefined
      try {
        await client.preloadLiveQuery({
          query: oldQuery.limit(2),
          ...(keyed ? { queryKey: [`old`] } : {}),
        })
        await supplied.preload()
        const wrapper = ({ children }: { children: ReactNode }) => (
          <DbProvider client={client}>{children}</DbProvider>
        )
        const hook = renderHook(
          ({ replacement }: { replacement: boolean }) =>
            useRuntimeWindow(() => (replacement ? supplied : oldQuery), {
              pageSize: 1,
              ...(keyed ? { queryKey: [replacement ? `new` : `old`] } : {}),
            }),
          { wrapper, initialProps: { replacement: false } },
        )
        unmount = hook.unmount
        expect(hook.result.current.data.map((row) => row.name)).toEqual([`old`])
        hook.rerender({ replacement: true })
        expect(
          hook.result.current.data.map((row) => row.name),
          `replacement owns its hydration identity`,
        ).toEqual([`new`])
      } finally {
        unmount?.()
        await client.cleanup()
        await supplied.cleanup()
        await source.cleanup()
      }
    })
  for (const matching of [false, true])
    it(`keeps keyed initial window distinct matching=${matching}`, async () => {
      const descriptor = collectionOptions(`window-identity`, () => ({
        id: `window-identity`,
        getKey: (row: { id: string }) => row.id,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const id of [`a`, `b`, `c`, `d`])
              write({ type: `insert`, value: { id } })
            commit()
            markReady()
          },
        },
      }))
      const query = new Query()
        .from({ row: descriptor })
        .orderBy(({ row }) => row.id)
      const client = new DbClient()
      try {
        const unbounded = getLiveQueryHash({ query }, [`window`])
        const windowed = getLiveQueryHash({ query: query.limit(2).offset(0) }, [
          `window`,
        ])
        await client.preloadLiveQuery({
          query: matching ? query.limit(2).offset(0) : query,
          queryKey: [`window`],
        })
        function Consumer() {
          const result = useLiveInfiniteQuery(() => query, {
            pageSize: 1,
            queryKey: [`window`],
          })
          return <output>{result.data.map((row) => row.id).join(`,`)}</output>
        }
        const renderWindow = () =>
          renderSsr(
            <DbProvider client={client}>
              <Consumer />
            </DbProvider>,
          )
        if (matching) expect(renderWindow()).toContain(`<output>a</output>`)
        else expect(renderWindow).toThrow(/SSR.*preload/)
        expect(
          unbounded,
          `unbounded and windowed results cannot alias`,
        ).not.toBe(windowed)
        if (matching)
          expect(
            client
              .dehydrate()
              .liveQueries?.find((q) => q.queryHash === windowed)?.snapshot
              ?.rows,
          ).toHaveLength(2)
      } finally {
        await client.cleanup()
      }
    })
})

// Streaming must capture the view it actually renders, even when the adapter
// publishes again in the microtask before its preload promise captures a result.
// This metamorphic observation compares the final host markup with transport.
// An ordinary sibling may already have rendered loading before Suspense starts
// the same query. Each reader owes its own rendered view during hydration;
// preserving the earlier view cannot prevent the explicit preload completing.
// Synchronous act permits the ordinary sibling's effects before React hydrates
// its Suspense boundary. That sibling must not consume another reader's seed.
// The readiness schedule also holds source writes and markReady until an ordinary
// server read occurs. With Suspense first, the Router has already queued a pending
// stream before that ordinary reader contributes its loading view. Both reader
// orders must transfer each hook's own view; a final direct dehydrate is not a
// substitute for the actual queued Router chunks. The provider and Router render
// callback are controlled premises, not a deployed Start or Electric witness.
// A held source may instead report an initial-sync error. The ordinary reader
// already rendered loading, while Suspense renders its server fallback. Error
// object fidelity is outside this relation; the ordinary first-view status is
// still owed before browser commit, and the Suspense boundary may recover.
async function checkStreamCut(
  history: SsrStreamHistory,
  reach: ReturnType<typeof createStreamReach>,
) {
  reach.beginHistory()
  const authoredRows = Array.from({ length: history.count }, (_, i) => ({
    id: String(i),
    name: `first ${i}`,
  }))
  const client = new DbClient({ runtime: `server` })
  const ordinaryRendered = createDeferred<void>()
  let releaseServerSource: (() => void) | undefined
  const sourceError = new Error(`stream source unavailable`)
  const descriptor = collectionOptions(`stream-render-cut`, (owner) => ({
    id: `stream-render-cut`,
    getKey: (row: { id: string; name: string }) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady, markError }) => {
        const rows =
          owner !== client && history.browserWrite
            ? [{ id: `0`, name: `browser only` }]
            : authoredRows
        const publish = () => {
          if (owner === client && history.sourceError) {
            markError(sourceError)
            return
          }
          begin()
          for (const row of rows) write({ type: `insert`, value: row })
          commit()
          markReady()
          queueMicrotask(() => {
            for (let i = 0; i < history.writes; i++) {
              begin()
              write({
                type: rows.length || i ? `update` : `insert`,
                value: { id: `0`, name: `later ${i}` },
              })
              commit()
            }
          })
        }
        if (owner === client && history.holdSourceReadiness)
          releaseServerSource = publish
        else publish()
      },
    },
  }))
  client._setSsrStreamingEnabled(true)
  let finishRouterRender = () => {}
  const router: {
    isServer: boolean
    options: {
      context: { dbClient: DbClient }
      dehydrate?: () => Promise<DehydratedRouterDbState>
    }
    serverSsr: {
      isDehydrated: () => boolean
      onRenderFinished: (callback: () => void) => void
    }
  } = {
    isServer: true,
    options: { context: { dbClient: client } },
    serverSsr: {
      isDehydrated: () => true,
      onRenderFinished: (callback) => {
        finishRouterRender = callback
      },
    },
  }
  // The real Router adapter supplies the transport for the same generated law.
  // Its SSR callback is controlled; this is not a deployed Start host witness.
  Reflect.apply(routerWithDbClient, undefined, [router, client])
  const initialRouterState = await router.options.dehydrate!()
  const query = new Query()
    .from({ row: descriptor })
    .select(({ row }) => ({ name: row.name }))
  const ordinaryReads: Array<{ status: string; names: Array<string> }> = []
  const suspenseReads: Array<Array<string>> = []
  function Consumer() {
    const result = useLiveSuspenseQuery({ query })
    suspenseReads.push(result.data.map((row) => row.name))
    return <span>{result.data.map((row) => row.name).join(`,`)}</span>
  }
  function OrdinaryConsumer() {
    const result = useLiveQuery({ query })
    ordinaryReads.push({
      status: result.status,
      names: result.data.map((row) => row.name),
    })
    if (typeof window === `undefined`) ordinaryRendered.resolve()
    return (
      <output data-status={result.status}>
        {result.data.map((row) => row.name).join(`,`)}
      </output>
    )
  }
  class StreamBoundary extends Component<
    { children: ReactNode },
    { failed: boolean }
  > {
    state = { failed: false }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    render() {
      return this.state.failed ? <b>query failed</b> : this.props.children
    }
  }
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    const errors: Array<unknown> = []
    const renderedHtml = new Promise<string>((resolve, reject) => {
      let text = ``
      const sink = new Writable({
        write(chunk, _encoding, done) {
          text += chunk.toString()
          done()
        },
      })
      sink.on(`finish`, () => resolve(text))
      sink.on(`error`, reject)
      const stream = renderToPipeableStream(
        <DbProvider client={client}>
          {history.ordinaryFirst && <OrdinaryConsumer />}
          <StreamBoundary>
            <Suspense fallback={<span>loading</span>}>
              <Consumer />
            </Suspense>
          </StreamBoundary>
          {history.ordinaryLast && <OrdinaryConsumer />}
        </DbProvider>,
        {
          onAllReady() {
            stream.pipe(sink)
          },
          onError(error) {
            errors.push(error)
          },
        },
      )
    })
    if (history.holdSourceReadiness) {
      // Holding readiness is legal only with an ordinary sibling. Its actual
      // public read, rather than a delay, proves this source-loading cut ran.
      await ordinaryRendered.promise
      expect(ordinaryReads[0], `held source renders ordinary loading`).toEqual({
        status: `loading`,
        names: [],
      })
      expect(
        releaseServerSource,
        `Suspense entered the held source`,
      ).toBeTypeOf(`function`)
      reach.reach(
        history.ordinaryFirst ? `held-ordinary-first` : `held-suspense-first`,
      )
      releaseServerSource!()
      releaseServerSource = undefined
    } else {
      reach.reach(`synchronous-readiness`)
    }
    const html = await renderedHtml
    if (history.sourceError) {
      // Live-query startup may wrap the provider's error. The receiving
      // premise is failure before readiness, not cross-boundary error identity.
      expect(
        errors.length,
        `Suspense received the held provider failure`,
      ).toBeGreaterThan(0)
      reach.reach(`held-source-error`)
    } else {
      expect(errors).toEqual([])
      const rendered = html.match(/<span>([^<]*)<\/span>/)?.[1]
      expect(rendered).toBe(authoredRows.map((row) => row.name).join(`,`))
      const transport = client
        .dehydrate({ shouldDehydrateLiveQuery: () => true })
        .liveQueries!.find(
          (result) => result.queryHash === getLiveQueryHash({ query }),
        )!
      const snapshot = transport.snapshot ?? (await transport.promise)
      expect(
        snapshot?.rows.map((row) => (row.value as { name: string }).name),
        `stream transport reproduces its rendered view`,
      ).toEqual(authoredRows.map((row) => row.name))
    }
    if (history.ordinaryFirst || history.ordinaryLast) {
      const firstServerRead = ordinaryReads[0]
      expect(
        firstServerRead,
        `ordinary server hook returned a view`,
      ).toBeDefined()
      ordinaryReads.length = 0
      const firstSuspenseRead = suspenseReads[0]
      if (!history.sourceError)
        expect(
          firstSuspenseRead,
          `Suspense server hook returned its ready view`,
        ).toBeDefined()
      suspenseReads.length = 0
      vi.stubGlobal(`window`, browserWindow)
      const browser = new DbClient({ runtime: `browser` })
      browser.hydrate(initialRouterState.dehydratedDbClient)
      const reader = initialRouterState.dbStream.getReader()
      finishRouterRender()
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          browser.hydrate({
            ...chunk.value,
            liveQueries: chunk.value.liveQueries?.map(
              ({ promise, ...data }) => ({
                ...JSON.parse(JSON.stringify(data)),
                ...(promise
                  ? {
                      promise: promise.then((value) =>
                        JSON.parse(JSON.stringify(value)),
                      ),
                    }
                  : {}),
              }),
            ),
          })
        }
      } finally {
        reader.releaseLock()
      }
      const host = document.createElement(`div`)
      host.innerHTML = html
      let root: Root | undefined
      const hydrationErrors: Array<unknown> = []
      try {
        const hydrate = () => {
          root = hydrateRoot(
            host,
            <DbProvider client={browser}>
              {history.ordinaryFirst && <OrdinaryConsumer />}
              <StreamBoundary>
                <Suspense fallback={<span>loading</span>}>
                  <Consumer />
                </Suspense>
              </StreamBoundary>
              {history.ordinaryLast && <OrdinaryConsumer />}
            </DbProvider>,
            { onRecoverableError: (error) => hydrationErrors.push(error) },
          )
        }
        await act(
          history.splitHydration
            ? hydrate
            : async () => {
                hydrate()
                await Promise.resolve()
              },
        )
        reach.reach(
          history.holdSourceReadiness
            ? `held-router-browser-handoff`
            : `synchronous-router-browser-handoff`,
        )
        const firstBrowserSuspenseRead = suspenseReads[0]
        expect(
          ssrStreamHydrationMismatches([
            {
              reader: `ordinary`,
              server: firstServerRead!,
              hydration: ordinaryReads[0],
            },
            ...(history.sourceError
              ? []
              : [
                  {
                    reader: `Suspense`,
                    server: { status: `ready`, names: firstSuspenseRead! },
                    hydration: firstBrowserSuspenseRead
                      ? { status: `ready`, names: firstBrowserSuspenseRead }
                      : undefined,
                  },
                ]),
          ]),
          `each reader's first hydration view matches its own server view`,
        ).toEqual([])
        if (!history.sourceError) {
          expect(hydrationErrors).toEqual([])
        }
      } finally {
        await act(async () => {
          root?.unmount()
          await Promise.resolve()
        })
        await browser.cleanup()
      }
    }
    reach.reach(history.count ? `nonempty` : `empty`)
    reach.reach(history.writes ? `later-publication` : `unchanged`)
    reach.reach(
      history.ordinaryFirst
        ? `ordinary-first`
        : history.ordinaryLast
          ? `suspense-first`
          : `suspense-only`,
    )
    if (history.ordinaryFirst || history.ordinaryLast) {
      reach.reach(
        history.splitHydration ? `split-hydration` : `together-hydration`,
      )
      reach.reach(history.browserWrite ? `browser-different` : `browser-same`)
    }
  } finally {
    releaseServerSource?.()
    vi.stubGlobal(`window`, browserWindow)
    finishRouterRender()
    await client.cleanup()
  }
}
const createStreamReach = () =>
  createOracleReach(`react-stream-cut`, [
    `empty`,
    `nonempty`,
    `later-publication`,
    `unchanged`,
    `ordinary-first`,
    `suspense-first`,
    `suspense-only`,
    `browser-different`,
    `browser-same`,
    `split-hydration`,
    `together-hydration`,
    `synchronous-readiness`,
    `held-ordinary-first`,
    `held-suspense-first`,
    `held-router-browser-handoff`,
    `synchronous-router-browser-handoff`,
    `held-source-error`,
  ])
describe(`stream render snapshot cut`, () => {
  for (const ordinaryFirst of [false, true])
    for (const splitHydration of [false, true])
      it(`retains an ordinary loading view when its stream later fails, ordinaryFirst=${ordinaryFirst}, split=${splitHydration}`, () =>
        checkStreamCut(
          {
            count: 0,
            writes: 0,
            ordinaryFirst,
            ordinaryLast: !ordinaryFirst,
            holdSourceReadiness: true,
            sourceError: true,
            splitHydration,
          },
          createStreamReach(),
        ))
  for (const count of [0, 1])
    for (const ordinaryFirst of [false, true])
      for (const splitHydration of [false, true])
        it(`hydrates each held-source view with count=${count}, ordinaryFirst=${ordinaryFirst}, split=${splitHydration}`, () =>
          checkStreamCut(
            {
              count,
              writes: 0,
              ordinaryFirst,
              ordinaryLast: !ordinaryFirst,
              holdSourceReadiness: true,
              browserWrite: true,
              splitHydration,
            },
            createStreamReach(),
          ))
  it(`keeps an ordinary reader from blocking a shared Suspense preload`, () =>
    checkStreamCut(
      { count: 1, writes: 0, ordinaryFirst: true, browserWrite: true },
      createStreamReach(),
    ))
  it(`hydrates an ordinary reader rendered after its Suspense sibling`, () =>
    checkStreamCut(
      { count: 1, writes: 0, ordinaryLast: true, browserWrite: true },
      createStreamReach(),
    ))
  it(`retains the Suspense view after its ordinary sibling commits`, () =>
    checkStreamCut(
      {
        count: 1,
        writes: 0,
        ordinaryFirst: true,
        browserWrite: true,
        splitHydration: true,
      },
      createStreamReach(),
    ))
  for (const history of [
    { count: 0, writes: 1 },
    { count: 1, writes: 1 },
    { count: 1, writes: 0 },
  ])
    it(`replays count=${history.count} later-writes=${history.writes}`, () =>
      checkStreamCut(history, createStreamReach()))
  for (const campaign of [`fixed`, `random`] as const)
    it(`transports the rendered view (${campaign})`, async () => {
      const reach = createStreamReach()
      try {
        await fc.assert(
          fc.asyncProperty(
            fc
              .record({
                count: fc.integer({ min: 0, max: 3 }),
                writes: fc.integer({ min: 0, max: 3 }),
                ordinaryFirst: fc.boolean(),
                ordinaryLast: fc.boolean(),
                browserWrite: fc.boolean(),
                splitHydration: fc.boolean(),
                holdSourceReadiness: fc.boolean(),
                sourceError: fc.boolean(),
              })
              .map((history) => {
                // A held provider needs an ordinary read to release it; a
                // Suspense-only history retains synchronous source readiness.
                const holdSourceReadiness =
                  history.holdSourceReadiness &&
                  (history.ordinaryFirst || history.ordinaryLast)
                // Failure is held until a real ordinary loading read. Empty
                // sources isolate lifecycle status from error-row retention.
                const sourceError = history.sourceError && holdSourceReadiness
                return {
                  ...history,
                  ordinaryLast: !history.ordinaryFirst && history.ordinaryLast,
                  holdSourceReadiness,
                  sourceError,
                  count: sourceError ? 0 : history.count,
                  writes: sourceError ? 0 : history.writes,
                }
              }),
            (history) => checkStreamCut(history, reach),
          ),
          campaign === `fixed`
            ? { numRuns: oracleRuns(40), seed: 2229 }
            : oraclePropertyOptions(40, `react.ssr-stream-cut`),
        )
      } finally {
        // Keep reached premises visible when the first refinement check fails.
        console.info(
          `react-stream-cut ${campaign}`,
          Object.fromEntries(reach.counts()),
        )
      }
      reach.assertReached()
    })
})

// Explicit keys identify the same window across builder preload and supplied
// Collection input, including a callback that returns that Collection.
for (const callback of [false, true])
  it(`hydrates a supplied window with callback=${callback}`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `supplied-window-key`,
        getKey: (row) => row.id,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        initialData: [{ id: `a` }, { id: `b` }, { id: `c` }],
      }),
    )
    const query = new Query()
      .from({ row: source })
      .orderBy(({ row }) => row.id)
      .limit(2)
      .offset(0)
    const supplied = createLiveQueryCollection({ query })
    const client = new DbClient()
    function Consumer() {
      const result = useRuntimeWindow(callback ? () => supplied : supplied, {
        pageSize: 1,
        queryKey: [`supplied`],
      })
      return <output>{result.data.map((row) => row.id).join(`,`)}</output>
    }
    try {
      await client.preloadLiveQuery({ query, queryKey: [`supplied`] })
      expect(
        renderSsr(
          <DbProvider client={client}>
            <Consumer />
          </DbProvider>,
        ),
      ).toContain(`<output>a</output>`)
    } finally {
      await client.cleanup()
      await supplied.cleanup()
      await source.cleanup()
    }
  })
