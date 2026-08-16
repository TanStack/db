import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { flushPromises } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type { Deferred } from '../../src/deferred.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'

type Post = {
  id: number
  authorId: string
  title: string
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
      if (initialPosts.length > 0) await preload
    },
    apply: () => undefined,
    cleanup: async ({ posts, comments, live, preload }) => {
      await live.cleanup()
      await finishPreload(preload)
      await Promise.all([posts.cleanup(), comments.cleanup()])
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
      await live.cleanup()
      await finishPreload(preload)
      await Promise.all([posts.cleanup(), comments.cleanup()])
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

async function expectObsoleteDemandCannotPublishAfterReactivation(): Promise<void> {
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
  } finally {
    for (const request of requests) request.deferred.resolve()
    await Promise.allSettled(requests.map(({ outcome }) => outcome))
    await live.cleanup()
    await Promise.all([posts.cleanup(), comments.cleanup()])
  }
}

type FastPathEvent = {
  phase: `fast` | `late`
  keys: Array<number>
}

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
      await parentDelivery
      await live.cleanup()
      await finishPreload(preload)
      await Promise.all([users?.cleanup(), posts.cleanup()])
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
  it(`an empty outer does not wait for an undemanded child`, () =>
    expectReadinessMatches([]))

  it(`loads a demanded child before becoming ready`, async () => {
    await expectReadinessMatches([
      { id: 1, authorId: `selected`, title: `one` },
      { id: 2, authorId: `selected`, title: `two` },
    ])
  })

  it(
    `obsolete child demand does not block readiness`,
    expectObsoleteDemandDoesNotBlockReadiness,
  )

  it(
    `obsolete child demand cannot publish after the route is reactivated`,
    expectObsoleteDemandCannotPublishAfterReactivation,
  )

  it(`loads a direct progressive subset inside the fast-path window`, async () => {
    await expectProgressiveTraceMatches(`direct`)
  })

  it(`a nested progressive subset loads inside the fast-path window`, () =>
    expectProgressiveTraceMatches(`nested`))
})
