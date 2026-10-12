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
  it(`reclaims a query-function collection abandoned before it commits`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `abandoned-infinite-query`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
        // Reclaimed as soon as nothing holds it.
        gcTime: 1,
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

    // Like useLiveQuery, the hook starts sync during render. The render asks
    // for no data, but its collection holds the source until GC reclaims it.
    expect(source.subscriberCount).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(source.status).not.toBe(`cleaned-up`)
    await waitFor(() => expect(source.status).toBe(`cleaned-up`))
    rendered.unmount()
  })

  it(`reclaims a supplied collection that an abandoned render started`, async () => {
    // Like useLiveQuery, the hook starts a supplied collection with eager
    // sources during render, so its first paint is ready. The supplied
    // collection's own gcTime reclaims a render that never commits. #1675 kept
    // supplied collections idle until commit; that rule caused the empty first
    // render in #2023 and was reversed by decision to match useLiveQuery.
    // A supplied window wider than the hook needs, but finite, waits for
    // commit so it never requests extra rows: see the shared
    // on-demand-collection-window scenario.
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `abandoned-supplied-infinite-query`,
        getKey: (post) => post.id,
        initialData: createMockPosts(10),
        // Reclaimed as soon as nothing holds it.
        gcTime: 1,
      }),
    )
    const liveQuery = createLiveQueryCollection({
      query: (q) =>
        q.from({ post: source }).orderBy(({ post }) => post.createdAt, `desc`),
      gcTime: 1,
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

    expect(source.subscriberCount).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(source.status).not.toBe(`cleaned-up`)
    await waitFor(() => expect(source.status).toBe(`cleaned-up`))
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
          fetchNextPage: () => Promise<void>
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

  it(`resolves the fetch promise and exposes pagination failures in state`, async () => {
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

    let request!: Promise<void>
    act(() => {
      request = result.current.fetchNextPage()
    })
    await act(async () => {
      await expect(request).resolves.toBeUndefined()
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
      expect(result.current.error).toBe(failure)
      expect(result.current.isFetchingNextPage).toBe(false)
    })
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.hasNextPage).toBe(true)
  })

  it(`should derive query identity from structured captured values`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `derived-identity-change-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result, rerender } = renderHook(
      ({ category }: { category: string }) => {
        return useLiveInfiniteQuery(
          (q) =>
            q
              .from({ posts: collection })
              .where(({ posts: p }) => eq(p.category, category))
              .orderBy(({ posts: p }) => p.createdAt, `desc`),
          {
            pageSize: 5,
          },
        )
      },
      { initialProps: { category: `tech` } },
    )

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    act(() => {
      rerender({ category: `life` })
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(1)
    })

    result.current.pages[0]!.forEach((post) => {
      expect(post.category).toBe(`life`)
    })
  })

  it(`uses structural queryKey identity without rerunning a stable query`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `infinite-query-key-identity`,
        getKey: (post) => post.id,
        initialData: createMockPosts(20),
      }),
    )
    let queryExecutions = 0

    const { result, rerender } = renderHook(
      ({ filter }: { filter: { category: string } }) =>
        useLiveInfiniteQuery(
          (q) => {
            queryExecutions += 1
            return q
              .from({ post: source })
              .where(({ post }) => eq(post.category, filter.category))
              .orderBy(({ post }) => post.createdAt, `desc`)
          },
          {
            pageSize: 2,
            queryKey: [source.id, `category`, filter],
          },
        ),
      { initialProps: { filter: { category: `tech` } } },
    )

    await waitFor(() => expect(result.current.isReady).toBe(true))
    const firstCollection = result.current.collection
    expect(queryExecutions).toBe(1)

    rerender({ filter: { category: `tech` } })

    expect(result.current.collection).toBe(firstCollection)
    expect(queryExecutions).toBe(1)

    rerender({ filter: { category: `life` } })

    await waitFor(() => {
      expect(result.current.collection).not.toBe(firstCollection)
      expect(
        result.current.data.every((post) => post.category === `life`),
      ).toBe(true)
    })
    expect(queryExecutions).toBe(2)
  })

  it(`uses queryKey to make captured values in opaque queries reactive`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `infinite-opaque-query-key`,
        getKey: (post) => post.id,
        initialData: createMockPosts(20),
      }),
    )
    const { result, rerender } = renderHook(
      ({ category }: { category: string }) =>
        useLiveInfiniteQuery(
          (q) =>
            q
              .from({ post: source })
              .fn.where(({ post }) => post.category === category)
              .orderBy(({ post }) => post.createdAt, `desc`),
          {
            pageSize: 2,
            queryKey: [source.id, `category-fn`, category],
          },
        ),
      { initialProps: { category: `tech` } },
    )

    await waitFor(() => {
      expect(result.current.data.length).toBeGreaterThan(0)
      expect(
        result.current.data.every((post) => post.category === `tech`),
      ).toBe(true)
    })
    const firstCollection = result.current.collection

    rerender({ category: `life` })

    await waitFor(() => {
      expect(result.current.collection).not.toBe(firstCollection)
      expect(result.current.data.length).toBeGreaterThan(0)
      expect(
        result.current.data.every((post) => post.category === `life`),
      ).toBe(true)
    })
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

  it(`preserves loaded pages when dependencies are structurally unchanged`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `infinite-query-structurally-equal-deps`,
        getKey: (post) => post.id,
        initialData: createMockPosts(20),
      }),
    )
    const { result, rerender } = renderHook(
      ({ filter }: { filter: { category: string } }) =>
        useLiveInfiniteQuery(
          (q) =>
            q
              .from({ post: source })
              .where(({ post }) => eq(post.category, filter.category))
              .orderBy(({ post }) => post.createdAt, `desc`),
          { pageSize: 2 },
          [filter],
        ),
      { initialProps: { filter: { category: `tech` } } },
    )

    await waitFor(() => expect(result.current.isReady).toBe(true))
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.pages).toHaveLength(2))
    const firstCollection = result.current.collection

    rerender({ filter: { category: `tech` } })

    await waitFor(() => {
      expect(result.current.collection).not.toBe(firstCollection)
      expect(result.current.isReady).toBe(true)
    })
    expect(result.current.pages).toHaveLength(2)
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
