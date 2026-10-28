/**
 * Ordinary tests moved from includes-temporal-oracle.test.ts. They check literal
 * values, harness failure reporting, or a fixed scenario that has no computed
 * expectation, so they are supplemental coverage. The temporal laws and their
 * models are owned by includes-temporal-oracle.test.ts, which keeps the
 * generated and driver-based checks. Shared helpers live in
 * includes-temporal-support.ts.
 */

import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { SubsetDemandController } from '../../src/query/live/subset-demand-controller.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
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
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { Deferred } from '../../src/deferred.js'
import type { LoadSubsetOptions, SyncAppliedReceipt } from '../../src/types.js'
import type { LazyDemandPlan } from '../../src/query/compiler/joins.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type {
  CapturedFailure,
  Comment,
  Post,
  PreloadState,
  ProgressivePost,
  User,
} from './includes-temporal-support.js'

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

    // After the first ready, the failed replacement is a request error on the
    // live query's node. The query stays ready and keeps established rows.
    expect(live.status).toBe(`ready`)
    expect(live.health.error).toEqual(expect.anything())
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

describe(`includes temporal oracle`, () => {
  it(
    `retired child demand does not block initial-query readiness`,
    expectObsoleteDemandDoesNotBlockReadiness,
  )

  it(
    `an obsolete child acquisition cannot publish after the route is reactivated`,
    expectObsoleteAcquisitionCannotPublishAfterReactivation,
  )

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
})
