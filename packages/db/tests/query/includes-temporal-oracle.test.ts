import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { SubsetDemandController } from '../../src/query/live/subset-demand-controller.js'
import { createEffect } from '../../src/query/effect.js'
import { LoadSubsetOperationAbortedError } from '../../src/errors.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  queryOnce,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { createOracleReach } from '../oracle-reach.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import { captureMicrotaskErrors, flushPromises } from '../utils.js'
import {
  correlationKeys,
  createColdPosts,
  createMutablePosts,
  createPostsWithCommentsLive,
  createRemovablePost,
  finishPreload,
  finishTemporalCleanup,
  nextCollectionId,
  startPreload,
} from './includes-temporal-support.js'
import type { Collection } from '../../src/collection/index.js'
import type { Deferred } from '../../src/deferred.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type { LazyDemandPlan } from '../../src/query/compiler/joins.js'
import type { Effect } from '../../src/query/effect.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { Scheduler } from 'fast-check'
import type {
  CapturedFailure,
  Comment,
  Post,
  PreloadState,
  ProgressivePost,
  User,
} from './includes-temporal-support.js'

/**
 * # Which child acquisitions control initial-query readiness and publication?
 *
 * Parent routes can appear, disappear, and return. Their correlated child
 * demand changes with them. A settled Promise does not identify current work.
 * The model follows logical demand incarnations and applies these laws:
 *
 * 1. Successful current acquisitions must cover every reachable child demand
 *    before initial-query readiness, with their establishing sync writes applied.
 * 2. Demand that is no longer reachable cannot block initial-query readiness.
 * 3. An obsolete acquisition cannot publish request-scoped rows, satisfy
 *    current demand, or complete the current preload.
 * 4. A subset-load promise fulfills only after its establishing sync writes apply.
 * 5. Failure belongs to the demand that failed. Retired failure cannot poison
 *    a later demand or keep unrelated graph work private.
 * 6. Growth loads only uncovered keys. Churn replaces fragmented coverage only
 *    after the complete current union applies; failure preserves prior coverage.
 * 7. Source Collection readiness gates initial-query readiness only for an
 *    eager source. An on-demand source, including one
 *    whose Collection readiness lags its settled subsets, gates it through
 *    demand alone. An Effect with `skipInitial` ends suppression at the same
 *    point.
 *
 * No one state machine mirrors the production controller. The declared models
 * cover initial-query readiness (Model A), the current demand of scheduled
 * acquisitions, release reentry, and source readiness (Model D). Each model
 * records only the public facts needed for its law. Fixed scenarios for churn,
 * cancellation, failed replay, and progressive delivery have literal
 * expectations and no model; they live in includes-temporal.test.ts.
 * "Demand incarnation" is a model label for one interval of active logical
 * demand on a route. Reactivation starts another interval; the label does not
 * imply one physical acquisition or one provider transport. The fast/late
 * phase is a fixture clock around source startup, not an ordered query window.
 * fast-check schedules current and obsolete completions in new orders, while
 * fixed scheduler orders pin both directions.
 *
 * The production drivers use real Collections, compiled includes, applied
 * receipts, release callbacks, replay barriers, and source writes. They observe
 * live-query Collection readiness, preload settlement, visible rows, request
 * keys, release signals, and errors at each named boundary. Observation fields
 * named `ready` record `live.isReady()`; `preloadSettled` records whether the
 * preload promise fulfilled or rejected. The live-query architecture remains
 * the contract source.
 *
 * The fragmented-demand checks (requested key unions, abort signals, and
 * retained rows after rejection) are fixed scenarios with literal expectations.
 * They moved unchanged to includes-temporal.test.ts as supplemental coverage.
 *
 * Known omissions: these controlled adapters establish core demand and graph
 * behavior, not that a real provider honors abort or supplies the same applied
 * receipts. The scheduled history has two demand incarnations; it does not
 * establish arbitrary route churn or transport completion order. This file
 * does not judge framework render timing; the React Suspense test checks that
 * Suspense and `isReady` release together over a lagging source, and other
 * framework adapters rely on the same Collection readiness without their own
 * witness.
 */

