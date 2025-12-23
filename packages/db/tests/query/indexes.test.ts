import { beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'

import { createLiveQueryCollection } from '../../src/query/live-query-collection'
import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  length,
  or,
} from '../../src/query/builder/functions'
import { mockSyncCollectionOptions } from '../utils'

interface TestItem {
  id: string
  name: string
  age: number
  status: `active` | `inactive` | `pending`
  score?: number
  createdAt: Date
}

type TestItem2 = Omit<TestItem, `id`> & {
  id2: string
}

// Index usage tracking utilities (copied from collection-indexes.test.ts)
interface IndexUsageStats {
  rangeQueryCalls: number
  fullScanCalls: number
  indexesUsed: Array<string>
  queriesExecuted: Array<{
    type: `index` | `fullScan`
    operation?: string
    field?: string
    value?: any
  }>
}

function createIndexUsageTracker(collection: any): {
  stats: IndexUsageStats
  restore: () => void
} {
  const stats: IndexUsageStats = {
    rangeQueryCalls: 0,
    fullScanCalls: 0,
    indexesUsed: [],
    queriesExecuted: [],
  }

  // Track rangeQuery calls on index objects (index usage)
  const originalIndexes = new Map()

  // Mock the indexes getter to intercept index access
  const originalIndexesGetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(collection),
    `indexes`,
  )?.get
  Object.defineProperty(collection, `indexes`, {
    get: function () {
      const indexes = originalIndexesGetter?.call(collection) || new Map()

      // Mock each index's rangeQuery method
      for (const [indexId, index] of indexes.entries()) {
        if (!originalIndexes.has(indexId)) {
          const originalLookup = index.lookup
          originalIndexes.set(indexId, originalLookup)

          index.lookup = function (operation: string, value: any) {
            stats.rangeQueryCalls++
            stats.indexesUsed.push(indexId)
            stats.queriesExecuted.push({
              type: `index`,
              operation,
              field: index.expression?.path?.join(`.`),
              value,
            })
            return originalLookup.call(this, operation, value)
          }
        }
      }

      return indexes
    },
    configurable: true,
  })

  // Track full scan calls (entries() iteration)
  const originalEntries = collection.entries
  collection.entries = function* () {
    // Only count as full scan if we're in a filtering context
    // Check the call stack to see if we're inside createFilterFunction
    const stack = new Error().stack || ``
    if (
      stack.includes(`createFilterFunction`) ||
      stack.includes(`currentStateAsChanges`)
    ) {
      stats.fullScanCalls++
      stats.queriesExecuted.push({
        type: `fullScan`,
      })
    }
    yield* originalEntries.call(this)
  }

  const restore = () => {
    // Restore original indexes getter
    if (originalIndexesGetter) {
      Object.defineProperty(collection, `indexes`, {
        get: originalIndexesGetter,
        configurable: true,
      })
    }

    // Restore original lookup methods on indexes
    const indexes = originalIndexesGetter?.call(collection) || new Map()
    for (const [indexId, originalLookup] of originalIndexes.entries()) {
      const index = indexes.get(indexId)
      if (index) {
        index.lookup = originalLookup
      }
    }

    collection.entries = originalEntries
  }

  return { stats, restore }
}

// Helper to assert index usage
function expectIndexUsage(
  stats: IndexUsageStats,
  expectations: {
    shouldUseIndex: boolean
    shouldUseFullScan?: boolean
    indexCallCount?: number
    fullScanCallCount?: number
  },
) {
  if (expectations.shouldUseIndex) {
    expect(stats.rangeQueryCalls).toBeGreaterThan(0)
    expect(stats.indexesUsed.length).toBeGreaterThan(0)

    if (expectations.indexCallCount !== undefined) {
      expect(stats.rangeQueryCalls).toBe(expectations.indexCallCount)
    }
  } else {
    expect(stats.rangeQueryCalls).toBe(0)
    expect(stats.indexesUsed.length).toBe(0)
  }

  if (expectations.shouldUseFullScan !== undefined) {
    if (expectations.shouldUseFullScan) {
      expect(stats.fullScanCalls).toBeGreaterThan(0)

      if (expectations.fullScanCallCount !== undefined) {
        expect(stats.fullScanCalls).toBe(expectations.fullScanCallCount)
      }
    } else {
      expect(stats.fullScanCalls).toBe(0)
    }
  }
}

