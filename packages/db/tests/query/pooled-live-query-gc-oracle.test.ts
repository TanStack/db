import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { createOracleReach } from '../oracle-reach.js'
import {
  createPooledLiveQuery,
  pooledLiveQueries,
} from '../../src/query/pooled-live-query.js'
import { CollectionImpl, createCollection } from '../../src/collection/index.js'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { BaseQueryBuilder, Query } from '../../src/query/builder/index.js'
import { createLiveQueryCollection, eq, not } from '../../src/query/index.js'
import { createDeferred } from '../../src/deferred.js'
import { resolveLiveQueryValue } from '../../src/live-query-options.js'
import {
  captureMicrotaskErrors,
  mockSyncCollectionOptions,
  withOracleCleanup,
} from '../utils.js'
import type { Collection } from '../../src/collection/index.js'

/**
 * # Does a pooled live query hold its source as long as its Collection would?
 *
 * Law: a pooled live query keeps its source subscribed for the same time as
 * the live-query Collection it stands in for. After the last subscriber
 * leaves, that is exactly `gcTime`; a `gcTime` of 0 or `Infinity` never
 * releases; and a query built but never subscribed waits at least the
 * Collection lifecycle's 50 ms floor. Views of one partition with different `gcTime`s release with the longest.
 * A view that subscribes again after its partition released, as a hidden
 * React Activity does, follows the source like its restarted Collection.
 * Source cleanup instead makes that partition terminal, including a released
 * partition that reattaches during cleanup. Failed or interrupted startup must
 * retain no partial source ownership.
 *
 * Each case runs the same timeline against a pooled query and a live-query
 * Collection on separate sources and compares when each source loses its
 * subscriber, allowing the one tick the Collection's cleanup queue adds.
 * Release timing is resource lifetime, not data, so the pooled
 * live query oracle does not observe it.
 */
type Row = { id: string; g: string }
let serial = 0

function makeSource() {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `pooled-gc-${serial++}`,
      getKey: (row) => row.id,
      initialData: [{ id: `a`, g: `x` }],
    }),
  )
}

const query = (source: Collection<Row, string | number, any>) => (q: any) =>
  q.from({ r: source }).where(({ r }: any) => eq(r.g, `x`))

// Milliseconds after which the source no longer has a subscriber, checking
// up to `horizon`; undefined when it keeps one throughout.
async function releaseTime(
  source: ReturnType<typeof makeSource>,
  horizon: number,
): Promise<number | undefined> {
  for (let elapsed = 0; elapsed <= horizon; elapsed++) {
    if (source.subscriberCount === 0) return elapsed
    // Collection cleanup settles through promises after its timer fires.
    await vi.advanceTimersByTimeAsync(1)
  }
  return undefined
}

function pooled(gcTime: number, subscribe: boolean) {
  const source = makeSource()
  const view = createPooledLiveQuery(query(source)(new Query()), { gcTime })!
  const observer = createLiveQueryObserver(view, { mode: `wholesale` })
  if (subscribe) observer.subscribe(() => {})()
  return source
}

function compiled(gcTime: number, subscribe: boolean) {
  const source = makeSource()
  const live = createLiveQueryCollection({
    query: query(source),
    startSync: true,
    gcTime,
  })
  const observer = createLiveQueryObserver(live, { mode: `wholesale` })
  if (subscribe) observer.subscribe(() => {})()
  return source
}

/**
 * Callback failure does not transfer an unreturned subscription handle or
 * remove a healthy observer's right to terminal cleanup status. These are
 * the observer subscribe/dispose ownership law and ARCHITECTURE.md's pooled
 * substitution and cleanup laws, applied to separate observers of one view.
 * Throwing the application error remains permitted; retaining ownership or
 * leaving a healthy observer ready does not.
 *
 * Both production paths use the same bounded histories and judgment. The
 * ordinary path is a compiled live-query Collection, so its source lease may
 * remain until query GC even after a failed bootstrap. The pooled path must
 * release after that same grace period. Source subscriber counts observe the
 * retained physical subscription; returned handles count logical observers.
 * No partition fields or production dispatch helpers supply expected results.
 *
 * The grammar crosses bootstrap/cleanup failure, return/throw, Error/undefined,
 * zero through three healthy peers, and failure before/after their callbacks.
 * Every source already holds one row, making granular bootstrap unavoidable.
 * Removing that row would exclude bootstrap failure. Removing the suffix-peer
 * position would hide an early throwing listener's skipped terminal delivery.
 * Zero peers is the ownership margin; one later peer reconstructs the missed
 * cleanup witness. Repeated handle release remains legal; a second source
 * cleanup before the held cleanup settles is not a separate history action.
 *
 * These are core observer receiving paths with controlled synchronous adapter
 * callbacks. They establish no framework scheduling or remote shutdown claim.
 */
