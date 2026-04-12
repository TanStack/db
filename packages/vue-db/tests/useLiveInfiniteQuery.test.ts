import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
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

type OnDemandCollectionOptions = {
  id: string
  allPosts: Array<Post>
  autoIndex?: `off` | `eager`
  asyncDelay?: number
}

const createOnDemandCollection = (opts: OnDemandCollectionOptions) => {
  const loadSubsetCalls: Array<LoadSubsetOptions> = []
  const { id, allPosts, autoIndex, asyncDelay } = opts

  const collection = createCollection<Post>({
    id,
    getKey: (post: Post) => post.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: autoIndex ?? `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ markReady, begin, write, commit }) => {
        markReady()

        return {
          loadSubset: (subsetOpts: LoadSubsetOptions) => {
            loadSubsetCalls.push({ ...subsetOpts })

            let filtered = [...allPosts].sort(
              (a, b) => b.createdAt - a.createdAt,
            )

            if (subsetOpts.cursor) {
              const whereFromFn = createFilterFunctionFromExpression(
                subsetOpts.cursor.whereFrom,
              )
              filtered = filtered.filter(whereFromFn)
            }

            if (subsetOpts.limit !== undefined) {
              filtered = filtered.slice(0, subsetOpts.limit)
            }

            const writeAll = (): void => {
              begin()
              for (const post of filtered) {
                write({ type: `insert`, value: post })
              }
              commit()
            }

            if (asyncDelay !== undefined) {
              return new Promise<void>((resolve) => {
                setTimeout(() => {
                  writeAll()
                  resolve()
                }, asyncDelay)
              })
            }

            writeAll()
            return true
          },
        }
      },
    },
  })

  return { collection, loadSubsetCalls }
}

async function waitForVueUpdate() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

async function waitFor(fn: () => void, timeout = 2000, interval = 20) {
  const start = Date.now()

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    try {
      fn()
      return
    } catch (err) {
      if (Date.now() - start > timeout) throw err
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }
}

describe(`useLiveInfiniteQuery`, () => {
  it(`should fetch initial page of data`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-initial-page-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.pages.value[0]).toHaveLength(10)
    expect(result.data.value).toHaveLength(10)
    expect(result.hasNextPage.value).toBe(true)

    expect(result.pages.value[0]![0]).toMatchObject({
      id: `1`,
      title: `Post 1`,
    })
  })

  it(`should fetch multiple pages`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-multiple-pages-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.hasNextPage.value).toBe(true)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(result.pages.value[0]).toHaveLength(10)
    expect(result.pages.value[1]).toHaveLength(10)
    expect(result.data.value).toHaveLength(20)
    expect(result.hasNextPage.value).toBe(true)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(3)
    })

    expect(result.data.value).toHaveLength(30)
    expect(result.hasNextPage.value).toBe(true)
  })

  it(`should detect when no more pages available`, async () => {
    const posts = createMockPosts(25)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-no-more-pages-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.hasNextPage.value).toBe(true)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(result.pages.value[1]).toHaveLength(10)
    expect(result.hasNextPage.value).toBe(true)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(3)
    })

    expect(result.pages.value[2]).toHaveLength(5)
    expect(result.data.value).toHaveLength(25)
    expect(result.hasNextPage.value).toBe(false)
  })

  it(`should handle empty results`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-empty-results-test`,
        getKey: (post: Post) => post.id,
        initialData: [],
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.pages.value[0]).toHaveLength(0)
    expect(result.data.value).toHaveLength(0)
    expect(result.hasNextPage.value).toBe(false)
  })

  it(`should update pages when underlying data changes`, async () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-live-updates-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(result.data.value).toHaveLength(20)

    collection.utils.begin()
    collection.utils.write({
      type: `insert`,
      value: {
        id: `new-1`,
        title: `New Post`,
        content: `New Content`,
        createdAt: 1000001,
        category: `tech`,
      },
    })
    collection.utils.commit()

    await waitFor(() => {
      expect(result.pages.value[0]![0]).toMatchObject({
        id: `new-1`,
        title: `New Post`,
      })
    })

    expect(result.pages.value).toHaveLength(2)
    expect(result.data.value).toHaveLength(20)
    expect(result.pages.value[0]).toHaveLength(10)
    expect(result.pages.value[1]).toHaveLength(10)
  })

  it(`should handle deletions across pages`, async () => {
    const posts = createMockPosts(25)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-deletions-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(result.data.value).toHaveLength(20)
    const firstItemId = result.data.value[0]!.id

    collection.utils.begin()
    collection.utils.write({
      type: `delete`,
      value: posts[0]!,
    })
    collection.utils.commit()

    await waitFor(() => {
      expect(result.data.value[0]!.id).not.toBe(firstItemId)
    })

    expect(result.pages.value).toHaveLength(2)
    expect(result.data.value).toHaveLength(20)
    expect(result.pages.value[0]).toHaveLength(10)
    expect(result.pages.value[1]).toHaveLength(10)
  })

  it(`should handle deletion from partial page with descending order`, async () => {
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-partial-page-deletion-desc-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.data.value).toHaveLength(5)
    expect(result.hasNextPage.value).toBe(false)

    const firstItemId = result.data.value[0]!.id
    expect(firstItemId).toBe(`1`)

    collection.utils.begin()
    collection.utils.write({
      type: `delete`,
      value: posts[0]!,
    })
    collection.utils.commit()

    await waitFor(() => {
      expect(result.data.value).toHaveLength(4)
    })

    expect(
      result.data.value.find((p) => p.id === firstItemId),
    ).toBeUndefined()
    expect(result.data.value[0]!.id).toBe(`2`)
    expect(result.pages.value).toHaveLength(1)
    expect(result.pages.value[0]).toHaveLength(4)
    expect(result.hasNextPage.value).toBe(false)
  })

  it(`should handle deletion from partial page with ascending order`, async () => {
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-partial-page-deletion-asc-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
      (q) =>
        q
          .from({ posts: collection })
          .orderBy(({ posts: p }) => p.createdAt, `asc`),
      {
        pageSize: 20,
        getNextPageParam: (lastPage) =>
          lastPage.length === 20 ? lastPage.length : undefined,
      },
    )

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.data.value).toHaveLength(5)
    expect(result.hasNextPage.value).toBe(false)

    const firstItemId = result.data.value[0]!.id
    expect(firstItemId).toBe(`5`)

    collection.utils.begin()
    collection.utils.write({
      type: `delete`,
      value: posts[4]!,
    })
    collection.utils.commit()

    await waitFor(() => {
      expect(result.data.value).toHaveLength(4)
    })

    expect(
      result.data.value.find((p) => p.id === firstItemId),
    ).toBeUndefined()
    expect(result.pages.value).toHaveLength(1)
    expect(result.pages.value[0]).toHaveLength(4)
    expect(result.hasNextPage.value).toBe(false)
  })

  it(`should work with where clauses`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-where-clause-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.pages.value[0]).toHaveLength(5)

    result.pages.value[0]!.forEach((post) => {
      expect(post.category).toBe(`tech`)
    })

    expect(result.hasNextPage.value).toBe(true)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(result.data.value).toHaveLength(10)
  })

  it(`should re-execute query when dependencies change`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-deps-change-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const category = ref(`tech`)

    const result = useLiveInfiniteQuery(
      (q) =>
        q
          .from({ posts: collection })
          .where(({ posts: p }) => eq(p.category, category.value))
          .orderBy(({ posts: p }) => p.createdAt, `desc`),
      {
        pageSize: 5,
        getNextPageParam: (lastPage) =>
          lastPage.length === 5 ? lastPage.length : undefined,
      },
      [category],
    )

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    // Change category to life
    category.value = `life`

    await waitFor(() => {
      expect(result.pages.value).toHaveLength(1)
    })

    result.pages.value[0]!.forEach((post) => {
      expect(post.category).toBe(`life`)
    })
  })

  it(`should track pageParams correctly`, async () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-page-params-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pageParams.value).toEqual([0])

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pageParams.value).toEqual([0, 1])
    })

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pageParams.value).toEqual([0, 1, 2])
    })
  })

  it(`should handle exact page size boundaries`, async () => {
    const posts = createMockPosts(20)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-exact-boundary-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
      (q) =>
        q
          .from({ posts: collection })
          .orderBy(({ posts: p }) => p.createdAt, `desc`),
      {
        pageSize: 10,
        getNextPageParam: (lastPage, allPages) => {
          if (lastPage.length < 10) return undefined
          return allPages.flat().length
        },
      },
    )

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.hasNextPage.value).toBe(true)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(result.pages.value[1]).toHaveLength(10)
    expect(result.hasNextPage.value).toBe(false)
    expect(result.data.value).toHaveLength(20)
  })

  it(`should not fetch when already fetching`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-concurrent-fetch-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(3)
    })

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(4)
    })

    expect(result.pages.value).toHaveLength(4)
    expect(result.data.value).toHaveLength(40)
  })

  it(`should not fetch when hasNextPage is false`, async () => {
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-no-fetch-when-done-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.hasNextPage.value).toBe(false)
    expect(result.pages.value).toHaveLength(1)

    result.fetchNextPage()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(result.pages.value).toHaveLength(1)
  })

  it(`should support custom initialPageParam`, async () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-initial-param-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pageParams.value).toEqual([100])

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pageParams.value).toEqual([100, 101])
    })
  })

  it(`should detect hasNextPage change when new items are synced`, async () => {
    const posts = createMockPosts(20)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-sync-detection-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(result.hasNextPage.value).toBe(false)
    expect(result.data.value).toHaveLength(20)

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

    await waitFor(() => {
      expect(result.hasNextPage.value).toBe(true)
    })

    expect(result.data.value).toHaveLength(20)
    expect(result.pages.value).toHaveLength(2)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(3)
    })

    expect(result.pages.value[2]).toHaveLength(5)
    expect(result.data.value).toHaveLength(25)
    expect(result.hasNextPage.value).toBe(false)
  })

  it(`should set isFetchingNextPage to false when data is immediately available`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `vue-immediate-data-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.isFetchingNextPage.value).toBe(false)

    result.fetchNextPage()
    await waitForVueUpdate()

    expect(result.pages.value).toHaveLength(2)
    expect(result.isFetchingNextPage.value).toBe(false)
  })

  it(`should request limit+1 (peek-ahead) from loadSubset for hasNextPage detection`, async () => {
    const PAGE_SIZE = 10
    const { collection, loadSubsetCalls } = createOnDemandCollection({
      id: `vue-peek-ahead-limit-test`,
      allPosts: createMockPosts(PAGE_SIZE),
    })

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    const callWithLimit = loadSubsetCalls.find(
      (call) => call.limit !== undefined,
    )
    expect(callWithLimit).toBeDefined()
    expect(callWithLimit!.limit).toBe(PAGE_SIZE + 1)

    expect(result.hasNextPage.value).toBe(false)
    expect(result.data.value).toHaveLength(PAGE_SIZE)
  })

  it(`should detect hasNextPage via peek-ahead with exactly pageSize+1 items in on-demand collection`, async () => {
    const PAGE_SIZE = 10
    const { collection } = createOnDemandCollection({
      id: `vue-peek-ahead-boundary-test`,
      allPosts: createMockPosts(PAGE_SIZE + 1),
    })

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.hasNextPage.value).toBe(true)
    expect(result.data.value).toHaveLength(PAGE_SIZE)
    expect(result.pages.value).toHaveLength(1)
    expect(result.pages.value[0]).toHaveLength(PAGE_SIZE)
  })

  it(`should work with on-demand collection and fetch multiple pages`, async () => {
    const PAGE_SIZE = 10
    const { collection, loadSubsetCalls } = createOnDemandCollection({
      id: `vue-on-demand-e2e-test`,
      allPosts: createMockPosts(25),
      autoIndex: `eager`,
    })

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.data.value).toHaveLength(PAGE_SIZE)
    expect(result.hasNextPage.value).toBe(true)
    expect(result.data.value[0]!.id).toBe(`1`)
    expect(result.data.value[9]!.id).toBe(`10`)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(2)
    })

    expect(loadSubsetCalls.length).toBeGreaterThan(1)
    expect(result.data.value).toHaveLength(20)
    expect(result.hasNextPage.value).toBe(true)
    expect(result.pages.value[1]![0]!.id).toBe(`11`)
    expect(result.pages.value[1]![9]!.id).toBe(`20`)

    result.fetchNextPage()
    await waitFor(() => {
      expect(result.pages.value).toHaveLength(3)
    })

    expect(result.data.value).toHaveLength(25)
    expect(result.pages.value[2]).toHaveLength(5)
    expect(result.hasNextPage.value).toBe(false)
    expect(result.pages.value[2]![0]!.id).toBe(`21`)
    expect(result.pages.value[2]![4]!.id).toBe(`25`)
  })

  it(`should work with on-demand collection with async loadSubset`, async () => {
    const PAGE_SIZE = 10
    const { collection, loadSubsetCalls } = createOnDemandCollection({
      id: `vue-on-demand-async-test`,
      allPosts: createMockPosts(25),
      autoIndex: `eager`,
      asyncDelay: 10,
    })

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    await waitFor(() => {
      expect(result.data.value).toHaveLength(PAGE_SIZE)
    })

    expect(result.pages.value).toHaveLength(1)
    expect(result.hasNextPage.value).toBe(true)

    const initialCallCount = loadSubsetCalls.length

    result.fetchNextPage()
    await nextTick()

    await waitFor(
      () => {
        expect(result.data.value).toHaveLength(20)
      },
      5000,
    )

    expect(result.pages.value).toHaveLength(2)
    expect(loadSubsetCalls.length).toBeGreaterThan(initialCallCount)
    expect(result.hasNextPage.value).toBe(true)

    const callCountBeforePage3 = loadSubsetCalls.length

    result.fetchNextPage()

    await waitFor(
      () => {
        expect(result.data.value).toHaveLength(25)
      },
      5000,
    )

    expect(result.pages.value).toHaveLength(3)
    expect(result.pages.value[2]).toHaveLength(5)
    expect(loadSubsetCalls.length).toBeGreaterThan(callCountBeforePage3)
    expect(result.hasNextPage.value).toBe(false)
  })

  it(`should track isFetchingNextPage when async loading is triggered`, async () => {
    const allPosts = createMockPosts(30)

    const collection = createCollection<Post>({
      id: `vue-async-loading-test`,
      getKey: (post: Post) => post.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          begin()
          const initialPosts = allPosts.slice(0, 15)
          for (const post of initialPosts) {
            write({ type: `insert`, value: post })
          }
          commit()
          markReady()

          return {
            loadSubset: (opts: LoadSubsetOptions) => {
              let filtered = allPosts

              if (opts.where) {
                const filterFn = createFilterFunctionFromExpression(opts.where)
                filtered = filtered.filter(filterFn)
              }

              if (opts.orderBy && opts.orderBy.length > 0) {
                filtered = filtered.sort((a, b) => b.createdAt - a.createdAt)
              }

              if (opts.cursor) {
                const { whereFrom, whereCurrent } = opts.cursor
                try {
                  const whereFromFn =
                    createFilterFunctionFromExpression(whereFrom)
                  const fromData = filtered.filter(whereFromFn)

                  const whereCurrentFn =
                    createFilterFunctionFromExpression(whereCurrent)
                  const currentData = filtered.filter(whereCurrentFn)

                  const seenIds = new Set<string>()
                  filtered = []
                  for (const item of currentData) {
                    if (!seenIds.has(item.id)) {
                      seenIds.add(item.id)
                      filtered.push(item)
                    }
                  }
                  const limitedFromData = opts.limit
                    ? fromData.slice(0, opts.limit)
                    : fromData
                  for (const item of limitedFromData) {
                    if (!seenIds.has(item.id)) {
                      seenIds.add(item.id)
                      filtered.push(item)
                    }
                  }
                  filtered.sort((a, b) => b.createdAt - a.createdAt)
                } catch (e) {
                  throw new Error(`Test loadSubset: cursor parsing failed`, {
                    cause: e,
                  })
                }
              } else if (opts.limit !== undefined) {
                filtered = filtered.slice(0, opts.limit)
              }

              return new Promise<void>((resolve) => {
                setTimeout(() => {
                  begin()
                  for (const post of filtered) {
                    write({ type: `insert`, value: post })
                  }
                  commit()
                  resolve()
                }, 50)
              })
            },
          }
        },
      },
    })

    const result = useLiveInfiniteQuery(
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

    await waitFor(() => {
      expect(result.isReady.value).toBe(true)
    })

    await waitFor(() => {
      expect(result.isFetchingNextPage.value).toBe(false)
    })

    expect(result.pages.value).toHaveLength(1)

    result.fetchNextPage()
    await nextTick()

    await waitFor(
      () => {
        expect(result.isFetchingNextPage.value).toBe(true)
      },
      500,
    )

    await waitFor(
      () => {
        expect(result.isFetchingNextPage.value).toBe(false)
      },
      5000,
    )

    expect(result.pages.value).toHaveLength(2)
    expect(result.data.value).toHaveLength(20)
  }, 10000)

  describe(`pre-created collections`, () => {
    it(`should accept pre-created live query collection`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `vue-pre-created-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(5),
      })

      await liveQueryCollection.preload()

      const result = useLiveInfiniteQuery(liveQueryCollection, {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      })

      await waitFor(() => {
        expect(result.isReady.value).toBe(true)
      })

      expect(result.pages.value).toHaveLength(1)
      expect(result.pages.value[0]).toHaveLength(10)
      expect(result.data.value).toHaveLength(10)
      expect(result.hasNextPage.value).toBe(true)

      expect(result.pages.value[0]![0]).toMatchObject({
        id: `1`,
        title: `Post 1`,
      })
    })

    it(`should fetch multiple pages with pre-created collection`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `vue-pre-created-multi-page-test`,
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

      const result = useLiveInfiniteQuery(liveQueryCollection, {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      })

      await waitFor(() => {
        expect(result.isReady.value).toBe(true)
      })

      expect(result.pages.value).toHaveLength(1)
      expect(result.hasNextPage.value).toBe(true)

      result.fetchNextPage()
      await waitFor(() => {
        expect(result.pages.value).toHaveLength(2)
      })

      expect(result.pages.value[0]).toHaveLength(10)
      expect(result.pages.value[1]).toHaveLength(10)
      expect(result.data.value).toHaveLength(20)
      expect(result.hasNextPage.value).toBe(true)
    })

    it(`should reset pagination when collection instance changes`, async () => {
      const posts1 = createMockPosts(30)
      const collection1 = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `vue-pre-created-reset-1`,
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
          autoIndex: `eager`,
          id: `vue-pre-created-reset-2`,
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

      const collectionRef = ref(liveQueryCollection1) as any

      const result = useLiveInfiniteQuery(collectionRef, {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      })

      await waitFor(() => {
        expect(result.isReady.value).toBe(true)
      })

      result.fetchNextPage()
      await waitFor(() => {
        expect(result.pages.value).toHaveLength(2)
      })

      expect(result.data.value).toHaveLength(20)

      // Switch to second collection
      collectionRef.value = liveQueryCollection2

      await waitFor(() => {
        expect(result.pages.value).toHaveLength(1)
      })

      expect(result.data.value).toHaveLength(10)
    })

    it(`should throw error if collection lacks orderBy`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `vue-no-orderby-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q) => q.from({ posts: collection }),
      })

      await liveQueryCollection.preload()

      expect(() => {
        useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      }).toThrow(/ORDER BY/)
    })

    it(`should throw error if first argument is not a collection or function`, () => {
      expect(() => {
        useLiveInfiniteQuery(`not a collection or function` as any, {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      }).toThrow(/must be either a pre-created live query collection/)

      expect(() => {
        useLiveInfiniteQuery(123 as any, {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      }).toThrow(/must be either a pre-created live query collection/)

      expect(() => {
        useLiveInfiniteQuery(null as any, {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        })
      }).toThrow(/must be either a pre-created live query collection/)
    })

    it(`should work correctly even if pre-created collection has different initial limit`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `vue-mismatched-window-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(5)
            .offset(0),
      })

      await liveQueryCollection.preload()

      const result = useLiveInfiniteQuery(liveQueryCollection, {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      })

      await waitFor(() => {
        expect(result.isReady.value).toBe(true)
      })

      expect(result.pages.value).toHaveLength(1)
      expect(result.pages.value[0]).toHaveLength(10)
      expect(result.data.value).toHaveLength(10)
      expect(result.hasNextPage.value).toBe(true)
    })

    it(`should handle live updates with pre-created collection`, async () => {
      const posts = createMockPosts(30)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `vue-pre-created-live-updates-test`,
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

      const result = useLiveInfiniteQuery(liveQueryCollection, {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      })

      await waitFor(() => {
        expect(result.isReady.value).toBe(true)
      })

      result.fetchNextPage()
      await waitFor(() => {
        expect(result.pages.value).toHaveLength(2)
      })

      expect(result.data.value).toHaveLength(20)

      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `new-1`,
          title: `New Post`,
          content: `New Content`,
          createdAt: 1000001,
          category: `tech`,
        },
      })
      collection.utils.commit()

      await waitFor(() => {
        expect(result.pages.value[0]![0]).toMatchObject({
          id: `new-1`,
          title: `New Post`,
        })
      })

      expect(result.pages.value).toHaveLength(2)
      expect(result.data.value).toHaveLength(20)
    })

    it(`should work with router loader pattern (preloaded collection)`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `vue-router-loader-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const loaderQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(20),
      })

      await loaderQuery.preload()

      const result = useLiveInfiniteQuery(loaderQuery, {
        pageSize: 20,
        getNextPageParam: (lastPage) =>
          lastPage.length === 20 ? lastPage.length : undefined,
      })

      await waitFor(() => {
        expect(result.isReady.value).toBe(true)
      })

      expect(result.pages.value).toHaveLength(1)
      expect(result.pages.value[0]).toHaveLength(20)
      expect(result.data.value).toHaveLength(20)
      expect(result.hasNextPage.value).toBe(true)

      result.fetchNextPage()
      await waitFor(() => {
        expect(result.pages.value).toHaveLength(2)
      })

      expect(result.data.value).toHaveLength(40)
    })
  })
})
