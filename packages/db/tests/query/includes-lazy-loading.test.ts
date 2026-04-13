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
