import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  lte,
} from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery.svelte.js'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { InitialQueryBuilder } from '@tanstack/db'

type Post = {
  id: string
  title: string
  createdAt: number
}

function createPosts(count: number): Array<Post> {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    title: `Post ${index + 1}`,
    createdAt: count - index,
  }))
}

function createPostsCollection(id: string, count: number) {
  return createCollection(
    mockSyncCollectionOptions<Post>({
      autoIndex: `eager`,
      id,
      getKey: (post) => post.id,
      initialData: createPosts(count),
    }),
  )
}

function createPostsLiveQuery(posts: ReturnType<typeof createPostsCollection>) {
  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ posts })
        .orderBy(({ posts: post }) => post.createdAt, `desc`)
        .limit(4),
  })
}

// An on-demand source that counts acquisitions. Its loads never settle, so
// the test observes only whether a request was sent.
function createCountingOnDemandPosts(id: string) {
  let loads = 0
  const posts = createCollection<Post>({
    id,
    getKey: (post) => post.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            loads++
            return new Promise<void>(() => {})
          },
        }
      },
    },
  })
  return { posts, loads: () => loads }
}

// Reads the maximum inside the query callback, so the hook tracks it directly.
function usePostsAtMostInfiniteQuery(
  posts: ReturnType<typeof createPostsCollection>,
  getMaximum: () => number,
) {
  return useLiveInfiniteQuery(
    (q: InitialQueryBuilder) =>
      q
        .from({ posts })
        .where(({ posts: post }) => lte(post.createdAt, getMaximum()))
        .orderBy(({ posts: post }) => post.createdAt, `desc`),
    { pageSize: 3 },
  )
}

function usePostsCollectionInfiniteQuery(
  getCollection: () => ReturnType<typeof createPostsLiveQuery>,
) {
  return useLiveInfiniteQuery(getCollection, { pageSize: 3 })
}

describe(`useLiveInfiniteQuery`, () => {
  it(`rejects a server-page callback before constructing a query`, () => {
    const queryFn = vi.fn(() => {
      throw new Error(`query must not be constructed`)
    })
    const config = { pageSize: 2, getNextPageParam: () => 1 }
    const stop = $effect.root(() => {
      expect(() => useLiveInfiniteQuery(queryFn, config)).toThrow(
        `getNextPageParam is not supported`,
      )
      expect(queryFn).not.toHaveBeenCalled()
    })
    stop()
  })

  let cleanup: (() => void) | undefined

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    vi.restoreAllMocks()
  })

  it(`accepts a reactive getter for a pre-created ordered collection`, async () => {
    const posts = createPostsCollection(`svelte-infinite-precreated`, 7)
    const livePosts = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ posts })
          .orderBy(({ posts: post }) => post.createdAt, `desc`)
          .limit(2)
          .offset(1),
    })
    await livePosts.preload()
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})

    let query!: ReturnType<typeof usePostsCollectionInfiniteQuery>
    cleanup = $effect.root(() => {
      query = useLiveInfiniteQuery(() => livePosts, {
        pageSize: 3,
      })
    })
    flushSync()
    // flushSync starts the subscription but does not settle its window load.
    await vi.waitFor(() =>
      expect(livePosts.utils.getWindow()).toEqual({ offset: 0, limit: 4 }),
    )
    flushSync()

    expect(query.collection).toBe(livePosts)
    expect(query.data.map((post) => post.id)).toEqual([`1`, `2`, `3`])
    expect(query.state.get(`1`)?.title).toBe(`Post 1`)
    expect(query.hasNextPage).toBe(true)
    expect(warning).toHaveBeenCalledOnce()
    expect(livePosts.utils.getWindow()).toEqual({ offset: 0, limit: 4 })
  })

  it(`resets to the first page when a collection getter changes`, async () => {
    const firstPosts = createPostsCollection(`svelte-infinite-swap-first`, 8)
    const secondPosts = createPostsCollection(`svelte-infinite-swap-second`, 4)
    const firstQuery = createPostsLiveQuery(firstPosts)
    const secondQuery = createPostsLiveQuery(secondPosts)
    await Promise.all([firstQuery.preload(), secondQuery.preload()])

    let query: ReturnType<typeof usePostsCollectionInfiniteQuery> | undefined
    let replaceCollection:
      ((collection: typeof secondQuery) => void) | undefined
    cleanup = $effect.root(() => {
      let selectedQuery = $state(firstQuery)
      query = usePostsCollectionInfiniteQuery(() => selectedQuery)
      replaceCollection = (collection) => {
        selectedQuery = collection
      }
    })
    flushSync()
    if (!query || !replaceCollection) {
      throw new Error(`Failed to mount infinite query`)
    }

    await query.fetchNextPage()
    flushSync()
    expect(query.pages).toHaveLength(2)

    replaceCollection(secondQuery)
    flushSync()

    expect(query.collection).toBe(secondQuery)
    expect(query.pages).toHaveLength(1)
    expect(query.data.map((post) => post.createdAt)).toEqual([4, 3, 2])
  })

  it(`rebuilds the query when state read inside the query callback changes`, () => {
    const posts = createPostsCollection(`svelte-infinite-tracked-read`, 8)
    let query: ReturnType<typeof usePostsAtMostInfiniteQuery> | undefined
    let setMaximum: ((maximum: number) => void) | undefined
    cleanup = $effect.root(() => {
      // No deps array: the derived controller tracks this read directly.
      let maximum = $state(8)
      query = usePostsAtMostInfiniteQuery(posts, () => maximum)
      setMaximum = (next) => {
        maximum = next
      }
    })
    flushSync()
    if (!query || !setMaximum) throw new Error(`Failed to mount infinite query`)
    expect(query.data.map((post) => post.createdAt)).toEqual([8, 7, 6])

    setMaximum(5)
    flushSync()
    expect(query.data.map((post) => post.createdAt)).toEqual([5, 4, 3])
  })
  it(`does not acquire an on-demand source before the subscribing effect runs`, () => {
    for (const wrapped of [false, true]) {
      const { posts: remote, loads } = createCountingOnDemandPosts(
        `svelte-infinite-on-demand-${wrapped ? `wrapped` : `direct`}`,
      )
      // A live-query Collection does not copy its source's sync mode.
      const posts = wrapped
        ? createLiveQueryCollection({
            query: (q) =>
              q
                .from({ posts: remote })
                .orderBy(({ posts: post }) => post.createdAt, `desc`),
            startSync: false,
            gcTime: 1,
          })
        : remote
      let query: ReturnType<typeof usePostsAtMostInfiniteQuery> | undefined
      let setMaximum: ((maximum: number) => void) | undefined
      const stop = $effect.root(() => {
        let maximum = $state(8)
        // The wrapped live-query Collection has a derived row type. This test
        // reads only acquisition counts, so the source type is cast here.
        query = usePostsAtMostInfiniteQuery(posts as any, () => maximum)
        setMaximum = (next) => {
          maximum = next
        }
      })
      try {
        if (!query || !setMaximum) {
          throw new Error(`Failed to mount infinite query`)
        }
        // Construction and a superseded recompute both precede the effect.
        void query.data
        setMaximum(5)
        void query.data
        expect(loads()).toBe(0)

        flushSync()
        expect(loads()).toBeGreaterThan(0)
      } finally {
        stop()
      }
    }
  })
})