type CallbackPath = `ordinary` | `pooled`
type CallbackBoundary = `bootstrap` | `cleanup`
type CallbackHistory = {
  throws: boolean
  cause: `error` | `undefined`
  peers: number
  position: `before` | `after`
  gcTime: number
}

const callbackHistory: fc.Arbitrary<CallbackHistory> = fc.record({
  throws: fc.boolean(),
  cause: fc.constantFrom(`error` as const, `undefined` as const),
  peers: fc.integer({ min: 0, max: 3 }),
  position: fc.constantFrom(`before` as const, `after` as const),
  gcTime: fc.integer({ min: 1, max: 3 }),
})

// A returned handle keeps one observer; a bootstrap throw keeps none. Cleanup
// gives every admitted observer one terminal notification regardless of which
// sibling throws. These token and per-observer judgments need no dispatch model.
function expectedCallbackHistory(
  history: CallbackHistory,
  boundary: CallbackBoundary,
) {
  return {
    returnedOwners:
      history.peers + (boundary === `bootstrap` && history.throws ? 0 : 1),
    sourceAfterRelease: 0,
    terminalStatus: `error`,
    terminalNotifications: 1,
  } as const
}

async function checkCallbackHistory(
  path: CallbackPath,
  boundary: CallbackBoundary,
  history: CallbackHistory,
  reach: ReturnType<typeof createOracleReach<string>>,
): Promise<void> {
  const expected = expectedCallbackHistory(history, boundary)
  const gate = createDeferred<void>()
  const failure =
    history.cause === `error` ? new Error(`observer callback`) : undefined
  const uncaught = captureMicrotaskErrors()
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    gcTime: 0,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { id: `a`, g: `x` } })
        commit()
        markReady()
        return { cleanup: () => gate.promise }
      },
    },
  })
  source.startSyncImmediate()
  const builder = new Query().from({ r: source }).where(({ r }) => eq(r.g, `x`))
  if (!(builder instanceof BaseQueryBuilder)) throw new Error(`not a builder`)
  const view =
    path === `pooled`
      ? createPooledLiveQuery(builder, { gcTime: history.gcTime })!
      : createLiveQueryCollection({
          query: builder,
          startSync: true,
          gcTime: history.gcTime,
        })
  type Observer = ReturnType<typeof createLiveQueryObserver>
  const observers: Array<Observer> = []
  const stops: Array<() => void> = []
  const peerStops: Array<() => void> = []
  const notifications: Array<number> = []
  let cleanupStarted = false
  let cleanupSettlement: Promise<{ threw: boolean; error: unknown }> | undefined
  let failed: { threw: boolean; error?: unknown } = { threw: false }
  const subscribe = (isFailure: boolean) => {
    const index = observers.length
    const observer = createLiveQueryObserver(view, {
      mode: boundary === `bootstrap` ? `granular` : `wholesale`,
    })
    observers.push(observer)
    notifications.push(0)
    try {
      const stop = observer.subscribe(() => {
        notifications[index] = notifications[index]! + 1
        if (
          isFailure &&
          history.throws &&
          (boundary === `bootstrap` || cleanupStarted)
        )
          throw failure
      })
      stops.push(stop)
      if (!isFailure) peerStops.push(stop)
    } catch (error) {
      failed = { threw: true, error }
    }
    // Prime the public snapshot before cleanup; a missed notify must not be
    // repaired by the first read accidentally observing the source's status.
    expect(observer.getSnapshot().status).toBe(`ready`)
  }

  await withOracleCleanup(async () => {
    reach.reach(path)
    reach.reach(history.throws ? `throw` : `return`)
    reach.reach(history.peers ? `healthy-peer` : `no-peer`)
    if (history.cause === `undefined`) reach.reach(`undefined-cause`)
    if (history.position === `before`) subscribe(true)
    for (let peer = 0; peer < history.peers; peer++) subscribe(false)
    if (history.position === `after`) subscribe(true)
    if (history.throws && history.peers > 0)
      reach.reach(`throw-${history.position}-peer`)

    // First-return cut: only successful calls return ownership handles. Source
    // acquisition has resumed on both paths and remains until query release.
    expect(failed.threw).toBe(boundary === `bootstrap` && history.throws)
    if (failed.threw) expect(failed.error).toBe(failure)
    expect(stops).toHaveLength(expected.returnedOwners)
    expect(source.subscriberCount).toBe(1)
    reach.reach(`first-return`)

    if (boundary === `cleanup`) {
      cleanupStarted = true
      cleanupSettlement = source.cleanup().then(
        () => ({ threw: false, error: undefined }),
        (error: unknown) => ({ threw: true, error }),
      )
      // Adapter cleanup is held. Every still-subscribed peer already owes its
      // terminal snapshot and callback at cleanup start, before settlement.
      expect(source.status).toBe(`ready`)
      for (const observer of observers)
        expect(
          observer.getSnapshot().status,
          `cleanup start: every admitted observer receives terminal status`,
        ).toBe(expected.terminalStatus)
      expect(notifications).toEqual(
        observers.map(() => expected.terminalNotifications),
      )
      reach.reach(`cleanup-start`)
      gate.resolve()
      const result = await cleanupSettlement
      await vi.advanceTimersByTimeAsync(1)
      for (const observer of observers)
        expect(observer.getSnapshot().status).toBe(expected.terminalStatus)
      const reported = [
        ...uncaught.errors,
        ...(result.threw ? [result.error] : []),
      ]
      expect(reported).toEqual(history.throws ? [failure] : [])
      reach.reach(`cleanup-settlement`)
    } else {
      // A failed bootstrap cannot poison a sibling's ownership. Release only
      // the possibly successful failure-site observer before the peer cut.
      for (const stop of stops) if (!peerStops.includes(stop)) stop()
      await vi.advanceTimersByTimeAsync(100)
      expect(
        source.subscriberCount,
        `bootstrap release: only surviving peers retain source ownership`,
      ).toBe(history.peers > 0 ? 1 : 0)
    }

    for (const stop of stops) stop()
    for (const observer of observers) observer.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(
      source.subscriberCount,
      `final release: no failed or returned observer retains source ownership`,
    ).toBe(expected.sourceAfterRelease)
    reach.reach(`release`)
  }, [
    () => withOracleCleanup(() => {}, stops),
    () =>
      withOracleCleanup(
        () => {},
        observers.map((observer) => () => observer.dispose()),
      ),
    () => gate.resolve(),
    () => view.cleanup(),
    () => cleanupSettlement ?? source.cleanup(),
    () => uncaught.restore(),
  ])
}

