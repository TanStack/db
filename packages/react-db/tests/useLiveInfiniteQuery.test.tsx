import { describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from '@tanstack/db'
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

  it(`preserves committed pages across an abandoned dependency update`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `abandoned-infinite-query-update`,
        getKey: (post) => post.id,
        initialData: createMockPosts(20),
      }),
    )
    const never = new Promise<void>(() => {})
    let shouldSuspend = false
    let current:
      | {
          isReady: boolean
          pages: Array<Array<unknown>>
          fetchNextPage: () => void
        }
      | undefined

    function Query({ minimum }: { minimum: number }): ReactNode {
      current = useLiveInfiniteQuery(
        (q) =>
          q
            .from({ post: source })
            .where(({ post }) => gt(post.createdAt, minimum))
            .orderBy(({ post }) => post.createdAt, `desc`),
        { pageSize: 3 },
        [minimum],
      )
      if (shouldSuspend) throw never
      return null
    }

    function App({ minimum }: { minimum: number }): ReactNode {
      return (
        <Suspense fallback={null}>
          <Query minimum={minimum} />
        </Suspense>
      )
    }

    const rendered = render(<App minimum={0} />)
    await waitFor(() => expect(current?.isReady).toBe(true))
    await act(async () => {
      await current!.fetchNextPage()
      await current!.fetchNextPage()
    })
    expect(current?.pages.map((page) => page.length)).toEqual([3, 3, 3])

    shouldSuspend = true
    rendered.rerender(<App minimum={5} />)
    await Promise.resolve()

    shouldSuspend = false
    rendered.rerender(<App minimum={0} />)
    await waitFor(() => expect(current?.isReady).toBe(true))
    expect(current?.pages.map((page) => page.length)).toEqual([3, 3, 3])
    rendered.unmount()
  })

  it(`recognizes a structurally valid collection from another realm`, () => {
    const foreignCollection = {
      id: `foreign-live-query`,
      subscribeChanges: () => () => {},
      startSyncImmediate: () => {},
      utils: {
        setWindow: () => true as const,
        getWindow: () => undefined,
      },
    }

    expect(() =>
      renderHook(() =>
        useLiveInfiniteQuery(foreignCollection as any, { pageSize: 3 }),
      ),
    ).toThrow(/orderBy/)
  })

  it(`exposes pagination failures without an unhandled rejection`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `infinite-query-pagination-failure`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
      }),
    )
    const query = createLiveQueryCollection({
      query: (q) =>
        q.from({ post: source }).orderBy(({ post }) => post.createdAt, `desc`),
    })
    const { result } = renderHook(() =>
      useLiveInfiniteQuery(query, { pageSize: 2 }),
    )

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
      expect(result.current.hasNextPage).toBe(true)
    })

    const failure = new Error(`window load failed`)
    vi.spyOn(query.utils, `setWindow`).mockRejectedValueOnce(failure)

    act(() => {
      void result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
      expect(result.current.error).toBe(failure)
      expect(result.current.isFetchingNextPage).toBe(false)
    })
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.hasNextPage).toBe(true)
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
