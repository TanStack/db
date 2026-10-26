import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  queryOnce,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { SubsetDemandController } from '../../src/query/live/subset-demand-controller.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { createEffect } from '../../src/query/effect.js'
import { LoadSubsetOperationAbortedError } from '../../src/errors.js'
import { runTrace } from '../trace-runner.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import { captureMicrotaskErrors, flushPromises } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { Deferred } from '../../src/deferred.js'
import type { LoadSubsetOptions, SyncAppliedReceipt } from '../../src/types.js'
import type { LazyDemandPlan } from '../../src/query/compiler/joins.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { Effect } from '../../src/query/effect.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { Scheduler } from 'fast-check'

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
 * No one state machine mirrors the production controller. The file uses small
 * models for initial-query readiness, cancellation, acquisition promise
 * settlement, progressive delivery, and source readiness. Each model records
 * only the public facts needed for its law.
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
 * The fragmented-demand lanes observe requested key unions and adapter abort
 * signals before settlement and after success, rejection, retry, or
 * obsolescence. The direct controller lane proves the acquisition-retirement
 * boundary. A compiled includes lane also makes adapter unload remove owned
 * rows, so rejection proves that established child rows remain publicly
 * visible rather than only that old signals remain live.
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

type Post = {
  id: number
  authorId: string
  title: string
}

type PostChange = {
  type: `insert` | `delete`
  value: Post
}

type Comment = {
  id: number
  postId: number
  body: string
}

type User = {
  id: number
  name: string
}

type ProgressivePost = {
  id: number
  userId: number
  title: string
}

let collectionId = 0

function nextCollectionId(prefix: string): string {
  collectionId += 1
  return `${prefix}-${collectionId}`
}

type PreloadState = {
  preloadFailure?: { error: unknown }
  preloadOutcome?: Promise<void>
  preloadSettled: boolean
}

type CapturedFailure = { error: unknown }

// Run every cleanup step after the first mismatch. Keep that mismatch as the
// cause and retain each secondary cleanup error separately.
async function finishTemporalCleanup(
  primary: CapturedFailure | undefined,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<void> {
  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (cleanupFailures.length > 0) {
    if (!primary && cleanupFailures.length === 1) throw cleanupFailures[0]
    throw new AggregateError(
      [...(primary ? [primary.error] : []), ...cleanupFailures],
      `Temporal oracle and cleanup failed`,
      { cause: primary ? primary.error : cleanupFailures[0] },
    )
  }
  if (primary) throw primary.error
}

it(`preserves a row mismatch and later cleanup failures together`, async () => {
  const mismatch = new Error(`row mismatch at checkpoint 1`)
  const cleanupError = new Error(`release failed`)
  const cleanupCalls: Array<string> = []
  let reported: unknown
  try {
    await finishTemporalCleanup({ error: mismatch }, [
      () => {
        cleanupCalls.push(`release`)
        throw cleanupError
      },
      () => {
        cleanupCalls.push(`remaining cleanup`)
      },
    ])
  } catch (error) {
    reported = error
  }
  expect(reported).toBeInstanceOf(AggregateError)
  if (!(reported instanceof AggregateError)) return
  expect(reported.cause).toBe(mismatch)
  expect(reported.errors).toEqual([mismatch, cleanupError])
  expect(cleanupCalls).toEqual([`release`, `remaining cleanup`])
})

// A preload can reject before cleanup observes it. This record retains both
// settlement and the original error without changing the production Promise.
function startPreload(
  live: ReturnType<typeof createLiveQueryCollection>,
  state: PreloadState,
): Promise<void> {
  const preload = live.preload()
  state.preloadOutcome = preload.then(
    () => {
      state.preloadSettled = true
    },
    (error) => {
      state.preloadFailure = { error }
      state.preloadSettled = true
    },
  )
  return preload
}

async function finishPreload(state: PreloadState): Promise<void> {
  await state.preloadOutcome
  if (state.preloadFailure) throw state.preloadFailure.error
}

function correlationKeys(
  loads: ReadonlyArray<LoadSubsetOptions>,
  field: string,
): Array<number> {
  return [
    ...new Set(
      loads.flatMap((load) =>
        extractSimpleComparisons(load.where).flatMap((filter) => {
          if (filter.field[0] !== field) return []
          if (filter.operator === `eq` && typeof filter.value === `number`) {
            return [filter.value]
          }
          if (filter.operator !== `in` || !Array.isArray(filter.value)) {
            return []
          }
          return filter.value.filter(
            (value): value is number => typeof value === `number`,
          )
        }),
      ),
    ),
  ].sort((left, right) => left - right)
}

type CommentRequest =
  | { readonly type: `ref`; readonly path: ReadonlyArray<string> }
  | { readonly type: `val`; readonly value: unknown }
  | {
      readonly type: `func`
      readonly name: string
      readonly args: ReadonlyArray<CommentRequest>
    }

function captureCommentRequest(
  expression: BasicExpression | undefined,
): CommentRequest {
  if (!expression)
    throw new Error(`Unsupported bounded comment fixture predicate`)
  switch (expression.type) {
    case `ref`:
      return Object.freeze({
        type: `ref`,
        path: Object.freeze([...expression.path]),
      })
    case `val`:
      return Object.freeze({
        type: `val`,
        value: Array.isArray(expression.value)
          ? Object.freeze([...expression.value])
          : expression.value,
      })
    case `func`:
      return Object.freeze({
        type: `func`,
        name: expression.name,
        args: Object.freeze([...expression.args].map(captureCommentRequest)),
      })
  }
}

// A bounded fixture interpreter, not the production filter evaluator. Compile
// every branch before inspecting rows, including false-first conjunctions.
function commentRequestPredicate(
  request: CommentRequest | undefined,
): (row: Comment) => boolean {
  if (!request) return () => true
  if (request.type === `func`) {
    if (request.name === `and` && request.args.length > 0) {
      const predicates = request.args.map(commentRequestPredicate)
      return (row) => predicates.every((predicate) => predicate(row))
    }
    let [reference, constant] = request.args
    if (request.name === `eq` && reference?.type === `val`)
      [reference, constant] = [constant, reference]
    if (
      request.args.length === 2 &&
      reference?.type === `ref` &&
      reference.path.length === 1 &&
      reference.path[0] === `postId` &&
      constant?.type === `val`
    ) {
      const value = constant.value
      if (
        request.name === `eq` &&
        typeof value === `number` &&
        Number.isFinite(value)
      )
        return (row) => row.postId === value
      if (
        request.name === `in` &&
        Array.isArray(value) &&
        value.every(
          (key: unknown) => typeof key === `number` && Number.isFinite(key),
        )
      )
        return (row) => value.includes(row.postId)
    }
  }
  throw new Error(`Unsupported bounded comment fixture predicate`)
}

function createValidatedColdComments(initial: ReadonlyArray<Comment>) {
  const requests: Array<CommentRequest | undefined> = []
  const loaded = new Set<number>()
  const collection = createCollection<Comment>({
    id: nextCollectionId(`validated-temporal-comments`),
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => ({
        loadSubset: (options) => {
          const request = options.where && captureCommentRequest(options.where)
          requests.push(request)
          if (
            options.orderBy?.length ||
            options.cursor !== undefined ||
            options.limit !== undefined ||
            (options.offset ?? 0) !== 0
          )
            throw new Error(`Unsupported bounded comment fixture request`)
          const matches = commentRequestPredicate(request)
          begin()
          for (const row of initial) {
            if (!loaded.has(row.id) && matches(row)) {
              write({ type: `insert`, value: { ...row } })
              loaded.add(row.id)
            }
          }
          const receipt = commit()
          if (receipt !== true) return receipt.then(() => markReady())
          markReady()
          return true
        },
      }),
    },
  })
  return { collection, requests }
}

function captureCommentRows(value: unknown): Array<Comment> {
  if (!Array.isArray(value)) throw new Error(`Expected inline comment rows`)
  return value.map((row: unknown) => {
    if (
      row === null ||
      typeof row !== `object` ||
      !(`id` in row) ||
      !(`postId` in row) ||
      !(`body` in row) ||
      typeof row.id !== `number` ||
      typeof row.postId !== `number` ||
      typeof row.body !== `string`
    )
      throw new Error(`Expected selected comment fields`)
    return { id: row.id, postId: row.postId, body: row.body }
  })
}