function createColdComments(): {
  collection: Collection<Comment>
  loads: Array<LoadSubsetOptions>
} {
  const loads: Array<LoadSubsetOptions> = []
  const comments: Array<Comment> = [
    { id: 100, postId: 1, body: `one` },
    { id: 200, postId: 2, body: `two` },
  ]
  const collection = createCollection<Comment>({
    id: nextCollectionId(`temporal-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => ({
        loadSubset: (options) => {
          loads.push(options)
          const requested = new Set(correlationKeys([options], `postId`))
          begin()
          for (const comment of comments) {
            if (requested.has(comment.postId)) {
              write({ type: `insert`, value: comment })
            }
          }
          commit()
          markReady()
          return Promise.resolve()
        },
      }),
    },
  })
  return { collection, loads }
}

// Model A: initial-query readiness depends only on currently reachable demand.
type ReadinessObservation = {
  ready: boolean
  preloadSettled: boolean
  rowCount: number
  childLoadCount: number
  loadedPostIds: Array<number>
}

type ReadinessContext = {
  posts: Collection<Post>
  comments: Collection<Comment>
  live: ReturnType<typeof createLiveQueryCollection>
  loads: Array<LoadSubsetOptions>
  preload: PreloadState
  parentLoaded: Deferred<void>
  expected: ReadinessObservation
}

// Model A's prediction after the parent rows load: every reachable child demand
// settles, so the query is ready. One grouped child acquisition covers every
// selected parent key, and an empty parent set issues none.
function expectedReadinessObservation(
  initialPosts: ReadonlyArray<Post>,
): ReadinessObservation {
  return {
    ready: true,
    preloadSettled: true,
    rowCount: initialPosts.length,
    childLoadCount: initialPosts.length === 0 ? 0 : 1,
    loadedPostIds: initialPosts.map(({ id }) => id),
  }
}

function createReadinessDriver(
  initialPosts: ReadonlyArray<Post>,
): TraceDriver<never, ReadinessContext> {
  return {
    setup: () => {
      const { collection: postCollection, loaded: parentLoaded } =
        createColdPosts(initialPosts)
      const { collection: comments, loads } = createColdComments()
      const live = createLiveQueryCollection((q) =>
        q
          .from({ post: postCollection })
          .where(({ post }) => eq(post.authorId, `selected`))
          .select(({ post }) => ({
            id: post.id,
            comments: toArray(
              q
                .from({ comment: comments })
                .where(({ comment }) => eq(comment.postId, post.id)),
            ),
          })),
      )

      return {
        posts: postCollection,
        comments,
        live,
        loads,
        preload: { preloadSettled: false },
        parentLoaded,
        expected: expectedReadinessObservation(initialPosts),
      }
    },
    start: async (context) => {
      const preload = startPreload(context.live, context.preload)
      await context.parentLoaded.promise
      await preload
    },
    apply: () => undefined,
    cleanup: async ({ posts, comments, live, preload }) => {
      await finishTemporalCleanup(undefined, [
        () => live.cleanup(),
        () => finishPreload(preload),
        () => posts.cleanup(),
        () => comments.cleanup(),
      ])
    },
  }
}

const readinessProjection: TraceProjection<
  ReadinessContext,
  ReadinessObservation
> = {
  observe: ({ live, loads, preload }) => ({
    ready: live.isReady(),
    preloadSettled: preload.preloadSettled,
    rowCount: live.size,
    childLoadCount: loads.length,
    loadedPostIds: correlationKeys(loads, `postId`),
  }),
  recompute: ({ expected }) => expected,
  assertEqual: (observed, expected) => {
    expect(observed).toEqual(expected)
    return undefined
  },
}

async function expectReadinessMatches(
  posts: ReadonlyArray<Post>,
): Promise<void> {
  await runTrace({
    steps: [],
    driver: createReadinessDriver(posts),
    projection: readinessProjection,
  })
}

async function expectScheduledAcquisitionsRespectCurrentDemand(
  scheduler: Scheduler,
): Promise<void> {
  // The scheduler changes only acquisition promise settlement order. An aborted
  // acquisition cannot publish request-scoped rows for the reactivated demand.
  const { collection: posts, remove, add } = createRemovablePost()
  const requests: Array<{
    outcome: Promise<void>
    signal: AbortSignal | undefined
  }> = []
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-scheduled-generation-comments`),
    getKey: (comment) => comment.id,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => ({
        loadSubset: (options) => {
          const requestIndex = requests.length
          const signal = options.signal
          const outcome = scheduler
            .schedule(Promise.resolve(), `demand-${requestIndex}`)
            .then(() => {
              if (signal?.aborted) return
              begin()
              write({
                type: `insert`,
                value: {
                  id: requestIndex === 0 ? 100 : 200,
                  postId: 1,
                  body: requestIndex === 0 ? `obsolete` : `current`,
                },
              })
              commit()
              markReady()
            })
          requests.push({ outcome, signal })
          return outcome
        },
      }),
    },
  })
  const live = createPostsWithCommentsLive(posts, comments)
  const preload = live.preload()
  const observations: Array<ScheduledDemandObservation> = []

  let primaryFailure: CapturedFailure | undefined
  try {
    await flushPromises()
    expect(requests).toHaveLength(1)

    remove()
    await preload
    add()
    await flushPromises()
    expect(requests).toHaveLength(2)
    expect(requests[0]!.signal?.aborted).toBe(true)

    await scheduler.waitAll(async (task) => {
      await task()
      await flushPromises()
      // Copy this completion's public value. Later completions must not replace
      // it.
      observations.push({
        completed: scheduler
          .report()
          .filter(({ status }) => status === `resolved`)
          .map(({ label }) => label),
        ready: live.isReady(),
        rows: live.toArray.map(({ id, comments: rows }) => ({
          id,
          comments: rows.map(({ id: childId, body }) => ({
            id: childId,
            body,
          })),
        })),
      })
    })
    await Promise.all(requests.map(({ outcome }) => outcome))
    await flushPromises()

    expect(observations).toHaveLength(2)
    for (const [index, observation] of observations.entries()) {
      expectScheduledDemandObservation(observation, index)
    }
    expect(live.isReady()).toBe(true)
    expect(live.get(1)?.comments.map(({ id, body }) => ({ id, body }))).toEqual(
      [{ id: 200, body: `current` }],
    )
  } catch (error) {
    primaryFailure = { error }
  }
  await finishTemporalCleanup(primaryFailure, [
    () => scheduler.count() > 0 && scheduler.waitAll(),
    () => Promise.allSettled(requests.map(({ outcome }) => outcome)),
    () => live.cleanup(),
    () => Promise.allSettled([preload]),
    () => posts.cleanup(),
    () => comments.cleanup(),
  ])
}

type ScheduledDemandObservation = {
  completed: Array<string>
  ready: boolean
  rows: Array<{ id: number; comments: Array<{ id: number; body: string }> }>
}

// The public row depends on whether the current acquisition's promise fulfilled.
// An obsolete acquisition's settlement alone cannot add its child row.
function expectScheduledDemandObservation(
  observation: ScheduledDemandObservation,
  index: number,
): void {
  expect(observation.completed).toHaveLength(index + 1)
  const currentCompleted = observation.completed.includes(`demand-1`)
  expect(observation.rows).toEqual([
    {
      id: 1,
      comments: currentCompleted ? [{ id: 200, body: `current` }] : [],
    },
  ])
  if (currentCompleted) expect(observation.ready).toBe(true)
}

async function expectDemandReactivationRetriesAfterReleaseFailure(
  keys: ReadonlyArray<number>,
): Promise<void> {
  let loadCount = 0
  let unloadCount = 0
  let allowUnload = false
  const requestedKeys: Array<Array<number>> = []
  const releaseError = new Error(`child release failed`)
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-release-retry-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ markReady }) => ({
        loadSubset: (options) => {
          loadCount += 1
          requestedKeys.push(correlationKeys([options], `postId`))
          markReady()
          return true
        },
        unloadSubset: () => {
          unloadCount += 1
          if (!allowUnload) throw releaseError
        },
      }),
    },
  })
  comments.createIndex((comment) => comment.postId)
  const subscription = comments.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const controller = new SubsetDemandController()
  const plan: LazyDemandPlan = {
    id: `release-failure-retry`,
    path: [`postId`],
    collectionId: comments.id,
    initialKeys: new Set(),
  }
  // Core reports the throwing release uncaught, once.
  const uncaught = captureMicrotaskErrors()

  let primaryFailure: CapturedFailure | undefined
  try {
    expect(
      controller.setDemand(subscription, plan, new Set(keys)),
    ).toMatchObject({ changed: true, empty: false })
    expect(loadCount).toBe(1)

    const retired = controller.setDemand(subscription, plan, new Set())
    expect(retired).toMatchObject({ changed: true, empty: true })
    expect(unloadCount).toBe(1)
    await flushPromises()
    expect(uncaught.errors).toEqual([releaseError])

    const reactivated = controller.setDemand(subscription, plan, new Set(keys))
    expectReleaseReentryObservation(
      {
        changed: reactivated.changed,
        empty: reactivated.empty,
        loadCount,
        requestedKeys,
      },
      keys,
    )
  } catch (error) {
    primaryFailure = { error }
  }
  allowUnload = true
  await finishTemporalCleanup(primaryFailure, [
    () => controller.clear(),
    () => subscription.unsubscribe(),
    () => comments.cleanup(),
    () => uncaught.restore(),
  ])
}

type ReleaseReentryObservation = {
  changed: boolean
  empty: boolean
  loadCount: number
  requestedKeys: Array<Array<number>>
}

function expectReleaseReentryObservation(
  observed: ReleaseReentryObservation,
  keys: ReadonlyArray<number>,
): void {
  const expectedKeys = [...keys].sort((left, right) => left - right)
  expect(observed).toEqual({
    changed: true,
    empty: false,
    loadCount: 2,
    requestedKeys: [expectedKeys, expectedKeys],
  })
}

