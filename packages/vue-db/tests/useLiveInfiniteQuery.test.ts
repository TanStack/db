import { describe, expect, it } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { createApp, defineComponent, h, nextTick, onErrorCaptured, ref, shallowRef } from 'vue'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { InitialQueryBuilder } from '@tanstack/db'

describe(`useLiveInfiniteQuery`, () => {


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

// Helper function to wait for Vue reactivity
async function waitForVueUpdate() {
  await nextTick()
  // Additional small delay to ensure collection updates are processed
  await new Promise((resolve) => setTimeout(resolve, 50))
}



  it(`should fetch initial page of data`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `initial-page-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { pages, data, hasNextPage, isReady } = useLiveInfiniteQuery(
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
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      },
    )

    await waitForVueUpdate()

    expect(isReady.value).toBe(true)

    // Should have 1 page initially
    expect(pages.value).toHaveLength(1)
    expect(pages.value[0]).toHaveLength(10)

    // Data should be flattened
    expect(data.value).toHaveLength(10)

    // Should have next page since we have 50 items total
    expect(hasNextPage.value).toBe(true)

    // First item should be Post 1 (most recent by createdAt)
    expect(pages.value[0]![0]).toMatchObject({
      id: `1`,
      title: `Post 1`,
    })
  })

  it(`should fetch multiple pages`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `multiple-pages-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { pages, data, hasNextPage, fetchNextPage, isReady } =
      useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )

    await waitForVueUpdate()

    expect(isReady.value).toBe(true)

    // Initially 1 page
    expect(pages.value).toHaveLength(1)
    expect(hasNextPage.value).toBe(true)

    // Fetch next page
    fetchNextPage()

    await waitForVueUpdate()
    // Need a bit more time for the async setWindow to complete and trigger reactivity
    await waitForVueUpdate()

    expect(pages.value).toHaveLength(2)
    expect(pages.value[0]).toHaveLength(10)
    expect(pages.value[1]).toHaveLength(10)
    expect(data.value).toHaveLength(20)
    expect(hasNextPage.value).toBe(true)

    // Fetch another page
    fetchNextPage()

    await waitForVueUpdate()
    await waitForVueUpdate()

    expect(pages.value).toHaveLength(3)
    expect(data.value).toHaveLength(30)
    expect(hasNextPage.value).toBe(true)
  })

  it(`should detect when no more pages available`, async () => {
    const posts = createMockPosts(25)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `no-more-pages-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { pages, data, hasNextPage, fetchNextPage, isReady } =
      useLiveInfiniteQuery(
        (q: InitialQueryBuilder) =>
          q
            .from({ posts: collection })
            .orderBy(({ posts: p }) => p.createdAt, `desc`),
        {
          pageSize: 10,
          getNextPageParam: (lastPage) =>
            lastPage.length === 10 ? lastPage.length : undefined,
        },
      )

    await waitForVueUpdate()
    expect(isReady.value).toBe(true)

    // Page 1: 10 items, has more
    expect(pages.value).toHaveLength(1)
    expect(hasNextPage.value).toBe(true)

    // Fetch page 2
    fetchNextPage()
    await waitForVueUpdate()
    await waitForVueUpdate()

    expect(pages.value).toHaveLength(2)
    expect(pages.value[1]).toHaveLength(10)
    expect(hasNextPage.value).toBe(true)

    // Fetch page 3
    fetchNextPage()
    await waitForVueUpdate()
    await waitForVueUpdate()

    expect(pages.value).toHaveLength(3)
    // Page 3: 5 items, no more
    expect(pages.value[2]).toHaveLength(5)
    expect(data.value).toHaveLength(25)
    expect(hasNextPage.value).toBe(false)
  })

  it(`should update pages when underlying data changes`, async () => {
    const posts = createMockPosts(30)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `live-updates-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const { pages, data, fetchNextPage, isReady } = useLiveInfiniteQuery(
      (q: InitialQueryBuilder) =>
        q
          .from({ posts: collection })
          .orderBy(({ posts: p }) => p.createdAt, `desc`),
      {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      },
    )

    await waitForVueUpdate()
    expect(isReady.value).toBe(true)

    // Fetch 2 pages
    fetchNextPage()
    await waitForVueUpdate()
    await waitForVueUpdate()

    expect(pages.value).toHaveLength(2)
    expect(data.value).toHaveLength(20)

    // Insert a new post with most recent timestamp
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

    await waitForVueUpdate()

    // New post should be first AND structure should be maintained
    expect(pages.value[0]![0]).toMatchObject({
      id: `new-1`,
      title: `New Post`,
    })

    // Still showing 2 pages (20 items), but content has shifted
    expect(pages.value).toHaveLength(2)
    expect(data.value).toHaveLength(20)
    expect(pages.value[0]).toHaveLength(10)
    expect(pages.value[1]).toHaveLength(10)
  })

  it(`should re-execute query when dependencies change`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `deps-change-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const category = ref(`tech`)

    const { pages, fetchNextPage, isReady } = useLiveInfiniteQuery(
      (q: InitialQueryBuilder) =>
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

    await waitForVueUpdate()
    expect(isReady.value).toBe(true)

    // Fetch 2 pages of tech posts
    fetchNextPage()
    await waitForVueUpdate()
    await waitForVueUpdate()

    expect(pages.value).toHaveLength(2)

    // Change category to life
    category.value = `life`
    await waitForVueUpdate()
    await waitForVueUpdate()

    // Should reset to 1 page with life posts
    expect(pages.value).toHaveLength(1)

    // All items should be life category
    pages.value[0]!.forEach((post) => {
      expect(post.category).toBe(`life`)
    })
  })

  it(`should accept pre-created live query collection`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `pre-created-collection-test-infinite-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    // Create a live query collection beforehand
    const liveQueryCollection = createLiveQueryCollection({
      query: (q: InitialQueryBuilder) =>
        q
          .from({ posts: collection })
          .orderBy(({ posts: p }) => p.createdAt, `desc`),
      startSync: true,
    })

    const { pages, data, hasNextPage, isReady } = useLiveInfiniteQuery(
      liveQueryCollection,
      {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      },
    )

    await waitForVueUpdate()

    expect(isReady.value).toBe(true)
    expect(pages.value).toHaveLength(1)
    expect(data.value).toHaveLength(10)
    expect(hasNextPage.value).toBe(true)
  })
  it(`should handle getter returning a collection`, async () => {
    const posts = createMockPosts(20)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `getter-collection-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const liveQueryCollection = createLiveQueryCollection({
      query: (q: InitialQueryBuilder) =>
        q
          .from({ posts: collection })
          .orderBy(({ posts: p }) => p.createdAt, `desc`),
      startSync: true,
    })

    // Pass a getter function that returns the collection
    const { pages, isReady } = useLiveInfiniteQuery(() => liveQueryCollection, {
      pageSize: 10,
      getNextPageParam: (lastPage) =>
        lastPage.length === 10 ? lastPage.length : undefined,
    })

    await waitForVueUpdate()

    expect(isReady.value).toBe(true)
    expect(pages.value).toHaveLength(1)
  })

  it(`should handle query function returning a collection`, async () => {
    const posts = createMockPosts(20)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `fn-returning-collection-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const liveQueryCollection = createLiveQueryCollection({
      query: (q: InitialQueryBuilder) =>
        q
          .from({ posts: collection })
          .orderBy(({ posts: p }) => p.createdAt, `desc`),
      startSync: true,
    })

    // Pass a function that accepts 'q' but returns a collection
    const { pages, isReady } = useLiveInfiniteQuery(
      (() => liveQueryCollection) as any,
      {
        pageSize: 10,
        getNextPageParam: (lastPage) =>
          lastPage.length === 10 ? lastPage.length : undefined,
      },
    )

    await waitForVueUpdate()

    expect(isReady.value).toBe(true)
    expect(pages.value).toHaveLength(1)
  })

  it(`should throw when pre-created collection is missing orderBy`, () => {
    return new Promise<void>((resolve, reject) => {
      const posts = createMockPosts(10)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `missing-orderby-captured`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )
      
      const liveQueryCollection = createLiveQueryCollection({
          query: (q: InitialQueryBuilder) => q.from({ posts: collection }),
          startSync: true
      })

      const ChildComp = defineComponent({
        setup() {
           useLiveInfiniteQuery(liveQueryCollection, {
              pageSize: 5,
              getNextPageParam: () => undefined
           })
           return () => h('div')
        }
      })

      const TestComp = defineComponent({
          setup() {
              onErrorCaptured((err) => {
                  try {
                    expect(err.message).toContain('orderBy')
                    resolve()
                  } catch (e) {
                    reject(e)
                  }
                  return false
              })

              return () => h(ChildComp)
          }
      })

      const div = document.createElement('div')
      const app = createApp(TestComp)
      app.mount(div)
    })
  })

  it(`should throw when passing a raw Collection directly`, () => {
    return new Promise<void>((resolve, reject) => {
      const posts = createMockPosts(10)
      const collection = createCollection(
        mockSyncCollectionOptions<Post>({
          id: `raw-collection-error`,
          getKey: (post: Post) => post.id,
          initialData: posts,
        }),
      )
      
      const ChildComp = defineComponent({
        setup() {
           useLiveInfiniteQuery(collection, { // Passing raw collection, not LiveQueryCollection
              pageSize: 5,
              getNextPageParam: () => undefined
           })
           return () => h('div')
        }
      })

      const TestComp = defineComponent({
          setup() {
              onErrorCaptured((err) => {
                  try {
                    expect(err.message).toContain('orderBy')
                    resolve()
                  } catch (e) {
                    reject(e)
                  }
                  return false
              })

              return () => h(ChildComp)
          }
      })

      const div = document.createElement('div')
      const app = createApp(TestComp)
      app.mount(div)
    })
  })



  it(`should reset pagination when input changes`, async () => {
    const posts = createMockPosts(50)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `reset-pagination-test-vue`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )

    const category = ref(`tech`)
    const { pages, fetchNextPage, isReady } = useLiveInfiniteQuery(
      (q: InitialQueryBuilder) =>
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

    await waitForVueUpdate()
    expect(isReady.value).toBe(true)

    fetchNextPage()
    await waitForVueUpdate()
    expect(pages.value).toHaveLength(2)

    // Change input
    category.value = `life`
    await waitForVueUpdate()

    // Should reset to 1 page
    expect(pages.value).toHaveLength(1)
  })

  it(`should reset pagination when switching collection instances (direct input)`, async () => {
    const posts1 = createMockPosts(10)
    const collection1 = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) => q.from({ posts: createCollection(mockSyncCollectionOptions<Post>({ id: 'c1', initialData: posts1, getKey: p=>p.id })) })
                                         .orderBy(({ posts: p }: any) => p.createdAt, 'desc'),
        startSync: true
    })

    const posts2 = createMockPosts(10)
    const collection2 = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) => q.from({ posts: createCollection(mockSyncCollectionOptions<Post>({ id: 'c2', initialData: posts2, getKey: p=>p.id })) })
                                         .orderBy(({ posts: p }: any) => p.createdAt, 'desc'),
        startSync: true
    })

    const currentCollection = shallowRef(collection1)

    // Pass the Ref directly as the first argument
    const { pages, fetchNextPage } = useLiveInfiniteQuery(
      currentCollection,
      {
        pageSize: 2,
        getNextPageParam: () => undefined,
      }
    )

    await waitForVueUpdate()
    expect(pages.value).toHaveLength(1)
    
    fetchNextPage()
    await waitForVueUpdate()
    expect(pages.value).toHaveLength(2)

    // Switch collection ref
    currentCollection.value = collection2
    await waitForVueUpdate()
    await waitForVueUpdate()

    // Should receive reset to page 1
    expect(pages.value).toHaveLength(1)
    expect(pages.value[0]).toHaveLength(2)
  })

  it(`should skip window update if already correct`, async () => {
    const posts = createMockPosts(10)
    const collection = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `window-skip-test`,
        getKey: (post: Post) => post.id,
        initialData: posts,
      }),
    )
    
    const liveQueryCollection = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) => q.from({ posts: collection }).orderBy(({ posts: p }) => p.createdAt, 'desc'),
        startSync: true
    })

    // Spy on setWindow
    let setWindowCallCount = 0
    const originalSetWindow = liveQueryCollection.utils.setWindow
    liveQueryCollection.utils.setWindow = (opts) => {
        setWindowCallCount++
        return originalSetWindow(opts)
    }

    const { fetchNextPage } = useLiveInfiniteQuery(liveQueryCollection, {
        pageSize: 5,
        getNextPageParam: () => undefined
    })

    await waitForVueUpdate()
    expect(setWindowCallCount).toBeGreaterThan(0)
    const countAfterInit = setWindowCallCount

    // Force a reactivity update that DOESN'T change pagination
    // e.g. unrelated dependency or just re-render if we could trigger it. 
    // Since we don't have unrelated deps in the hook usage here, 
    // we can rely on the fact that if we don't call fetchNextPage, it shouldn't call setWindow again
    // even if we wait.
    await waitForVueUpdate()
    expect(setWindowCallCount).toBe(countAfterInit)

    // Verify fetching next page triggers it
    fetchNextPage()
    await waitForVueUpdate()
    await waitForVueUpdate()
    expect(setWindowCallCount).toBeGreaterThan(countAfterInit)
  })
})