describe(`bounded cold comment request observations`, () => {
  it(`validates complete predicates before filtering even an empty input`, () => {
    const rows: Array<Comment> = [
      { id: 100, postId: 1, body: `one` },
      { id: 200, postId: 2, body: `two` },
      { id: 300, postId: 3, body: `three` },
    ]
    const ref = new PropRef([`postId`])
    const cases: Array<[BasicExpression | undefined, Array<number>]> = [
      [undefined, [100, 200, 300]],
      [new Func(`eq`, [ref, new Value(1)]), [100]],
      [new Func(`eq`, [new Value(2), ref]), [200]],
      [new Func(`in`, [ref, new Value([1, 3])]), [100, 300]],
      [new Func(`in`, [ref, new Value([2])]), [200]],
      [new Func(`in`, [ref, new Value([])]), []],
      [
        new Func(`and`, [
          new Func(`in`, [ref, new Value([1, 3])]),
          new Func(`eq`, [ref, new Value(3)]),
        ]),
        [300],
      ],
    ]
    for (const [expression, expected] of cases) {
      const predicate = commentRequestPredicate(
        expression && captureCommentRequest(expression),
      )
      expect(rows.filter(predicate).map(({ id }) => id)).toEqual(expected)
    }
    // These reject the fixture's unsupported domain, not runtime query syntax.
    for (const expression of [
      new Func(`lt`, [ref, new Value(1)]),
      new Func(`eq`, [new PropRef([`id`]), new Value(1)]),
      new Func(`eq`, [new PropRef([`postId`, `nested`]), new Value(1)]),
      new Func(`eq`, [ref]),
      new Func(`in`, [ref, new Value(1)]),
      new Func(`and`, [
        new Func(`eq`, [ref, new Value(999)]),
        new Func(`lt`, [ref, new Value(1)]),
      ]),
    ]) {
      const request = captureCommentRequest(expression)
      expect(() => commentRequestPredicate(request)).toThrow(
        `Unsupported bounded comment fixture predicate`,
      )
      expect(() => [].filter(commentRequestPredicate(request))).toThrow(
        `Unsupported bounded comment fixture predicate`,
      )
    }
  })

  it(`retains immutable request paths, branches and membership values`, () => {
    const path = [`postId`]
    const membership = [1, 3]
    const args = [new PropRef(path), new Value(membership)]
    const snapshot = captureCommentRequest(new Func(`in`, args))
    // Change only test-owned input after capture, never a runtime request.
    path[0] = `changed`
    membership.splice(0, 2, 2)
    args.pop()
    expect(snapshot).toEqual({
      type: `func`,
      name: `in`,
      args: [
        { type: `ref`, path: [`postId`] },
        { type: `val`, value: [1, 3] },
      ],
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    if (snapshot.type !== `func`) throw new Error(`Expected function snapshot`)
    expect(Object.isFrozen(snapshot.args)).toBe(true)
    const [reference, constant] = snapshot.args
    if (reference?.type !== `ref` || constant?.type !== `val`)
      throw new Error(`Expected reference and value snapshots`)
    expect(Object.isFrozen(reference.path)).toBe(true)
    expect(Object.isFrozen(constant.value)).toBe(true)
  })

  it.each(
    ([`array`, `materialized`] as const).flatMap((form) =>
      ([`expression`, `functional`] as const).map((projection) => ({
        form,
        projection,
      })),
    ),
  )(
    `$form / $projection becomes ready for selected parents without counting an excluded parent`,
    async ({ form, projection }) => {
      const posts = createColdPosts([
        { id: 1, authorId: `selected`, title: `one` },
        { id: 2, authorId: `excluded`, title: `two` },
        { id: 3, authorId: `selected`, title: `three` },
      ])
      const comments = createValidatedColdComments([
        { id: 100, postId: 1, body: `one` },
        { id: 200, postId: 2, body: `two` },
        { id: 300, postId: 3, body: `three` },
      ])
      const live = createLiveQueryCollection((q) => {
        const included = q
          .from({ post: posts.collection })
          .where(({ post }) => eq(post.authorId, `selected`))
          .select(({ post }) => {
            const childRows = q
              .from({ comment: comments.collection })
              .where(({ comment }) => eq(comment.postId, post.id))
              .select(({ comment }) => ({
                id: comment.id,
                postId: comment.postId,
                body: comment.body,
              }))
            return {
              id: post.id,
              comments:
                form === `array` ? toArray(childRows) : materialize(childRows),
              count: 0,
            }
          })
        const outer = q.from({ row: included })
        return projection === `expression`
          ? outer.select(({ row }) => row)
          : outer.fn.select(({ row }) => {
              expect(Array.isArray(row.comments)).toBe(true)
              return {
                ...row,
                count: Array.isArray(row.comments) ? row.comments.length : -1,
              }
            })
      })
      let primaryFailure: { error: unknown } | undefined
      try {
        expect(comments.collection.size).toBe(0)
        await live.preload()
        expect(live.isReady()).toBe(true)
        expect(comments.requests.length).toBeGreaterThan(0)
        expect(
          live.toArray
            .map((row) => ({
              id: row.id,
              comments: captureCommentRows(row.comments),
              count: row.count,
            }))
            .sort((left, right) => left.id - right.id),
        ).toEqual([
          {
            id: 1,
            comments: [{ id: 100, postId: 1, body: `one` }],
            count: projection === `functional` ? 1 : 0,
          },
          {
            id: 3,
            comments: [{ id: 300, postId: 3, body: `three` }],
            count: projection === `functional` ? 1 : 0,
          },
        ])
      } catch (error) {
        primaryFailure = { error }
      }
      const results = await Promise.allSettled(
        [live, posts.collection, comments.collection].map(async (collection) =>
          collection.cleanup(),
        ),
      )
      const failures = results.flatMap((result): Array<unknown> =>
        result.status === `rejected` ? [result.reason as unknown] : [],
      )
      if (failures.length > 0) {
        if (!primaryFailure && failures.length === 1) throw failures[0]
        throw new AggregateError(
          [...(primaryFailure ? [primaryFailure.error] : []), ...failures],
          `Cold comment observation and cleanup failed`,
          { cause: primaryFailure ? primaryFailure.error : failures[0] },
        )
      }
      if (primaryFailure) throw primaryFailure.error
    },
  )
})

function createColdPosts(initial: ReadonlyArray<Post>): {
  collection: Collection<Post>
  loaded: Deferred<void>
} {
  const loaded = createDeferred<void>()
  const collection = createCollection<Post>({
    id: nextCollectionId(`temporal-posts`),
    getKey: (post) => post.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => ({
        loadSubset: () => {
          begin()
          for (const post of initial) {
            write({ type: `insert`, value: post })
          }
          commit()
          markReady()
          loaded.resolve()
          return Promise.resolve()
        },
      }),
    },
  })
  return { collection, loaded }
}

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

it.each(
  ([`array`, `materialized`] as const).flatMap((form) =>
    ([`expression`, `functional`] as const).map((projection) => ({
      form,
      projection,
    })),
  ),
)(
  `$form / $projection preserves child demand and applied settlement across projection`,
  async ({ form, projection }) => {
    const posts = createColdPosts([{ id: 1, authorId: `one`, title: `post` }])
    const started = createDeferred<void>()
    const release = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const comments = createCollection<Comment>({
      id: nextCollectionId(`projection-pending-comments`),
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => ({
          loadSubset: (options) => {
            loads.push(options)
            const keys = correlationKeys([options], `postId`)
            started.resolve()
            return release.promise.then(async () => {
              if (options.signal?.aborted) return
              begin()
              if (keys.includes(1))
                write({
                  type: `insert`,
                  value: { id: 100, postId: 1, body: `one` },
                })
              await commit()
              markReady()
            })
          },
        }),
      },
    })
    const live = createLiveQueryCollection((q) => {
      const included = q.from({ post: posts.collection }).select(({ post }) => {
        const childRows = q
          .from({ comment: comments })
          .where(({ comment }) => eq(comment.postId, post.id))
        return {
          id: post.id,
          comments:
            form === `array` ? toArray(childRows) : materialize(childRows),
          count: 0,
        }
      })
      const outer = q.from({ row: included })
      return projection === `expression`
        ? outer.select(({ row }) => row)
        : outer.fn.select(({ row }) => {
            expect
              .soft(
                Array.isArray(row.comments),
                `callback receives an inline value`,
              )
              .toBe(true)
            return {
              id: row.id,
              comments: row.comments,
              count: Array.isArray(row.comments) ? row.comments.length : -1,
            }
          })
    })
    let settled = false
    const preload = live.preload()
    const observed = preload.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    let primaryFailure: CapturedFailure | undefined
    try {
      await Promise.race([started.promise, preload])
      expect(loads).toHaveLength(1)
      expect(correlationKeys(loads, `postId`)).toEqual([1])
      expect(settled).toBe(false)
      release.resolve()
      await preload
      expect(live.toArray).toHaveLength(1)
      // Observe the runtime boundary: a broken projection can omit this value.
      const publishedComments = live.toArray[0]?.comments as unknown as
        Array<Comment> | undefined
      expect(
        publishedComments?.map(({ id, postId, body }) => ({
          id,
          postId,
          body,
        })),
      ).toEqual([{ id: 100, postId: 1, body: `one` }])
      if (projection === `functional`) expect(live.toArray[0]?.count).toBe(1)
    } catch (error) {
      primaryFailure = { error }
    }
    release.resolve()
    await finishTemporalCleanup(primaryFailure, [
      () => live.cleanup(),
      () => observed,
      () => posts.collection.cleanup(),
      () => comments.cleanup(),
    ])
  },
)