// Model D: source Collection readiness gates initial-query readiness only for
// an eager source.
//
// An on-demand source serves a consumer through subset acquisitions, so its
// settled demand is the evidence that the consumer's initial rows are present.
// Its own Collection readiness can lag that evidence: a progressive Electric
// source stays `loading` until its background full sync completes, while
// "the first query loads immediately (on-demand)" (TanStack DB 0.5 release
// post). An eager source serves no subset demand, so its Collection readiness
// is the only evidence. The architecture's initial-readiness law states this
// rule; this lane is its executable owner.
//
// The law has three kinds of consumer. A live-query Collection becomes ready,
// and its preload settles, at initial-query readiness. A one-shot read resolves
// at the same point with the rows held then: `queryOnce`, and a live query's
// `toArrayWhenReady()` and `stateWhenReady()`. Rows that are visible before
// readiness do not resolve a read. The `queryOnce` read starts with the
// trace. A live query's read starts right after `deliver`, when its rows are
// already visible; the live query itself preloads from the start. A read
// that starts after readiness resolves with the rows it sees then. An Effect with `skipInitial`
// suppresses every delta until the same point and delivers every later delta.
// An Effect without `skipInitial` passes the same gate, but the gate holds no
// callback: "other ordinary initial/refinement requests keep their existing
// callback timing", and `skipInitial` "only decides whether the initial rows
// are delivered" (ARCHITECTURE.md, Effects and initial readiness). Its
// callback-visible result is the query's current result at every checkpoint,
// before readiness too. Its cells reject an Effect that holds or drops its
// initial deltas until readiness.
//
// Each on-demand cell also runs a metamorphic twin: the same consumer over an
// on-demand source that is ready from its start, receiving every other step.
// The law says an on-demand source's Collection readiness never changes what
// its consumer observes, so the two must agree at every checkpoint. The twin
// does not use the model's eager/on-demand rule, so it still rejects a wrong
// readiness design if that rule shares the mistake.
//
// The model keeps four facts for the lagging source: whether its initial row
// was delivered, whether the consumer's acquisition settled, whether the
// source Collection is ready, and which rows the source wrote after initial
// readiness. Each fact changes a promised observation. The consumer reaches
// initial readiness when every source satisfies its own rule: settled demand
// for an on-demand source, Collection readiness for an eager source. The other
// source in a shape is ready from the start and adds no condition. An
// unordered live query publishes delivered rows as a partial result before
// readiness. An ordered window of one, the highest id, stays unpublished until
// its acquisitions settle (atomic window publication). An Effect with
// `skipInitial` reports only rows written after initial readiness.
//
// The history grammar is exhaustive. For an on-demand source, `deliver` comes
// before `settle` (applied settlement) and `source-ready` takes any of three
// positions. For an eager source, `deliver` and `source-ready` take either
// order. Every base history then receives one `change`, a later source write of
// a second matching row, at every position. A change between `settle` and
// `source-ready` separates "initial readiness at settlement" from "initial
// readiness at full sync". `settle` completes every acquisition the consumer
// has issued, including an ordered window's continuation requests, because
// how many requests reach a window's fixed point is an implementation choice.
// The live-query shapes put the lagging source at a direct root, a
// single-result root, an ordered root window, a correlated include child,
// the lazy side of a join, an eager root that sets `syncMode: 'eager'`, and
// an eager root that leaves `syncMode` at its default. Both Effect lanes, with
// and without `skipInitial`, use the direct, lazy-join, and both eager-root
// shapes; Effects over an ordered window or an include are not covered here. The eager roots are the nearby
// witnesses: a design that ignores source readiness entirely completes them
// too early, and one that exempts every source not configured as eager
// misses the default. A design that waits for every source's Collection
// readiness keeps the on-demand shapes waiting after their demand settles.
//
// Every on-demand history is also crossed with one disturbance before
// `settle`: a `truncate` of the lagging source, or a `rekey` of the join's or
// include's parent. Each retires the pending acquisition, which rejects with
// `AbortError`. The model's readiness rule is unchanged, because only current
// acquisitions count. An Effect that lets an obsolete rejection close
// suppression stays silent after readiness, and one that releases its hold
// without the truncate replacement reports rows too early. A live query that
// treats an aborted lazy-demand load as a failure enters error. Between a
// truncate and its settlement the replay barrier owns publication, so the
// model does not judge live-query rows or an Effect's callback-visible rows
// there; the metamorphic twin does.
//
// The driver uses real Collections, a live-query preload or `createEffect`,
// and controlled source writes. Each step is followed by a timer turn. Each
// checkpoint compares the consumer's observation and the number of
// acquisitions; the ordered shape records only that it acquired. A rejected acquisition, source error, and later demand changes
// are outside this lane; Models A to C, the Effect disposal oracle, and the
// subscription lifecycle oracle own them. The Electric live-query tests hold
// the receiving witnesses for a real progressive source and for an on-demand
// source that is ready before its subset loads.
type LaggingSourceMode = `on-demand` | `eager`

type LaggingSourceShape =
  | `direct`
  | `find-one`
  | `ordered`
  | `include`
  | `join`
  | `eager-root`
  | `eager-default`

type LaggingSourceConsumer =
  | `live-query`
  | `effect`
  | `effect-initial-rows`
  | `query-once`
  | `to-array-when-ready`
  | `state-when-ready`

// One-shot reads share the read model: rows at initial-query readiness.
const isReadConsumer = (consumer: LaggingSourceConsumer): boolean =>
  consumer === `query-once` ||
  consumer === `to-array-when-ready` ||
  consumer === `state-when-ready`

type LaggingSourceStep =
  `deliver` | `settle` | `source-ready` | `change` | `rekey` | `truncate`

const LAGGING_SOURCE_SHAPES: Record<LaggingSourceShape, LaggingSourceMode> = {
  direct: `on-demand`,
  'find-one': `on-demand`,
  ordered: `on-demand`,
  include: `on-demand`,
  join: `on-demand`,
  'eager-root': `eager`,
  'eager-default': `eager`,
}

const LAGGING_SOURCE_BASE_HISTORIES: Record<
  LaggingSourceMode,
  ReadonlyArray<ReadonlyArray<LaggingSourceStep>>
> = {
  'on-demand': [
    [`source-ready`, `deliver`, `settle`],
    [`deliver`, `source-ready`, `settle`],
    [`deliver`, `settle`, `source-ready`],
  ],
  eager: [
    [`source-ready`, `deliver`],
    [`deliver`, `source-ready`],
  ],
}

function laggingSourceHistories(
  mode: LaggingSourceMode,
): Array<Array<LaggingSourceStep>> {
  return LAGGING_SOURCE_BASE_HISTORIES[mode].flatMap((base) =>
    Array.from({ length: base.length + 1 }, (_, position) => [
      ...base.slice(0, position),
      `change` as const,
      ...base.slice(position),
    ]),
  )
}

