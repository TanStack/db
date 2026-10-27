import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { BaseQueryBuilder, Query } from '../../src/query/builder/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createPooledLiveQuery } from '../../src/query/pooled-live-query.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { createOracleReach } from '../oracle-reach.js'
import { declareOracle } from '../oracle-declaration.js'
import { captureMicrotaskErrors, withOracleCleanup } from '../utils.js'
import {
  makeSource,
  query,
  releaseTime,
} from './pooled-live-query-gc-support.js'
import type { Row } from './pooled-live-query-gc-support.js'

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

// Pooled and live-query Collection sources lose their last subscriber at the
// same time under the same timeline. The Collection is the differential
// reference: the pooled partition releases in its GC timer, and the Collection
// one cleanup-queue tick later.
async function expectPooledReleaseMatchesCollection(
  gcTime: number,
  subscribe: boolean,
): Promise<void> {
  const expected = await releaseTime(compiled(gcTime, subscribe), 400)
  const actual = await releaseTime(pooled(gcTime, subscribe), 400)
  if (expected === undefined) expect(actual).toBeUndefined()
  // The Collection releases its source one cleanup-queue tick after
  // its GC timer fires; the partition releases in the timer itself.
  else expect([expected - 1, expected]).toContain(actual)
}

declareOracle({
  check: [expectPooledReleaseMatchesCollection, checkCallbackHistory],
  model: [expectedCallbackHistory],
})

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

  for (const gcTime of [1, 100, 0, Number.POSITIVE_INFINITY]) {
    for (const subscribe of [true, false]) {
      it(`matches a live-query Collection for gcTime ${gcTime}${subscribe ? `` : ` without a subscriber`}`, async () => {
        await expectPooledReleaseMatchesCollection(gcTime, subscribe)
      })
    }
  }
})
