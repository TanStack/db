import { describe, expect, it } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createCollection, eq } from "@tanstack/db"
import { useLiveInfiniteQuery } from "../src/useLiveInfiniteQuery"
import { mockSyncCollectionOptions } from "../../db/tests/utils"

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
      })
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
        }
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
      })
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
        }
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
      })
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
        }
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
      })
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
        }
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
      })
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
        }
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
      })
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
        }
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

  it(`should work with where clauses`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `where-clause-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      })
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
        }
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
      })
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
          [category]
        )
      },
      { initialProps: { category: `tech` } }
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
      })
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
          getNextPageParam: (lastPage, allPages, lastPageParam) =>
            lastPage.length === 10 ? lastPageParam + 1 : undefined,
        }
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
      })
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
        }
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
      })
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
        }
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
      })
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
        }
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
      })
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
          getNextPageParam: (lastPage, allPages, lastPageParam) =>
            lastPage.length === 10 ? lastPageParam + 1 : undefined,
        }
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
      })
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
        }
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
      })
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
        }
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

  it(`should track isFetchingNextPage when async loading is triggered`, async () => {
    let loadSubsetCallCount = 0

    const collection = createCollection<Post>({
      id: `async-loading-test`,
      getKey: (post: Post) => post.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          // Provide initial data
          begin()
          for (let i = 1; i <= 15; i++) {
            write({
              type: `insert`,
              value: {
                id: `${i}`,
                title: `Post ${i}`,
                content: `Content ${i}`,
                createdAt: 1000000 - i * 1000,
                category: i % 2 === 0 ? `tech` : `life`,
              },
            })
          }
          commit()
          markReady()

          return {
            loadSubset: () => {
              loadSubsetCallCount++

              // First few calls return true (initial load + window setup)
              if (loadSubsetCallCount <= 2) {
                return true
              }

              // Subsequent calls simulate async loading with a real timeout
              const loadPromise = new Promise<void>((resolve) => {
                setTimeout(() => {
                  begin()
                  // Load more data
                  for (let i = 16; i <= 30; i++) {
                    write({
                      type: `insert`,
                      value: {
                        id: `${i}`,
                        title: `Post ${i}`,
                        content: `Content ${i}`,
                        createdAt: 1000000 - i * 1000,
                        category: i % 2 === 0 ? `tech` : `life`,
                      },
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
        }
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
      { timeout: 200 }
    )

    // Should have 2 pages now
    expect(result.current.pages).toHaveLength(2)
    expect(result.current.data).toHaveLength(20)
  }, 10000)
})