// Every consumer also receives one disturbance before `settle`: `truncate`
// replaces the lagging source's rows, which retires and replays its pending
// acquisition, and `rekey` (join and include) moves the parent to a new key, which
// retires its pending lazy demand. Each obsolete acquisition rejects with
// `AbortError`. Neither may hold or close initial suppression; only the
// current acquisitions decide it.
function disturbedHistories(
  shape: LaggingSourceShape,
): Array<Array<LaggingSourceStep>> {
  const histories = laggingSourceHistories(LAGGING_SOURCE_SHAPES[shape])
  const disturbances: Array<LaggingSourceStep> =
    shape === `join` || shape === `include`
      ? [`rekey`, `truncate`]
      : LAGGING_SOURCE_SHAPES[shape] === `on-demand`
        ? [`truncate`]
        : []
  return [
    ...histories,
    ...disturbances.flatMap((disturbance) =>
      histories.flatMap((history) =>
        Array.from({ length: history.indexOf(`settle`) + 1 }, (_, position) => [
          ...history.slice(0, position),
          disturbance,
          ...history.slice(position),
        ]),
      ),
    ),
  ]
}

const INITIAL_POST_ID = 2

const CHANGED_POST_ID = 4

type LaggingSourceFacts = {
  delivered: boolean
  changed: boolean
  settled: boolean
  sourceReady: boolean
  disturbed: boolean
  parentId: number
  posts: Array<{ id: number; userId: number }>
  writtenAfterReadiness: Array<number>
  exitsAfterReadiness: number
  idsAtReadiness: Array<number> | undefined
  // A read started after `deliver`: the rows it owes, or `at-readiness` when
  // it started before readiness and so owes `idsAtReadiness`.
  readOwes: Array<number> | `at-readiness` | undefined
  replayPending: boolean
}

function initiallyReady(mode: LaggingSourceMode, facts: LaggingSourceFacts) {
  return mode === `on-demand` ? facts.settled : facts.sourceReady
}

type LiveQueryObservation = {
  ready: boolean
  preloadSettled: boolean
  // `null` between a truncate and its settlement: the replay barrier owns
  // publication there, so only the metamorphic twin compares those rows.
  postIds: Array<number> | null
  acquisitions: number
}

// A one-shot read waits for initial readiness, then returns the rows held at
// that moment; later writes do not change its result. The query is unordered,
// so the ids compare as a sorted set.
type ReadObservation = {
  resolvedIds: Array<number> | undefined
  acquisitions: number
}

type EffectObservation = {
  enteredPostIds: Array<number>
  otherEvents: number
  acquisitions: number
}

// An Effect without `skipInitial` has a callback-visible result: the rows it
// entered and has not exited. The recorder counts an `enter` for a visible
// key, and an `exit` or `update` for an absent key, as inconsistent, so a
// duplicate or lost delta reaches the comparison. `visible` is `null` between
// a truncate and its settlement, where the replay barrier owns publication.
type InitialRowsEffectObservation = {
  visible: { rows: number; postIds: Array<number> } | null
  inconsistentEvents: number
  acquisitions: number
}

// An unordered shape publishes held rows as a partial result. The `find-one`
// shape is the reported trace (TanStack/db#2113): a single result filtered by
// the initial post's id, so the later change never matches it. The ordered
// shape keeps its window of one, the highest id, unpublished until its
// acquisition settles (atomic window publication).
function expectedLiveQueryObservation(
  shape: LaggingSourceShape,
  facts: LaggingSourceFacts,
): LiveQueryObservation {
  const mode = LAGGING_SOURCE_SHAPES[shape]
  const ready = initiallyReady(mode, facts)
  const heldIds = facts.posts
    .filter((post) => postMatchesShape(shape, facts, post))
    .map(({ id }) => id)
    .sort((a, b) => a - b)
  return {
    ready,
    preloadSettled: ready,
    postIds: facts.replayPending
      ? null
      : shape !== `ordered`
        ? heldIds
        : facts.settled
          ? heldIds.slice(-1)
          : [],
    acquisitions: mode === `on-demand` ? 1 : 0,
  }
}

function expectedReadObservation(
  consumer: LaggingSourceConsumer,
  mode: LaggingSourceMode,
  facts: LaggingSourceFacts,
): ReadObservation {
  return {
    resolvedIds:
      consumer === `query-once` || facts.readOwes === `at-readiness`
        ? facts.idsAtReadiness
        : facts.readOwes,
    acquisitions: mode === `on-demand` ? 1 : 0,
  }
}

function expectedEffectObservation(
  mode: LaggingSourceMode,
  facts: LaggingSourceFacts,
): EffectObservation {
  return {
    enteredPostIds: [...facts.writtenAfterReadiness],
    otherEvents: facts.exitsAfterReadiness,
    acquisitions: mode === `on-demand` ? 1 : 0,
  }
}

// Without `skipInitial`, initial-query readiness holds the Effect's gate but
// no callback: ordinary initial requests keep their callback timing. So the
// callback-visible result is the shape's current result at every checkpoint,
// before readiness too. A left-join parent always shows one row, matched or
// unmatched.
function expectedInitialRowsEffectObservation(
  shape: LaggingSourceShape,
  facts: LaggingSourceFacts,
): InitialRowsEffectObservation {
  const postIds = facts.posts
    .filter((post) => postMatchesShape(shape, facts, post))
    .map(({ id }) => id)
    .sort((a, b) => a - b)
  return {
    visible: facts.replayPending
      ? null
      : {
          rows: shape === `join` ? Math.max(postIds.length, 1) : postIds.length,
          postIds,
        },
    inconsistentEvents: 0,
    acquisitions: LAGGING_SOURCE_SHAPES[shape] === `on-demand` ? 1 : 0,
  }
}

// A written post reaches the consumer when it matches the current parent: the
// selected user for the join, or `userId = 2` for the root shapes. After
// initial readiness it enters the Effect; a left-join parent that showed no
// post also exits its unmatched row.
// A post belongs to a shape's result when it matches the shape's filter: its
// id for the single result, the current parent for the join and include, and
// `userId = 2` for the root shapes.
function postMatchesShape(
  shape: LaggingSourceShape,
  facts: LaggingSourceFacts,
  post: { id: number; userId: number },
): boolean {
  if (shape === `find-one`) return post.id === INITIAL_POST_ID
  return (
    post.userId ===
    (shape === `join` || shape === `include` ? facts.parentId : 2)
  )
}

function recordLaggingSourceWrite(
  shape: LaggingSourceShape,
  facts: LaggingSourceFacts,
  post: { id: number; userId: number },
): void {
  const matches = postMatchesShape(shape, facts, post)
  const parentShowedPost = facts.posts.some(
    ({ userId }) => userId === facts.parentId,
  )
  if (matches && initiallyReady(LAGGING_SOURCE_SHAPES[shape], facts)) {
    facts.writtenAfterReadiness.push(post.id)
    if (shape === `join` && !parentShowedPost) facts.exitsAfterReadiness += 1
  }
  facts.posts.push(post)
}

type LaggingPosts = {
  collection: Collection<ProgressivePost>
  acquisitions: Array<Deferred<void>>
  write: (post: { id: number; userId: number }) => void
  truncate: () => void
  markReady: () => void
}

