import { describe, expect, it, vi } from 'vitest'
import {
  and,
  createLiveQueryCollection,
  eq,
  gte,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import { flushPromises, stripVirtualProps } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

/**
 * Tests that includes subqueries use lazy loading for child collections,
 * analogous to how regular joins use lazy loading.
 */

type Root = {
  id: number
  name: string
}

type Item = {
  id: number
  rootId: number
  title: string
}

const sampleRoots: Array<Root> = [
  { id: 1, name: `Root A` },
  { id: 2, name: `Root B` },
  { id: 3, name: `Root C` },
]

const sampleItems: Array<Item> = [
  { id: 10, rootId: 1, title: `Item A1` },
  { id: 11, rootId: 1, title: `Item A2` },
  { id: 20, rootId: 2, title: `Item B1` },
  // No items for Root C
]

describe(`includes lazy loading`, () => {
  function createRootsCollection() {
    return createCollection<Root>({
      id: `includes-lazy-roots`,
      getKey: (r) => r.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const root of sampleRoots) {
            write({ type: `insert`, value: root })
          }
          commit()
          markReady()
        },
      },
    })
  }

  function createItemsCollectionWithTracking() {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Item>({
      id: `includes-lazy-items`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of sampleItems) {
            write({ type: `insert`, value: item })
          }
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            }),
          }
        },
      },
    })

    return { collection, loadSubsetCalls }
  }

  it(`should pass correlation filter to child collection loadSubset`, async () => {
    const roots = createRootsCollection()
    const { collection: items, loadSubsetCalls } =
      createItemsCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        name: r.name,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    // The child collection should have received a loadSubset call with
    // an inArray filter containing the parent root IDs
    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]!
    expect(lastCall.where).toBeDefined()

    // The filter should be an `in` expression on rootId with the parent key values
    const filters = extractSimpleComparisons(lastCall.where)
    expect(filters).toEqual([
      {
        field: [`rootId`],
        operator: `in`,
        value: expect.arrayContaining([1, 2, 3]),
      },
    ])
  })

  it(`should produce correct query results with lazy-loaded includes`, async () => {
    const roots = createRootsCollection()
    const { collection: items } = createItemsCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        name: r.name,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    // Verify the query results are correct
    expect(liveQuery.size).toBe(3)

    const rootA = stripVirtualProps(liveQuery.get(1))
    expect(rootA).toBeDefined()
    expect(rootA!.name).toBe(`Root A`)
    expect((rootA as any).children).toHaveLength(2)

    const rootB = stripVirtualProps(liveQuery.get(2))
    expect(rootB).toBeDefined()
    expect(rootB!.name).toBe(`Root B`)
    expect((rootB as any).children).toHaveLength(1)

    const rootC = stripVirtualProps(liveQuery.get(3))
    expect(rootC).toBeDefined()
    expect(rootC!.name).toBe(`Root C`)
    expect((rootC as any).children).toHaveLength(0)
  })

  it(`should mark child source as lazy (not load initial state eagerly)`, async () => {
    const roots = createRootsCollection()

    let initialLoadTriggered = false
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const items = createCollection<Item>({
      id: `includes-lazy-items-eager-check`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of sampleItems) {
            write({ type: `insert`, value: item })
          }
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              // Check if this is a full load (no where clause) vs targeted load
              if (!options.where) {
                initialLoadTriggered = true
              }
              return Promise.resolve()
            }),
          }
        },
      },
    })

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    // The child collection should NOT have triggered a full initial load
    // (without any where clause). It should only load via targeted
    // requestSnapshot calls with correlation key filters.
    expect(initialLoadTriggered).toBe(false)

    // But it should have loaded data via targeted loadSubset calls
    expect(loadSubsetCalls.length).toBeGreaterThan(0)
    // Every loadSubset call should have a where clause
    for (const call of loadSubsetCalls) {
      expect(call.where).toBeDefined()
    }
  })

  it(`should reactively load new child data when parent rows are added`, async () => {
    let syncMethods: any

    const roots = createCollection<Root>({
      id: `includes-lazy-roots-reactive`,
      getKey: (r) => r.id,
      sync: {
        sync: (methods) => {
          syncMethods = methods
          methods.begin()
          methods.write({ type: `insert`, value: { id: 1, name: `Root A` } })
          methods.commit()
          methods.markReady()
        },
      },
    })

    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const items = createCollection<Item>({
      id: `includes-lazy-items-reactive`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          // Pre-load items for roots 1 and 2
          write({ type: `insert`, value: { id: 10, rootId: 1, title: `A1` } })
          write({ type: `insert`, value: { id: 20, rootId: 2, title: `B1` } })
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            }),
          }
        },
      },
    })

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        name: r.name,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    // Clear previous calls
    const callsBefore = loadSubsetCalls.length

    // Add a new parent row — this should trigger a loadSubset call
    // for the new correlation key (id: 2)
    syncMethods.begin()
    syncMethods.write({ type: `insert`, value: { id: 2, name: `Root B` } })
    syncMethods.commit()

    // Wait for the reactive pipeline to process
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // A new loadSubset call should have been made that includes the new key
    const newCalls = loadSubsetCalls.slice(callsBefore)
    expect(newCalls.length).toBeGreaterThan(0)

    // At least one of the new calls should include the new parent key (2)
    const hasNewKey = newCalls.some((call) => {
      if (!call.where) return false
      const filters = extractSimpleComparisons(call.where)
      return filters.some(
        (f) =>
          f.operator === `in` && Array.isArray(f.value) && f.value.includes(2),
      )
    })
    expect(hasNewKey).toBe(true)
  })

  it(`should not trigger loadSubset without where for toArray includes`, async () => {
    // Same test as the lazy check but using toArray explicitly
    // to verify the materialization mode doesn't affect lazy loading
    const roots = createRootsCollection()
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const items = createCollection<Item>({
      id: `includes-lazy-items-toarray`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of sampleItems) {
            write({ type: `insert`, value: item })
          }
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            }),
          }
        },
      },
    })

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .select(({ item }) => ({
              id: item.id,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    // Every loadSubset call should have a where clause (no unfiltered loads)
    for (const call of loadSubsetCalls) {
      expect(call.where).toBeDefined()
    }
  })

  it(`should work with Collection materialization (not just toArray)`, async () => {
    const roots = createRootsCollection()
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const items = createCollection<Item>({
      id: `includes-lazy-items-collection-mat`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of sampleItems) {
            write({ type: `insert`, value: item })
          }
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            }),
          }
        },
      },
    })

    // Use Collection materialization (no toArray wrapper)
    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        name: r.name,
        children: q
          .from({ item: items })
          .where(({ item }) => eq(item.rootId, r.id))
          .select(({ item }) => ({
            id: item.id,
            title: item.title,
          })),
      })),
    )

    await liveQuery.preload()

    // Should use lazy loading with filters for Collection materialization too
    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]!
    expect(lastCall.where).toBeDefined()

    const filters = extractSimpleComparisons(lastCall.where)
    expect(filters).toEqual([
      {
        field: [`rootId`],
        operator: `in`,
        value: expect.arrayContaining([1, 2, 3]),
      },
    ])
  })
})