it.each(
  ([`array`, `materialized`] as const).flatMap((form) =>
    ([`expression`, `functional`] as const).flatMap((projection) =>
      [false, true].map((pending) => ({ form, projection, pending })),
    ),
  ),
)(
  `$form / $projection waits for actual source application with pending=$pending`,
  async ({ form, projection, pending }) => {
    const posts = createColdPosts([{ id: 1, authorId: `one`, title: `post` }])
    const mutation = createDeferred<void>()
    const started = createDeferred<void>()
    const requests: Array<{
      receipt: SyncAppliedReceipt
      settled: boolean
      outcome: Promise<void>
    }> = []
    let writeChild: (row: Comment) => SyncAppliedReceipt = () => {
      throw new Error(`Comment source has not started`)
    }
    const comments = createCollection<Comment>({
      id: nextCollectionId(`actual-applied-receipt-comments`),
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      onInsert: () => mutation.promise,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          writeChild = (row) => {
            begin()
            write({ type: `insert`, value: row })
            return commit()
          }
          return {
            loadSubset: (options) => {
              begin()
              write({
                type: `insert`,
                value: { id: 100, postId: 1, body: `applied` },
              })
              const receipt = commit(options.signal)
              const request = {
                receipt,
                settled: false,
                outcome: Promise.resolve(),
              }
              request.outcome = Promise.resolve(receipt).then(
                () => {
                  request.settled = true
                },
                () => {
                  request.settled = true
                },
              )
              requests.push(request)
              started.resolve()
              return Promise.resolve(receipt).then(() => {
                markReady()
              })
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) => {
      const included = q.from({ post: posts.collection }).select(({ post }) => {
        const rows = q
          .from({ comment: comments })
          .where(({ comment }) => eq(comment.postId, post.id))
          .orderBy(({ comment }) => comment.id)
        return {
          id: post.id,
          comments: form === `array` ? toArray(rows) : materialize(rows),
          count: 0,
        }
      })
      const outer = q.from({ row: included })
      return projection === `expression`
        ? outer.select(({ row }) => row)
        : outer.fn.select(({ row }) => {
            expect.soft(Array.isArray(row.comments)).toBe(true)
            return {
              ...row,
              count: Array.isArray(row.comments) ? row.comments.length : -1,
            }
          })
    })
    let transaction: ReturnType<typeof comments.insert> | undefined
    let transactionOutcome: Promise<unknown> | undefined
    const state: PreloadState = { preloadSettled: false }
    let primaryFailure: { error: unknown } | undefined
    try {
      if (pending) {
        transaction = comments.insert({
          id: 999,
          postId: 999,
          body: `unrelated`,
        })
        transactionOutcome = transaction.isPersisted.promise.then(
          () => undefined,
          () => undefined,
        )
      }
      const preload = startPreload(live, state)
      await Promise.race([started.promise, preload])
      await flushPromises()
      expect(requests.length).toBeGreaterThan(0)
      if (pending) {
        expect(transaction?.state).toBe(`persisting`)
        expect(
          requests.every(({ receipt }) => receipt instanceof Promise),
        ).toBe(true)
        expect(requests.every(({ settled }) => !settled)).toBe(true)
        expect(comments.has(100)).toBe(false)
        expect(comments.get(100)).toBeUndefined()
        expect(state.preloadSettled).toBe(false)
        expect(live.isReady()).toBe(false)
      } else {
        expect(requests.every(({ receipt }) => receipt === true)).toBe(true)
        expect(comments.get(100)).toMatchObject({
          id: 100,
          postId: 1,
          body: `applied`,
        })
      }
      mutation.resolve()
      if (transaction) await transaction.isPersisted.promise
      await preload
      await Promise.all(requests.map(({ outcome }) => outcome))
      expect(requests.every(({ settled }) => settled)).toBe(true)
      expect(live.isReady()).toBe(true)
      const capture = () =>
        live.toArray.map((row) => ({
          id: row.id,
          comments: captureCommentRows(row.comments),
          count: row.count,
        }))
      expect(capture()).toEqual([
        {
          id: 1,
          comments: [{ id: 100, postId: 1, body: `applied` }],
          count: projection === `functional` ? 1 : 0,
        },
      ])
      await writeChild({ id: 101, postId: 1, body: `continued` })
      expect(capture()).toEqual([
        {
          id: 1,
          comments: [
            { id: 100, postId: 1, body: `applied` },
            { id: 101, postId: 1, body: `continued` },
          ],
          count: projection === `functional` ? 2 : 0,
        },
      ])
    } catch (error) {
      primaryFailure = { error }
    }
    const cleanupErrors: Array<unknown> = []
    try {
      if (
        transaction?.state === `pending` ||
        transaction?.state === `persisting`
      )
        transaction.rollback()
    } catch (error) {
      cleanupErrors.push(error)
    }
    mutation.resolve()
    if (cleanupErrors.length === 0) await transactionOutcome
    const results = await Promise.allSettled(
      [live, posts.collection, comments].map(async (collection) =>
        collection.cleanup(),
      ),
    )
    for (const result of results)
      if (result.status === `rejected`)
        cleanupErrors.push(result.reason as unknown)
    if (cleanupErrors.length === 0) {
      await state.preloadOutcome
      await Promise.all(requests.map(({ outcome }) => outcome))
    }
    if (cleanupErrors.length > 0) {
      if (!primaryFailure && cleanupErrors.length === 1) throw cleanupErrors[0]
      throw new AggregateError(
        [...(primaryFailure ? [primaryFailure.error] : []), ...cleanupErrors],
        `Applied receipt observation and cleanup failed`,
        { cause: primaryFailure ? primaryFailure.error : cleanupErrors[0] },
      )
    }
    if (primaryFailure) throw primaryFailure.error
  },
)

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
        expected: {
          ready: true,
          preloadSettled: true,
          rowCount: initialPosts.length,
          childLoadCount: initialPosts.length === 0 ? 0 : 1,
          loadedPostIds: initialPosts.map(({ id }) => id),
        },
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

// Model B: retiring the only route removes its child acquisition from
// initial-query readiness, even when that acquisition's promise is pending.
type DemandCancellationObservation = {
  ready: boolean
  rowCount: number
  childLoadStarted: boolean
  childLoadPending: boolean
}

type DemandCancellationContext = {
  posts: Collection<Post>
  comments: Collection<Comment>
  live: ReturnType<typeof createLiveQueryCollection>
  removePost: () => void
  childLoad: ReturnType<typeof createDeferred<void>>
  childLoadStarted: Deferred<void>
  preload: PreloadState
  expected: DemandCancellationObservation
}

function createRemovablePost(): {
  collection: Collection<Post>
  remove: () => void
  add: () => void
} {
  const post: Post = {
    id: 1,
    authorId: `selected`,
    title: `selected`,
  }
  let remove: () => void = () => {
    throw new Error(`Post collection has not started`)
  }
  let add: () => void = () => {
    throw new Error(`Post collection has not started`)
  }
  const collection = createCollection<Post>({
    id: nextCollectionId(`temporal-removable-post`),
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: post })
        commit()
        markReady()
        remove = () => {
          begin()
          write({ type: `delete`, value: post })
          commit()
        }
        add = () => {
          begin()
          write({ type: `insert`, value: post })
          commit()
        }
      },
    },
  })
  return { collection, remove: () => remove(), add: () => add() }
}