describe(`pooled live query gcTime`, () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  for (const boundary of [`bootstrap`, `cleanup`] as const) {
    const property =
      boundary === `bootstrap`
        ? `pooled-live-query.bootstrap-ownership`
        : `pooled-live-query.cleanup-peers`
    const title =
      boundary === `bootstrap`
        ? `bootstrap ownership after callback failure`
        : `cleanup status reaches every observer`
    for (const path of [`ordinary`, `pooled`] as const) {
      for (const campaign of [`fixed`, `random`] as const) {
        it(`${title}: ${path} (${campaign})`, async () => {
          const states = [
            path,
            `return`,
            `throw`,
            `healthy-peer`,
            `no-peer`,
            `throw-before-peer`,
            `throw-after-peer`,
            `undefined-cause`,
            `first-return`,
            `release`,
            ...(boundary === `cleanup`
              ? [`cleanup-start`, `cleanup-settlement`]
              : []),
          ]
          const reach = createOracleReach(property, states)
          try {
            await fc.assert(
              fc.asyncProperty(callbackHistory, async (history) => {
                reach.beginHistory()
                await checkCallbackHistory(path, boundary, history, reach)
              }),
              campaign === `fixed`
                ? { numRuns: oracleRuns(80), seed: 2229 }
                : oraclePropertyOptions(80, property),
            )
            reach.assertReached()
          } finally {
            console.info(
              `${property} ${path} ${campaign}`,
              Object.fromEntries(reach.counts()),
            )
          }
        })
      }
    }
  }

  it.each([`loading`, `ready`] as const)(
    `releases a partition when source startup re-enters cleanup at %s`,
    async (cleanupAt) => {
      const gate = createDeferred<void>()
      let starts = 0
      const source = createCollection<Row>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
            return { cleanup: () => gate.promise }
          },
        },
      })
      const builder = new Query()
        .from({ r: source })
        .where(({ r }) => eq(r.g, `x`))
      if (!(builder instanceof BaseQueryBuilder))
        throw new Error(`not a builder`)
      const view = createPooledLiveQuery(builder, { gcTime: 1 })!
      let pending: Promise<void> | undefined
      const off = source.on(`status:change`, ({ status }) => {
        if (status === cleanupAt) pending = source.cleanup()
      })
      let stop: { unsubscribe: () => void } | undefined
      try {
        stop = view.subscribeChanges(() => {})
        expect(pending).toBeDefined()
        expect(starts).toBe(cleanupAt === `loading` ? 0 : 1)
        expect(view.status).toBe(`error`)
        expect(source.subscriberCount).toBe(0)
        expect(source[`_changes`].activeSubscribersCount).toBe(0)
        gate.resolve()
        await pending
        expect(source.subscriberCount).toBe(0)
      } finally {
        off()
        gate.resolve()
        stop?.unsubscribe()
        await source.cleanup()
      }
    },
  )

  // Cleanup start makes a dependent terminal even if it registers late. A
  // released partition has no source subscription, so its next attachment
  // must observe cleanup before acquiring one. The bounded grammar varies
  // initial ownership (new, retained, released), callback mode and held source
  // status. It checks terminality before settlement, after restart, and after a
  // fresh partition mounts. Source counts detect retained or duplicate ownership.
  it.each(
    ([`new`, `retained`, `released`] as const).flatMap((ownership) =>
      ([`granular`, `wholesale`] as const).flatMap((mode) =>
        ([`loading`, `ready`] as const).map((priorStatus) => ({
          ownership,
          mode,
          priorStatus,
        })),
      ),
    ),
  )(
    `retires $ownership $mode partition during $priorStatus cleanup`,
    async ({ ownership, mode, priorStatus }) => {
      const gate = createDeferred<void>()
      let starts = 0
      const source = createCollection<Row>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            starts++
            begin()
            write({ type: `insert`, value: { id: `a`, g: `x` } })
            commit()
            if (priorStatus === `ready` || starts > 1) markReady()
            return { cleanup: () => gate.promise }
          },
        },
      })
      const build = () => {
        const builder = new Query()
          .from({ r: source })
          .where(({ r }) => eq(r.g, `x`))
        if (!(builder instanceof BaseQueryBuilder))
          throw new Error(`not a builder`)
        return createPooledLiveQuery(builder, { gcTime: 1 })!
      }
      let view: ReturnType<typeof build> | undefined
      let observer: ReturnType<typeof createLiveQueryObserver> | undefined
      let stop: (() => void) | undefined
      let fresh:
        | ReturnType<typeof createLiveQueryObserver<Row, string | number>>
        | undefined
      let stopFresh: (() => void) | undefined
      try {
        source.startSyncImmediate()
        if (ownership !== `new`) {
          view = build()
          observer = createLiveQueryObserver(view, { mode })
          stop = observer.subscribe(() => {})
          if (ownership === `released`) {
            stop()
            stop = undefined
            await vi.advanceTimersByTimeAsync(100)
            expect(source.subscriberCount).toBe(0)
          }
        }
        const pending = source.cleanup()
        expect(source.status).toBe(priorStatus)
        view ??= build()
        observer ??= createLiveQueryObserver(view, { mode })
        let attachmentError: unknown
        try {
          if (ownership !== `retained`) stop = observer.subscribe(() => {})
        } catch (error) {
          attachmentError = error
        }
        expect(
          attachmentError,
          `late dependent becomes terminal without acquiring a source`,
        ).toBeUndefined()
        expect(view.status).toBe(`error`)
        expect(observer.getSnapshot().status).toBe(`error`)
        expect(source.subscriberCount).toBe(0)
        expect(source[`_changes`].activeSubscribersCount).toBe(0)
        gate.resolve()
        await pending
        source.startSyncImmediate()
        expect(view.status).toBe(`error`)
        fresh = createLiveQueryObserver(build(), { mode })
        stopFresh = fresh.subscribe(() => {})
        expect(fresh.getSnapshot().status).toBe(`ready`)
        expect(
          Array.from(fresh.getSnapshot().state!.values(), ({ id, g }) => ({
            id,
            g,
          })),
        ).toEqual([{ id: `a`, g: `x` }])
        expect(source.subscriberCount).toBe(1)
      } finally {
        gate.resolve()
        stop?.()
        stopFresh?.()
        observer?.dispose()
        fresh?.dispose()
        await source.cleanup()
      }
    },
  )

  /**
   * Late cleanup notification can invoke application status listeners before
   * registration returns. A throw is still fail-fast, but it cannot retain a
   * source status lease. This extends failed-construction ownership to the
   * real synchronous callback boundary, with returned and thrown neighbors.
   * Releasing the partition before cleanup is essential: a retained partition
   * receives cleanup at its original registration, not during registration.
   */
  for (const campaign of [`fixed`, `random`] as const) {
    it(`releases late cleanup registration channels (${campaign})`, async () => {
      const reach = createOracleReach(`pooled-late-cleanup`, [
        `return`,
        `throw`,
        `undefined-cause`,
      ])
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            throws: fc.boolean(),
            cause: fc.constantFrom(`error` as const, `undefined` as const),
            peers: fc.integer({ min: 1, max: 3 }),
          }),
          async (history) => {
            reach.beginHistory()
            const gate = createDeferred<void>()
            const source = createCollection<Row>({
              getKey: (row) => row.id,
              gcTime: 0,
              sync: {
                sync: ({ markReady }) => {
                  markReady()
                  return { cleanup: () => gate.promise }
                },
              },
            })
            source.startSyncImmediate()
            let statusLeases = 0
            let statusReleases = 0
            const on = source.on.bind(source)
            source.on = (event, listener) => {
              const off = on(event, listener)
              if (event !== `status:change`) return off
              statusLeases++
              let active = true
              return () => {
                statusReleases++
                if (active) {
                  active = false
                  statusLeases--
                  off()
                }
              }
            }
            const builder = new Query()
              .from({ r: source })
              .where(({ r }) => eq(r.g, `x`))
            if (!(builder instanceof BaseQueryBuilder))
              throw new Error(`not a builder`)
            const view = createPooledLiveQuery(builder, { gcTime: 1 })!
            const failure =
              history.cause === `error`
                ? new Error(`status listener`)
                : undefined
            const stops = Array.from({ length: history.peers }, () =>
              view.on(`status:change`, () => {}),
            )
            stops.push(
              view.on(`status:change`, () => {
                if (history.throws) throw failure
              }),
            )
            let subscription:
              ReturnType<typeof view.subscribeChanges> | undefined
            try {
              await vi.advanceTimersByTimeAsync(100)
              expect(source.subscriberCount).toBe(0)
              expect(statusLeases, `partition released before cleanup`).toBe(0)
              const pending = source.cleanup()
              const releasesBeforeRegistration = statusReleases
              let result: { threw: boolean; error?: unknown } = { threw: false }
              try {
                subscription = view.subscribeChanges(() => {})
              } catch (error) {
                result = { threw: true, error }
              }
              reach.reach(history.throws ? `throw` : `return`)
              if (history.cause === `undefined`) reach.reach(`undefined-cause`)
              expect(result.threw).toBe(history.throws)
              if (history.throws) expect(result.error).toBe(failure)
              expect(
                statusLeases,
                `failed/terminal registration owns no channel`,
              ).toBe(0)
              expect(
                statusReleases - releasesBeforeRegistration,
                `one late channel needs one release invocation`,
              ).toBe(1)
              expect(source.subscriberCount).toBe(0)
              expect(view.status).toBe(`error`)
              gate.resolve()
              await pending
            } finally {
              stops.forEach((stop) => stop())
              subscription?.unsubscribe()
              gate.resolve()
              await source.cleanup()
            }
          },
        ),
        campaign === `fixed`
          ? { numRuns: oracleRuns(40), seed: 2229 }
          : oraclePropertyOptions(40, `pooled-live-query.late-cleanup`),
      )
      reach.assertReached()
      console.info(
        `pooled-late-cleanup ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }

  /** A recoverable eager-source error changes status, not partition lifetime.
   * Only source cleanup is terminal. The return-to-ready checkpoint checks
   * both shared views and fresh subscription ownership in the same sync run.
   * On-demand sources cannot enter this path: pooling explicitly excludes them.
   */
  it.each([`before-views`, `after-views`] as const)(
    `retains a partition through recoverable error $0`,
    async (errorAt) => {
      let fail = () => {}
      let recover = () => {}
      const source = createCollection<Row>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ begin, write, commit, markReady, markError }) => {
            begin()
            write({ type: `insert`, value: { id: `a`, g: `x` } })
            commit()
            markReady()
            fail = () => markError(new Error(`temporary source error`))
            recover = markReady
          },
        },
      })
      source.startSyncImmediate()
      if (errorAt === `before-views`) fail()
      const build = () => {
        const builder = new Query()
          .from({ r: source })
          .where(({ r }) => eq(r.g, `x`))
        if (!(builder instanceof BaseQueryBuilder))
          throw new Error(`not a builder`)
        return createPooledLiveQuery(builder, { gcTime: 1 })!
      }
      const views = [build(), build()]
      const stops: Array<ReturnType<typeof source.subscribeChanges>> = []
      try {
        if (errorAt === `after-views`) fail()
        for (const view of views) {
          expect(view).toBeDefined()
          stops.push(view.subscribeChanges(() => {}))
          expect(view.status).toBe(`error`)
        }
        recover()
        for (const view of views) {
          expect(view.status).toBe(`ready`)
          expect(
            Array.from(view.entries(), ([key, row]) => ({
              key,
              id: row.id,
              g: row.g,
            })),
          ).toEqual([{ key: `a`, id: `a`, g: `x` }])
        }
        expect(source.subscriberCount).toBe(1)
      } finally {
        stops.forEach((stop) => stop.unsubscribe())
        await vi.advanceTimersByTimeAsync(100)
        await source.cleanup()
      }
    },
  )

  for (const gcTime of [1, 100, 0, Number.POSITIVE_INFINITY]) {
    for (const subscribe of [true, false]) {
      it(`matches a live-query Collection for gcTime ${gcTime}${subscribe ? `` : ` without a subscriber`}`, async () => {
        const expected = await releaseTime(compiled(gcTime, subscribe), 400)
        const actual = await releaseTime(pooled(gcTime, subscribe), 400)
        if (expected === undefined) expect(actual).toBeUndefined()
        // The Collection releases its source one cleanup-queue tick after
        // its GC timer fires; the partition releases in the timer itself.
        else expect([expected - 1, expected]).toContain(actual)
      })
    }
  }

  it(`follows its source again when resubscribed after its partition released`, async () => {
    const run = async (
      build: (source: ReturnType<typeof makeSource>) => any,
    ) => {
      const source = makeSource()
      const observer = createLiveQueryObserver(build(source), {
        mode: `wholesale`,
      })
      observer.subscribe(() => {})()
      await vi.advanceTimersByTimeAsync(50)
      // Hidden past gcTime, as under a hidden React Activity, then shown.
      source.utils.begin()
      source.utils.write({ type: `insert`, value: { id: `b`, g: `x` } })
      source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
      source.utils.commit()
      const stop = observer.subscribe(() => {})
      await vi.advanceTimersByTimeAsync(1)
      source.utils.begin()
      source.utils.write({ type: `insert`, value: { id: `c`, g: `x` } })
      source.utils.commit()
      await vi.advanceTimersByTimeAsync(1)
      const keys = [...observer.getSnapshot().state!.keys()]
      stop()
      return keys
    }
    const compiledKeys = await run((source) =>
      createLiveQueryCollection({
        query: query(source),
        startSync: true,
        gcTime: 1,
      }),
    )
    expect(compiledKeys).toEqual([`b`, `c`])
    expect(
      await run((source) =>
        createPooledLiveQuery(query(source)(new Query()), { gcTime: 1 })!,
      ),
    ).toEqual(compiledKeys)
  })

  it(`seeds a filtered view from its refilled group after a release`, async () => {
    const source = makeSource()
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `b`, g: `x` } })
    source.utils.commit()
    // `not(eq(r.id, 'b'))` is evaluated per view, so this view keeps `a`.
    const view = createPooledLiveQuery(
      query(source)(new Query()).where(({ r }: any) => not(eq(r.id, `b`))),
      { gcTime: 1 },
    )!
    const observer = createLiveQueryObserver(view, { mode: `wholesale` })
    observer.subscribe(() => {})()
    await vi.advanceTimersByTimeAsync(60)
    const stop = observer.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(1)
    expect([...observer.getSnapshot().state!.keys()]).toEqual([`a`])
    source.utils.begin()
    source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
    source.utils.commit()
    await vi.advanceTimersByTimeAsync(1)
    expect([...observer.getSnapshot().state!.keys()]).toEqual([])
    stop()
  })

  it(`shares one partition after a released partition subscribes again`, async () => {
    const source = makeSource()
    const mount = () => {
      const view = createPooledLiveQuery(query(source)(new Query()), {
        gcTime: 1,
      })!
      const observer = createLiveQueryObserver(view, { mode: `wholesale` })
      return { observer, stop: observer.subscribe(() => {}) }
    }
    const first = mount()
    first.stop()
    await vi.advanceTimersByTimeAsync(60)
    // The released partition's view subscribes again, beside a new view.
    const again = first.observer.subscribe(() => {})
    const second = mount()
    // The new view joins the partition that subscribed again.
    expect(source.subscriberCount).toBe(1)
    again()
    await vi.advanceTimersByTimeAsync(60)
    const third = mount()
    expect(source.subscriberCount).toBe(1)
    second.stop()
    third.stop()
  })

  it(`keeps a newer partition when an older one releases again`, async () => {
    const source = makeSource()
    const mount = () => {
      const view = createPooledLiveQuery(query(source)(new Query()), {
        gcTime: 1,
      })!
      const observer = createLiveQueryObserver(view, { mode: `wholesale` })
      return { observer, stop: observer.subscribe(() => {}) }
    }
    const first = mount()
    first.stop()
    await vi.advanceTimersByTimeAsync(60)
    // A new partition takes the key before the old view subscribes again.
    const second = mount()
    first.observer.subscribe(() => {})()
    await vi.advanceTimersByTimeAsync(60)
    const third = mount()
    expect(source.subscriberCount).toBe(1)
    second.stop()
    third.stop()
  })

  it(`turns terminal when source cleanup starts, before it settles`, async () => {
    let release!: () => void
    const source = createCollection<Row, string | number>({
      id: `pooled-gc-${serial++}`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `a`, g: `x` } })
          commit()
          markReady()
          // The adapter's cleanup stays pending until released.
          return () =>
            new Promise<void>((resolve) => {
              release = resolve
            })
        },
      },
    })
    const observe = (view: any) => {
      const observer = createLiveQueryObserver(view, { mode: `wholesale` })
      return { observer, stop: observer.subscribe(() => {}) }
    }
    const pooledView = observe(
      createPooledLiveQuery(query(source)(new Query()), { gcTime: 1 })!,
    )
    const compiledView = observe(
      createLiveQueryCollection({ query: query(source), startSync: true }),
    )
    await vi.advanceTimersByTimeAsync(1)
    const cleanup = source.cleanup()
    await vi.advanceTimersByTimeAsync(1)
    expect(compiledView.observer.getSnapshot().status).toBe(`error`)
    expect(pooledView.observer.getSnapshot().status).toBe(`error`)
    release()
    await cleanup
    pooledView.stop()
    compiledView.stop()
  })

  it(`defaults to a live-query Collection's gcTime when the adapter gives none`, async () => {
    // A pooled view and a compiled one, each on its own source.
    const pooledOnOwn = makeSource()
    const pooledObserver = createLiveQueryObserver(
      resolveLiveQueryValue(query(pooledOnOwn)(new Query()), {
        pool: pooledLiveQueries,
      }),
      { mode: `wholesale` },
    )
    pooledObserver.subscribe(() => {})()
    const compiledOnOwn = makeSource()
    const compiledObserver = createLiveQueryObserver(
      createLiveQueryCollection({
        query: query(compiledOnOwn),
        startSync: true,
      }),
      { mode: `wholesale` },
    )
    compiledObserver.subscribe(() => {})()
    await vi.advanceTimersByTimeAsync(4_900)
    expect(compiledOnOwn.subscriberCount).toBe(1)
    expect(pooledOnOwn.subscriberCount).toBe(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(compiledOnOwn.subscriberCount).toBe(0)
    expect(pooledOnOwn.subscriberCount).toBe(0)
  })

  it(`pools a query config that names only its query`, () => {
    const source = makeSource()
    const observe = (value: unknown) =>
      createLiveQueryObserver(
        resolveLiveQueryValue(value, { pool: pooledLiveQueries, gcTime: 1 }),
        {
          mode: `wholesale`,
        },
      ).subscribe(() => {})
    const stops = [
      observe({ query: query(source)(new Query()) }),
      observe({ query: query(source)(new Query()), gcTime: 5 }),
    ]
    expect(source.subscriberCount).toBe(1)
    // An id names a distinct Collection, so that config compiles its own.
    stops.push(observe({ query: query(source)(new Query()), id: `own` }))
    expect(source.subscriberCount).toBe(2)
    for (const stop of stops) stop()
  })

  it(`keeps groups only for values with rows or watchers`, async () => {
    const source = makeSource()
    source.utils.begin()
    for (let n = 0; n < 50; n++) {
      source.utils.write({ type: `insert`, value: { id: `r${n}`, g: `v${n}` } })
    }
    source.utils.commit()
    const view = createPooledLiveQuery(query(source)(new Query()), {
      gcTime: 1,
    })!
    const observer = createLiveQueryObserver(view, { mode: `wholesale` })
    const stop = observer.subscribe(() => {})
    const groups = () =>
      (view as unknown as { partition: { groups: Map<string, unknown> } })
        .partition.groups.size
    // One group per distinct value, plus the watched `x`.
    expect(groups()).toBe(51)
    source.utils.begin()
    for (let n = 0; n < 50; n++) {
      source.utils.write({ type: `delete`, value: { id: `r${n}`, g: `v${n}` } })
    }
    source.utils.commit()
    expect(groups()).toBe(1)
    // The watched group empties and is dropped; new rows recreate it, and
    // the observer still sees them.
    source.utils.begin()
    source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
    source.utils.commit()
    expect(groups()).toBe(1)
    expect(observer.getSnapshot().data).toEqual([])
    stop()
    expect(groups()).toBe(0)
    const again = observer.subscribe(() => {})
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `b`, g: `x` } })
    source.utils.commit()
    expect([...observer.getSnapshot().state!.keys()]).toEqual([`b`])
    again()
  })

  it(`never reuses a dropped group's revision for a detached reader`, () => {
    const source = makeSource()
    const write = (type: `insert` | `delete`, id: string, g: string) => {
      source.utils.begin()
      source.utils.write({ type, value: { id, g } })
      source.utils.commit()
    }
    // A watched `y` view keeps the partition subscribed.
    write(`insert`, `z`, `y`)
    const keepAlive = createLiveQueryObserver(
      createPooledLiveQuery(
        new Query()
          .from({ r: source })
          .where(({ r }: any) => eq(r.g, `y`)) as any,
        { gcTime: 1 },
      ),
      { mode: `wholesale` },
    ).subscribe(() => {})
    // The `x` view is read without subscribing, so it compares revisions.
    const reader = createLiveQueryObserver(
      createPooledLiveQuery(query(source)(new Query()), { gcTime: 1 }),
      { mode: `wholesale` },
    )
    write(`insert`, `b`, `x`)
    const keys = () => [...reader.getSnapshot().state!.keys()]
    expect(keys()).toEqual([`a`, `b`])
    // Emptying the unwatched group drops it; new rows build a new one.
    source.utils.begin()
    source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
    source.utils.write({ type: `delete`, value: { id: `b`, g: `x` } })
    source.utils.commit()
    write(`insert`, `c`, `x`)
    write(`insert`, `d`, `x`)
    expect(keys()).toEqual([`c`, `d`])
    keepAlive()
  })

  it(`keeps its public Collection live while observed`, async () => {
    const source = makeSource()
    const view = createPooledLiveQuery(query(source)(new Query()), {
      gcTime: 1,
    })!
    const observer = createLiveQueryObserver(view, { mode: `wholesale` })
    const stop = observer.subscribe(() => {})
    const collection = observer.getSnapshot().collection!
    expect(collection.toArray).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(collection.status).toBe(`ready`)
    expect(collection.toArray).toHaveLength(1)
    stop()
  })

  it(`hands users a Collection that queries accept as a source`, () => {
    const source = makeSource()
    const view = createPooledLiveQuery(query(source)(new Query()), {
      gcTime: 1,
    })!
    const collection = createLiveQueryObserver(view, {
      mode: `wholesale`,
    }).getSnapshot().collection!
    expect(collection).toBeInstanceOf(CollectionImpl)
    const nested = createLiveQueryCollection({
      query: (q) => q.from({ c: collection }),
      startSync: true,
    })
    expect(nested.toArray.map((row) => row.id)).toEqual([`a`])
  })

  it.each([[[5, 120]], [[120, 5]]])(
    `releases with the longest gcTime among a partition's views (%j)`,
    async (gcTimes) => {
      const source = makeSource()
      for (const gcTime of gcTimes) {
        const view = createPooledLiveQuery(query(source)(new Query()), {
          gcTime,
        })!
        createLiveQueryObserver(view, { mode: `wholesale` }).subscribe(
          () => {},
        )()
      }
      expect(await releaseTime(source, 400)).toBe(120)
    },
  )
})
