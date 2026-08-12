import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { createCollection, createLiveQueryCollection, gt } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery.svelte.js'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type {
  InitialQueryBuilder,
  LiveQueryCollectionUtils,
} from '@tanstack/db'

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

function usePostsInfiniteQuery(
  posts: ReturnType<typeof createPostsCollection>,
  config: { pageSize?: number; initialPageParam?: number },
) {
  return useLiveInfiniteQuery(
    (q: InitialQueryBuilder) =>
      q.from({ posts }).orderBy(({ posts: post }) => post.createdAt, `desc`),
    config,
  )
}

function useFilteredPostsInfiniteQuery(
  posts: ReturnType<typeof createPostsCollection>,
  minimum: () => number,
) {
  return useLiveInfiniteQuery(
    (q: InitialQueryBuilder) =>
      q
        .from({ posts })
        .where(({ posts: post }) => gt(post.createdAt, minimum()))
        .orderBy(({ posts: post }) => post.createdAt, `desc`),
    { pageSize: 3 },
    [minimum],
  )
}

describe(`useLiveInfiniteQuery`, () => {
  let cleanup: (() => void) | undefined

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    vi.restoreAllMocks()
  })

  function mountPostsQuery(
    posts: ReturnType<typeof createPostsCollection>,
    config: { pageSize?: number; initialPageParam?: number },
  ): ReturnType<typeof usePostsInfiniteQuery> {
    let query: ReturnType<typeof usePostsInfiniteQuery> | undefined
    cleanup = $effect.root(() => {
      query = usePostsInfiniteQuery(posts, config)
    })
    flushSync()
    if (!query) throw new Error(`Failed to mount infinite query`)
    return query
  }

  it(`delegates page windows and snapshots to the shared controller`, async () => {
    const posts = createPostsCollection(`svelte-infinite-controller`, 12)
    const query = mountPostsQuery(posts, {
      pageSize: 5,
      initialPageParam: 3,
    })

    expect(query.data).toHaveLength(5)
    expect(query.pages.map((page) => page.length)).toEqual([5])
    expect(query.pageParams).toEqual([3])
    expect(query.hasNextPage).toBe(true)
    expect(
      (query.collection.utils as LiveQueryCollectionUtils).getWindow(),
    ).toEqual({ offset: 0, limit: 6 })

    await query.fetchNextPage()
    flushSync()

    expect(query.data).toHaveLength(10)
    expect(query.pages.map((page) => page.length)).toEqual([5, 5])
    expect(query.pageParams).toEqual([3, 4])
    expect(query.hasNextPage).toBe(true)
    expect(
      (query.collection.utils as LiveQueryCollectionUtils).getWindow(),
    ).toEqual({ offset: 0, limit: 11 })

    await query.fetchNextPage()
    flushSync()

    expect(query.data).toHaveLength(12)
    expect(query.pages.map((page) => page.length)).toEqual([5, 5, 2])
    expect(query.hasNextPage).toBe(false)
  })

  it(`keeps loaded pages live when rows enter or leave the window`, async () => {
    const posts = createPostsCollection(`svelte-infinite-live-rows`, 8)
    const query = mountPostsQuery(posts, { pageSize: 3 })

    await query.fetchNextPage()
    flushSync()
    expect(query.data.map((post) => post.id)).toEqual([
      `1`,
      `2`,
      `3`,
      `4`,
      `5`,
      `6`,
    ])

    posts.utils.begin()
    posts.utils.write({
      type: `insert`,
      value: { id: `new`, title: `Newest`, createdAt: 100 },
    })
    posts.utils.commit()
    flushSync()

    expect(query.data.map((post) => post.id)).toEqual([
      `new`,
      `1`,
      `2`,
      `3`,
      `4`,
      `5`,
    ])
    expect(query.pages.map((page) => page.length)).toEqual([3, 3])
  })

  it(`recreates the controller at the first page when a dependency changes`, async () => {
    const posts = createPostsCollection(`svelte-infinite-dependency`, 10)
    let query: ReturnType<typeof useFilteredPostsInfiniteQuery> | undefined
    let setMinimum: ((value: number) => void) | undefined

    cleanup = $effect.root(() => {
      let minimum = $state(0)
      query = useFilteredPostsInfiniteQuery(posts, () => minimum)
      setMinimum = (value) => {
        minimum = value
      }
    })
    flushSync()
    if (!query || !setMinimum) throw new Error(`Failed to mount infinite query`)

    await query.fetchNextPage()
    flushSync()
    expect(query.pages).toHaveLength(2)

    setMinimum(5)
    flushSync()

    expect(query.pages).toHaveLength(1)
    expect(query.data.map((post) => post.createdAt)).toEqual([10, 9, 8])
  })

  it.each([
    { label: `empty`, count: 0, pageSize: 5, pageLengths: [0], limit: 6 },
    { label: `single row`, count: 1, pageSize: 5, pageLengths: [1], limit: 6 },
    {
      label: `zero page size`,
      count: 1,
      pageSize: 0,
      pageLengths: [1],
      limit: 21,
    },
  ])(
    `handles $label pagination boundaries`,
    ({ label, count, pageSize, pageLengths, limit }) => {
      const posts = createPostsCollection(`svelte-infinite-${label}`, count)
      const query = mountPostsQuery(posts, { pageSize })

      expect(query.pages.map((page) => page.length)).toEqual(pageLengths)
      expect(query.hasNextPage).toBe(false)
      expect(
        (query.collection.utils as LiveQueryCollectionUtils).getWindow(),
      ).toEqual({ offset: 0, limit })
    },
  )

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

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(() => livePosts, {
        pageSize: 3,
        getNextPageParam: (lastPage) => lastPage[0]?.createdAt,
      })
      flushSync()

      expect(query.collection).toBe(livePosts)
      expect(query.data.map((post) => post.id)).toEqual([`1`, `2`, `3`])
      expect(query.state.get(`1`)?.title).toBe(`Post 1`)
      expect(query.hasNextPage).toBe(true)
      expect(warning).toHaveBeenCalledOnce()
      expect(livePosts.utils.getWindow()).toEqual({ offset: 0, limit: 4 })
    })
  })
})