// Helper to run a test with index usage tracking (automatically handles setup/cleanup)
function withIndexTracking(
  collection: any,
  testFn: (tracker: { stats: IndexUsageStats }) => void | Promise<void>,
): void | Promise<void> {
  const tracker = createIndexUsageTracker(collection)

  try {
    const result = testFn(tracker)
    if (result instanceof Promise) {
      return result.finally(() => tracker.restore())
    }
    tracker.restore()
  } catch (error) {
    tracker.restore()
    throw error
  }
}

const testData: Array<TestItem> = [
  {
    id: `1`,
    name: `Alice`,
    age: 25,
    status: `active`,
    score: 95,
    createdAt: new Date(`2023-01-01`),
  },
  {
    id: `2`,
    name: `Bob`,
    age: 30,
    status: `inactive`,
    score: 80,
    createdAt: new Date(`2023-01-02`),
  },
  {
    id: `3`,
    name: `Charlie`,
    age: 35,
    status: `active`,
    score: 90,
    createdAt: new Date(`2023-01-03`),
  },
  {
    id: `4`,
    name: `Diana`,
    age: 28,
    status: `pending`,
    score: 85,
    createdAt: new Date(`2023-01-04`),
  },
  {
    id: `5`,
    name: `Eve`,
    age: 22,
    status: `active`,
    score: undefined,
    createdAt: new Date(`2023-01-05`),
  },
]

function createTestItemCollection(autoIndex: `off` | `eager` = `off`) {
  return createCollection(
    mockSyncCollectionOptions<TestItem>({
      id: `test-collection`,
      getKey: (item) => item.id,
      initialData: testData,
      autoIndex,
    }),
  )
}

