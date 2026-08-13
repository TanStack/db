import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
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

  it(`does not recreate a controller through a retained callback after unmount`, async () => {
    const posts = createPostsCollection(`vue-infinite-retained-fetch`, 7)
    let queryBuilds = 0
    const scope = effectScope()
    const query = scope.run(() =>
      useLiveInfiniteQuery(
        (q: InitialQueryBuilder) => {
          queryBuilds++
          return q
            .from({ posts })
            .orderBy(({ posts: post }) => post.createdAt, `desc`)
        },
        { pageSize: 3 },
      ),
    )
    if (!query) throw new Error(`Failed to mount infinite query`)
    await flushVue()
    expect(queryBuilds).toBe(1)

    const retainedFetch = query.fetchNextPage
    scope.stop()
    await retainedFetch()
    await retainedFetch()

    expect(queryBuilds).toBe(1)
  })
})
