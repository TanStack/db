import { describe, expect, it } from 'vitest'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

type Post = {
  id: string
  title: string
  content: string
  createdAt: number
  category: string
}

function createMockPosts(count: number): Array<Post> {
  const posts: Array<Post> = []
  for (let i = 1; i <= count; i++) {
    posts.push({
      id: `${i}`,
      title: `Post ${i}`,
      content: `Content ${i}`,
      createdAt: 1000000 - i * 1000, // Descending order
      category: i % 2 === 0 ? `tech` : `life`,
    })
  }
  return posts
}

describe(`useLiveInfiniteQuery`, () => {
  it(`does not activate a query-function collection for an abandoned render`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `abandoned-infinite-query`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
      }),
    )
    const never = new Promise<void>(() => {})

    function AbandonedQuery(): ReactNode {
      useLiveInfiniteQuery(
        (q) =>
          q
            .from({ post: source })
            .orderBy(({ post }) => post.createdAt, `desc`),
        { pageSize: 3 },
      )
      throw never
    }

    const rendered = render(
      <Suspense fallback={null}>
        <AbandonedQuery />
      </Suspense>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(source.subscriberCount).toBe(0)
    rendered.unmount()
  })

  it(`does not activate a supplied collection for an abandoned render`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `abandoned-supplied-infinite-query`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
      }),
    )
    const liveQuery = createLiveQueryCollection({
      query: (q) =>
        q.from({ post: source }).orderBy(({ post }) => post.createdAt, `desc`),
    })
    const never = new Promise<void>(() => {})

    function AbandonedQuery(): ReactNode {
      useLiveInfiniteQuery(liveQuery, { pageSize: 3 })
      throw never
    }

    const rendered = render(
      <Suspense fallback={null}>
        <AbandonedQuery />
      </Suspense>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(source.subscriberCount).toBe(0)
    rendered.unmount()
  })

  it(`compares dependencies by identity instead of serialization`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `infinite-query-map-deps`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
      }),
    )
    const { result, rerender } = renderHook(
      ({ filter }: { filter: Map<string, string> }) =>
        useLiveInfiniteQuery(
          (q) =>
            q
              .from({ post: source })
              .where(({ post }) => eq(post.category, filter.get(`category`)))
              .orderBy(({ post }) => post.createdAt, `desc`),
          { pageSize: 3 },
          [filter],
        ),
      {
        initialProps: {
          filter: new Map([[`category`, `tech`]]),
        },
      },
    )

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
      expect(result.current.data.length).toBeGreaterThan(0)
      expect(
        result.current.data.every((post) => post.category === `tech`),
      ).toBe(true)
    })

    rerender({ filter: new Map([[`category`, `life`]]) })

    await waitFor(() => {
      expect(result.current.data.length).toBeGreaterThan(0)
      expect(
        result.current.data.every((post) => post.category === `life`),
      ).toBe(true)
    })
  })

  it(`releases a replaced controller through the external-store unsubscribe`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `infinite-query-controller-replacement`,
        getKey: (post) => post.id,
        initialData: createMockPosts(20),
      }),
    )
    const query = createLiveQueryCollection({
      query: (q) =>
        q.from({ post: source }).orderBy(({ post }) => post.createdAt, `desc`),
    })
    const { result, rerender, unmount } = renderHook(
      ({ pageSize }) => useLiveInfiniteQuery(query, { pageSize }),
      { initialProps: { pageSize: 2 } },
    )

    await waitFor(() => expect(result.current.isReady).toBe(true))
    expect(query.subscriberCount).toBe(1)

    rerender({ pageSize: 3 })
    await waitFor(() => expect(result.current.pages[0]).toHaveLength(3))
    expect(query.subscriberCount).toBe(1)

    unmount()
    expect(query.subscriberCount).toBe(0)
  })

  it(`binds fetchNextPage to the controller that returned it`, async () => {
    const sourceA = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `infinite-query-generation-a`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
      }),
    )
    const sourceB = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `infinite-query-generation-b`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
      }),
    )
    const queryA = createLiveQueryCollection({
      query: (q) =>
        q.from({ post: sourceA }).orderBy(({ post }) => post.createdAt, `desc`),
    })
    const queryB = createLiveQueryCollection({
      query: (q) =>
        q.from({ post: sourceB }).orderBy(({ post }) => post.createdAt, `desc`),
    })
    const { result, rerender } = renderHook(
      ({ query }) => useLiveInfiniteQuery(query, { pageSize: 2 }),
      { initialProps: { query: queryA } },
    )

    await waitFor(() => expect(result.current.isReady).toBe(true))
    const fetchFromA = result.current.fetchNextPage

    rerender({ query: queryB })
    await waitFor(() => {
      expect(result.current.collection).toBe(queryB)
      expect(result.current.isReady).toBe(true)
      expect(result.current.pages).toHaveLength(1)
    })

    act(() => {
      void fetchFromA()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.pages).toHaveLength(1)

    act(() => {
      void result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.pages).toHaveLength(2))
  })
})