describe(`Query Index Optimization`, () => {
  let collection: ReturnType<typeof createTestItemCollection>

  beforeEach(async () => {
    collection = createTestItemCollection()

    // Wait for sync to complete
    await collection.stateWhenReady()

    // Verify data was loaded
    expect(collection.size).toBe(5)
  })

  describe(`Live Query Index Optimization`, () => {
    beforeEach(() => {
      collection.createIndex((row) => row.age)
      collection.createIndex((row) => row.status)
    })

    it(`should use indexes for live queries with WHERE clauses on single collections`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) => eq(item.age, 25))
              .select(({ item }: any) => ({
                id: item.id,
                name: item.name,
                age: item.age,
              })),
          startSync: true,
        })

        // Wait for the live query to be ready
        await liveQuery.stateWhenReady()

        // Should have found Alice (age 25)
        expect(liveQuery.size).toBe(1)
        expect(liveQuery.toArray[0]?.name).toBe(`Alice`)

        // Verify that the live query used index optimization
        // The index usage should be tracked in the collection's stats
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 1,
          fullScanCallCount: 0,
        })

        // Verify the specific operation
        expect(tracker.stats.queriesExecuted[0]).toMatchObject({
          type: `index`,
          operation: `eq`,
          field: `age`,
          value: 25,
        })
      })
    })

    it(`should use indexes for live queries with range conditions`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) => gte(item.age, 30))
              .select(({ item }: any) => ({
                id: item.id,
                name: item.name,
                age: item.age,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found Bob (30) and Charlie (35)
        expect(liveQuery.size).toBe(2)
        const names = liveQuery.toArray.map((item) => item.name).sort()
        expect(names).toEqual([`Bob`, `Charlie`])

        // Verify index usage
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 1,
          fullScanCallCount: 0,
        })

        expect(tracker.stats.queriesExecuted[0]).toMatchObject({
          type: `index`,
          operation: `gte`,
          field: `age`,
          value: 30,
        })
      })
    })

    it(`should use indexes for live queries with multiple field conditions`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) =>
                and(eq(item.status, `active`), gte(item.age, 25)),
              )
              .select(({ item }: any) => ({
                id: item.id,
                name: item.name,
                age: item.age,
                status: item.status,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found Alice (25, active) and Charlie (35, active)
        expect(liveQuery.size).toBe(2)
        const names = liveQuery.toArray.map((item) => item.name).sort()
        expect(names).toEqual([`Alice`, `Charlie`])

        // Verify index usage for both conditions
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 2,
          fullScanCallCount: 0,
        })

        // Verify both operations used indexes
        expect(tracker.stats.queriesExecuted).toHaveLength(2)
        expect(tracker.stats.queriesExecuted[0]).toMatchObject({
          type: `index`,
          operation: `eq`,
          field: `status`,
          value: `active`,
        })
        expect(tracker.stats.queriesExecuted[1]).toMatchObject({
          type: `index`,
          operation: `gte`,
          field: `age`,
          value: 25,
        })
      })
    })

    it(`should use indexes for live queries with OR conditions`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) => or(eq(item.age, 25), eq(item.age, 35)))
              .select(({ item }: any) => ({
                id: item.id,
                name: item.name,
                age: item.age,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found Alice (25) and Charlie (35)
        expect(liveQuery.size).toBe(2)
        const names = liveQuery.toArray.map((item) => item.name).sort()
        expect(names).toEqual([`Alice`, `Charlie`])

        // Verify index usage for both OR conditions
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 2,
          fullScanCallCount: 0,
        })

        // Verify both operations used indexes
        expect(tracker.stats.queriesExecuted).toHaveLength(2)
        expect(tracker.stats.queriesExecuted[0]).toMatchObject({
          type: `index`,
          operation: `eq`,
          field: `age`,
          value: 25,
        })
        expect(tracker.stats.queriesExecuted[1]).toMatchObject({
          type: `index`,
          operation: `eq`,
          field: `age`,
          value: 35,
        })
      })
    })

    it(`should use indexes for live queries with inArray conditions`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) =>
                inArray(item.status, [`active`, `pending`]),
              )
              .select(({ item }: any) => ({
                id: item.id,
                name: item.name,
                status: item.status,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found Alice, Charlie, Eve (active) and Diana (pending)
        expect(liveQuery.size).toBe(4)
        const names = liveQuery.toArray.map((item) => item.name).sort()
        expect(names).toEqual([`Alice`, `Charlie`, `Diana`, `Eve`])

        // Verify index usage - should make 1 optimized 'in' call instead of 2 'eq' calls
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 1,
          fullScanCallCount: 0,
        })

        // Verify optimized 'in' operation was used for both values
        expect(tracker.stats.queriesExecuted).toHaveLength(1)
        expect(tracker.stats.queriesExecuted[0]).toMatchObject({
          type: `index`,
          operation: `in`,
          field: `status`,
          value: [`active`, `pending`],
        })
      })
    })

    it(`should fall back to full scan for live queries with complex expressions`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) => gt(length(item.name), 4)) // `length` is not supported by the collection index system
              .select(({ item }: any) => ({
                id: item.id,
                name: item.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found items with names longer than 4 characters
        expect(liveQuery.size).toBeGreaterThan(0)

        // Should fall back to full scan for complex expressions
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: false,
          shouldUseFullScan: true,
          indexCallCount: 0,
          fullScanCallCount: 1,
        })
      })
    })

    it(`should not optimize live queries with joins`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        // Create a second collection for the join
        const secondCollection = createCollection<TestItem, string>({
          getKey: (item) => item.id,
          startSync: true,
          sync: {
            sync: ({ begin, write, commit }) => {
              begin()
              write({
                type: `insert`,
                value: {
                  id: `other1`,
                  name: `Other Item`,
                  age: 40,
                  status: `active`,
                  createdAt: new Date(),
                },
              })
              commit()
            },
          },
        })

        await secondCollection.stateWhenReady()

        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join({ other: secondCollection }, ({ item, other }: any) =>
                eq(item.status, other.status),
              )
              .where(({ item }: any) => eq(item.age, 25))
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found results (Alice with matching status)
        expect(liveQuery.size).toBeGreaterThan(0)

        // Should use index optimization for WHERE clauses that only touch the main collection
        // even when there are joins, because the optimizer can push down single-source clauses
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 1, // The age=25 condition can use index
          fullScanCallCount: 0, // No full scan needed for the main collection
        })
      })
    })

    it(`should not optimize live queries with GROUP BY`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) => eq(item.status, `active`))
              .groupBy(({ item }: any) => [item.status])
              .select(({ item }: any) => ({
                status: item.status,
                count: count(item.id), // This will be aggregated
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found aggregated results
        expect(liveQuery.size).toBeGreaterThan(0)

        // Should use index optimization for the WHERE clause even with GROUP BY
        // because the WHERE clause only touches the main collection and doesn't affect GROUP BY semantics
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 1, // The status='active' condition can use index
          fullScanCallCount: 0,
        })
      })
    })

    it(`should use indexes for both main and joined sources when both are indexed`, async () => {
      // Create a second collection for the join with its own index
      const secondCollection = createCollection<TestItem, string>({
        getKey: (item) => item.id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit }) => {
            begin()
            write({
              type: `insert`,
              value: {
                id: `1`, // Matches Alice from main collection
                name: `Other Active Item`,
                age: 40,
                status: `active`,
                createdAt: new Date(),
              },
            })
            write({
              type: `insert`,
              value: {
                id: `2`, // Matches Bob from main collection
                name: `Other Inactive Item`,
                age: 35,
                status: `inactive`,
                createdAt: new Date(),
              },
            })
            commit()
          },
        },
      })

      // Create indexes on both collections for the same field
      collection.createIndex((row) => row.status)
      secondCollection.createIndex((row) => row.status)

      await secondCollection.stateWhenReady()

      // Track both collections
      const tracker1 = createIndexUsageTracker(collection)
      const tracker2 = createIndexUsageTracker(secondCollection)

      try {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join({ other: secondCollection }, ({ item, other }: any) =>
                eq(item.id, other.id),
              )
              .where(({ item, other }: any) =>
                and(eq(item.status, `active`), eq(other.status, `active`)),
              )
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found results where both items are active
        expect(liveQuery.size).toBeGreaterThan(0)

        // Combine stats from both collections
        const combinedStats: IndexUsageStats = {
          rangeQueryCalls:
            tracker1.stats.rangeQueryCalls + tracker2.stats.rangeQueryCalls,
          fullScanCalls:
            tracker1.stats.fullScanCalls + tracker2.stats.fullScanCalls,
          indexesUsed: [
            ...tracker1.stats.indexesUsed,
            ...tracker2.stats.indexesUsed,
          ],
          queriesExecuted: [
            ...tracker1.stats.queriesExecuted,
            ...tracker2.stats.queriesExecuted,
          ],
        }

        // Should use index optimization for both WHERE clauses
        // since they each touch only a single source and both sources are indexed
        expectIndexUsage(combinedStats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 2, // Both item.status='active' and other.status='active' can use indexes
          fullScanCallCount: 0,
        })
      } finally {
        tracker1.restore()
        tracker2.restore()
      }
    })

    it(`should use index of biggest collection when inner-joining collections`, async () => {
      // Create a second collection for the join with its own index
      const secondCollection = createCollection<TestItem2, string>({
        getKey: (item) => item.id2,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit }) => {
            begin()
            write({
              type: `insert`,
              value: {
                id2: `1`,
                name: `Other Active Item`,
                age: 40,
                status: `active`,
                createdAt: new Date(),
              },
            })
            write({
              type: `insert`,
              value: {
                id2: `other2`,
                name: `Other Inactive Item`,
                age: 35,
                status: `inactive`,
                createdAt: new Date(),
              },
            })
            commit()
          },
        },
      })

      // Since we're using an inner join, it will iterate over the smallest collection
      // and join in matching keys from the bigger collection
      // so it will iterate over the second collection and use the index for the status to find active items
      // then for each such item (there is only 1), it will do an index lookup into the first collection to find matching items
      // So we need an index on the status for the second collection
      // and an index on the id for the first collection
      collection.createIndex((row) => row.id)

      await secondCollection.stateWhenReady()

      // Track both collections
      const tracker1 = createIndexUsageTracker(collection)
      const tracker2 = createIndexUsageTracker(secondCollection)

      try {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join(
                { other: secondCollection },
                ({ item, other }: any) => eq(item.id, other.id2),
                `inner`,
              )
              .where(({ item, other }: any) =>
                and(eq(item.status, `active`), eq(other.status, `active`)),
              )
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found results where both items are active
        expect(liveQuery.toArray).toEqual([
          { id: `1`, name: `Alice`, otherName: `Other Active Item` },
        ])

        // We should have done an index lookup on the 2nd collection to find active items
        // There should only be 1 active item in the second collection and it has id "1"
        expect(tracker2.stats.queriesExecuted).toEqual([
          {
            type: `fullScan`,
          },
        ])

        // We should have done 2 index lookups:
        // 1. to find active items
        // 2. to find items with matching IDs
        expect(tracker1.stats.queriesExecuted).toEqual([
          {
            type: `index`,
            operation: `eq`,
            field: `status`,
            value: `active`,
          },
          {
            type: `index`,
            operation: `in`,
            field: `id`,
            value: [`1`],
          },
        ])
      } finally {
        tracker1.restore()
        tracker2.restore()
      }
    })

    it(`should not optimize inner join if biggest collection has no index on the join key`, async () => {
      // Create a second collection for the join with its own index
      const secondCollection = createCollection<TestItem2, string>({
        getKey: (item) => item.id2,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit }) => {
            begin()
            write({
              type: `insert`,
              value: {
                id2: `1`,
                name: `Other Active Item`,
                age: 40,
                status: `active`,
                createdAt: new Date(),
              },
            })
            write({
              type: `insert`,
              value: {
                id2: `other2`,
                name: `Other Inactive Item`,
                age: 35,
                status: `inactive`,
                createdAt: new Date(),
              },
            })
            commit()
          },
        },
      })

      await secondCollection.stateWhenReady()

      // Track both collections
      const tracker1 = createIndexUsageTracker(collection)
      const tracker2 = createIndexUsageTracker(secondCollection)

      try {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join(
                { other: secondCollection },
                ({ item, other }: any) => eq(item.id, other.id2),
                `inner`,
              )
              .where(({ item, other }: any) =>
                and(eq(item.status, `active`), eq(other.status, `active`)),
              )
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found results where both items are active
        expect(liveQuery.size).toBe(1)

        // We should have done an index lookup on the 2nd collection to find active items
        // There should only be 1 active item in the second collection and it has id "1"
        expect(tracker2.stats.queriesExecuted).toEqual([
          {
            type: `fullScan`,
          },
        ])

        // We should have done an index lookup on the 1st collection to find active items
        expect(tracker1.stats.queriesExecuted).toEqual([
          {
            type: `index`,
            operation: `eq`,
            field: `status`,
            value: `active`,
          },
        ])
      } finally {
        tracker1.restore()
        tracker2.restore()
      }
    })

    it(`should use index of right collection when left-joining collections`, async () => {
      // Create a second collection for the join with its own index
      const secondCollection = createCollection<TestItem2, string>({
        getKey: (item) => item.id2,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit }) => {
            begin()
            write({
              type: `insert`,
              value: {
                id2: `1`,
                name: `Other Active Item`,
                age: 40,
                status: `active`,
                createdAt: new Date(),
              },
            })
            write({
              type: `insert`,
              value: {
                id2: `other2`,
                name: `Other Inactive Item`,
                age: 35,
                status: `inactive`,
                createdAt: new Date(),
              },
            })
            commit()
          },
        },
      })

      // Since we're using a left join, it will iterate over the left collection
      // and join in matching keys from the right collection
      secondCollection.createIndex((row) => row.id2)

      await secondCollection.stateWhenReady()

      // Track both collections
      const tracker1 = createIndexUsageTracker(collection)
      const tracker2 = createIndexUsageTracker(secondCollection)

      try {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join(
                { other: secondCollection },
                ({ item, other }: any) => eq(item.id, other.id2),
                `left`,
              )
              .where(({ item, other }: any) =>
                and(eq(item.status, `active`), eq(other.status, `active`)),
              )
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should only include results where both sides match the WHERE condition
        // Charlie and Eve are filtered out because they have no matching 'other' records
        // and the WHERE clause requires other.status = 'active' (can't be NULL)
        expect(liveQuery.toArray).toEqual([
          { id: `1`, name: `Alice`, otherName: `Other Active Item` },
        ])

        // Combine stats from both collections
        const combinedStats: IndexUsageStats = {
          rangeQueryCalls:
            tracker1.stats.rangeQueryCalls + tracker2.stats.rangeQueryCalls,
          fullScanCalls:
            tracker1.stats.fullScanCalls + tracker2.stats.fullScanCalls,
          indexesUsed: [
            ...tracker1.stats.indexesUsed,
            ...tracker2.stats.indexesUsed,
          ],
          queriesExecuted: [
            ...tracker1.stats.queriesExecuted,
            ...tracker2.stats.queriesExecuted,
          ],
        }

        // We should have done an index lookup on the 1st collection to find active items
        expect(tracker1.stats.queriesExecuted).toEqual([
          {
            type: `index`,
            operation: `eq`,
            field: `status`,
            value: `active`,
          },
        ])

        // For each active item from the first collection
        // we must have done an index lookup on the 2nd collection to find matching items
        expect(tracker2.stats.queriesExecuted).toEqual([
          {
            type: `index`,
            operation: `in`,
            field: `id2`,
            value: [`1`, `3`, `5`],
          },
        ])

        expectIndexUsage(combinedStats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 2,
          fullScanCallCount: 0,
        })
      } finally {
        tracker1.restore()
        tracker2.restore()
      }
    })

    it(`should not optimize left join if right collection has no index on the join key`, async () => {
      // Create a second collection for the join with its own index
      const secondCollection = createCollection<TestItem2, string>({
        getKey: (item) => item.id2,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit }) => {
            begin()
            write({
              type: `insert`,
              value: {
                id2: `1`,
                name: `Other Active Item`,
                age: 40,
                status: `active`,
                createdAt: new Date(),
              },
            })
            write({
              type: `insert`,
              value: {
                id2: `other2`,
                name: `Other Inactive Item`,
                age: 35,
                status: `inactive`,
                createdAt: new Date(),
              },
            })
            commit()
          },
        },
      })

      await secondCollection.stateWhenReady()

      // Track both collections
      const tracker1 = createIndexUsageTracker(collection)
      const tracker2 = createIndexUsageTracker(secondCollection)

      try {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join(
                { other: secondCollection },
                ({ item, other }: any) => eq(item.id, other.id2),
                `left`,
              )
              .where(({ item, other }: any) =>
                and(eq(item.status, `active`), eq(other.status, `active`)),
              )
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should only include results where both sides match the WHERE condition
        // Charlie and Eve are filtered out because they have no matching 'other' records
        // and the WHERE clause requires other.status = 'active' (can't be NULL)
        expect(liveQuery.toArray).toEqual([
          { id: `1`, name: `Alice`, otherName: `Other Active Item` },
        ])

        // We should have done an index lookup on the left collection to find active items
        expect(tracker1.stats.queriesExecuted).toEqual([
          {
            type: `index`,
            operation: `eq`,
            field: `status`,
            value: `active`,
          },
        ])

        // We should have done a full scanof the right collection
        // because it doesn't have any indexes
        expect(tracker2.stats.queriesExecuted).toEqual([
          {
            type: `fullScan`,
          },
        ])
      } finally {
        tracker1.restore()
        tracker2.restore()
      }
    })

    it(`should use index of left collection when right-joining collections`, async () => {
      // Create a second collection for the join with its own index
      const secondCollection = createCollection<TestItem2, string>({
        getKey: (item) => item.id2,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit }) => {
            begin()
            write({
              type: `insert`,
              value: {
                id2: `1`,
                name: `Other Active Item`,
                age: 40,
                status: `active`,
                createdAt: new Date(),
              },
            })
            write({
              type: `insert`,
              value: {
                id2: `other2`,
                name: `Other Inactive Item`,
                age: 35,
                status: `inactive`,
                createdAt: new Date(),
              },
            })
            commit()
          },
        },
      })

      // Since we're using a right join, it will iterate over the right collection
      // and join in matching keys from the left collection
      collection.createIndex((row) => row.id)

      await secondCollection.stateWhenReady()

      // Track both collections
      const tracker1 = createIndexUsageTracker(collection)
      const tracker2 = createIndexUsageTracker(secondCollection)

      try {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join(
                { other: secondCollection },
                ({ item, other }: any) => eq(item.id, other.id2),
                `right`,
              )
              .where(({ item, other }: any) =>
                and(eq(item.status, `active`), eq(other.status, `active`)),
              )
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should include all results from the first collection
        expect(liveQuery.toArray).toEqual([
          { id: `1`, name: `Alice`, otherName: `Other Active Item` },
        ])

        // We should have done a full scan of the right collection
        expect(tracker2.stats.queriesExecuted).toEqual([
          {
            type: `fullScan`,
          },
        ])

        // We should have done an index lookup on the 1st collection to find active items
        expect(tracker1.stats.queriesExecuted).toEqual([
          {
            field: `status`,
            operation: `eq`,
            type: `index`,
            value: `active`,
          },
          {
            type: `index`,
            operation: `in`,
            field: `id`,
            value: [`1`],
          },
        ])
      } finally {
        tracker1.restore()
        tracker2.restore()
      }
    })

    it(`should not optimize right join if left collection has no index on the join key`, async () => {
      // Create a second collection for the join with its own index
      const secondCollection = createCollection<TestItem2, string>({
        getKey: (item) => item.id2,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit }) => {
            begin()
            write({
              type: `insert`,
              value: {
                id2: `1`,
                name: `Other Active Item`,
                age: 40,
                status: `active`,
                createdAt: new Date(),
              },
            })
            write({
              type: `insert`,
              value: {
                id2: `other2`,
                name: `Other Inactive Item`,
                age: 35,
                status: `inactive`,
                createdAt: new Date(),
              },
            })
            commit()
          },
        },
      })

      await secondCollection.stateWhenReady()

      // Track both collections
      const tracker1 = createIndexUsageTracker(collection)
      const tracker2 = createIndexUsageTracker(secondCollection)

      try {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .join(
                { other: secondCollection },
                ({ item, other }: any) => eq(item.id, other.id2),
                `right`,
              )
              .where(({ item, other }: any) =>
                and(eq(item.status, `active`), eq(other.status, `active`)),
              )
              .select(({ item, other }: any) => ({
                id: item.id,
                name: item.name,
                otherName: other.name,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found results where both items are active
        expect(liveQuery.toArray).toEqual([
          { id: `1`, name: `Alice`, otherName: `Other Active Item` },
        ])

        // We should have done a full scan of the right collection
        // because it has no indexes
        expect(tracker2.stats.queriesExecuted).toEqual([
          {
            type: `fullScan`,
          },
        ])

        // We should have done an index lookup on the left collection to find active items
        // because it has an index on the join key
        expect(tracker1.stats.queriesExecuted).toEqual([
          {
            type: `index`,
            operation: `eq`,
            field: `status`,
            value: `active`,
          },
        ])
      } finally {
        tracker1.restore()
        tracker2.restore()
      }
    })

    it(`should optimize live queries with ORDER BY and LIMIT`, async () => {
      collection.createIndex((row) => row.age)

      const liveQuery = createLiveQueryCollection({
        query: (q: any) =>
          q
            .from({ item: collection })
            .where(({ item }: any) => eq(item.status, `active`))
            .orderBy(({ item }: any) => item.age)
            .limit(2)
            .select(({ item }: any) => ({
              id: item.id,
              name: item.name,
              age: item.age,
            })),
        startSync: true,
      })

      await liveQuery.stateWhenReady()

      // Should have found limited results
      expect(liveQuery.size).toBe(2)

      expect(liveQuery.toArray).toEqual([
        { id: `5`, name: `Eve`, age: 22 },
        { id: `1`, name: `Alice`, age: 25 },
      ])

      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `6`,
          name: `Dave`,
          age: 20,
          status: `active`,
          score: undefined,
          createdAt: new Date(`2023-01-09`),
        },
      })
      collection.utils.commit()

      expect(liveQuery.size).toBe(2)

      expect(liveQuery.toArray).toEqual([
        { id: `6`, name: `Dave`, age: 20 },
        { id: `5`, name: `Eve`, age: 22 },
      ])
    })

    it(`should stop loading data for live queries with ORDER BY and LIMIT if no more data available`, async () => {
      collection.createIndex((row) => row.age)

      const liveQuery = createLiveQueryCollection({
        query: (q: any) =>
          q
            .from({ item: collection })
            .orderBy(({ item }: any) => item.age)
            .limit(10) // limit > than total number of items in the collection (5)
            .select(({ item }: any) => ({
              id: item.id,
              name: item.name,
              age: item.age,
            })),
        startSync: true,
      })

      await liveQuery.stateWhenReady()

      expect(liveQuery.size).toBe(5)

      // Insert a new item
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `6`,
          name: `Dave`,
          age: 29,
          status: `active`,
          score: undefined,
          createdAt: new Date(`2023-01-09`),
        },
      })
      collection.utils.commit()

      expect(liveQuery.size).toBe(6)

      expect(liveQuery.toArray).toEqual([
        { id: `5`, name: `Eve`, age: 22 },
        { id: `1`, name: `Alice`, age: 25 },
        { id: `4`, name: `Diana`, age: 28 },
        { id: `6`, name: `Dave`, age: 29 },
        { id: `2`, name: `Bob`, age: 30 },
        { id: `3`, name: `Charlie`, age: 35 },
      ])
    })

    it(`should handle live queries without WHERE clauses`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q.from({ item: collection }).select(({ item }: any) => ({
              id: item.id,
              name: item.name,
              age: item.age,
            })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found all items
        expect(liveQuery.size).toBe(5)

        // Should NOT use index optimization because there's no WHERE clause
        // but should still use full scan to get all data
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: false,
          shouldUseFullScan: true,
          indexCallCount: 0,
          fullScanCallCount: 1, // Need to scan collection to get all data
        })
      })
    })

    it(`should handle live queries with functional WHERE clauses`, async () => {
      await withIndexTracking(collection, async (tracker) => {
        const liveQuery = createLiveQueryCollection({
          query: (q: any) =>
            q
              .from({ item: collection })
              .where(({ item }: any) => gt(item.age, 25))
              .select(({ item }: any) => ({
                id: item.id,
                name: item.name,
                age: item.age,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()

        // Should have found items with age > 25
        expect(liveQuery.size).toBeGreaterThan(0)

        // Should use index optimization for functional WHERE clauses that use supported functions
        expectIndexUsage(tracker.stats, {
          shouldUseIndex: true,
          shouldUseFullScan: false,
          indexCallCount: 1, // The gt(item.age, 25) condition can use index
          fullScanCallCount: 0,
        })
      })
    })
  })
})