function createDemandCancellationDriver(): TraceDriver<
  `remove-parent`,
  DemandCancellationContext
> {
  return {
    setup: () => {
      const { collection: posts, remove } = createRemovablePost()
      const childLoad = createDeferred<void>()
      const childLoadStarted = createDeferred<void>()
      const comments = createCollection<Comment>({
        id: nextCollectionId(`temporal-pending-comments`),
        getKey: (comment) => comment.id,
        syncMode: `on-demand`,
        sync: {
          sync: () => ({
            loadSubset: () => {
              childLoadStarted.resolve()
              return childLoad.promise
            },
          }),
        },
      })
      const live = createLiveQueryCollection((q) =>
        q.from({ post: posts }).select(({ post }) => ({
          id: post.id,
          comments: toArray(
            q
              .from({ comment: comments })
              .where(({ comment }) => eq(comment.postId, post.id)),
          ),
        })),
      )
      return {
        posts,
        comments,
        live,
        removePost: remove,
        childLoad,
        childLoadStarted,
        preload: { preloadSettled: false },
        expected: {
          ready: false,
          rowCount: 1,
          childLoadStarted: true,
          childLoadPending: true,
        },
      }
    },
    start: async (context) => {
      startPreload(context.live, context.preload)
      await context.childLoadStarted.promise
    },
    apply: (_step, context) => {
      context.removePost()
      context.expected = {
        ready: true,
        rowCount: 0,
        childLoadStarted: true,
        childLoadPending: true,
      }
    },
    cleanup: async ({ posts, comments, live, childLoad, preload }) => {
      childLoad.resolve()
      await finishTemporalCleanup(undefined, [
        () => live.cleanup(),
        () => finishPreload(preload),
        () => posts.cleanup(),
        () => comments.cleanup(),
      ])
    },
  }
}

const demandCancellationProjection: TraceProjection<
  DemandCancellationContext,
  DemandCancellationObservation
> = {
  observe: ({ live, childLoadStarted, childLoad }) => ({
    ready: live.isReady(),
    rowCount: live.size,
    childLoadStarted: !childLoadStarted.isPending(),
    childLoadPending: childLoad.isPending(),
  }),
  recompute: ({ expected }) => expected,
  assertEqual: (observed, expected) => {
    expect(observed).toEqual(expected)
    return undefined
  },
}

async function expectObsoleteDemandDoesNotBlockReadiness(): Promise<void> {
  await runTrace({
    steps: [`remove-parent`],
    driver: createDemandCancellationDriver(),
    projection: demandCancellationProjection,
  })
}

async function expectObsoleteAcquisitionCannotPublishAfterReactivation(): Promise<void> {
  const { collection: posts, remove, add } = createRemovablePost()
  const requests: Array<{
    deferred: Deferred<void>
    outcome: Promise<void>
    signal: AbortSignal | undefined
  }> = []
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-generation-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => ({
        loadSubset: (options) => {
          const requestIndex = requests.length
          const deferred = createDeferred<void>()
          const signal = options.signal
          const outcome = deferred.promise.then(() => {
            if (signal?.aborted) return
            begin()
            write({
              type: `insert`,
              value:
                requestIndex === 0
                  ? { id: 100, postId: 1, body: `obsolete` }
                  : { id: 200, postId: 1, body: `current` },
            })
            commit()
            markReady()
          })
          requests.push({ deferred, outcome, signal })
          return outcome
        },
      }),
    },
  })
  const live = createLiveQueryCollection((q) =>
    q.from({ post: posts }).select(({ post }) => ({
      id: post.id,
      comments: toArray(
        q
          .from({ comment: comments })
          .where(({ comment }) => eq(comment.postId, post.id))
          .select(({ comment }) => ({
            id: comment.id,
            body: comment.body,
          })),
      ),
    })),
  )

  const preload = live.preload()
  let primaryFailure: CapturedFailure | undefined
  try {
    await flushPromises()
    expect(requests).toHaveLength(1)

    remove()
    await preload
    expect(live.size).toBe(0)

    add()
    await flushPromises()
    expect(requests).toHaveLength(2)

    requests[1]!.deferred.resolve()
    await requests[1]!.outcome
    await flushPromises()
    expect(live.get(1)?.comments).toEqual([{ id: 200, body: `current` }])

    requests[0]!.deferred.resolve()
    await requests[0]!.outcome
    await flushPromises()
    expect(live.get(1)?.comments).toEqual([{ id: 200, body: `current` }])
    expect(requests[0]!.signal?.aborted).toBe(true)
  } catch (error) {
    primaryFailure = { error }
  }
  for (const request of requests) request.deferred.resolve()
  await finishTemporalCleanup(primaryFailure, [
    () => Promise.allSettled(requests.map(({ outcome }) => outcome)),
    () => live.cleanup(),
    () => Promise.allSettled([preload]),
    () => posts.cleanup(),
    () => comments.cleanup(),
  ])
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

function createMutablePosts(
  initial: ReadonlyArray<Post>,
  options: { markReadyInitially?: boolean } = {},
): {
  collection: Collection<Post>
  write: (type: PostChange[`type`], post: Post) => void
  writeBatch: (changes: ReadonlyArray<PostChange>) => void
  markReady: () => void
} {
  let writePosts: (changes: ReadonlyArray<PostChange>) => void = () => {
    throw new Error(`Post collection has not started`)
  }
  let markPostsReady: () => void = () => {
    throw new Error(`Post collection has not started`)
  }
  const collection = createCollection<Post>({
    id: nextCollectionId(`temporal-mutable-posts`),
    getKey: (post) => post.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const post of initial) write({ type: `insert`, value: post })
        commit()
        if (options.markReadyInitially !== false) markReady()
        writePosts = (changes) => {
          begin()
          for (const change of changes) write(change)
          commit()
        }
        markPostsReady = markReady
      },
    },
  })
  return {
    collection,
    write: (type, post) => writePosts([{ type, value: post }]),
    writeBatch: (changes) => writePosts(changes),
    markReady: () => markPostsReady(),
  }
}

