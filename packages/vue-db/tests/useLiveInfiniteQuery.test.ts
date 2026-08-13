import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { createCollection, createLiveQueryCollection, gt } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
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

async function flushVue(): Promise<void> {
  await nextTick()
  await Promise.resolve()
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
    const scope = effectScope()
    const query = scope.run(() => usePostsInfiniteQuery(posts, config))
    cleanup = () => scope.stop()
    if (!query) throw new Error(`Failed to mount infinite query`)
    return query
  }

  it(`delegates page windows and snapshots to the shared controller`, async () => {
    const posts = createPostsCollection(`vue-infinite-controller`, 12)
    const query = mountPostsQuery(posts, {
      pageSize: 5,
      initialPageParam: 3,
    })
    await flushVue()

    expect(query.data.value).toHaveLength(5)
    expect(query.pages.value.map((page) => page.length)).toEqual([5])
    expect(query.pageParams.value).toEqual([3])
    expect(query.hasNextPage.value).toBe(true)
    expect(
      (query.collection.value.utils as LiveQueryCollectionUtils).getWindow(),
    ).toEqual({ offset: 0, limit: 6 })

    await query.fetchNextPage()
    await flushVue()

    expect(query.data.value).toHaveLength(10)
    expect(query.pages.value.map((page) => page.length)).toEqual([5, 5])
    expect(query.pageParams.value).toEqual([3, 4])
    expect(query.hasNextPage.value).toBe(true)
    expect(
      (query.collection.value.utils as LiveQueryCollectionUtils).getWindow(),
    ).toEqual({ offset: 0, limit: 11 })

    await query.fetchNextPage()
    await flushVue()

    expect(query.data.value).toHaveLength(12)
    expect(query.pages.value.map((page) => page.length)).toEqual([5, 5, 2])
    expect(query.hasNextPage.value).toBe(false)
  })

  it(`keeps loaded pages live when rows enter or leave the window`, async () => {
    const posts = createPostsCollection(`vue-infinite-live-rows`, 8)
    const query = mountPostsQuery(posts, { pageSize: 3 })
    await flushVue()

    await query.fetchNextPage()
    await flushVue()
    expect(query.data.value.map((post) => post.id)).toEqual([
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
    await flushVue()

    expect(query.data.value.map((post) => post.id)).toEqual([
      `new`,
      `1`,
      `2`,
      `3`,
      `4`,
      `5`,
    ])
    expect(query.pages.value.map((page) => page.length)).toEqual([3, 3])
  })

  it(`recreates the controller at the first page when a dependency changes`, async () => {
    const posts = createPostsCollection(`vue-infinite-dependency`, 10)
    const minimum = ref(0)
    const scope = effectScope()
    const query = scope.run(() =>
      useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts })
            .where(({ posts: post }) => gt(post.createdAt, minimum.value))
            .orderBy(({ posts: post }) => post.createdAt, `desc`),
        { pageSize: 3 },
        [minimum],
      ),
    )
    cleanup = () => scope.stop()
    if (!query) throw new Error(`Failed to mount infinite query`)
    await flushVue()

    await query.fetchNextPage()
    await flushVue()
    expect(query.pages.value).toHaveLength(2)

    minimum.value = 5
    await flushVue()

    expect(query.pages.value).toHaveLength(1)
    expect(query.data.value.map((post) => post.createdAt)).toEqual([10, 9, 8])
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
    {
      label: `unsafe page size`,
      count: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
      pageLengths: [1],
      limit: 21,
    },
  ])(
    `handles $label pagination boundaries`,
    async ({ label, count, pageSize, pageLengths, limit }) => {
      const posts = createPostsCollection(`vue-infinite-${label}`, count)
      const query = mountPostsQuery(posts, { pageSize })
      await flushVue()

      expect(query.pages.value.map((page) => page.length)).toEqual(pageLengths)
      expect(query.pageParams.value).toEqual([0])
      expect(query.hasNextPage.value).toBe(false)
      expect(
        (query.collection.value.utils as LiveQueryCollectionUtils).getWindow(),
      ).toEqual({ offset: 0, limit })

      const data = [...query.data.value]
      await expect(query.fetchNextPage()).resolves.toBeUndefined()
      await flushVue()
      expect(query.data.value).toEqual(data)
      expect(query.pages.value.map((page) => page.length)).toEqual(pageLengths)
    },
  )

  it(`coalesces concurrent page requests`, async () => {
    const posts = createPostsCollection(`vue-infinite-concurrent`, 8)
    const query = mountPostsQuery(posts, { pageSize: 3 })
    await flushVue()

    const utils = query.collection.value.utils as LiveQueryCollectionUtils
    const originalSetWindow = utils.setWindow.bind(utils)
    let resolveWindow!: () => void
    const setWindow = vi
      .spyOn(utils, `setWindow`)
      .mockImplementationOnce((options) => {
        originalSetWindow(options)
        return new Promise<void>((resolve) => {
          resolveWindow = resolve
        })
      })

    const firstFetch = query.fetchNextPage()
    const concurrentFetch = query.fetchNextPage()

    expect(query.isFetchingNextPage.value).toBe(true)
    expect(setWindow).toHaveBeenCalledOnce()
    await expect(concurrentFetch).resolves.toBeUndefined()

    resolveWindow()
    await firstFetch
    await flushVue()

    expect(query.pages.value.map((page) => page.length)).toEqual([3, 3])
  })

  it(`accepts a reactive ref for a pre-created ordered collection`, async () => {
    const posts = createPostsCollection(`vue-infinite-precreated`, 7)
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
    const scope = effectScope()
    const collection = shallowRef(livePosts)
    const query = scope.run(() =>
      useLiveInfiniteQuery(collection, {
        pageSize: 3,
        getNextPageParam: (lastPage) => lastPage[0]?.createdAt,
      }),
    )
    cleanup = () => scope.stop()
    if (!query) throw new Error(`Failed to mount infinite query`)
    await flushVue()

    expect(query.collection.value).toBe(livePosts)
    expect(query.data.value.map((post) => post.id)).toEqual([`1`, `2`, `3`])
    expect(query.state.value.get(`1`)?.title).toBe(`Post 1`)
    expect(query.hasNextPage.value).toBe(true)
    expect(warning).toHaveBeenCalledOnce()
    expect(livePosts.utils.getWindow()).toEqual({ offset: 0, limit: 4 })
  })

  it(`resets to the first page when a collection ref changes`, async () => {
    const firstPosts = createPostsCollection(`vue-infinite-swap-first`, 8)
    const secondPosts = createPostsCollection(`vue-infinite-swap-second`, 4)
    const firstQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ posts: firstPosts })
          .orderBy(({ posts: post }) => post.createdAt, `desc`)
          .limit(4),
    })
    const secondQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ posts: secondPosts })
          .orderBy(({ posts: post }) => post.createdAt, `desc`)
          .limit(4),
    })
    await Promise.all([firstQuery.preload(), secondQuery.preload()])

    const scope = effectScope()
    const selectedQuery = shallowRef(firstQuery)
    const query = scope.run(() =>
      useLiveInfiniteQuery(selectedQuery, { pageSize: 3 }),
    )
    cleanup = () => scope.stop()
    if (!query) throw new Error(`Failed to mount infinite query`)
    await flushVue()

    await query.fetchNextPage()
    await flushVue()
    expect(query.pages.value).toHaveLength(2)

    selectedQuery.value = secondQuery
    await flushVue()

    expect(query.collection.value).toBe(secondQuery)
    expect(query.pages.value).toHaveLength(1)
    expect(query.data.value.map((post) => post.createdAt)).toEqual([4, 3, 2])
  })
})
