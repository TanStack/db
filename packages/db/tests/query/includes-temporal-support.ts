// Shared helpers for the includes temporal tests. The oracle that owns the
// temporal laws is includes-temporal-oracle.test.ts; the ordinary tests are in
// includes-temporal.test.ts. Each helper here is used by both files.

import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import type { Collection } from '../../src/collection/index.js'
import type { Deferred } from '../../src/deferred.js'
import type { LoadSubsetOptions } from '../../src/types.js'

export type Post = {
  id: number
  authorId: string
  title: string
}

export type PostChange = {
  type: `insert` | `delete`
  value: Post
}

export type Comment = {
  id: number
  postId: number
  body: string
}

export type User = {
  id: number
  name: string
}

export type ProgressivePost = {
  id: number
  userId: number
  title: string
}

let collectionId = 0

export function nextCollectionId(prefix: string): string {
  collectionId += 1
  return `${prefix}-${collectionId}`
}

export type PreloadState = {
  preloadFailure?: { error: unknown }
  preloadOutcome?: Promise<void>
  preloadSettled: boolean
}

export type CapturedFailure = { error: unknown }

export // Run every cleanup step after the first mismatch. Keep that mismatch as the
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

export // A preload can reject before cleanup observes it. This record retains both
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

export async function finishPreload(state: PreloadState): Promise<void> {
  await state.preloadOutcome
  if (state.preloadFailure) throw state.preloadFailure.error
}

export function correlationKeys(
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

export function createColdPosts(initial: ReadonlyArray<Post>): {
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

export function createRemovablePost(): {
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

export function createMutablePosts(
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

export function createPostsWithCommentsLive(
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
