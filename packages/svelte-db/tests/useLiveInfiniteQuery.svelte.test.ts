import { afterEach, describe, expect, it } from 'vitest'
import { flushSync } from 'svelte'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery.svelte.js'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { createFilterFunctionFromExpression } from '../../db/src/collection/change-events'
import type { InitialQueryBuilder, LoadSubsetOptions } from '@tanstack/db'

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

type OnDemandCollectionOptions = {
  id: string
  allPosts: Array<Post>
  autoIndex?: `off` | `eager`
  asyncDelay?: number
}

function createOnDemandCollection(opts: OnDemandCollectionOptions) {
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

            function writeAll(): void {
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

describe(`useLiveInfiniteQuery`, () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
  })

  it(`should fetch initial page of data`, () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `initial-page-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
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
        },
      )

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(10)
      expect(query.data).toHaveLength(10)
      expect(query.hasNextPage).toBe(true)
      expect(query.pages[0]![0]).toMatchObject({
        id: `1`,
        title: `Post 1`,
      })
    })
  })

  it(`should fetch multiple pages`, () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `multiple-pages-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.pages).toHaveLength(1)
      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.pages[0]).toHaveLength(10)
      expect(query.pages[1]).toHaveLength(10)
      expect(query.data).toHaveLength(20)
      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(3)
      expect(query.data).toHaveLength(30)
      expect(query.hasNextPage).toBe(true)
    })
  })

  it(`should detect when no more pages available`, () => {
    const posts = createMockPosts(25)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `no-more-pages-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.pages).toHaveLength(1)
      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.pages[1]).toHaveLength(10)
      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(3)
      expect(query.pages[2]).toHaveLength(5)
      expect(query.data).toHaveLength(25)
      expect(query.hasNextPage).toBe(false)
    })
  })

  it(`should handle empty results`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `empty-results-test`,
        getKey: (post: Post) => post.id,
        initialData: [],
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(0)
      expect(query.data).toHaveLength(0)
      expect(query.hasNextPage).toBe(false)
    })
  })

  it(`should update pages when underlying data changes`, () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `live-updates-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.data).toHaveLength(20)

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

      flushSync()

      expect(query.pages[0]![0]).toMatchObject({
        id: `new-1`,
        title: `New Post`,
      })

      expect(query.pages).toHaveLength(2)
      expect(query.data).toHaveLength(20)
      expect(query.pages[0]).toHaveLength(10)
      expect(query.pages[1]).toHaveLength(10)
    })
  })

  it(`should work with where clauses`, () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `where-clause-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .where(({ posts: p }) => eq(p.category, `tech`))
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 5,
        },
      )

      flushSync()

      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(5)

      query.pages[0]!.forEach((post: Post) => {
        expect(post.category).toBe(`tech`)
      })

      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.data).toHaveLength(10)
    })
  })

  it(`should re-execute query when dependencies change`, () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `deps-change-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      let category = $state(`tech`)

      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .where(({ posts: p }) => eq(p.category, category))
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 5,
        },
        [() => category],
      )

      flushSync()

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)

      category = `life`
      flushSync()

      expect(query.pages).toHaveLength(1)
      query.pages[0]!.forEach((post: Post) => {
        expect(post.category).toBe(`life`)
      })
    })
  })

  it(`should track pageParams correctly`, () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `page-params-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          initialPageParam: 0,
        },
      )

      flushSync()

      expect(query.pageParams).toEqual([0])

      query.fetchNextPage()
      flushSync()

      expect(query.pageParams).toEqual([0, 1])

      query.fetchNextPage()
      flushSync()

      expect(query.pageParams).toEqual([0, 1, 2])
    })
  })

  it(`should accept pre-created live query collection`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `pre-created-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const liveQueryCollection = createLiveQueryCollection({
      query: (q: InitialQueryBuilder) =>
        q
          .from({ posts: collection })
          .orderBy(({ posts: p }) => p.createdAt, `desc`)
          .limit(5),
    })

    await liveQueryCollection.preload()

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(liveQueryCollection, {
        pageSize: 10,
      })

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(10)
      expect(query.data).toHaveLength(10)
      expect(query.hasNextPage).toBe(true)
      expect(query.pages[0]![0]).toMatchObject({
        id: `1`,
        title: `Post 1`,
      })
    })
  })

  it(`should work with on-demand collection via peek-ahead`, () => {
    const PAGE_SIZE = 10
    const { collection } = createOnDemandCollection({
      id: `peek-ahead-boundary-test`,
      allPosts: createMockPosts(PAGE_SIZE + 1),
    })

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: PAGE_SIZE,
        },
      )

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.hasNextPage).toBe(true)
      expect(query.data).toHaveLength(PAGE_SIZE)
      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(PAGE_SIZE)
    })
  })

  it(`should handle deletions across pages`, () => {
    const posts = createMockPosts(25)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `deletions-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.data).toHaveLength(20)
      const firstItemId = query.data[0]!.id

      collection.utils.begin()
      collection.utils.write({
        type: `delete`,
        value: posts[0]!,
      })
      collection.utils.commit()

      flushSync()

      expect(query.data[0]!.id).not.toBe(firstItemId)
      expect(query.pages).toHaveLength(2)
      expect(query.data).toHaveLength(20)
      expect(query.pages[0]).toHaveLength(10)
      expect(query.pages[1]).toHaveLength(10)
    })
  })

  it(`should handle deletion from partial page with descending order`, () => {
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `partial-page-deletion-desc-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 20,
        },
      )

      flushSync()

      expect(query.pages).toHaveLength(1)
      expect(query.data).toHaveLength(5)

      const firstItemId = query.data[0]!.id
      expect(firstItemId).toBe(`1`)

      collection.utils.begin()
      collection.utils.write({
        type: `delete`,
        value: posts[0]!,
      })
      collection.utils.commit()

      flushSync()

      expect(query.data).toHaveLength(4)
      expect(query.data.find((p: Post) => p.id === firstItemId)).toBeUndefined()
      expect(query.data[0]!.id).toBe(`2`)
      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(4)
    })
  })

  it(`should handle deletion from partial page with ascending order`, () => {
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `partial-page-deletion-asc-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `asc`),
        {
          pageSize: 20,
        },
      )

      flushSync()

      expect(query.pages).toHaveLength(1)
      expect(query.data).toHaveLength(5)

      const firstItemId = query.data[0]!.id
      expect(firstItemId).toBe(`5`)

      collection.utils.begin()
      collection.utils.write({
        type: `delete`,
        value: posts[4]!,
      })
      collection.utils.commit()

      flushSync()

      expect(query.data).toHaveLength(4)
      expect(query.data.find((p: Post) => p.id === firstItemId)).toBeUndefined()
      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(4)
    })
  })

  it(`should handle exact page size boundaries`, () => {
    const posts = createMockPosts(20)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `exact-boundary-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.pages[1]).toHaveLength(10)
      expect(query.hasNextPage).toBe(false)
      expect(query.data).toHaveLength(20)
    })
  })

  it(`should not fetch when already fetching`, () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `concurrent-fetch-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()
      expect(query.pages).toHaveLength(1)

      query.fetchNextPage()
      flushSync()
      expect(query.pages).toHaveLength(2)

      query.fetchNextPage()
      flushSync()
      expect(query.pages).toHaveLength(3)

      query.fetchNextPage()
      flushSync()
      expect(query.pages).toHaveLength(4)

      expect(query.pages).toHaveLength(4)
      expect(query.data).toHaveLength(40)
    })
  })

  it(`should not fetch when hasNextPage is false`, () => {
    const posts = createMockPosts(5)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `no-fetch-when-done-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      expect(query.hasNextPage).toBe(false)
      expect(query.pages).toHaveLength(1)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(1)
    })
  })

  it(`should support custom initialPageParam`, () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `initial-param-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          initialPageParam: 100,
        },
      )

      flushSync()

      expect(query.pageParams).toEqual([100])

      query.fetchNextPage()
      flushSync()

      expect(query.pageParams).toEqual([100, 101])
    })
  })

  it(`should detect hasNextPage change when new items are synced`, () => {
    const posts = createMockPosts(20)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `sync-detection-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.hasNextPage).toBe(false)
      expect(query.data).toHaveLength(20)

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

      flushSync()

      expect(query.hasNextPage).toBe(true)
      expect(query.data).toHaveLength(20)
      expect(query.pages).toHaveLength(2)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(3)
      expect(query.pages[2]).toHaveLength(5)
      expect(query.data).toHaveLength(25)
      expect(query.hasNextPage).toBe(false)
    })
  })

  it(`should set isFetchingNextPage to false when data is immediately available`, () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        autoIndex: `eager`,
        id: `immediate-data-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (queryBuilder: InitialQueryBuilder) =>
          queryBuilder
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
        },
      )

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.pages).toHaveLength(1)
      expect(query.isFetchingNextPage).toBe(false)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.isFetchingNextPage).toBe(false)
    })
  })

  it(`should detect hasNextPage via peek-ahead with exactly pageSize+1 items in on-demand collection`, () => {
    const PAGE_SIZE = 10
    const { collection } = createOnDemandCollection({
      id: `peek-ahead-boundary-test-on-demand`,
      allPosts: createMockPosts(PAGE_SIZE + 1),
    })

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (queryBuilder: InitialQueryBuilder) =>
          queryBuilder
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: PAGE_SIZE,
        },
      )

      flushSync()

      expect(query.isReady).toBe(true)
      expect(query.hasNextPage).toBe(true)
      expect(query.data).toHaveLength(PAGE_SIZE)
      expect(query.pages).toHaveLength(1)
      expect(query.pages[0]).toHaveLength(PAGE_SIZE)
    })
  })

  it(`should request limit+1 (peek-ahead) from loadSubset for hasNextPage detection`, () => {
    const PAGE_SIZE = 10
    const { collection, loadSubsetCalls } = createOnDemandCollection({
      id: `peek-ahead-limit-test`,
      allPosts: createMockPosts(PAGE_SIZE),
    })

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: PAGE_SIZE,
        },
      )

      flushSync()
      expect(query.isReady).toBe(true)

      const callWithLimit = loadSubsetCalls.find(
        (call) => call.limit !== undefined,
      )
      expect(callWithLimit).toBeDefined()
      expect(callWithLimit!.limit).toBe(PAGE_SIZE + 1)
      expect(query.hasNextPage).toBe(false)
      expect(query.data).toHaveLength(PAGE_SIZE)
    })
  })

  it(`should work with on-demand collection and fetch multiple pages`, () => {
    const PAGE_SIZE = 10
    const { collection } = createOnDemandCollection({
      id: `on-demand-e2e-test`,
      allPosts: createMockPosts(25),
      autoIndex: `eager`,
    })

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (queryBuilder: InitialQueryBuilder) =>
          queryBuilder
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: PAGE_SIZE,
        },
      )

      flushSync()
      expect(query.isReady).toBe(true)

      expect(query.pages).toHaveLength(1)
      expect(query.data).toHaveLength(PAGE_SIZE)
      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(2)
      expect(query.data).toHaveLength(20)
      expect(query.hasNextPage).toBe(true)

      query.fetchNextPage()
      flushSync()

      expect(query.pages).toHaveLength(3)
      expect(query.data).toHaveLength(25)
      expect(query.pages[2]).toHaveLength(5)
      expect(query.hasNextPage).toBe(false)
    })
  })

  it(`should work with on-demand collection with async loadSubset`, async () => {
    const PAGE_SIZE = 10
    const { collection } = createOnDemandCollection({
      id: `on-demand-async-test`,
      allPosts: createMockPosts(25),
      autoIndex: `eager`,
      asyncDelay: 10,
    })

    const query = await new Promise<any>((resolve) => {
      const rootCleanup = $effect.root(() => {
        const q = useLiveInfiniteQuery(
          (queryBuilder: InitialQueryBuilder) =>
            queryBuilder
              .from({ posts: collection })
              .orderBy(({ posts: p }) => p.createdAt, `desc`),
          {
            pageSize: PAGE_SIZE,
          },
        )
        $effect(() => {
          if (q.isReady && q.data.length === PAGE_SIZE) {
            resolve(q)
          }
        })
        return () => {}
      })
      cleanup = rootCleanup
    })

    expect(query.pages).toHaveLength(1)
    expect(query.hasNextPage).toBe(true)

    query.fetchNextPage()
    flushSync()
    expect(query.isFetchingNextPage).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 50))
    flushSync()

    expect(query.data).toHaveLength(20)
    expect(query.pages).toHaveLength(2)
    expect(query.hasNextPage).toBe(true)

    query.fetchNextPage()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 50))
    flushSync()

    expect(query.data).toHaveLength(25)
    expect(query.pages).toHaveLength(3)
    expect(query.hasNextPage).toBe(false)
  })

  it(`should track isFetchingNextPage when async loading is triggered`, async () => {
    const PAGE_SIZE = 10
    const allPosts = createMockPosts(30)
    const { collection } = createOnDemandCollection({
      id: `async-loading-test-robust`,
      allPosts,
      asyncDelay: 50,
    })

    const query = await new Promise<any>((resolve) => {
      const rootCleanup = $effect.root(() => {
        const q = useLiveInfiniteQuery(
          (queryBuilder: InitialQueryBuilder) =>
            queryBuilder
              .from({ posts: collection })
              .orderBy(({ posts: p }) => p.createdAt, `desc`),
          {
            pageSize: PAGE_SIZE,
          },
        )
        $effect(() => {
          if (q.isReady && !q.isFetchingNextPage) {
            resolve(q)
          }
        })
        return () => {}
      })
      cleanup = rootCleanup
    })

    expect(query.pages).toHaveLength(1)
    expect(query.data).toHaveLength(PAGE_SIZE)

    query.fetchNextPage()
    // Should be fetching now
    flushSync()
    expect(query.isFetchingNextPage).toBe(true)

    // Wait for loadSubset (50ms) + buffer
    await new Promise((resolve) => setTimeout(resolve, 150))
    flushSync()

    expect(query.isFetchingNextPage).toBe(false)
    expect(query.pages).toHaveLength(2)
    expect(query.data).toHaveLength(20)
  })

  describe(`pre-created collections`, () => {
    it(`should fetch multiple pages with pre-created collection`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `pre-created-multi-page-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      await liveQueryCollection.preload()

      cleanup = $effect.root(() => {
        const query = useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10,
        })

        flushSync()

        expect(query.isReady).toBe(true)
        expect(query.pages).toHaveLength(1)
        expect(query.hasNextPage).toBe(true)

        query.fetchNextPage()
        flushSync()

        expect(query.pages).toHaveLength(2)
        expect(query.pages[0]).toHaveLength(10)
        expect(query.pages[1]).toHaveLength(10)
        expect(query.data).toHaveLength(20)
        expect(query.hasNextPage).toBe(true)
      })
    })

    it(`should reset pagination when collection instance changes`, () => {
      const posts1 = createMockPosts(30)
      const collection1 = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `pre-created-reset-1`,
          getKey: (post: Post) => post.id,
          initialData: posts1,
        }),
      )

      const liveQueryCollection1 = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection1 })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      const posts2 = createMockPosts(40)
      const collection2 = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `pre-created-reset-2`,
          getKey: (post: Post) => post.id,
          initialData: posts2,
        }),
      )

      const liveQueryCollection2 = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection2 })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      cleanup = $effect.root(() => {
        let coll = $state(liveQueryCollection1)

        const query = useLiveInfiniteQuery(() => coll, {
          pageSize: 10,
        })

        flushSync()

        expect(query.isReady).toBe(true)

        query.fetchNextPage()
        flushSync()

        expect(query.pages).toHaveLength(2)
        expect(query.data).toHaveLength(20)

        coll = liveQueryCollection2
        flushSync()

        expect(query.pages).toHaveLength(1)
        expect(query.data).toHaveLength(10)
      })
    })

    it(`should throw error if collection lacks orderBy`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `no-orderby-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) => q.from({ posts: collection }),
      })

      await liveQueryCollection.preload()

      expect(() => {
        $effect.root(() => {
          useLiveInfiniteQuery(liveQueryCollection, {
            pageSize: 10,
          })
          flushSync()
        })
      }).toThrow(/orderBy/)
    })

    it(`should throw error if first argument is not a collection or function`, () => {
      expect(() => {
        $effect.root(() => {
          useLiveInfiniteQuery(`not a collection or function` as any, {
            pageSize: 10,
          })
          flushSync()
        })
      }).toThrow(/must be either a pre-created live query collection/)
    })

    it(`should work correctly even if pre-created collection has different initial limit`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `mismatched-window-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(5)
            .offset(0),
      })

      await liveQueryCollection.preload()

      cleanup = $effect.root(() => {
        const query = useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10,
        })

        flushSync()

        expect(query.isReady).toBe(true)
        expect(query.pages).toHaveLength(1)
        expect(query.pages[0]).toHaveLength(10)
        expect(query.data).toHaveLength(10)
        expect(query.hasNextPage).toBe(true)
      })
    })

    it(`should handle live updates with pre-created collection`, async () => {
      const posts = createMockPosts(30)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `pre-created-live-updates-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const liveQueryCollection = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(10)
            .offset(0),
      })

      await liveQueryCollection.preload()

      cleanup = $effect.root(() => {
        const query = useLiveInfiniteQuery(liveQueryCollection, {
          pageSize: 10,
        })

        flushSync()

        expect(query.isReady).toBe(true)

        query.fetchNextPage()
        flushSync()

        expect(query.pages).toHaveLength(2)
        expect(query.data).toHaveLength(20)

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

        flushSync()

        expect(query.pages[0]![0]).toMatchObject({
          id: `new-1`,
          title: `New Post`,
        })

        expect(query.pages).toHaveLength(2)
        expect(query.data).toHaveLength(20)
      })
    })

    it(`should maintain reactivity when destructuring return values with $derived`, () => {
      const posts = createMockPosts(20)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `destructure-reactivity-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      cleanup = $effect.root(() => {
        const query = useLiveInfiniteQuery(
          (q: InitialQueryBuilder) =>
            q
              .from({ posts: collection })
              .orderBy(({ posts: p }) => p.createdAt, `desc`),
          {
            pageSize: 5,
          },
        )

        // Destructure with $derived
        const { data, hasNextPage, fetchNextPage } = $derived(query)

        flushSync()

        expect(data).toHaveLength(5)
        expect(hasNextPage).toBe(true)

        fetchNextPage()
        flushSync()

        // Should be reactive
        expect(data).toHaveLength(10)
      })
    })

    it(`should react to dynamic pageSize changes`, () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `dynamic-pagesize-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      cleanup = $effect.root(() => {
        let pageSize = $state(5)
        const query = useLiveInfiniteQuery(
          (q: InitialQueryBuilder) =>
            q
              .from({ posts: collection })
              .orderBy(({ posts: p }) => p.createdAt, `desc`),
          {
            get pageSize() {
              return pageSize
            },
          },
        )

        flushSync()
        expect(query.pages[0]).toHaveLength(5)
        expect(query.data).toHaveLength(5)

        // Change pageSize reactively
        pageSize = 10
        flushSync()

        expect(query.pages[0]).toHaveLength(10)
        expect(query.data).toHaveLength(10)
      })
    })

    it(`should handle cleanup of infinite query`, () => {
      const posts = createMockPosts(10)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `cleanup-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      let query: any
      const rootCleanup = $effect.root(() => {
        query = useLiveInfiniteQuery(
          (q: InitialQueryBuilder) =>
            q
              .from({ posts: collection })
              .orderBy(({ posts: p }) => p.createdAt, `desc`),
          {
            pageSize: 5,
          },
        )
        return () => {}
      })

      flushSync()
      expect(query.isCleanedUp).toBe(false)

      rootCleanup()
      flushSync()

      expect(query.isCleanedUp).toBe(true)
    })

    it(`should work with router loader pattern (preloaded collection)`, async () => {
      const posts = createMockPosts(50)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          autoIndex: `eager`,
          id: `router-loader-test`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )

      const loaderQuery = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`)
            .limit(20),
      })

      await loaderQuery.preload()

      cleanup = $effect.root(() => {
        const query = useLiveInfiniteQuery(loaderQuery, {
          pageSize: 20,
        })

        flushSync()

        expect(query.isReady).toBe(true)
        expect(query.pages).toHaveLength(1)
        expect(query.pages[0]).toHaveLength(20)
        expect(query.data).toHaveLength(20)
        expect(query.hasNextPage).toBe(true)

        query.fetchNextPage()
        flushSync()

        expect(query.pages).toHaveLength(2)
        expect(query.data).toHaveLength(40)
      })
    })
  })

  it(`should maintain peek-ahead limit consistency when fetching subsequent pages`, () => {
    const PAGE_SIZE = 5
    const allPosts = createMockPosts(20)
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Post>({
      id: `peek-ahead-consistency`,
      getKey: (p) => p.id,
      syncMode: `on-demand`,
      startSync: true,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          markReady()
          return {
            loadSubset: (opts: LoadSubsetOptions) => {
              loadSubsetCalls.push({ ...opts })
              // Page-based calculation similar to what a user might do
              const limit = opts.limit!
              // Use PAGE_SIZE for page calculation
              const page = Math.floor(opts.offset! / PAGE_SIZE) + 1

              // Backend behavior: returns items for the requested page using the PROVIDED limit as page size
              // This is common in APIs that use the limit parameter to define the page size for that request.
              const start = (page - 1) * limit
              const filtered = allPosts.slice(start, start + limit)

              begin()
              for (const post of filtered) {
                write({ type: `insert`, value: post })
              }
              commit()
              return true
            },
          }
        },
      },
    })

    collection.createIndex((p) => p.createdAt, { indexType: BTreeIndex })

    cleanup = $effect.root(() => {
      const query = useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: PAGE_SIZE,
        },
      )

      flushSync()
      expect(query.hasNextPage).toBe(true)
      expect(query.data).toHaveLength(5)

      // First call should have limit 6 (pageSize + 1)
      expect(loadSubsetCalls[0]!.limit).toBe(6)

      query.fetchNextPage()
      flushSync()

      // When fetching page 2, we should still request with peek-ahead.
      // For loadedPageCount=2, we expect total limit to be 12 (2 * (pageSize + 1))
      // CollectionSubscriber will then request (12 - currentSize) = 12 - 6 = 6 items.
      // If we requested limit 5 here, we would only get 4 new items due to overlap,
      // resulting in total size 10 and hasNextPage=false.
      expect(loadSubsetCalls[1]!.limit).toBe(6)
      expect(query.data).toHaveLength(10)
      expect(query.hasNextPage).toBe(true)
    })
  })
})