// The source never calls `markReady()` on its own. `write` inserts one post
// through a normal sync transaction; `truncate` replaces every row; `markReady`
// stands for the end of a background full sync. An acquisition whose signal
// aborts rejects with `AbortError`, as a source that can cancel must.
function createLaggingPosts(
  mode: LaggingSourceMode,
  explicitMode: boolean,
  readyAtStart = false,
): LaggingPosts {
  const acquisitions: Array<Deferred<void>> = []
  let sync:
    | {
        begin: () => void
        write: (change: { type: `insert`; value: ProgressivePost }) => void
        commit: () => unknown
        markReady: () => void
        truncate: () => void
      }
    | undefined
  const collection = createCollection<ProgressivePost>({
    id: nextCollectionId(`temporal-lagging-posts`),
    getKey: (post) => post.id,
    ...(explicitMode ? { syncMode: mode } : {}),
    sync: {
      sync: ({ begin, write, commit, markReady, truncate }) => {
        sync = { begin, write, commit, markReady, truncate }
        if (readyAtStart) markReady()
        if (mode === `eager`) return undefined
        return {
          loadSubset: ({ signal }) => {
            const acquisition = createDeferred<void>()
            acquisitions.push(acquisition)
            signal?.addEventListener(`abort`, () =>
              acquisition.reject(new LoadSubsetOperationAbortedError()),
            )
            return acquisition.promise
          },
        }
      },
    },
  })
  return {
    collection,
    acquisitions,
    write: (post) => {
      sync!.begin()
      sync!.write({ type: `insert`, value: { ...post, title: `selected` } })
      sync!.commit()
    },
    truncate: () => {
      sync!.begin()
      sync!.truncate()
      sync!.commit()
    },
    markReady: () => sync!.markReady(),
  }
}

// Users holds only the selected parent. `rekey` replaces user 2 with user 3.
function createReadyUsers(): {
  collection: Collection<User>
  rekey: () => void
} {
  let sync:
    | {
        begin: () => void
        write: (change: { type: `insert` | `delete`; value: User }) => void
        commit: () => unknown
      }
    | undefined
  const collection = createCollection<User>({
    id: nextCollectionId(`temporal-ready-users`),
    getKey: (user) => user.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        sync = { begin, write, commit }
        begin()
        write({ type: `insert`, value: { id: 2, name: `selected` } })
        commit()
        markReady()
      },
    },
  })
  return {
    collection,
    rekey: () => {
      sync!.begin()
      sync!.write({ type: `delete`, value: { id: 2, name: `selected` } })
      sync!.write({ type: `insert`, value: { id: 3, name: `selected` } })
      sync!.commit()
    },
  }
}

function laggingSourceQuery(
  shape: LaggingSourceShape,
  posts: Collection<ProgressivePost>,
  users: Collection<User> | undefined,
) {
  return (q: InitialQueryBuilder) => {
    if (
      shape === `direct` ||
      shape === `eager-root` ||
      shape === `eager-default`
    )
      return q.from({ post: posts }).where(({ post }) => eq(post.userId, 2))
    if (shape === `find-one`)
      return q
        .from({ post: posts })
        .where(({ post }) => eq(post.id, INITIAL_POST_ID))
        .findOne()
    if (shape === `ordered`)
      return q
        .from({ post: posts })
        .where(({ post }) => eq(post.userId, 2))
        .orderBy(({ post }) => post.id, `desc`)
        .limit(1)
    if (shape === `include`)
      return q.from({ user: users! }).select(({ user }) => ({
        id: user.id,
        posts: toArray(
          q.from({ post: posts }).where(({ post }) => eq(post.userId, user.id)),
        ),
      }))
    return q
      .from({ user: users! })
      .join({ post: posts }, ({ user, post }) => eq(user.id, post.userId))
      .select(({ user, post }) => ({ id: user.id, postId: post.id }))
  }
}

// Each shape projects a result row to the selected post ids it shows. An
// include parent and an unmatched join row show no post.
function rowPostIds(
  shape: LaggingSourceShape,
  row: Record<string, unknown>,
): Array<number> {
  if (shape === `include`)
    return (row.posts as Array<ProgressivePost>).map(({ id }) => id)
  if (shape === `join`)
    return typeof row.postId === `number` ? [row.postId] : []
  return [row.id as number]
}

// One consumer of a lagging source: a live query with its preload, a
// `skipInitial` Effect with the deltas it reported, or an Effect without
// `skipInitial` with its callback-visible rows.
type LaggingSourceConsumerState = {
  source: LaggingPosts
  resolvedIds: Array<number> | undefined
  live: ReturnType<typeof createLiveQueryCollection> | undefined
  preload: PreloadState
  effect: Effect | undefined
  enteredPostIds: Array<number>
  otherEvents: number
  visibleRows: Map<unknown, Record<string, unknown>>
  inconsistentEvents: number
  // Starts a live query's `toArrayWhenReady()` or `stateWhenReady()` read.
  startRead: (() => void) | undefined
}

type LaggingSourceContext = {
  shape: LaggingSourceShape
  mode: LaggingSourceMode
  users: Collection<User> | undefined
  rekeyUsers: (() => void) | undefined
  facts: LaggingSourceFacts
  main: LaggingSourceConsumerState
  // The metamorphic twin reads an on-demand source that is ready from its
  // start and receives every other step. An on-demand source's Collection
  // readiness must not change what its consumer observes, so the two
  // consumers must agree at every checkpoint. The twin never consults the
  // model's mode rule; it compares production with production.
  twin: LaggingSourceConsumerState | undefined
}

function startLaggingSourceConsumer(
  consumer: LaggingSourceConsumer,
  shape: LaggingSourceShape,
  source: LaggingPosts,
  users: Collection<User> | undefined,
): LaggingSourceConsumerState {
  const state: LaggingSourceConsumerState = {
    source,
    resolvedIds: undefined,
    live: undefined,
    preload: { preloadSettled: false },
    effect: undefined,
    enteredPostIds: [],
    otherEvents: 0,
    visibleRows: new Map(),
    inconsistentEvents: 0,
    startRead: undefined,
  }
  const query = laggingSourceQuery(shape, source.collection, users)
  if (consumer === `live-query`) {
    state.live = createLiveQueryCollection(query)
    void startPreload(state.live, state.preload)
  } else if (isReadConsumer(consumer)) {
    const resolve = (rows: ReadonlyArray<object>) => {
      state.resolvedIds = rows
        .flatMap((row) => rowPostIds(shape, row as Record<string, unknown>))
        .sort((a, b) => a - b)
    }
    if (consumer === `query-once`) {
      void queryOnce(query).then((rows) => resolve(rows as Array<object>))
    } else {
      const live = createLiveQueryCollection(query)
      state.live = live
      void startPreload(live, state.preload)
      state.startRead = () => {
        const read =
          consumer === `to-array-when-ready`
            ? live.toArrayWhenReady()
            : live.stateWhenReady().then((rows) => [...rows.values()])
        void read.then(resolve)
      }
    }
  } else {
    const skipInitial = consumer === `effect`
    state.effect = createEffect({
      query,
      skipInitial,
      onBatch: (events) => {
        for (const event of events) {
          if (skipInitial) {
            if (event.type === `enter`)
              state.enteredPostIds.push(...rowPostIds(shape, event.value))
            else state.otherEvents += 1
            continue
          }
          const visible = state.visibleRows.has(event.key)
          if (event.type === `enter` ? visible : !visible)
            state.inconsistentEvents += 1
          if (event.type === `exit`) state.visibleRows.delete(event.key)
          else state.visibleRows.set(event.key, event.value)
        }
      },
    })
  }
  return state
}

