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

describe(`cluster-verification #1510 (evaluate-review)`, () => {
  /**
   * Claim (#1510): a live query whose select contains an include subquery
   * against a cold on-demand collection hangs in `loading` forever when the
   * outer query yields ZERO rows. Mechanism: lazy loadSubset only fires per
   * outer row, so with an empty outer result the inner collection never gets
   * a loadSubset call, never marks ready, and allCollectionsReady() stays
   * false — the live query never leaves `loading`.
   *
   * Unlike the mocks above (which call markReady eagerly inside sync), a
   * faithful cold on-demand collection — like query-db-collection in
   * on-demand mode — only calls markReady after its first loadSubset
   * request completes. That is what these mocks model.
   */

  type VRoot = {
    id: number
    name: string
  }

  type VItem = {
    id: number
    rootId: number
    title: string
  }

  function createColdOnDemandItemsCollection(id: string) {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<VItem>({
      id,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          // Cold: no data written up-front, and markReady is only called
          // once a loadSubset request actually arrives (mirroring real
          // on-demand collections, which mark ready after the first
          // successful query result).
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              begin()
              commit()
              markReady()
              return Promise.resolve()
            },
          }
        },
      },
    })

    return { collection, loadSubsetCalls }
  }

  async function preloadWithTimeout(
    liveQuery: { preload: () => Promise<unknown> },
    ms: number,
  ) {
    return Promise.race([
      liveQuery.preload().then(() => `ready` as const),
      new Promise<`timed-out`>((resolve) =>
        setTimeout(() => resolve(`timed-out`), ms),
      ),
    ])
  }

  it(
    `live query with include over a cold on-demand collection should become ready when the outer collection is empty`,
    async () => {
      // Outer collection: ready, but contains ZERO rows
      const roots = createCollection<VRoot>({
        id: `cluster-1510-empty-roots`,
        getKey: (r) => r.id,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            begin()
            commit()
            markReady()
          },
        },
      })

      const { collection: items } = createColdOnDemandItemsCollection(
        `cluster-1510-cold-items-empty-outer`,
      )

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

      // Bound the wait: the claimed buggy behavior is an infinite hang in
      // `loading`, so we must not await preload() unguarded.
      const outcome = await preloadWithTimeout(liveQuery, 3000)

      expect({ outcome, status: liveQuery.status }).toEqual({
        outcome: `ready`,
        status: `ready`,
      })
      expect(liveQuery.size).toBe(0)
    },
    5000,
  )

  it(
    `live query with include over a cold on-demand collection should become ready when the outer where matches nothing`,
    async () => {
      // Outer collection has rows, but the outer where-clause matches none
      const roots = createCollection<VRoot>({
        id: `cluster-1510-roots-where-none`,
        getKey: (r) => r.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: 1, name: `Root A` } })
            write({ type: `insert`, value: { id: 2, name: `Root B` } })
            commit()
            markReady()
          },
        },
      })

      const { collection: items } = createColdOnDemandItemsCollection(
        `cluster-1510-cold-items-where-none`,
      )

      const liveQuery = createLiveQueryCollection((q) =>
        q
          .from({ r: roots })
          .where(({ r }) => eq(r.id, 999))
          .select(({ r }) => ({
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

      const outcome = await preloadWithTimeout(liveQuery, 3000)

      expect({ outcome, status: liveQuery.status }).toEqual({
        outcome: `ready`,
        status: `ready`,
      })
      expect(liveQuery.size).toBe(0)
    },
    5000,
  )
})

/**
 * Verification of #1533 / PR #1532: in Electric's `progressive` sync mode a
 * loadSubset call is served immediately from a snapshot (fetchSnapshot fast
 * path) only while the initial background sync is still buffering
 * (`isBufferingInitialSync()` in electric.ts). After the first `up-to-date`
 * that window closes and the data only becomes visible once the ENTIRE
 * background sync commits.
 *
 * A direct query issues loadSubset at subscription time (inside the window),
 * but a nested toArray include child is marked lazy and its loadSubset is
 * deferred until the PARENT query produces rows — by which point the child's
 * window has typically closed, so the nested include stays empty until the
 * full background sync finishes.
 *
 * The window is modelled here with a plain on-demand collection; the deferral
 * it exposes is real @tanstack/db behaviour.
 */
