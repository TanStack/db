import { afterEach, describe, expect, it } from 'vitest'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

/**
 * Outcome checklist for the holds behind initial-query readiness.
 *
 * Initial-query readiness and Effect `skipInitial` suppression wait on held
 * acquisitions: a live query's lazy demand and an Effect's initial loads.
 * Model D in `includes-temporal-oracle.test.ts` owns the settle, abort
 * (rekey), and truncate-replacement outcomes. This file pins the remaining
 * outcomes for one hold at a time:
 *
 * - a real load failure disposes a `skipInitial` Effect and delivers nothing;
 * - an owner disposed or cleaned up while a hold is pending ignores the late
 *   settlement or rejection of that hold.
 *
 * Each source is on-demand and stays `loading`, so only the hold decides.
 */

type User = { id: number; name: string }
type Post = { id: number; userId: number }

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

type PendingLoad = {
  options: LoadSubsetOptions
  resolve: () => void
  reject: (error: unknown) => void
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// An on-demand source that never reaches Collection readiness. Each load
// waits until the test settles it; `deliver` writes its rows first.
function createLaggingPosts(id: string) {
  const loads: Array<PendingLoad> = []
  let write: ((post: Post) => void) | undefined
  const collection = createCollection<Post, number>({
    id,
    getKey: (post) => post.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        write = (post) => {
          params.begin()
          params.write({ type: `insert`, value: post })
          params.commit()
        }
        return {
          loadSubset: (options) =>
            new Promise<void>((resolve, reject) => {
              loads.push({ options, resolve, reject })
            }),
        }
      },
    },
    startSync: true,
  })
  cleanups.push(() => collection.cleanup())
  return {
    collection,
    loads,
    deliver: (post: Post) => write!(post),
  }
}

function createUsers(id: string) {
  const collection = createCollection(
    mockSyncCollectionOptions<User>({
      id,
      getKey: (user) => user.id,
      initialData: [{ id: 1, name: `Alice` }],
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
    }),
  )
  cleanups.push(() => collection.cleanup())
  return collection
}

describe(`Effect initial-load hold outcomes`, () => {
  it(`disposes a skipInitial effect when its initial load fails`, async () => {
    const posts = createLaggingPosts(`hold-effect-reject`)
    const entered: Array<number> = []
    const sourceErrors: Array<Error> = []
    const effect = createEffect<Post>({
      query: (q) => q.from({ post: posts.collection }),
      skipInitial: true,
      onEnter: (event) => {
        entered.push(event.value.id)
      },
      onSourceError: (error) => sourceErrors.push(error),
    })
    cleanups.push(() => effect.dispose())

    await flush()
    expect(posts.loads).toHaveLength(1)
    posts.deliver({ id: 1, userId: 1 })
    posts.loads[0]!.reject(new Error(`load failed`))
    await flush()

    expect(sourceErrors).toEqual([
      expect.objectContaining({ message: `load failed` }),
    ])
    expect(effect.disposed).toBe(true)
    expect(entered).toEqual([])

    // A disposed effect reports no later change either.
    posts.deliver({ id: 2, userId: 1 })
    await flush()
    expect(entered).toEqual([])
  })

  it.each([`settles`, `rejects`] as const)(
    `ignores an initial load that %s after the effect is disposed`,
    async (outcome) => {
      const posts = createLaggingPosts(`hold-effect-dispose-${outcome}`)
      const events: Array<string> = []
      const sourceErrors: Array<Error> = []
      const effect = createEffect<Post>({
        query: (q) => q.from({ post: posts.collection }),
        skipInitial: true,
        onBatch: (batch) => {
          for (const event of batch) events.push(`${event.type}:${event.key}`)
        },
        onSourceError: (error) => sourceErrors.push(error),
      })

      await flush()
      expect(posts.loads).toHaveLength(1)
      await effect.dispose()

      posts.deliver({ id: 1, userId: 1 })
      if (outcome === `settles`) posts.loads[0]!.resolve()
      else posts.loads[0]!.reject(new Error(`late failure`))
      posts.deliver({ id: 2, userId: 1 })
      await flush()

      expect({ events, sourceErrors }).toEqual({ events: [], sourceErrors: [] })
    },
  )
})

describe(`live-query lazy demand hold outcomes`, () => {
  it.each([`settles`, `rejects`] as const)(
    `ignores lazy demand that %s after the query is cleaned up`,
    async (outcome) => {
      const users = createUsers(`hold-live-users-${outcome}`)
      const posts = createLaggingPosts(`hold-live-posts-${outcome}`)
      const liveQuery = createLiveQueryCollection((q) =>
        q
          .from({ user: users })
          .leftJoin({ post: posts.collection }, ({ user, post }) =>
            eq(user.id, post.userId),
          )
          .select(({ user, post }) => ({ id: user.id, postId: post.id })),
      )
      const subscription = liveQuery.subscribeChanges(() => {})

      await flush()
      expect(posts.loads).toHaveLength(1)
      expect(liveQuery.status).toBe(`loading`)

      subscription.unsubscribe()
      await liveQuery.cleanup()
      expect(liveQuery.status).toBe(`cleaned-up`)

      posts.deliver({ id: 10, userId: 1 })
      if (outcome === `settles`) posts.loads[0]!.resolve()
      else posts.loads[0]!.reject(new Error(`late failure`))
      await flush()

      expect(liveQuery.status).toBe(`cleaned-up`)
    },
  )

  it(`enters error when a lagging source's lazy demand fails`, async () => {
    const users = createUsers(`hold-live-users-reject`)
    const posts = createLaggingPosts(`hold-live-posts-reject`)
    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .leftJoin({ post: posts.collection }, ({ user, post }) =>
          eq(user.id, post.userId),
        )
        .select(({ user, post }) => ({ id: user.id, postId: post.id })),
    )
    cleanups.push(() => liveQuery.cleanup())
    const preload = liveQuery.preload().then(
      () => `ready`,
      () => `rejected`,
    )

    await flush()
    expect(posts.loads).toHaveLength(1)
    posts.loads[0]!.reject(new Error(`lazy load failed`))
    await flush()

    expect(liveQuery.status).toBe(`error`)
    expect(liveQuery.isReady()).toBe(false)
    expect(
      await Promise.race([preload, flush().then(() => `pending`)]),
    ).not.toBe(`ready`)
  })
})