function applyLaggingSourceStep(
  step: LaggingSourceStep,
  { shape, main, twin, facts, rekeyUsers }: LaggingSourceContext,
): void {
  const sources = [main.source, ...(twin ? [twin.source] : [])]
  if (step === `deliver` || step === `change`) {
    const post =
      step === `deliver`
        ? { id: INITIAL_POST_ID, userId: 2 }
        : { id: CHANGED_POST_ID, userId: facts.parentId }
    for (const source of sources) source.write(post)
    if (step === `deliver`) facts.delivered = true
    else facts.changed = true
    recordLaggingSourceWrite(shape, facts, post)
  } else if (step === `rekey`) {
    rekeyUsers!()
    facts.parentId = 3
    facts.disturbed = true
  } else if (step === `truncate`) {
    for (const source of sources) source.truncate()
    facts.posts = []
    facts.disturbed = true
    facts.replayPending = true
  } else if (step === `settle`) {
    for (const source of sources)
      for (const acquisition of source.acquisitions) acquisition.resolve()
    facts.settled = true
    facts.replayPending = false
  } else {
    // The twin's source has been ready since its start.
    main.source.markReady()
    facts.sourceReady = true
  }
  if (
    facts.idsAtReadiness === undefined &&
    initiallyReady(LAGGING_SOURCE_SHAPES[shape], facts)
  ) {
    facts.idsAtReadiness = facts.posts
      .filter((post) => postMatchesShape(shape, facts, post))
      .map(({ id }) => id)
      .sort((a, b) => a - b)
  }
}

function createLaggingSourceDriver(
  consumer: LaggingSourceConsumer,
  shape: LaggingSourceShape,
): TraceDriver<LaggingSourceStep, LaggingSourceContext> {
  const mode = LAGGING_SOURCE_SHAPES[shape]
  return {
    setup: () => {
      const users =
        shape === `direct` ||
        shape === `find-one` ||
        shape === `ordered` ||
        shape === `eager-root` ||
        shape === `eager-default`
          ? undefined
          : createReadyUsers()
      return {
        shape,
        mode,
        users: users?.collection,
        rekeyUsers: users?.rekey,
        facts: {
          delivered: false,
          changed: false,
          settled: false,
          sourceReady: false,
          disturbed: false,
          parentId: 2,
          posts: [],
          writtenAfterReadiness: [],
          exitsAfterReadiness: 0,
          idsAtReadiness: undefined,
          readOwes: undefined,
          replayPending: false,
        },
        main: startLaggingSourceConsumer(
          consumer,
          shape,
          createLaggingPosts(mode, shape !== `eager-default`),
          users?.collection,
        ),
        twin:
          mode === `on-demand`
            ? startLaggingSourceConsumer(
                consumer,
                shape,
                createLaggingPosts(mode, true, true),
                users?.collection,
              )
            : undefined,
      }
    },
    start: async () => {
      await flushPromises()
    },
    apply: async (step, context) => {
      applyLaggingSourceStep(step, context)
      await flushPromises()
      if (step === `deliver` && context.main.startRead) {
        const { facts } = context
        facts.readOwes =
          facts.idsAtReadiness === undefined
            ? `at-readiness`
            : facts.posts
                .filter((post) => postMatchesShape(context.shape, facts, post))
                .map(({ id }) => id)
                .sort((a, b) => a - b)
        context.main.startRead()
        context.twin?.startRead?.()
        await flushPromises()
      }
      // An ordered window may issue continuation requests to reach its fixed
      // point. `settle` completes that whole chain without new rows.
      const sources = [
        context.main.source,
        ...(context.twin ? [context.twin.source] : []),
      ]
      while (
        step === `settle` &&
        sources.some((source) =>
          source.acquisitions.some(({ isPending }) => isPending()),
        )
      ) {
        for (const source of sources)
          for (const acquisition of source.acquisitions) acquisition.resolve()
        await flushPromises()
      }
    },
    cleanup: async ({ users, main, twin }) => {
      const states = [main, ...(twin ? [twin] : [])]
      for (const { source } of states)
        for (const acquisition of source.acquisitions) acquisition.resolve()
      await finishTemporalCleanup(
        undefined,
        states
          .flatMap(({ live, effect, source, preload }) => [
            () => live?.cleanup(),
            () => (live ? finishPreload(preload) : undefined),
            () => effect?.dispose(),
            () => source.collection.cleanup(),
          ])
          .concat([() => users?.cleanup()]),
      )
    },
  }
}

// The number of ordered requests needed to reach a window's fixed point, and
// of replacement requests after a disturbance, is an implementation choice.
// Those cells record only that the consumer acquired.
function observedAcquisitions(
  shape: LaggingSourceShape,
  facts: LaggingSourceFacts,
  source: LaggingPosts,
): number {
  const count = source.acquisitions.length
  return shape === `ordered` || facts.disturbed ? Math.min(count, 1) : count
}

function observeLaggingSourceConsumer(
  consumer: LaggingSourceConsumer,
  shape: LaggingSourceShape,
  facts: LaggingSourceFacts,
  state: LaggingSourceConsumerState,
): LaggingSourceObservation {
  if (isReadConsumer(consumer))
    return {
      resolvedIds: state.resolvedIds,
      acquisitions: observedAcquisitions(shape, facts, state.source),
    }
  if (consumer === `effect-initial-rows`) {
    const rows = [...state.visibleRows.values()]
    return {
      visible: {
        rows: rows.length,
        postIds: rows
          .flatMap((row) => rowPostIds(shape, row))
          .sort((a, b) => a - b),
      },
      inconsistentEvents: state.inconsistentEvents,
      acquisitions: observedAcquisitions(shape, facts, state.source),
    }
  }
  return consumer === `live-query`
    ? {
        ready: state.live!.isReady(),
        preloadSettled: state.preload.preloadSettled,
        postIds: (state.live!.toArray as Array<Record<string, unknown>>)
          .flatMap((row) => rowPostIds(shape, row))
          .sort((a, b) => a - b),
        acquisitions: observedAcquisitions(shape, facts, state.source),
      }
    : {
        enteredPostIds: [...state.enteredPostIds],
        otherEvents: state.otherEvents,
        acquisitions: observedAcquisitions(shape, facts, state.source),
      }
}

type LaggingSourceObservation =
  | LiveQueryObservation
  | EffectObservation
  | InitialRowsEffectObservation
  | ReadObservation