describe(`cluster-verification #1533 (evaluate-review)`, () => {
  type User = { id: number; name: string }
  type Post = { id: number; userId: number; title: string }

  const allUsers: Array<User> = [
    { id: 1, name: `U1` },
    { id: 2, name: `U2` },
    { id: 3, name: `U3` },
  ]
  const allPosts: Array<Post> = [
    { id: 10, userId: 1, title: `P1` },
    { id: 20, userId: 2, title: `P2a` },
    { id: 21, userId: 2, title: `P2b` },
    { id: 30, userId: 3, title: `P3` },
  ]

  let seq = 0

  /**
   * Models an Electric collection in `progressive` sync mode.
   * - While the buffering window is open, loadSubset delivers the matching
   *   subset immediately (fetchSnapshot fast path).
   * - After `closeWindow()` (first `up-to-date` on the background stream),
   *   loadSubset can no longer be served — rows arrive only when the full
   *   background sync commits via `completeFullSync()`.
   */
  function makeProgressivePosts() {
    let windowOpen = true
    let syncFns: any
    const fastPathLoads: Array<LoadSubsetOptions> = []
    const lateLoads: Array<LoadSubsetOptions> = []

    const collection = createCollection<Post>({
      id: `progressive-posts-${seq++}`,
      getKey: (p) => p.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          syncFns = params
          params.begin()
          params.commit()
          params.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              if (windowOpen) {
                fastPathLoads.push(options)
                // Fast path: serve the matching subset immediately.
                const comparisons = options.where
                  ? extractSimpleComparisons(options.where)
                  : []
                const matching = allPosts.filter((post) =>
                  comparisons.every((c) => {
                    const value = (post as any)[c.field[0]!]
                    if (c.operator === `eq`) return value === c.value
                    if (c.operator === `in`)
                      return (c.value as Array<unknown>).includes(value)
                    return true
                  }),
                )
                syncFns.begin()
                for (const post of matching) {
                  syncFns.write({ type: `insert`, value: post })
                }
                syncFns.commit()
              } else {
                // Window closed: nothing can be served until the full
                // background sync commits.
                lateLoads.push(options)
              }
              return Promise.resolve()
            },
          }
        },
      },
    })

    return {
      collection,
      fastPathLoads,
      lateLoads,
      closeWindow: () => {
        windowOpen = false
      },
      completeFullSync: () => {
        syncFns.begin()
        for (const post of allPosts) {
          if (!collection.has(post.id)) {
            syncFns.write({ type: `insert`, value: post })
          }
        }
        syncFns.commit()
      },
    }
  }

  /**
   * A parent collection whose snapshot only lands after `release()` is
   * called — models a parent whose round-trip outlasts the child's
   * buffering window.
   */
  function makeGatedUsers() {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const collection = createCollection<User>({
      id: `progressive-gated-users-${seq++}`,
      getKey: (u) => u.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          void gate.then(() => {
            begin()
            for (const u of allUsers) {
              write({ type: `insert`, value: u })
            }
            commit()
            markReady()
          })
        },
      },
    })
    return { collection, release }
  }

  it(`direct query: fast-path subset is delivered before full background sync`, async () => {
    const {
      collection: posts,
      fastPathLoads,
      lateLoads,
    } = makeProgressivePosts()

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ post: posts }).where(({ post }) => eq(post.userId, 2)),
    )
    const preload = liveQuery.preload()
    await flushPromises()

    // loadSubset fired at subscription time — inside the buffering window.
    expect(fastPathLoads.length).toBeGreaterThan(0)
    expect(lateLoads.length).toBe(0)

    await preload

    // The matching subset is visible even though the full background sync
    // has not completed.
    expect(liveQuery.size).toBe(2)
    expect([...liveQuery.keys()].sort()).toEqual([20, 21])
  })

  it(`nested toArray include: fast-path subset should be delivered before full background sync`, async () => {
    const { collection: users, release } = makeGatedUsers()
    const {
      collection: posts,
      fastPathLoads,
      lateLoads,
      closeWindow,
      completeFullSync,
    } = makeProgressivePosts()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .where(({ user }) => eq(user.id, 2))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
          posts: toArray(
            q
              .from({ post: posts })
              .where(({ post }) => eq(post.userId, user.id)),
          ),
        })),
    )
    void liveQuery.preload()
    await flushPromises()

    // The child's buffering window closes (first `up-to-date` on its
    // background stream) before the parent's snapshot lands — the
    // realistic progressive-mode timeline from #1533.
    closeWindow()

    // Parent snapshot arrives.
    release()
    await flushPromises()

    // Parent row is present.
    expect(liveQuery.size).toBe(1)

    // EXPECTED (same fast path as the direct query): the child loadSubset
    // was issued inside the buffering window and the nested include is
    // populated from the fast-path subset, BEFORE the child's full
    // background sync completes.
    // BUG (#1533): the child loadSubset is deferred until the parent
    // produces rows — after the window closed — so the nested array stays
    // empty until the entire child collection finishes background sync.
    expect(fastPathLoads.length).toBeGreaterThan(0)
    expect(lateLoads.length).toBe(0)
    const row = liveQuery.get(2) as any
    expect(row?.posts?.map((p: Post) => p.id).sort()).toEqual([20, 21])

    // Sanity check that the modelled full background sync does deliver the
    // rows eventually (on current main this is the ONLY way they arrive,
    // which is the bug).
    completeFullSync()
    await flushPromises()
    const rowAfterFullSync = liveQuery.get(2) as any
    expect(
      rowAfterFullSync?.posts?.map((p: Post) => p.id).sort(),
    ).toEqual([20, 21])
  })
})
