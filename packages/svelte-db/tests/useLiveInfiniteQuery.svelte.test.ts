import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery.svelte.js'
import { mockSyncCollectionOptions } from '../../db/tests/utils'

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
      | ((collection: typeof secondQuery) => void)
      | undefined
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
})