type LaggingSourceCheck = {
  observation: LaggingSourceObservation
  // Present only when the twin observed something else.
  twinDisagreement: LaggingSourceObservation | undefined
}

// The states the `effect-initial-rows` cells exist to reach. Each is read from
// the production observation together with the model's facts at a checkpoint.
const INITIAL_ROWS_EFFECT_REACH_STATES = [
  `rows visible before initial-query readiness`,
  `row written after initial-query readiness is visible`,
  `truncate replay before settlement`,
] as const
type InitialRowsEffectReach = ReturnType<
  typeof createOracleReach<(typeof INITIAL_ROWS_EFFECT_REACH_STATES)[number]>
>

function recordInitialRowsEffectReach(
  reach: InitialRowsEffectReach,
  shape: LaggingSourceShape,
  facts: LaggingSourceFacts,
  { visible }: InitialRowsEffectObservation,
): void {
  if (facts.replayPending) reach.reach(`truncate replay before settlement`)
  if (visible === null) return
  if (
    visible.postIds.length > 0 &&
    !initiallyReady(LAGGING_SOURCE_SHAPES[shape], facts)
  )
    reach.reach(`rows visible before initial-query readiness`)
  if (facts.writtenAfterReadiness.some((id) => visible.postIds.includes(id)))
    reach.reach(`row written after initial-query readiness is visible`)
}

function laggingSourceProjection(
  consumer: LaggingSourceConsumer,
  shape: LaggingSourceShape,
  reach: InitialRowsEffectReach | undefined,
): TraceProjection<LaggingSourceContext, LaggingSourceCheck> {
  return {
    observe: ({ facts, main, twin }) => {
      const observation = observeLaggingSourceConsumer(
        consumer,
        shape,
        facts,
        main,
      )
      const twinObservation =
        twin && observeLaggingSourceConsumer(consumer, shape, facts, twin)
      if (reach && `visible` in observation)
        recordInitialRowsEffectReach(reach, shape, facts, observation)
      return {
        observation: !facts.replayPending
          ? observation
          : `postIds` in observation
            ? { ...observation, postIds: null }
            : `visible` in observation
              ? { ...observation, visible: null }
              : observation,
        twinDisagreement:
          twinObservation &&
          JSON.stringify(twinObservation) !== JSON.stringify(observation)
            ? twinObservation
            : undefined,
      }
    },
    recompute: ({ mode, facts }) => ({
      observation:
        consumer === `live-query`
          ? expectedLiveQueryObservation(shape, facts)
          : isReadConsumer(consumer)
            ? expectedReadObservation(consumer, mode, facts)
            : consumer === `effect-initial-rows`
              ? expectedInitialRowsEffectObservation(shape, facts)
              : expectedEffectObservation(mode, facts),
      twinDisagreement: undefined,
    }),
    assertEqual: (observed, expected) => {
      expect(observed).toEqual(expected)
      return undefined
    },
  }
}

async function expectLaggingSourceTraceMatches(
  consumer: LaggingSourceConsumer,
  shape: LaggingSourceShape,
  steps: ReadonlyArray<LaggingSourceStep>,
  reach?: InitialRowsEffectReach,
): Promise<void> {
  await runTrace({
    steps,
    driver: createLaggingSourceDriver(consumer, shape),
    projection: laggingSourceProjection(consumer, shape, reach),
  })
}

// Each generated lane uses one grammar and one check in both campaigns. A
// seed-and-path replay selects only its requested random lane.
function temporalCampaigns(property: string, fixedSeed: number) {
  return [
    {
      label: `fixed seed ${fixedSeed}`,
      test: oracleReplayTest(fcTest),
      options: { numRuns: oracleRuns(20), seed: fixedSeed },
    },
    {
      label: `random or replayed seed`,
      test: oracleReplayTest(fcTest, property),
      options: oraclePropertyOptions(20, property),
    },
  ]
}

declareOracle({
  check: [
    expectReadinessMatches,
    expectScheduledDemandObservation,
    expectReleaseReentryObservation,
    expectLaggingSourceTraceMatches,
  ],
  model: [
    expectedReadinessObservation,
    expectedLiveQueryObservation,
    expectedReadObservation,
    expectedEffectObservation,
    expectedInitialRowsEffectObservation,
  ],
  grammar: [disturbedHistories],
})