describe(`includes child where clauses in loadSubset`, () => {
  /**
   * Tests that pure-child WHERE clauses (not the correlation) are passed
   * through to the child collection's loadSubset/queryFn.
   */

  type Root = {
    id: number
    name: string
  }

  type Item = {
    id: number
    rootId: number
    status: string
    priority: number
    title: string
  }

  const sampleRoots: Array<Root> = [
    { id: 1, name: `Root A` },
    { id: 2, name: `Root B` },
  ]

  const sampleItems: Array<Item> = [
    { id: 10, rootId: 1, status: `active`, priority: 3, title: `A1 active` },
    {
      id: 11,
      rootId: 1,
      status: `archived`,
      priority: 1,
      title: `A1 archived`,
    },
    { id: 20, rootId: 2, status: `active`, priority: 5, title: `B1 active` },
    { id: 21, rootId: 2, status: `active`, priority: 2, title: `B1 active2` },
  ]

  function createRootsCollection() {
    return createCollection<Root>({
      id: `child-where-roots`,
      getKey: (r) => r.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const root of sampleRoots) {
            write({ type: `insert`, value: root })
          }
          commit()
          markReady()
        },
      },
    })
  }

  function createItemsCollectionWithTracking() {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Item>({
      id: `child-where-items`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of sampleItems) {
            write({ type: `insert`, value: item })
          }
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            }),
          }
        },
      },
    })

    return { collection, loadSubsetCalls }
  }

  it(`should include pure-child where clause in loadSubset along with correlation filter`, async () => {
    const roots = createRootsCollection()
    const { collection: items, loadSubsetCalls } =
      createItemsCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .where(({ item }) => eq(item.status, `active`))
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    // The loadSubset call should contain BOTH the correlation filter (inArray)
    // AND the pure-child filter (eq status 'active')
    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]!
    expect(lastCall.where).toBeDefined()

    const filters = extractSimpleComparisons(lastCall.where)
    const hasCorrelationFilter = filters.some(
      (f) => f.operator === `in` && f.field[0] === `rootId`,
    )
    const hasStatusFilter = filters.some(
      (f) =>
        f.operator === `eq` && f.field[0] === `status` && f.value === `active`,
    )

    expect(hasCorrelationFilter).toBe(true)
    expect(hasStatusFilter).toBe(true)
  })

  it(`should include multiple pure-child where clauses in loadSubset`, async () => {
    const roots = createRootsCollection()
    const { collection: items, loadSubsetCalls } =
      createItemsCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .where(({ item }) => eq(item.status, `active`))
            .where(({ item }) => gte(item.priority, 3))
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]!
    expect(lastCall.where).toBeDefined()

    const filters = extractSimpleComparisons(lastCall.where)
    const hasCorrelationFilter = filters.some(
      (f) => f.operator === `in` && f.field[0] === `rootId`,
    )
    const hasStatusFilter = filters.some(
      (f) =>
        f.operator === `eq` && f.field[0] === `status` && f.value === `active`,
    )
    const hasPriorityFilter = filters.some(
      (f) => f.operator === `gte` && f.field[0] === `priority` && f.value === 3,
    )

    expect(hasCorrelationFilter).toBe(true)
    expect(hasStatusFilter).toBe(true)
    expect(hasPriorityFilter).toBe(true)
  })

  it(`should produce correct filtered results with child where clause`, async () => {
    const roots = createRootsCollection()
    const { collection: items } = createItemsCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) => eq(item.rootId, r.id))
            .where(({ item }) => eq(item.status, `active`))
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    // Root A: only 1 active item (id 10), the archived one (id 11) should be filtered
    const rootA = stripVirtualProps(liveQuery.get(1))
    expect(rootA).toBeDefined()
    expect((rootA as any).children).toHaveLength(1)
    expect((rootA as any).children[0].id).toBe(10)

    // Root B: 2 active items
    const rootB = stripVirtualProps(liveQuery.get(2))
    expect(rootB).toBeDefined()
    expect((rootB as any).children).toHaveLength(2)
  })

  it(`should include child where clause combined with correlation in and() syntax`, async () => {
    const roots = createRootsCollection()
    const { collection: items, loadSubsetCalls } =
      createItemsCollectionWithTracking()

    // Use a single where with and() combining correlation + child filter
    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ r: roots }).select(({ r }) => ({
        id: r.id,
        children: toArray(
          q
            .from({ item: items })
            .where(({ item }) =>
              and(eq(item.rootId, r.id), eq(item.status, `active`)),
            )
            .select(({ item }) => ({
              id: item.id,
              title: item.title,
            })),
        ),
      })),
    )

    await liveQuery.preload()

    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]!
    expect(lastCall.where).toBeDefined()

    const filters = extractSimpleComparisons(lastCall.where)
    const hasCorrelationFilter = filters.some(
      (f) => f.operator === `in` && f.field[0] === `rootId`,
    )
    const hasStatusFilter = filters.some(
      (f) =>
        f.operator === `eq` && f.field[0] === `status` && f.value === `active`,
    )

    expect(hasCorrelationFilter).toBe(true)
    expect(hasStatusFilter).toBe(true)
  })
})

