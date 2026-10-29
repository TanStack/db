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
  collectionOptions,
  getLiveQueryHash,
  getStableQueryBuilderHash,
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
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { createDeferred } from '../../db/src/deferred'
import {
  expectedStartHandoff,
  modelSubscriberStartCleanup,
  subscriberStartCleanupHistories,
} from '../../db/tests/collection-subscription-lifecycle-grammar-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { renderSsr } from './descriptor-query-binding-support'
import type { Row } from './descriptor-query-binding-support'
import type { DehydratedRouterDbState } from '../../react-router-with-db/src'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'
import type { SsrStreamHistory } from '../../db/tests/ssr-stream-view-oracle'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

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

// The model reducer for one write: the row keyed by `next.id` takes its value.
function applyModelWrite(model: Map<string, Row>, next: Row): void {
  model.set(next.id, { ...next })
}

declareOracle({
  check: [checkStreamCut],
  model: [expectedRows, applyModelWrite],
})

describe(`standalone descriptor query binding`, () => {
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
        applyModelWrite(model, next)
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

/**
 * React receives the source-error premise through actual descriptor startup.
 * The shared conformance contract exposes ordinary hook errors as a readable
 * status. The start-handoff judgment distinguishes a returned fail() (a loading
 * error) from a synchronous throw (a crash); neither permits a failed commit
 * to retain ownership. A readable result shows the model's status through
 * exactly one of `isLoadingError` and `isCrashed`.
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
            `fail-before-release`,
            `fail-during-release`,
            `throw-before-release`,
            `throw-during-release`,
            `undefined-cause`,
          ])
          await fc.assert(
            fc.asyncProperty(
              fc.record({
                outcome: fc.constantFrom(`fail` as const, `throw` as const),
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
                      sync: ({ fail }) => {
                        starts++
                        if (history.outcome === `throw`) throw failure
                        fail(failure)
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
                      isLoadingError?: boolean
                      isCrashed?: boolean
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
                    expect(client.collection(descriptor).status).toBe(
                      expectedStartHandoff(history).status,
                    )
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
                      expect(current?.isLoadingError).toBe(
                        expected.status === `error`,
                      )
                      expect(current?.isCrashed).toBe(
                        expected.status === `crashed`,
                      )
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
            data-loading-error={result.isLoadingError}
            data-crashed={result.isCrashed}
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
      sync: ({ begin, write, commit, markReady, fail }) => {
        const rows =
          owner !== client && history.browserWrite
            ? [{ id: `0`, name: `browser only` }]
            : authoredRows
        const publish = () => {
          if (owner === client && history.sourceError) {
            fail(sourceError)
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
