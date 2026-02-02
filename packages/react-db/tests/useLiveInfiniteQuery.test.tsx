import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { createFilterFunctionFromExpression } from '../../db/src/collection/change-events'
import type { LoadSubsetOptions } from '@tanstack/db'

type Post = {
  id: string
  title: string
  content: string
  createdAt: number
  category: string
}

const createMockPosts = (count: number): Array<Post> => {
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
  it(`should fetch initial page of data`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `initial-page-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .select(({ posts: p }) => ({
              id: p.id,
              title: p.title,
              createdAt: p.createdAt,
            })),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Should have 1 page initially
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.pages[0]).toHaveLength(10)

    // Data should be flattened
    expect(result.current.data).toHaveLength(10)

    // Should have next page since we have 50 items total
    expect(result.current.hasNextPage).toBe(true)

    // First item should be Post 1 (most recent by createdAt)
    expect(result.current.pages[0]![0]).toMatchObject({
      id: `1`,
      title: `Post 1`,
    })
  })

  it(`should fetch multiple pages`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `multiple-pages-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Initially 1 page
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.hasNextPage).toBe(true)

    // Fetch next page
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    expect(result.current.pages[0]).toHaveLength(10)
    expect(result.current.pages[1]).toHaveLength(10)
    expect(result.current.data).toHaveLength(20)
    expect(result.current.hasNextPage).toBe(true)

    // Fetch another page
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(3)
    })

    expect(result.current.data).toHaveLength(30)
    expect(result.current.hasNextPage).toBe(true)
  })

  it(`should detect when no more pages available`, async () => {
    const posts = createMockPosts(25)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `no-more-pages-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Page 1: 10 items, has more
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.hasNextPage).toBe(true)

    // Fetch page 2
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    // Page 2: 10 items, has more
    expect(result.current.pages[1]).toHaveLength(10)
    expect(result.current.hasNextPage).toBe(true)

    // Fetch page 3
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(3)
    })

    // Page 3: 5 items, no more
    expect(result.current.pages[2]).toHaveLength(5)
    expect(result.current.data).toHaveLength(25)
    expect(result.current.hasNextPage).toBe(false)
  })

  it(`should handle empty results`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `empty-results-test`,
        getKey: (post: Post) => post.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // With no data, we still have 1 page (which is empty)
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.pages[0]).toHaveLength(0)
    expect(result.current.data).toHaveLength(0)
    expect(result.current.hasNextPage).toBe(false)
  })

  it(`should update pages when underlying data changes`, async () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `live-updates-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Fetch 2 pages
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    expect(result.current.data).toHaveLength(20)

    // Insert a new post with most recent timestamp
    act(() => {
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `new-1`,
          title: `New Post`,
          content: `New Content`,
          createdAt: 1000001, // Most recent
          category: `tech`,
        },
      })
      collection.utils.commit()
    })

    await waitFor(() => {
      // New post should be first
      expect(result.current.pages[0]![0]).toMatchObject({
        id: `new-1`,
        title: `New Post`,
      })
    })

    // Still showing 2 pages (20 items), but content has shifted
    // The new item is included, pushing the last item out of view
    expect(result.current.pages).toHaveLength(2)
    expect(result.current.data).toHaveLength(20)
    expect(result.current.pages[0]).toHaveLength(10)
    expect(result.current.pages[1]).toHaveLength(10)
  })

  it(`should handle deletions across pages`, async () => {
    const posts = createMockPosts(25)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `deletions-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Fetch 2 pages
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    expect(result.current.data).toHaveLength(20)
    const firstItemId = result.current.data[0]!.id

    // Delete the first item
    act(() => {
      collection.utils.begin()
      collection.utils.write({
        type: `delete`,
        value: posts[0]!,
      })
      collection.utils.commit()
    })

    await waitFor(() => {
      // First item should have changed
      expect(result.current.data[0]!.id).not.toBe(firstItemId)
    })

    // Still showing 2 pages, each pulls from remaining 24 items
    // Page 1: items 0-9 (10 items)
    // Page 2: items 10-19 (10 items)
    // Total: 20 items (item 20-23 are beyond our loaded pages)
    expect(result.current.pages).toHaveLength(2)
    expect(result.current.data).toHaveLength(20)
    expect(result.current.pages[0]).toHaveLength(10)
    expect(result.current.pages[1]).toHaveLength(10)
  })

  it(`should handle deletion from partial page with descending order`, async () => {
    // Create only 5 items - fewer than the pageSize of 20
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `partial-page-deletion-desc-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 20,
          getNextPageParam: (lastPage) =>
            lastPage.length === 20 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Should have all 5 items on one page (partial page)
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.data).toHaveLength(5)
    expect(result.current.hasNextPage).toBe(false)

    // Verify the first item (most recent by createdAt descending)
    const firstItemId = result.current.data[0]!.id
    expect(firstItemId).toBe(`1`) // Post 1 has the highest createdAt

    // Delete the first item (the one that appears first in descending order)
    act(() => {
      collection.utils.begin()
      collection.utils.write({
        type: `delete`,
        value: posts[0]!, // Post 1
      })
      collection.utils.commit()
    })

    // The deleted item should disappear from the result
    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })

    // Verify the deleted item is no longer in the data
    expect(
      result.current.data.find((p) => p.id === firstItemId),
    ).toBeUndefined()

    // Verify the new first item is Post 2
    expect(result.current.data[0]!.id).toBe(`2`)

    // Still should have 1 page with 4 items
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.pages[0]).toHaveLength(4)
    expect(result.current.hasNextPage).toBe(false)
  })

  it(`should handle deletion from partial page with ascending order`, async () => {
    // Create only 5 items - fewer than the pageSize of 20
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `partial-page-deletion-asc-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `asc`), // ascending order
        {
          pageSize: 20,
          getNextPageParam: (lastPage) =>
            lastPage.length === 20 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Should have all 5 items on one page (partial page)
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.data).toHaveLength(5)
    expect(result.current.hasNextPage).toBe(false)

    // In ascending order, Post 5 has the lowest createdAt and appears first
    const firstItemId = result.current.data[0]!.id
    expect(firstItemId).toBe(`5`) // Post 5 has the lowest createdAt

    // Delete the first item (the one that appears first in ascending order)
    act(() => {
      collection.utils.begin()
      collection.utils.write({
        type: `delete`,
        value: posts[4]!, // Post 5 (index 4 in array)
      })
      collection.utils.commit()
    })

    // The deleted item should disappear from the result
    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })

    // Verify the deleted item is no longer in the data
    expect(
      result.current.data.find((p) => p.id === firstItemId),
    ).toBeUndefined()

    // Still should have 1 page with 4 items
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.pages[0]).toHaveLength(4)
    expect(result.current.hasNextPage).toBe(false)
  })

  it(`should work with where clauses`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `where-clause-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .where(({ posts: p }) => eq(p.category, `tech`))
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 5,
          getNextPageParam: (lastPage) =>
            lastPage.length === 5 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Should only have tech posts (every even ID)
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.pages[0]).toHaveLength(5)

    // All items should be tech category
    result.current.pages[0]!.forEach((post) => {
      expect(post.category).toBe(`tech`)
    })

    // Should have more pages
    expect(result.current.hasNextPage).toBe(true)

    // Fetch next page
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    expect(result.current.data).toHaveLength(10)
  })

  it(`should re-execute query when dependencies change`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `deps-change-test`,
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
            getNextPageParam: (lastPage) =>
              lastPage.length === 5 ? lastPage.length : undefined,
          },
          [category],
        )
      },
      { initialProps: { category: `tech` } },
    )

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Fetch 2 pages of tech posts
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    // Change category to life
    act(() => {
      rerender({ category: `life` })
    })

    await waitFor(() => {
      // Should reset to 1 page with life posts
      expect(result.current.pages).toHaveLength(1)
    })

    // All items should be life category
    result.current.pages[0]!.forEach((post) => {
      expect(post.category).toBe(`life`)
    })
  })

  it(`should track pageParams correctly`, async () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `page-params-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          initialPageParam: 0,
          getNextPageParam: (lastPage, _allPages, lastPageParam) =>
            lastPage.length === 10 ? lastPageParam + 1 : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.pageParams).toEqual([0])

    // Fetch next page
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pageParams).toEqual([0, 1])
    })

    // Fetch another page
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pageParams).toEqual([0, 1, 2])
    })
  })

  it(`should handle exact page size boundaries`, async () => {
    const posts = createMockPosts(20) // Exactly 2 pages
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `exact-boundary-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          // Better getNextPageParam that checks against total data available
          getNextPageParam: (lastPage, allPages) => {
            // If last page is not full, we're done
            if (lastPage.length < 10) return undefined
            // Check if we've likely loaded all data (this is a heuristic)
            // In a real app with backend, you'd check response metadata
            const totalLoaded = allPages.flat().length
            // If we have less than a full page left, no more pages
            return totalLoaded
          },
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.hasNextPage).toBe(true)

    // Fetch page 2
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    expect(result.current.pages[1]).toHaveLength(10)
    // With setWindow peek-ahead, we can now detect no more pages immediately
    // We request 21 items (2 * 10 + 1 peek) but only get 20, so we know there's no more
    expect(result.current.hasNextPage).toBe(false)

    // Verify total data
    expect(result.current.data).toHaveLength(20)
  })

  it(`should not fetch when already fetching`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `concurrent-fetch-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.pages).toHaveLength(1)

    // With sync data, all fetches complete immediately, so all 3 calls will succeed
    // The key is that they won't cause race conditions or errors
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(3)
    })

    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(4)
    })

    // All fetches should have succeeded
    expect(result.current.pages).toHaveLength(4)
    expect(result.current.data).toHaveLength(40)
  })

  it(`should not fetch when hasNextPage is false`, async () => {
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `no-fetch-when-done-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.hasNextPage).toBe(false)
    expect(result.current.pages).toHaveLength(1)

    // Try to fetch when there's no next page
    act(() => {
      result.current.fetchNextPage()
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should still have only 1 page
    expect(result.current.pages).toHaveLength(1)
  })

  it(`should support custom initialPageParam`, async () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `initial-param-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          initialPageParam: 100,
          getNextPageParam: (lastPage, _allPages, lastPageParam) =>
            lastPage.length === 10 ? lastPageParam + 1 : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.pageParams).toEqual([100])

    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pageParams).toEqual([100, 101])
    })
  })

  it(`should detect hasNextPage change when new items are synced`, async () => {
    // Start with exactly 20 items (2 pages)
    const posts = createMockPosts(20)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `sync-detection-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Load both pages
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    // Should have no next page (exactly 20 items, 2 full pages, peek returns nothing)
    expect(result.current.hasNextPage).toBe(false)
    expect(result.current.data).toHaveLength(20)

    // Add 5 more items to the collection
    act(() => {
      collection.utils.begin()
      for (let i = 0; i < 5; i++) {
        collection.utils.write({
          type: `insert`,
          value: {
            id: `new-${i}`,
            title: `New Post ${i}`,
            content: `Content ${i}`,
            createdAt: Date.now() + i,
            category: `tech`,
          },
        })
      }
      collection.utils.commit()
    })

    // Should now detect that there's a next page available
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
    })

    // Data should still be 20 items (we haven't fetched the next page yet)
    expect(result.current.data).toHaveLength(20)
    expect(result.current.pages).toHaveLength(2)

    // Fetch the next page
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(3)
    })

    // Third page should have the new items
    expect(result.current.pages[2]).toHaveLength(5)
    expect(result.current.data).toHaveLength(25)

    // No more pages available now
    expect(result.current.hasNextPage).toBe(false)
  })

  it(`should set isFetchingNextPage to false when data is immediately available`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `immediate-data-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Initially 1 page and not fetching
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.isFetchingNextPage).toBe(false)

    // Fetch next page - should remain false because data is immediately available
    act(() => {
      result.current.fetchNextPage()
    })

    // Since data is *synchronously* available, isFetchingNextPage should be false
    expect(result.current.pages).toHaveLength(2)
    expect(result.current.isFetchingNextPage).toBe(false)
  })

  it(`should request limit+1 (peek-ahead) from loadSubset for hasNextPage detection`, async () => {
    // Verifies that useLiveInfiniteQuery requests pageSize+1 items from loadSubset
    // to detect whether there are more pages available (peek-ahead strategy)
    const PAGE_SIZE = 10
    const allPosts = createMockPosts(PAGE_SIZE) // Exactly PAGE_SIZE posts

    // Track all loadSubset calls to inspect the limit parameter
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Post>({
      id: `peek-ahead-limit-test`,
      getKey: (post: Post) => post.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          markReady()

          return {
            loadSubset: (opts: LoadSubsetOptions) => {
              // Record the call for later inspection
              loadSubsetCalls.push({ ...opts })

              // Return posts based on limit
              const postsToReturn = opts.limit
                ? allPosts.slice(0, opts.limit)
                : allPosts

              begin()
              for (const post of postsToReturn) {
                write({
                  type: `insert`,
                  value: post,
                })
              }
              commit()

              return true // Synchronous load
            },
          }
        },
      },
    })

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: PAGE_SIZE,
          getNextPageParam: (lastPage) =>
            lastPage.length === PAGE_SIZE ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Find the loadSubset call with a limit (the initial page load)
    const callWithLimit = loadSubsetCalls.find(
      (call) => call.limit !== undefined,
    )
    expect(callWithLimit).toBeDefined()
    expect(callWithLimit!.limit).toBe(PAGE_SIZE + 1)

    // With exactly PAGE_SIZE posts, hasNextPage should be false (no peek-ahead item returned)
    expect(result.current.hasNextPage).toBe(false)
    expect(result.current.data).toHaveLength(PAGE_SIZE)
  })

  it(`should work with on-demand collection and fetch multiple pages`, async () => {
    // This test verifies end-to-end behavior of useLiveInfiniteQuery with an
    // on-demand collection. The loadSubset function simulates a backend that
    // returns data incrementally based on the request.
    const PAGE_SIZE = 10
    const allPosts = createMockPosts(25) // 25 posts = 2 full pages + 5 items

    const collection = createCollection<Post>({
      id: `on-demand-e2e-test`,
      getKey: (post: Post) => post.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          markReady()

          return {
            loadSubset: (opts: LoadSubsetOptions) => {
              // Sort by createdAt descending (matching the query's orderBy)
              let filtered = [...allPosts].sort(
                (a, b) => b.createdAt - a.createdAt,
              )

              // Handle cursor-based pagination
              if (opts.cursor) {
                const { whereFrom } = opts.cursor
                const whereFromFn =
                  createFilterFunctionFromExpression(whereFrom)
                filtered = filtered.filter(whereFromFn)
              }

              // Apply limit
              if (opts.limit !== undefined) {
                filtered = filtered.slice(0, opts.limit)
              }

              begin()
              for (const post of filtered) {
                write({
                  type: `insert`,
                  value: post,
                })
              }
              commit()

              return true // Synchronous load
            },
          }
        },
      },
    })

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: PAGE_SIZE,
          getNextPageParam: (lastPage) =>
            lastPage.length === PAGE_SIZE ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Page 1: 10 items, hasNextPage should be true (25 total items)
    expect(result.current.pages).toHaveLength(1)
    expect(result.current.data).toHaveLength(PAGE_SIZE)
    expect(result.current.hasNextPage).toBe(true)

    // Verify first page has correct items (posts 1-10, sorted by createdAt desc)
    expect(result.current.data[0]!.id).toBe(`1`)
    expect(result.current.data[9]!.id).toBe(`10`)

    // Fetch page 2
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(2)
    })

    // Page 2: should have 20 items total, hasNextPage should be true
    expect(result.current.data).toHaveLength(20)
    expect(result.current.hasNextPage).toBe(true)

    // Verify second page has correct items (posts 11-20)
    expect(result.current.pages[1]![0]!.id).toBe(`11`)
    expect(result.current.pages[1]![9]!.id).toBe(`20`)

    // Fetch page 3 (partial page)
    act(() => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(3)
    })

    // Page 3: should have 25 items total (5 on last page), hasNextPage should be false
    expect(result.current.data).toHaveLength(25)
    expect(result.current.pages[2]).toHaveLength(5)
    expect(result.current.hasNextPage).toBe(false)

    // Verify third page has correct items (posts 21-25)
    expect(result.current.pages[2]![0]!.id).toBe(`21`)
    expect(result.current.pages[2]![4]!.id).toBe(`25`)
  })

  it(`should track isFetchingNextPage when async loading is triggered`, async () => {
    // Define all data upfront
    const allPosts = createMockPosts(30)

    const collection = createCollection<Post>({
      id: `async-loading-test`,
      getKey: (post: Post) => post.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          // Provide initial data by slicing the first 15 elements
          begin()
          const initialPosts = allPosts.slice(0, 15)
          for (const post of initialPosts) {
            write({
              type: `insert`,
              value: post,
            })
          }
          commit()
          markReady()

          return {
            loadSubset: (opts: LoadSubsetOptions) => {
              // Filter the data array based on opts
              let filtered = allPosts

              // Apply where clause if provided
              if (opts.where) {
                const filterFn = createFilterFunctionFromExpression(opts.where)
                filtered = filtered.filter(filterFn)
              }

              // Sort by createdAt descending if orderBy is provided
              if (opts.orderBy && opts.orderBy.length > 0) {
                filtered = filtered.sort((a, b) => {
                  // We know ordering is always by createdAt descending
                  return b.createdAt - a.createdAt
                })
              }

              // Apply cursor expressions if present (new cursor-based pagination)
              if (opts.cursor) {
                const { whereFrom, whereCurrent } = opts.cursor
                try {
                  const whereFromFn =
                    createFilterFunctionFromExpression(whereFrom)
                  const fromData = filtered.filter(whereFromFn)

                  const whereCurrentFn =
                    createFilterFunctionFromExpression(whereCurrent)
                  const currentData = filtered.filter(whereCurrentFn)

                  // Combine current (ties) with from (next page), deduplicate
                  const seenIds = new Set<string>()
                  filtered = []
                  for (const item of currentData) {
                    if (!seenIds.has(item.id)) {
                      seenIds.add(item.id)
                      filtered.push(item)
                    }
                  }
                  // Apply limit only to fromData
                  const limitedFromData = opts.limit
                    ? fromData.slice(0, opts.limit)
                    : fromData
                  for (const item of limitedFromData) {
                    if (!seenIds.has(item.id)) {
                      seenIds.add(item.id)
                      filtered.push(item)
                    }
                  }
                  // Re-sort after combining
                  filtered.sort((a, b) => b.createdAt - a.createdAt)
                } catch {
                  // Fallback to original filtered if cursor parsing fails
                }
              } else if (opts.limit !== undefined) {
                // Apply limit only if no cursor (cursor handles limit internally)
                filtered = filtered.slice(0, opts.limit)
              }

              // Subsequent calls simulate async loading with a real timeout
              const loadPromise = new Promise<void>((resolve) => {
                setTimeout(() => {
                  begin()

                  // Insert the requested posts
                  for (const post of filtered) {
                    write({
                      type: `insert`,
                      value: post,
                    })
                  }

                  commit()
                  resolve()
                }, 50)
              })

              return loadPromise
            },
          }
        },
      },
    })

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Wait for initial window setup to complete
    await waitFor(() => {
      expect(result.current.isFetchingNextPage).toBe(false)
    })

    expect(result.current.pages).toHaveLength(1)

    // Fetch next page which will trigger async loading
    act(() => {
      result.current.fetchNextPage()
    })

    // Should be fetching now and so isFetchingNextPage should be true *synchronously!*
    expect(result.current.isFetchingNextPage).toBe(true)

    // Wait for loading to complete
    await waitFor(
      () => {
        expect(result.current.isFetchingNextPage).toBe(false)
      },
      { timeout: 200 },
    )

    // Should have 2 pages now
    expect(result.current.pages).toHaveLength(2)
    expect(result.current.data).toHaveLength(20)
  }, 10000)

  describe(`pre-created collections`, () => {
    it(`should accept pre-created live query collection`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `pre-created-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(5), // Initial limit
      })

      await liveQueryCollection.preload()

      const { result } = renderHook(() => {
        return useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      })

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Should have 1 page initially
      expect(result.current.pages).toHaveLength(1)
      expect(result.current.pages[0]).toHaveLength(10)
      expect(result.current.data).toHaveLength(10)
      expect(result.current.hasNextPage).toBe(true)

      // First item should be Post 1 (most recent by createdAt)
      expect(result.current.pages[0]![0]).toMatchObject({
        id: `1`,
        title: `Post 1`,
      })
    })

    it(`should fetch multiple pages with pre-created collection`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `pre-created-multi-page-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      await liveQueryCollection.preload()

      const { result } = renderHook(() => {
        return useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      })

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.pages).toHaveLength(1)
      expect(result.current.hasNextPage).toBe(true)

      // Fetch next page
      act(() => {
        result.current.fetchNextPage()
      })

      await waitFor(() => {
        expect(result.current.pages).toHaveLength(2)
      })

      expect(result.current.pages[0]).toHaveLength(10)
      expect(result.current.pages[1]).toHaveLength(10)
      expect(result.current.data).toHaveLength(20)
      expect(result.current.hasNextPage).toBe(true)
    })

    it(`should reset pagination when collection instance changes`, async () => {
      const posts1 = createMockPosts(30)
      const collection1 = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `pre-created-reset-1`,
          getKey: (post: Post) => post.id,
          initialData: posts1,
        }),
      )

      const liveQueryCollection1 = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection1 })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      await liveQueryCollection1.preload()

      const posts2 = createMockPosts(40)
      const collection2 = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `pre-created-reset-2`,
          getKey: (post: Post) => post.id,
          initialData: posts2,
        }),
      )

      const liveQueryCollection2 = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection2 })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      await liveQueryCollection2.preload()

      const { result, rerender } = renderHook(
        ({ coll }: { coll: any }) => {
          return useLiveInfiniteQuery(coll, {
            pageSize: 10,
            getNextPageParam: (lastPage) =>
              lastPage.length === 10 ? lastPage.length : undefined,
          })
        },
        { initialProps: { coll: liveQueryCollection1 } },
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Fetch 2 pages
      act(() => {
        result.current.fetchNextPage()
      })

      await waitFor(() => {
        expect(result.current.pages).toHaveLength(2)
      })

      expect(result.current.data).toHaveLength(20)

      // Switch to second collection
      act(() => {
        rerender({ coll: liveQueryCollection2 })
      })

      await waitFor(() => {
        // Should reset to 1 page
        expect(result.current.pages).toHaveLength(1)
      })

      expect(result.current.data).toHaveLength(10)
    })

    it(`should throw error if collection lacks orderBy`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `no-orderby-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      // Create collection WITHOUT orderBy
      const liveQueryCollection = createLiveQueryCollection({
        query: (q) => q.from({ posts: collection }),
      })

      await liveQueryCollection.preload()

      // Should throw error when trying to use it with useLiveInfiniteQuery
      expect(() => {
        renderHook(() => {
          return useLiveInfiniteQuery(liveQueryCollection, {
            pageSize: 10,
            getNextPageParam: (lastPage) =>
              lastPage.length === 10 ? lastPage.length : undefined,
          })
        })
      }).toThrow(/ORDER BY/)
    })

    it(`should throw error if first argument is not a collection or function`, () => {
      // Should throw error when passing invalid types
      expect(() => {
        renderHook(() => {
          return useLiveInfiniteQuery(`not a collection or function` as any, {
            pageSize: 10,
            getNextPageParam: (lastPage) =>
              lastPage.length === 10 ? lastPage.length : undefined,
          })
        })
      }).toThrow(/must be either a pre-created live query collection/)

      expect(() => {
        renderHook(() => {
          return useLiveInfiniteQuery(123 as any, {
            pageSize: 10,
            getNextPageParam: (lastPage) =>
              lastPage.length === 10 ? lastPage.length : undefined,
          })
        })
      }).toThrow(/must be either a pre-created live query collection/)

      expect(() => {
        renderHook(() => {
          return useLiveInfiniteQuery(null as any, {
            pageSize: 10,
            getNextPageParam: (lastPage) =>
              lastPage.length === 10 ? lastPage.length : undefined,
          })
        })
      }).toThrow(/must be either a pre-created live query collection/)
    })

    it(`should work correctly even if pre-created collection has different initial limit`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `mismatched-window-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(5) // Different from pageSize
            .offset(0),
      })

      await liveQueryCollection.preload()

      const { result } = renderHook(() => {
        return useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10, // Different from the initial limit of 5
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      })

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Should work correctly despite different initial limit
      // The window will be adjusted to match pageSize
      expect(result.current.pages).toHaveLength(1)
      expect(result.current.pages[0]).toHaveLength(10)
      expect(result.current.data).toHaveLength(10)
      expect(result.current.hasNextPage).toBe(true)
    })

    it(`should handle live updates with pre-created collection`, async () => {
      const posts = createMockPosts(30)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `pre-created-live-updates-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      await liveQueryCollection.preload()

      const { result } = renderHook(() => {
        return useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      })

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Fetch 2 pages
      act(() => {
        result.current.fetchNextPage()
      })

      await waitFor(() => {
        expect(result.current.pages).toHaveLength(2)
      })

      expect(result.current.data).toHaveLength(20)

      // Insert a new post with most recent timestamp
      act(() => {
        collection.utils.begin()
        collection.utils.write({
          type: `insert`,
          value: {
            id: `new-1`,
            title: `New Post`,
            content: `New Content`,
            createdAt: 1000001, // Most recent
            category: `tech`,
          },
        })
        collection.utils.commit()
      })

      await waitFor(() => {
        // New post should be first
        expect(result.current.pages[0]![0]).toMatchObject({
          id: `new-1`,
          title: `New Post`,
        })
      })

      // Still showing 2 pages (20 items), but content has shifted
      expect(result.current.pages).toHaveLength(2)
      expect(result.current.data).toHaveLength(20)
    })

    it(`should work with router loader pattern (preloaded collection)`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `router-loader-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      // Simulate router loader: create and preload collection
      const loaderQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(20),
      })

      // Preload in loader
      await loaderQuery.preload()

      // Simulate component receiving preloaded collection
      const { result } = renderHook(() => {
        return useLiveInfiniteQuery(loaderQuery, {
          pageSize: 20,
          getNextPageParam: (lastPage) =>
            lastPage.length === 20 ? lastPage.length : undefined,
        })
      })

      // Should be immediately ready since it was preloaded
      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.pages).toHaveLength(1)
      expect(result.current.pages[0]).toHaveLength(20)
      expect(result.current.data).toHaveLength(20)
      expect(result.current.hasNextPage).toBe(true)

      // Can still fetch more pages
      act(() => {
        result.current.fetchNextPage()
      })

      await waitFor(() => {
        expect(result.current.pages).toHaveLength(2)
      })

      expect(result.current.data).toHaveLength(40)
    })
  })
})