describe(`subquery-in-select readiness with cold on-demand inner`, () => {
  /**
   * A live query whose select contains a subquery against an on-demand
   * collection must reach ready even when the outer returns zero rows and
   * no other consumer has warmed the inner. The lazy mechanism does not
   * fire loadSubset on the inner (no parent rows → no per-row tap), so
   * the inner must not block allCollectionsReady.
   *
   * These tests use an inner collection that becomes ready ONLY via
   * loadSubset (no markReady in initial sync) — calling markReady in
   * sync would mask the bug.
   */

  type Post = { id: number; authorId: string; title: string }
  type Comment = { id: number; postId: number; body: string }

  function createPostsCollection(initial: Array<Post>) {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Post>({
      id: `subq-cold-posts-${Math.random().toString(36).slice(2, 8)}`,
      getKey: (p) => p.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Intentionally do NOT call markReady here — only via loadSubset,
          // mirroring a real on-demand source where readiness is gated on
          // the first loadSubset completing.
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              begin()
              for (const p of initial) {
                write({ type: `insert`, value: p })
              }
              commit()
              markReady()
              return Promise.resolve()
            }),
          }
        },
      },
    })

    return { collection, loadSubsetCalls }
  }

  function createCommentsCollection() {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []
    const sampleComments: Array<Comment> = [
      { id: 100, postId: 1, body: `c1` },
      { id: 101, postId: 1, body: `c2` },
      { id: 200, postId: 2, body: `c3` },
    ]

    const collection = createCollection<Comment>({
      id: `subq-cold-comments-${Math.random().toString(36).slice(2, 8)}`,
      getKey: (c) => c.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Intentionally do NOT call markReady here — only via loadSubset.
          // This mirrors a real on-demand source: the collection is not
          // ready until its first loadSubset completes.
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              begin()
              for (const c of sampleComments) {
                // Best-effort filter: if the request includes a postId IN
                // filter (the lazy subquery passes one), only emit matching
                // rows. Otherwise emit nothing.
                const filters = extractSimpleComparisons(options.where)
                const postFilter = filters.find(
                  (f) => f.field[0] === `postId` && f.operator === `in`,
                )
                if (postFilter && Array.isArray(postFilter.value)) {
                  if (postFilter.value.includes(c.postId)) {
                    write({ type: `insert`, value: c })
                  }
                }
              }
              commit()
              markReady()
              return Promise.resolve()
            }),
          }
        },
      },
    })

    return { collection, loadSubsetCalls }
  }

  // Race a promise against a short timeout. Used to detect the hang —
  // if preload never resolves, the test fails fast instead of timing out
  // the whole vitest run.
  function withTimeout<T>(p: Promise<T>, ms: number, label: string) {
    return Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms),
      ),
    ])
  }

  it(`should reach ready when outer is empty and inner is cold on-demand`, async () => {
    const { collection: posts } = createPostsCollection([])
    const { collection: comments, loadSubsetCalls: commentsLoads } =
      createCommentsCollection()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ p: posts })
        .where(({ p }) => eq(p.authorId, `X`))
        .select(({ p }) => ({
          id: p.id,
          title: p.title,
          comments: toArray(
            q
              .from({ c: comments })
              .where(({ c }) => eq(c.postId, p.id))
              .select(({ c }) => ({ id: c.id, body: c.body })),
          ),
        })),
    )

    // Without the fix this hangs forever (allCollectionsReady never goes
    // true because the cold on-demand `comments` collection never receives
    // a loadSubset call when the outer is empty).
    await withTimeout(liveQuery.preload(), 1000, `liveQuery.preload()`)

    expect(liveQuery.isReady()).toBe(true)
    expect(liveQuery.size).toBe(0)
    // The inner was never loaded — that's fine, there were no parent rows
    // to drive a per-row load.
    expect(commentsLoads.length).toBe(0)
  })

  it(`should still drive per-row loadSubset on the inner when outer has rows`, async () => {
    const { collection: posts } = createPostsCollection([
      { id: 1, authorId: `X`, title: `Post 1` },
      { id: 2, authorId: `X`, title: `Post 2` },
    ])
    const { collection: comments, loadSubsetCalls: commentsLoads } =
      createCommentsCollection()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ p: posts })
        .where(({ p }) => eq(p.authorId, `X`))
        .select(({ p }) => ({
          id: p.id,
          title: p.title,
          comments: toArray(
            q
              .from({ c: comments })
              .where(({ c }) => eq(c.postId, p.id))
              .select(({ c }) => ({ id: c.id, body: c.body })),
          ),
        })),
    )

    await withTimeout(liveQuery.preload(), 1000, `liveQuery.preload()`)

    expect(liveQuery.isReady()).toBe(true)
    expect(liveQuery.size).toBe(2)
    // The lazy subquery should have driven at least one loadSubset call on
    // the inner with an inArray(postId, [...]) filter.
    expect(commentsLoads.length).toBeGreaterThan(0)
    const hasCorrelation = commentsLoads.some((call) => {
      const filters = extractSimpleComparisons(call.where)
      return filters.some(
        (f) =>
          f.field[0] === `postId` &&
          f.operator === `in` &&
          Array.isArray(f.value),
      )
    })
    expect(hasCorrelation).toBe(true)

    const post1 = stripVirtualProps(liveQuery.get(1)) as any
    const post2 = stripVirtualProps(liveQuery.get(2)) as any
    expect(post1.comments).toHaveLength(2)
    expect(post2.comments).toHaveLength(1)
  })
})