function createPendingComments(): {
  collection: Collection<Comment>
  requests: Array<{
    deferred: Deferred<void>
    outcome: Promise<void>
    keys: Array<number>
    signal: AbortSignal | undefined
  }>
} {
  const requests: Array<{
    deferred: Deferred<void>
    outcome: Promise<void>
    keys: Array<number>
    signal: AbortSignal | undefined
  }> = []
  const collection = createCollection<Comment>({
    id: nextCollectionId(`temporal-pending-coverage-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => ({
        loadSubset: (options) => {
          const deferred = createDeferred<void>()
          const outcome = deferred.promise.then(() => {
            if (!options.signal?.aborted) markReady()
          })
          requests.push({
            deferred,
            outcome,
            keys: correlationKeys([options], `postId`),
            signal: options.signal,
          })
          return outcome
        },
      }),
    },
  })
  return { collection, requests }
}

function createPostsWithCommentsLive(
  posts: Collection<Post>,
  comments: Collection<Comment>,
) {
  return createLiveQueryCollection((q) =>
    q.from({ post: posts }).select(({ post }) => ({
      id: post.id,
      comments: toArray(
        q
          .from({ comment: comments })
          .where(({ comment }) => eq(comment.postId, post.id)),
      ),
    })),
  )
}

async function expectRetainedDemandBlocksReadiness(): Promise<void> {
  const firstPost = { id: 1, authorId: `selected`, title: `one` }
  const secondPost = { id: 2, authorId: `selected`, title: `two` }
  const posts = createMutablePosts([firstPost])
  const { collection: comments, requests } = createPendingComments()
  const live = createPostsWithCommentsLive(posts.collection, comments)
  const preload: PreloadState = { preloadSettled: false }
  startPreload(live, preload)

  let primaryFailure: CapturedFailure | undefined
  try {
    await flushPromises()
    expect(requests.map(({ keys }) => keys)).toEqual([[1]])

    posts.write(`insert`, secondPost)
    await flushPromises()
    expect(requests.map(({ keys }) => keys)).toEqual([[1], [2]])

    requests[1]!.deferred.resolve()
    await requests[1]!.outcome
    await flushPromises()
    expect(preload.preloadSettled).toBe(false)
    expect(live.isReady()).toBe(false)

    requests[0]!.deferred.resolve()
    await requests[0]!.outcome
    await finishPreload(preload)
    expect(live.isReady()).toBe(true)
  } catch (error) {
    primaryFailure = { error }
  }
  for (const request of requests) request.deferred.resolve()
  await finishTemporalCleanup(primaryFailure, [
    () => Promise.allSettled(requests.map(({ outcome }) => outcome)),
    () => live.cleanup(),
    () => preload.preloadOutcome,
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
  ])
}

async function expectDemandChurnPreservesCoverage(
  replacementOutcome: `success` | `failure` | `obsolete`,
): Promise<void> {
  const { collection, requests } = createPendingComments()
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const controller = new SubsetDemandController()
  const plan: LazyDemandPlan = {
    id: `churn-consolidation`,
    path: [`postId`],
    collectionId: collection.id,
    initialKeys: new Set(),
  }
  const settle = async (index: number, ready: Promise<unknown> | true) => {
    requests[index]!.deferred.resolve()
    await requests[index]!.outcome
    if (ready instanceof Promise) await ready
  }

  let primaryFailure: CapturedFailure | undefined
  try {
    for (let key = 1; key <= 3; key++) {
      const update = controller.setDemand(
        subscription,
        plan,
        new Set(Array.from({ length: key }, (_, index) => index + 1)),
      )
      expect(requests[key - 1]!.keys).toEqual([key])
      await settle(key - 1, update.ready)
    }
    expect(requests.flatMap(({ keys }) => keys)).toHaveLength(3)

    const replacement = controller.setDemand(
      subscription,
      plan,
      new Set([2, 3, 4]),
    )
    expect(requests[3]!.keys).toEqual([2, 3, 4])
    expect(requests[1]!.signal?.aborted).toBe(false)
    expect(requests[2]!.signal?.aborted).toBe(false)

    if (replacementOutcome === `failure`) {
      if (!(replacement.ready instanceof Promise)) {
        throw new Error(`Expected replacement demand to be asynchronous`)
      }
      const failure = new Error(`replacement failed`)
      const failed = Promise.all([requests[3]!.outcome, replacement.ready])
      requests[3]!.deferred.reject(failure)
      await expect(failed).rejects.toBe(failure)
      expect(requests[1]!.signal?.aborted).toBe(false)
      expect(requests[2]!.signal?.aborted).toBe(false)

      const retry = controller.setDemand(subscription, plan, new Set([2, 3, 4]))
      expect(requests[3]!.signal?.aborted).toBe(true)
      expect(requests[4]!.keys).toEqual([2, 3, 4])
      expect(requests[1]!.signal?.aborted).toBe(false)
      expect(requests[2]!.signal?.aborted).toBe(false)
      await settle(4, retry.ready)
    } else if (replacementOutcome === `obsolete`) {
      const current = controller.setDemand(subscription, plan, new Set([2, 3]))
      expect(requests[3]!.signal?.aborted).toBe(true)
      expect(requests[4]!.keys).toEqual([2, 3])
      expect(requests[1]!.signal?.aborted).toBe(false)
      expect(requests[2]!.signal?.aborted).toBe(false)
      await settle(3, replacement.ready)
      expect(requests[1]!.signal?.aborted).toBe(false)
      expect(requests[2]!.signal?.aborted).toBe(false)
      await settle(4, current.ready)
    } else {
      await settle(3, replacement.ready)
    }

    expect(requests[1]!.signal?.aborted).toBe(true)
    expect(requests[2]!.signal?.aborted).toBe(true)
  } catch (error) {
    primaryFailure = { error }
  }
  for (const request of requests) request.deferred.resolve()
  await finishTemporalCleanup(primaryFailure, [
    () => Promise.allSettled(requests.map(({ outcome }) => outcome)),
    () => controller.clear(),
    () => subscription.unsubscribe(),
    () => collection.cleanup(),
  ])
}

async function expectFailedConsolidationKeepsVisibleRows(): Promise<void> {
  const posts = createMutablePosts([
    { id: 1, authorId: `selected`, title: `one` },
  ])
  const requests: Array<{
    deferred: Deferred<void>
    outcome: Promise<void>
    keys: Array<number>
    signal: AbortSignal | undefined
  }> = []
  const installed = new Map<number, Comment>()
  const acquisitionKeys = new Map<LoadSubsetOptions, Array<number>>()
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-visible-coverage-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => ({
        loadSubset: (options) => {
          const deferred = createDeferred<void>()
          const keys = correlationKeys([options], `postId`)
          const outcome = deferred.promise.then(async () => {
            if (options.signal?.aborted) return
            begin()
            for (const postId of keys) {
              const comment = {
                id: postId * 100,
                postId,
                body: `comment ${postId}`,
              }
              installed.set(postId, comment)
              write({ type: `insert`, value: comment })
            }
            const applied = commit(options.signal)
            if (applied instanceof Promise) await applied
            acquisitionKeys.set(options, keys)
            markReady()
          })
          requests.push({ deferred, outcome, keys, signal: options.signal })
          return outcome
        },
        unloadSubset: (options) => {
          const keys = acquisitionKeys.get(options)
          if (!keys) return
          acquisitionKeys.delete(options)
          begin()
          for (const postId of keys) {
            const comment = installed.get(postId)
            if (comment) write({ type: `delete`, value: comment })
            installed.delete(postId)
          }
          commit()
        },
      }),
    },
  })
  const live = createPostsWithCommentsLive(posts.collection, comments)
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const settle = async (index: number) => {
    requests[index]!.deferred.resolve()
    await requests[index]!.outcome
    await flushPromises()
  }
  const visibleCommentIds = () =>
    live.toArray
      .flatMap(({ comments: rows }) => rows.map(({ id }) => id))
      .sort((left, right) => left - right)

  let primaryFailure: CapturedFailure | undefined
  try {
    const preload = live.preload()
    await flushPromises()
    expect(requests.map(({ keys }) => keys)).toEqual([[1]])
    await settle(0)
    await preload

    for (let postId = 2; postId <= 3; postId++) {
      posts.write(`insert`, {
        id: postId,
        authorId: `selected`,
        title: String(postId),
      })
      await flushPromises()
      expect(requests.at(-1)?.keys).toEqual([postId])
      await settle(postId - 1)
    }
    expect(visibleCommentIds()).toEqual([100, 200, 300])

    posts.writeBatch([
      {
        type: `delete`,
        value: { id: 1, authorId: `selected`, title: `one` },
      },
      {
        type: `insert`,
        value: { id: 4, authorId: `selected`, title: `four` },
      },
    ])
    await flushPromises()
    expect(requests[3]?.keys).toEqual([2, 3, 4])
    expect(requests[1]?.signal?.aborted).toBe(false)
    expect(requests[2]?.signal?.aborted).toBe(false)

    const failure = new Error(`replacement failed`)
    requests[3]!.deferred.reject(failure)
    await expect(requests[3]!.outcome).rejects.toBe(failure)
    await flushPromises()

    expect(live.status).toBe(`error`)
    expect(live.utils.lastSubsetError).toBe(failure)
    expect(visibleCommentIds()).toEqual([200, 300])
  } catch (error) {
    primaryFailure = { error }
  }
  for (const request of requests) request.deferred.resolve()
  await finishTemporalCleanup(primaryFailure, [
    () => Promise.allSettled(requests.map(({ outcome }) => outcome)),
    () => live.cleanup(),
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
    () => consoleError.mockRestore(),
  ])
}

function expectContradictoryReplacementStartCrashes(): void {
  const releaseSnapshot = vi.fn()
  let requestCount = 0
  const subscription = {
    requestSnapshot: (
      options?: Parameters<CollectionSubscription[`requestSnapshot`]>[0],
    ) => {
      requestCount += 1
      options?.onLoadSubsetResult?.(true, { where: options.where }, () => {})
      return requestCount === 1
    },
    releaseSnapshot,
  } as unknown as CollectionSubscription
  const controller = new SubsetDemandController()
  const plan: LazyDemandPlan = {
    id: `contradictory-replacement-start`,
    path: [`postId`],
    collectionId: `contradictory-replacement-start`,
    initialKeys: new Set(),
  }

  controller.setDemand(subscription, plan, new Set([1, 2]))
  expect(() =>
    controller.setDemand(subscription, plan, new Set([2, 3])),
  ).toThrow(`Subset demand snapshot did not start`)
  expect(releaseSnapshot).not.toHaveBeenCalled()
}

async function expectObsoleteAcquisitionCannotCompleteCurrentPreload(): Promise<void> {
  const post = { id: 1, authorId: `selected`, title: `one` }
  const posts = createMutablePosts([post], { markReadyInitially: false })
  const { collection: comments, requests } = createPendingComments()
  const live = createPostsWithCommentsLive(posts.collection, comments)
  const preload: PreloadState = { preloadSettled: false }
  startPreload(live, preload)

  let primaryFailure: CapturedFailure | undefined
  try {
    await flushPromises()
    expect(requests).toHaveLength(1)

    posts.write(`delete`, post)
    posts.write(`insert`, post)
    await flushPromises()
    expect(requests).toHaveLength(2)
    expect(requests[0]!.signal?.aborted).toBe(true)

    requests[0]!.deferred.resolve()
    await requests[0]!.outcome
    posts.markReady()
    await flushPromises()
    expect(preload.preloadSettled).toBe(false)
    expect(live.isReady()).toBe(false)

    requests[1]!.deferred.resolve()
    await requests[1]!.outcome
    await finishPreload(preload)
  } catch (error) {
    primaryFailure = { error }
  }
  for (const request of requests) request.deferred.resolve()
  await finishTemporalCleanup(primaryFailure, [
    () => Promise.allSettled(requests.map(({ outcome }) => outcome)),
    () => live.cleanup(),
    () => preload.preloadOutcome,
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
  ])
}

async function expectRejectedDemandEntersError(): Promise<void> {
  const posts = createMutablePosts([
    { id: 1, authorId: `selected`, title: `one` },
  ])
  let loadCount = 0
  let shouldReject = true
  let writeAfterRestart: () => void = () => {
    throw new Error(`Successful demand has not started`)
  }
  const childLoadError = new Error(`child load failed`)
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-rejected-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => ({
        loadSubset: () => {
          loadCount += 1
          if (shouldReject) {
            return Promise.reject(childLoadError)
          }
          writeAfterRestart = () => {
            begin()
            write({
              type: `insert`,
              value: { id: 100, postId: 1, body: `after restart` },
            })
            commit()
          }
          markReady()
          return true
        },
      }),
    },
  })
  const live = createPostsWithCommentsLive(posts.collection, comments)
  const preload: PreloadState = { preloadSettled: false }
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  startPreload(live, preload)

  let primaryFailure: CapturedFailure | undefined
  try {
    await flushPromises()
    expect(loadCount).toBe(1)
    expect(live.status).toBe(`error`)
    expect(preload.preloadSettled).toBe(true)
    expect(preload.preloadFailure?.error).toBe(childLoadError)

    await live.cleanup()
    await preload.preloadOutcome
    shouldReject = false
    await live.preload()
    expect(loadCount).toBe(2)
    expect(live.isReady()).toBe(true)
    writeAfterRestart()
    expect(
      live.toArray.map(({ id, comments: rows }) => ({
        id,
        comments: rows.map(({ id: childId, body }) => ({ id: childId, body })),
      })),
    ).toEqual([{ id: 1, comments: [{ id: 100, body: `after restart` }] }])
  } catch (error) {
    primaryFailure = { error }
  }
  await finishTemporalCleanup(primaryFailure, [
    () => live.cleanup(),
    () => preload.preloadOutcome,
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
    () => consoleError.mockRestore(),
  ])
}

async function expectFailedDemandRetriesSameCoverage(): Promise<void> {
  let loadCount = 0
  let shouldReject = true
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-demand-retry-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ markReady }) => ({
        loadSubset: () => {
          loadCount += 1
          if (shouldReject) {
            return Promise.reject(new Error(`child load failed`))
          }
          markReady()
          return true
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
    id: `same-coverage-retry`,
    path: [`postId`],
    collectionId: comments.id,
    initialKeys: new Set(),
  }

  let primaryFailure: CapturedFailure | undefined
  try {
    const first = controller.setDemand(subscription, plan, new Set([1]))
    expect(first.ready).toBeInstanceOf(Promise)
    if (!(first.ready instanceof Promise)) {
      throw new Error(`Expected failed demand to be asynchronous`)
    }
    await expect(first.ready).rejects.toThrow(`child load failed`)

    shouldReject = false
    const retry = controller.setDemand(subscription, plan, new Set([1]))
    expect(retry.changed).toBe(true)
    expect(loadCount).toBe(2)
    if (retry.ready instanceof Promise) await retry.ready
  } catch (error) {
    primaryFailure = { error }
  }
  await finishTemporalCleanup(primaryFailure, [
    () => controller.clear(),
    () => subscription.unsubscribe(),
    () => comments.cleanup(),
  ])
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

async function expectRetiredDemandStaysNonfatalAfterReleaseFailure(): Promise<void> {
  const post = { id: 1, authorId: `selected`, title: `one` }
  const posts = createMutablePosts([post])
  let loadCount = 0
  let allowUnload = false
  const releaseError = new Error(`child release failed`)
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-retired-release-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ markReady }) => ({
        loadSubset: () => {
          loadCount += 1
          markReady()
          return true
        },
        unloadSubset: () => {
          if (!allowUnload) throw releaseError
        },
      }),
    },
  })
  const live = createPostsWithCommentsLive(posts.collection, comments)
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  // A throwing release is an adapter bug: core reports it uncaught, once,
  // and records no subset error.
  const uncaught = captureMicrotaskErrors()

  let primaryFailure: CapturedFailure | undefined
  try {
    await live.preload()
    expect(loadCount).toBe(1)
    expect(live.status).toBe(`ready`)

    posts.write(`delete`, post)
    await flushPromises()
    expect(live.size).toBe(0)
    expect(live.status).toBe(`ready`)
    expect(uncaught.errors).toEqual([releaseError])
    expect(live.utils.lastSubsetError).toBeUndefined()

    posts.write(`insert`, post)
    await flushPromises()
    expect(loadCount).toBe(2)
    expect(live.status).toBe(`ready`)
  } catch (error) {
    primaryFailure = { error }
  }
  allowUnload = true
  await finishTemporalCleanup(primaryFailure, [
    () => live.cleanup(),
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
    () => consoleError.mockRestore(),
    () => uncaught.restore(),
  ])
}

async function expectFailedReplayStopsGatingAfterLastDemandRetires(): Promise<void> {
  const post = { id: 1, authorId: `selected`, title: `one` }
  const posts = createMutablePosts([post])
  const replay = createDeferred<void>()
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Comment }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  let loadCount = 0
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-retired-replay-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        commit = operations.commit
        truncate = operations.truncate
        operations.markReady()
        return {
          loadSubset: () => {
            loadCount += 1
            if (loadCount === 1) {
              begin()
              write({
                type: `insert`,
                value: { id: 10, postId: post.id, body: `old` },
              })
              commit()
              return true
            }
            begin()
            write({
              type: `insert`,
              value: { id: 20, postId: post.id, body: `private replacement` },
            })
            commit()
            return replay.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createPostsWithCommentsLive(posts.collection, comments)
  const publications: Array<Array<number>> = []
  const subscription = live.subscribeChanges(
    () => publications.push(live.toArray.map(({ id }) => id)),
    { includeInitialState: false },
  )
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

  let primaryFailure: CapturedFailure | undefined
  try {
    await live.preload()
    expect(live.get(post.id)?.comments.map(({ id }) => id)).toEqual([10])
    publications.length = 0

    begin()
    truncate()
    commit()
    await flushPromises()
    expect(loadCount).toBe(2)

    replay.reject(new Error(`replacement failed`))
    await flushPromises()
    expect(live.get(post.id)?.comments.map(({ id }) => id)).toEqual([10])
    expect(publications).toEqual([])

    posts.write(`delete`, post)
    await flushPromises()

    // Once the parent retires the last child demand, its failed replay can no
    // longer gate unrelated parent changes in the shared graph.
    expect(live.size).toBe(0)
    expect(publications).toEqual([[]])
  } catch (error) {
    primaryFailure = { error }
  }
  replay.resolve()
  await finishTemporalCleanup(primaryFailure, [
    () => subscription.unsubscribe(),
    () => live.cleanup(),
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
    () => consoleError.mockRestore(),
  ])
}

async function expectSynchronousEmptyDemandIsReady(): Promise<void> {
  const posts = createMutablePosts([
    { id: 1, authorId: `selected`, title: `one` },
  ])
  let loadCount = 0
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-empty-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    sync: {
      sync: () => ({
        loadSubset: () => {
          loadCount += 1
          return true
        },
      }),
    },
  })
  const live = createPostsWithCommentsLive(posts.collection, comments)

  let primaryFailure: CapturedFailure | undefined
  try {
    await live.preload()
    expect(loadCount).toBe(1)
    expect(live.isReady()).toBe(true)
    expect(live.get(1)?.comments).toEqual([])
  } catch (error) {
    primaryFailure = { error }
  }
  await finishTemporalCleanup(primaryFailure, [
    () => live.cleanup(),
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
  ])
}

async function expectPartialShrinkRetainsCoverage(): Promise<void> {
  const firstPost = { id: 1, authorId: `selected`, title: `one` }
  const secondPost = { id: 2, authorId: `selected`, title: `two` }
  const posts = createMutablePosts([firstPost, secondPost])
  const initialLoad = createDeferred<void>()
  const installed = new Map<number, Comment>()
  let begin: () => void
  let write: (change: { type: `insert` | `delete`; value: Comment }) => void
  let commit: () => void
  let markReady: () => void
  let deduped: DeduplicatedLoadSubset
  const unloads: Array<Array<number>> = []
  const comments = createCollection<Comment>({
    id: nextCollectionId(`temporal-shrink-comments`),
    getKey: (comment) => comment.id,
    syncMode: `on-demand`,
    sync: {
      sync: (methods) => {
        ;({ begin, write, commit, markReady } = methods)
        deduped = new DeduplicatedLoadSubset({
          loadSubset: (options) =>
            initialLoad.promise.then(() => {
              const keys = correlationKeys([options], `postId`)
              begin()
              for (const postId of keys) {
                const comment = { id: postId * 100, postId, body: `${postId}` }
                installed.set(postId, comment)
                write({ type: `insert`, value: comment })
              }
              commit()
              markReady()
            }),
        })
        return {
          loadSubset: (options) => deduped.loadSubset(options),
          unloadSubset: (options) => {
            const keys = correlationKeys([options], `postId`)
            unloads.push(keys)
            begin()
            for (const postId of keys) {
              const comment = installed.get(postId)
              if (comment) write({ type: `delete`, value: comment })
              installed.delete(postId)
            }
            commit()
          },
        }
      },
    },
  })
  const live = createPostsWithCommentsLive(posts.collection, comments)
  const preload = live.preload()

  let primaryFailure: CapturedFailure | undefined
  try {
    await flushPromises()
    initialLoad.resolve()
    await preload
    expect(live.get(1)?.comments).toHaveLength(1)

    posts.write(`delete`, secondPost)
    await flushPromises()
    expect(live.get(1)?.comments).toHaveLength(1)
    expect(unloads).toEqual([])

    posts.write(`delete`, firstPost)
    await flushPromises()
    expect(unloads).toEqual([[1, 2]])
  } catch (error) {
    primaryFailure = { error }
  }
  initialLoad.resolve()
  await finishTemporalCleanup(primaryFailure, [
    () => live.cleanup(),
    () => Promise.allSettled([preload]),
    () => posts.collection.cleanup(),
    () => comments.cleanup(),
  ])
}

type FastPathEvent = {
  phase: `fast` | `late`
  keys: Array<number>
}

// Model C: progressive rows can publish while the acquisition promise is pending.
// The load starts inside the initial fast-path phase; initial-query readiness
// waits for fulfillment.
type ProgressiveObservation = {
  events: Array<FastPathEvent>
  ready: boolean
  preloadSettled: boolean
}

type ProgressiveStep = `release-parent`

type ProgressiveContext = {
  users: Collection<User> | undefined
  posts: Collection<ProgressivePost>
  live: ReturnType<typeof createLiveQueryCollection>
  events: Array<FastPathEvent>
  closeWindow: () => void
  releaseParent: (() => void) | undefined
  startReached: Deferred<void>
  parentDelivery: Promise<void> | undefined
  preload: PreloadState
  expected: ProgressiveObservation
}

function createProgressivePosts(): {
  collection: Collection<ProgressivePost>
  events: Array<FastPathEvent>
  closeWindow: () => void
  syncStarted: Deferred<void>
} {
  let windowOpen = true
  const events: Array<FastPathEvent> = []
  const syncStarted = createDeferred<void>()
  const collection = createCollection<ProgressivePost>({
    id: nextCollectionId(`temporal-progressive-posts`),
    getKey: (post) => post.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, commit, markReady }) => {
        syncStarted.resolve()
        begin()
        commit()
        markReady()
        return {
          loadSubset: (options) => {
            events.push({
              phase: windowOpen ? `fast` : `late`,
              keys: correlationKeys([options], `userId`),
            })
            return Promise.resolve()
          },
        }
      },
    },
  })
  return {
    collection,
    events,
    syncStarted,
    closeWindow: () => {
      windowOpen = false
    },
  }
}

function createGatedUsers(): {
  collection: Collection<User>
  release: () => void
  started: Deferred<void>
  delivery: Promise<void>
} {
  const gate = createDeferred<void>()
  const started = createDeferred<void>()
  const delivery = createDeferred<void>()
  const collection = createCollection<User>({
    id: nextCollectionId(`temporal-users`),
    getKey: (user) => user.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        started.resolve()
        gate.promise.then(
          () => {
            begin()
            write({ type: `insert`, value: { id: 2, name: `selected` } })
            commit()
            markReady()
            delivery.resolve()
          },
          (error) => delivery.reject(error),
        )
      },
    },
  })
  return {
    collection,
    release: () => gate.resolve(),
    started,
    delivery: delivery.promise,
  }
}

function createProgressiveDriver(
  mode: `direct` | `nested`,
): TraceDriver<ProgressiveStep, ProgressiveContext> {
  return {
    setup: () => {
      const {
        collection: posts,
        events,
        closeWindow,
        syncStarted,
      } = createProgressivePosts()

      if (mode === `direct`) {
        const live = createLiveQueryCollection((q) =>
          q.from({ post: posts }).where(({ post }) => eq(post.userId, 2)),
        )
        return {
          users: undefined,
          posts,
          live,
          events,
          closeWindow,
          releaseParent: undefined,
          startReached: syncStarted,
          parentDelivery: undefined,
          preload: { preloadSettled: false },
          expected: {
            events: [{ phase: `fast`, keys: [2] }],
            ready: true,
            preloadSettled: true,
          },
        }
      }

      const {
        collection: users,
        release,
        started,
        delivery,
      } = createGatedUsers()
      const live = createLiveQueryCollection((q) =>
        q
          .from({ user: users })
          .where(({ user }) => eq(user.id, 2))
          .select(({ user }) => ({
            id: user.id,
            posts: toArray(
              q
                .from({ post: posts })
                .where(({ post }) => eq(post.userId, user.id)),
            ),
          })),
      )
      return {
        users,
        posts,
        live,
        events,
        closeWindow,
        releaseParent: release,
        startReached: started,
        parentDelivery: delivery,
        preload: { preloadSettled: false },
        expected: {
          events: [{ phase: `fast`, keys: [2] }],
          ready: false,
          preloadSettled: false,
        },
      }
    },
    start: async (context) => {
      const preload = startPreload(context.live, context.preload)
      await context.startReached.promise
      context.closeWindow()
      if (mode === `direct`) await preload
    },
    apply: async (_step, context) => {
      context.releaseParent?.()
      context.expected = {
        events: [{ phase: `fast`, keys: [2] }],
        ready: true,
        preloadSettled: true,
      }
      await finishPreload(context.preload)
    },
    cleanup: async ({
      users,
      posts,
      live,
      releaseParent,
      parentDelivery,
      preload,
    }) => {
      releaseParent?.()
      await finishTemporalCleanup(undefined, [
        () => parentDelivery,
        () => live.cleanup(),
        () => finishPreload(preload),
        () => users?.cleanup(),
        () => posts.cleanup(),
      ])
    },
  }
}

const progressiveProjection: TraceProjection<
  ProgressiveContext,
  ProgressiveObservation
> = {
  observe: ({ events, live, preload }) => ({
    events: [...events],
    ready: live.isReady(),
    preloadSettled: preload.preloadSettled,
  }),
  recompute: ({ expected }) => expected,
  assertEqual: (observed, expected) => {
    expect(observed).toEqual(expected)
    return undefined
  },
}

async function expectProgressiveTraceMatches(
  mode: `direct` | `nested`,
): Promise<void> {
  await runTrace({
    steps: mode === `nested` ? [`release-parent`] : [],
    driver: createProgressiveDriver(mode),
    projection: progressiveProjection,
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
// its acquisitions settle (atomic window publication). An Effect reports only
// rows written after initial readiness.
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
// an eager root that leaves `syncMode` at its default. The Effect lane uses
// the direct, lazy-join, and both eager-root shapes; Effects over an ordered
// window or an include are not covered here. The eager roots are the nearby
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
// model does not judge live-query rows there; the metamorphic twin does.
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

// One consumer of a lagging source: a live query with its preload, or a
// `skipInitial` Effect with the deltas it reported.
type LaggingSourceConsumerState = {
  source: LaggingPosts
  resolvedIds: Array<number> | undefined
  live: ReturnType<typeof createLiveQueryCollection> | undefined
  preload: PreloadState
  effect: Effect | undefined
  enteredPostIds: Array<number>
  otherEvents: number
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
    state.effect = createEffect({
      query,
      skipInitial: true,
      onBatch: (events) => {
        for (const event of events) {
          if (event.type === `enter`)
            state.enteredPostIds.push(...rowPostIds(shape, event.value))
          else state.otherEvents += 1
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
        const { facts, shape } = context
        facts.readOwes =
          facts.idsAtReadiness === undefined
            ? `at-readiness`
            : facts.posts
                .filter((post) => postMatchesShape(shape, facts, post))
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
): LiveQueryObservation | EffectObservation | ReadObservation {
  if (isReadConsumer(consumer))
    return {
      resolvedIds: state.resolvedIds,
      acquisitions: observedAcquisitions(shape, facts, state.source),
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
  LiveQueryObservation | EffectObservation | ReadObservation

type LaggingSourceCheck = {
  observation: LaggingSourceObservation
  // Present only when the twin observed something else.
  twinDisagreement: LaggingSourceObservation | undefined
}

function laggingSourceProjection(
  consumer: LaggingSourceConsumer,
  shape: LaggingSourceShape,
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
      return {
        observation:
          facts.replayPending && `postIds` in observation
            ? { ...observation, postIds: null }
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
): Promise<void> {
  await runTrace({
    steps,
    driver: createLaggingSourceDriver(consumer, shape),
    projection: laggingSourceProjection(consumer, shape),
  })
}

// Each generated lane uses one grammar and one check in both campaigns. A
// seed-and-path replay selects only its requested random lane.
function temporalCampaigns(property: string, fixedSeed: number) {
  const replay = readOracleRunConfig()
  return [
    {
      label: `fixed seed ${fixedSeed}`,
      test: replay.replayPath === undefined ? fcTest : fcTest.skip,
      options: { numRuns: oracleRuns(20), seed: fixedSeed },
    },
    {
      label: `random or replayed seed`,
      test:
        replay.replayPath === undefined || replay.replayProperty === property
          ? fcTest
          : fcTest.skip,
      options: oraclePropertyOptions(20, property),
    },
  ]
}

describe(`includes temporal oracle`, () => {
  it(`an empty outer does not wait for an undemanded child`, () =>
    expectReadinessMatches([]))

  it(`loads a demanded child before becoming ready`, async () => {
    await expectReadinessMatches([
      { id: 1, authorId: `selected`, title: `one` },
      { id: 2, authorId: `selected`, title: `two` },
    ])
  })

  it(
    `retired child demand does not block initial-query readiness`,
    expectObsoleteDemandDoesNotBlockReadiness,
  )

  it(
    `an obsolete child acquisition cannot publish after the route is reactivated`,
    expectObsoleteAcquisitionCannotPublishAfterReactivation,
  )

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

  it(
    `retained demand with a pending acquisition blocks initial-query readiness after demand expands`,
    expectRetainedDemandBlocksReadiness,
  )

  it(`consolidates churn after apply without reloading monotonic growth`, () =>
    expectDemandChurnPreservesCoverage(`success`))

  it(`failed churn replacement retains coverage and retries its union`, () =>
    expectDemandChurnPreservesCoverage(`failure`))

  it(
    `failed churn replacement keeps established child rows visible`,
    expectFailedConsolidationKeepsVisibleRows,
  )

  it(`obsolete churn replacement cannot retire established coverage`, () =>
    expectDemandChurnPreservesCoverage(`obsolete`))

  it(
    `crashes before replacing coverage when snapshot admission contradicts its result`,
    expectContradictoryReplacementStartCrashes,
  )

  it(
    `an obsolete acquisition cannot complete preload for reactivated demand`,
    expectObsoleteAcquisitionCannotCompleteCurrentPreload,
  )

  it(`rejected demand enters error`, expectRejectedDemandEntersError)

  it(
    `failed demand retries the same coverage`,
    expectFailedDemandRetriesSameCoverage,
  )

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

  it(
    `failed release retires an empty live-query demand, reported uncaught, without poisoning reentry`,
    expectRetiredDemandStaysNonfatalAfterReleaseFailure,
  )

  it(
    `failed replay stops gating after its last demand retires`,
    expectFailedReplayStopsGatingAfterLastDemandRetires,
  )

  it(
    `a synchronous empty demand can establish ready coverage`,
    expectSynchronousEmptyDemandIsReady,
  )

  it(
    `partially shrinking demand retains established coverage`,
    expectPartialShrinkRetainsCoverage,
  )

  it(`loads a direct progressive subset inside the fast-path window`, async () => {
    await expectProgressiveTraceMatches(`direct`)
  })

  it(`a nested progressive subset loads inside the fast-path window`, () =>
    expectProgressiveTraceMatches(`nested`))

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
    it.each(cells)(`$consumer $shape: $history`, ({ consumer, shape, steps }) =>
      expectLaggingSourceTraceMatches(consumer, shape, steps),
    )
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