describe(`includes temporal oracle`, () => {
  it(`an empty outer does not wait for an undemanded child`, () =>
    expectReadinessMatches([]))

  it(`loads a demanded child before becoming ready`, async () => {
    await expectReadinessMatches([
      { id: 1, authorId: `selected`, title: `one` },
      { id: 2, authorId: `selected`, title: `two` },
    ])
  })

  // Grammar: one route is retired and reactivated, leaving one obsolete and
  // one current acquisition. The scheduler permutes their two completions.
  // Retire, reactivate, and completion order each distinguish the stale-demand
  // law; fixed orders below reconstruct both schedules. The two-task bound
  // excludes a third incarnation. A canceled source write is forbidden by the
  // fixture's signal guard, not treated as a valid completion.
  const demandScheduler = fc.scheduler()

  for (const campaign of temporalCampaigns(
    `includes-temporal.demand-scheduling`,
    1_658_301,
  )) {
    campaign.test.prop([demandScheduler], campaign.options)(
      `acquisition settlements preserve current demand with ${campaign.label}`,
      expectScheduledAcquisitionsRespectCurrentDemand,
    )
  }

  it.each([{ order: [1, 2] }, { order: [2, 1] }])(
    `observes every completion in fixed scheduler order $order`,
    ({ order }) =>
      expectScheduledAcquisitionsRespectCurrentDemand(fc.schedulerFor(order)),
  )

  it(`rejects an obsolete child row at the first scheduled checkpoint`, () => {
    expect(() =>
      expectScheduledDemandObservation(
        {
          completed: [`demand-0`],
          ready: false,
          rows: [{ id: 1, comments: [{ id: 100, body: `obsolete` }] }],
        },
        0,
      ),
    ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
  })

  it(`reactivated demand retries after its prior release fails`, () =>
    expectDemandReactivationRetriesAfterReleaseFailure([1]))

  it(`rejects a failed release that suppresses reacquisition`, () => {
    expect(() =>
      expectReleaseReentryObservation(
        {
          changed: false,
          empty: false,
          loadCount: 1,
          requestedKeys: [[1]],
        },
        [1],
      ),
    ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
  })

  // Grammar: a nonempty unique key set is acquired, retired through a failed
  // adapter unload, then reacquired unchanged. The single-key fixed witness
  // reconstructs the smallest history. Varying values challenges request-key
  // preservation; varying cardinality challenges one grouped acquisition.
  // The domain is 1..5 distinct integers in [-3, 3]. An empty reactivation
  // does not satisfy the active-demand premise; duplicate keys are excluded
  // because the demand is a set. Removing retirement or reactivation removes
  // the law's distinguishing next action.
  const releaseKeys = fc.uniqueArray(fc.integer({ min: -3, max: 3 }), {
    minLength: 1,
    maxLength: 5,
  })

  for (const campaign of temporalCampaigns(
    `includes-temporal.release-reentry`,
    1_658_302,
  )) {
    campaign.test.prop([releaseKeys], campaign.options)(
      `failed release never suppresses a later demand incarnation with ${campaign.label}`,
      expectDemandReactivationRetriesAfterReleaseFailure,
    )
  }

  describe(`source Collection readiness gates only an eager source`, () => {
    const consumers: Record<
      LaggingSourceConsumer,
      ReadonlyArray<LaggingSourceShape>
    > = {
      'live-query': [
        `direct`,
        `find-one`,
        `ordered`,
        `include`,
        `join`,
        `eager-root`,
        `eager-default`,
      ],
      effect: [`direct`, `join`, `eager-root`, `eager-default`],
      'effect-initial-rows': [`direct`, `join`, `eager-root`, `eager-default`],
      'query-once': [`direct`, `eager-root`],
      'to-array-when-ready': [`direct`, `find-one`, `join`, `eager-root`],
      'state-when-ready': [`direct`, `find-one`, `eager-root`],
    }
    const cells = Object.entries(consumers).flatMap(([consumer, shapes]) =>
      shapes.flatMap((shape) =>
        disturbedHistories(shape).map((steps) => ({
          consumer: consumer as LaggingSourceConsumer,
          shape,
          steps,
          history: steps.join(` → `),
        })),
      ),
    )
    const initialRowsReach = createOracleReach(
      `includes-temporal.effect-initial-rows`,
      INITIAL_ROWS_EFFECT_REACH_STATES,
    )
    let initialRowsHistories = 0
    it.each(cells)(
      `$consumer $shape: $history`,
      ({ consumer, shape, steps }) => {
        if (consumer !== `effect-initial-rows`)
          return expectLaggingSourceTraceMatches(consumer, shape, steps)
        initialRowsHistories += 1
        initialRowsReach.beginHistory()
        return expectLaggingSourceTraceMatches(
          consumer,
          shape,
          steps,
          initialRowsReach,
        )
      },
    )
    // The cells are a bounded exhaustive enumeration, so each declared state
    // must be reached by at least one of them.
    it(`effect-initial-rows cells reach every declared state`, () => {
      expect(initialRowsHistories).toBe(
        consumers[`effect-initial-rows`].flatMap(disturbedHistories).length,
      )
      initialRowsReach.assertReached()
    })
  })

  // Grammar: one parent receives 2..4 distinct-key children while its acquisition
  // promise is pending; a sibling stays empty. Every prefix, including zero, is a
  // public checkpoint in both inline forms. The two-child minimum reconstructs
  // the first partial prefix and its continuation. Removing the hold loses the
  // before-settlement law; removing the empty sibling loses its empty-value
  // check. Bodies are strings of length 0..8, including duplicates and empty
  // strings. Reusing a child public key or delivering after settlement is
  // outside this legal history; longer prefixes remain untested here.
  const partialBodies = fc.array(fc.string({ maxLength: 8 }), {
    minLength: 2,
    maxLength: 4,
  })

  for (const campaign of temporalCampaigns(
    `includes-temporal.partial-values`,
    1_658_303,
  )) {
    campaign.test.prop([partialBodies], campaign.options)(
      `publishes each partial child prefix before the acquisition promise fulfills with ${campaign.label}`,
      async (bodies) => {
        for (const form of [`array`, `materialized`] as const) {
          const parents = createMutablePosts([
            { id: 1, authorId: `selected`, title: `Receiving children` },
            { id: 2, authorId: `selected`, title: `Empty sibling` },
          ])
          const acquired = createDeferred<void>()
          const settled = createDeferred<void>()
          const requested = new Set<number>()
          let deliver!: (row: Comment) => Promise<void>
          let complete!: () => void
          const children = createCollection<Comment>({
            id: nextCollectionId(`partial-children`),
            getKey: (row) => row.id,
            syncMode: `on-demand`,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                deliver = async (value) => {
                  begin()
                  write({ type: `insert`, value })
                  await commit()
                }
                complete = () => {
                  markReady()
                  settled.resolve()
                }
                return {
                  loadSubset: (options) => {
                    for (const key of correlationKeys([options], `postId`))
                      requested.add(key)
                    acquired.resolve()
                    return settled.promise
                  },
                }
              },
            },
          })
          // Keep wrappers concrete at compilation. The query builder does not
          // accept a union of wrapper types as its result.
          const live =
            form === `array`
              ? createLiveQueryCollection((q) =>
                  q.from({ post: parents.collection }).select(({ post }) => ({
                    id: post.id,
                    children: toArray(
                      q
                        .from({ child: children })
                        .where(({ child }) => eq(child.postId, post.id))
                        .orderBy(({ child }) => child.id),
                    ),
                  })),
                )
              : createLiveQueryCollection((q) =>
                  q.from({ post: parents.collection }).select(({ post }) => ({
                    id: post.id,
                    children: materialize(
                      q
                        .from({ child: children })
                        .where(({ child }) => eq(child.postId, post.id))
                        .orderBy(({ child }) => child.id),
                    ),
                  })),
                )
          const preload: PreloadState = { preloadSettled: false }
          startPreload(live, preload)
          const expected: Array<Comment> = []
          const observe = () =>
            live.toArray
              .map((row) => ({
                id: row.id,
                children: row.children.map(({ id, postId, body }) => ({
                  id,
                  postId,
                  body,
                })),
              }))
              .sort((a, b) => a.id - b.id)
          const assertRows = (actual: ReturnType<typeof observe>) => {
            expect(actual).toEqual([
              { id: 1, children: expected },
              { id: 2, children: [] },
            ])
          }
          let primaryFailure: CapturedFailure | undefined
          try {
            await acquired.promise
            await flushPromises()
            expect([...requested].sort()).toEqual([1, 2])
            for (let count = 0; count <= bodies.length; count++) {
              if (count > 0) {
                const row = { id: count, postId: 1, body: bodies[count - 1]! }
                expected.push(row)
                await deliver(row)
              }
              const actual = observe()
              assertRows(actual)
              if (count === 1) {
                const lostPrefix = structuredClone(actual)
                lostPrefix[0]!.children = []
                const wrongValue = structuredClone(actual)
                wrongValue[0]!.children[0]!.body += `corrupt`
                for (const bad of [
                  lostPrefix,
                  wrongValue,
                  actual.slice(0, 1),
                ]) {
                  expect(() => assertRows(bad)).toThrowError(
                    expect.objectContaining({ name: `AssertionError` }),
                  )
                }
              }
              expect(live.isReady()).toBe(false)
              expect(preload.preloadSettled).toBe(false)
            }
            complete()
            await finishPreload(preload)
            expect(live.isReady()).toBe(true)
            assertRows(observe())
          } catch (error) {
            primaryFailure = { error }
          }
          settled.resolve()
          await finishTemporalCleanup(primaryFailure, [
            () => live.cleanup(),
            () => preload.preloadOutcome,
            () => parents.collection.cleanup(),
            () => children.cleanup(),
          ])
        }
      },
    )
  }
})
