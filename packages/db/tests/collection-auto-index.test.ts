import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import {
  and,
  eq,
  gt,
  length,
  lte,
  not,
  or,
} from '../src/query/builder/functions'
import { createSingleRowRefProxy } from '../src/query/builder/ref-proxy'
import { createLiveQueryCollection } from '../src'
import { PropRef } from '../src/query/ir'
import {
  createIndexUsageTracker,
  expectIndexUsage,
  withIndexTracking,
} from './utils'

// Global row proxy for expressions
const row = createSingleRowRefProxy<TestItem>()

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

const testData: Array<TestItem> = [
  {
    id: `1`,
    name: `Alice`,
    age: 25,
    status: `active`,
    score: 85,
    createdAt: new Date(`2023-01-01`),
  },
  {
    id: `2`,
    name: `Bob`,
    age: 30,
    status: `inactive`,
    score: 92,
    createdAt: new Date(`2023-01-02`),
  },
  {
    id: `3`,
    name: `Charlie`,
    age: 35,
    status: `pending`,
    score: 78,
    createdAt: new Date(`2023-01-03`),
  },
  {
    id: `4`,
    name: `Diana`,
    age: 28,
    status: `active`,
    score: 95,
    createdAt: new Date(`2023-01-04`),
  },
  {
    id: `5`,
    name: `Eve`,
    age: 32,
    status: `inactive`,
    score: 88,
    createdAt: new Date(`2023-01-05`),
  },
]

describe(`Collection Auto-Indexing`, () => {
  it(`should not create auto-indexes when autoIndex is "off"`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `off`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Should have no indexes initially
    expect(autoIndexCollection.indexes.size).toBe(0)

    // Subscribe with a where expression
    const changes: Array<any> = []
    const subscription = autoIndexCollection.subscribeChanges(
      (items) => {
        changes.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: eq(row.status, `active`),
      },
    )

    // Should still have no indexes after subscription
    expect(autoIndexCollection.indexes.size).toBe(0)

    subscription.unsubscribe()
  })

  it(`should not create auto-indexes by default when autoIndex is not specified`, async () => {
    const noAutoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await noAutoIndexCollection.stateWhenReady()

    // Should have no indexes initially
    expect(noAutoIndexCollection.indexes.size).toBe(0)

    // Subscribe with a where expression
    const changes: Array<any> = []
    const subscription = noAutoIndexCollection.subscribeChanges(
      (items) => {
        changes.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: eq(row.status, `active`),
      },
    )

    // Should have created an auto-index for the status field (default is eager)
    expect(noAutoIndexCollection.indexes.size).toBe(0)

    subscription.unsubscribe()
  })

  it(`should create auto-indexes for simple where expressions when autoIndex is "eager"`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Should have no indexes initially
    expect(autoIndexCollection.indexes.size).toBe(0)

    // Subscribe with a where expression
    const changes: Array<any> = []
    const subscription = autoIndexCollection.subscribeChanges(
      (items) => {
        changes.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: eq(row.status, `active`),
      },
    )

    // Should have created an auto-index for the status field
    expect(autoIndexCollection.indexes.size).toBe(1)

    const autoIndex = Array.from(autoIndexCollection.indexes.values())[0]!
    expect(autoIndex.expression.type).toBe(`ref`)
    expect((autoIndex.expression as any).path).toEqual([`status`])

    subscription.unsubscribe()
  })

  it(`should create auto-indexes for transformed fields of subqueries when autoIndex is "eager"`, async () => {})

  it(`should not create duplicate auto-indexes for the same field`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Subscribe with the same where expression multiple times
    const subscription1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `active`),
    })

    const subscription2 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `inactive`),
    })

    const subscription3 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `pending`),
    })

    // Should only have one index for the status field
    expect(autoIndexCollection.indexes.size).toBe(1)

    const autoIndex = Array.from(autoIndexCollection.indexes.values())[0]!
    expect(autoIndex.expression.type).toBe(`ref`)
    expect((autoIndex.expression as any).path).toEqual([`status`])

    subscription1.unsubscribe()
    subscription2.unsubscribe()
    subscription3.unsubscribe()
  })

  it(`should create auto-indexes for different supported operations`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Subscribe with different operations on different fields
    const subscription1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `active`),
    })

    const subscription2 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: gt(row.age, 25),
    })

    const subscription3 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: lte(row.score, 90),
    })

    // Should have created indexes for each field
    expect(autoIndexCollection.indexes.size).toBe(3)

    const indexPaths = Array.from(autoIndexCollection.indexes.values()).map(
      (index) => (index.expression as any).path,
    )

    expect(indexPaths).toContainEqual([`status`])
    expect(indexPaths).toContainEqual([`age`])
    expect(indexPaths).toContainEqual([`score`])

    subscription1.unsubscribe()
    subscription2.unsubscribe()
    subscription3.unsubscribe()
  })

  it(`should create auto-indexes for AND expressions`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Subscribe with AND expression that should create indexes for both fields
    const subscription = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: and(eq(row.status, `active`), gt(row.age, 25)),
    })

    // Should have created indexes for both fields in the AND expression
    expect(autoIndexCollection.indexes.size).toBe(2)

    const indexPaths = Array.from(autoIndexCollection.indexes.values()).map(
      (index) => (index.expression as any).path,
    )

    expect(indexPaths).toContainEqual([`status`])
    expect(indexPaths).toContainEqual([`age`])

    subscription.unsubscribe()
  })

  it(`should not create auto-indexes for OR expressions`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Subscribe with OR expression that shouldn't create auto-indexes
    const subscription = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: or(eq(row.status, `active`), eq(row.status, `pending`)),
    })

    // Should not have created any auto-indexes for OR expressions
    expect(autoIndexCollection.indexes.size).toBe(0)

    subscription.unsubscribe()
  })

  it(`should create auto-indexes for complex AND expressions with multiple fields`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Subscribe with complex AND expression that should create indexes for all fields
    const subscription = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: and(
        eq(row.status, `active`),
        gt(row.age, 25),
        lte(row.score, 90),
      ),
    })

    // Should have created indexes for all three fields in the AND expression
    expect(autoIndexCollection.indexes.size).toBe(3)

    const indexPaths = Array.from(autoIndexCollection.indexes.values()).map(
      (index) => (index.expression as any).path,
    )

    expect(indexPaths).toContainEqual([`status`])
    expect(indexPaths).toContainEqual([`age`])
    expect(indexPaths).toContainEqual([`score`])

    subscription.unsubscribe()
  })

  it(`should create auto-indexes for join key on lazy collection when joining`, async () => {
    const leftCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
      onInsert: async (_) => {},
    })

    const rightCollection = createCollection<TestItem2, string>({
      getKey: (item) => item.id2,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
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
          markReady()
        },
      },
    })

    await rightCollection.stateWhenReady()

    const liveQuery = createLiveQueryCollection({
      query: (q: any) =>
        q
          .from({ item: leftCollection })
          .join(
            { other: rightCollection },
            ({ item, other }: any) => eq(item.id, other.id2),
            `left`,
          )
          .select(({ item, other }: any) => ({
            id: item.id,
            name: item.name,
            otherName: other.name,
          })),
      startSync: true,
    })

    await liveQuery.stateWhenReady()

    expect(liveQuery.size).toBe(testData.length)

    expect(rightCollection.indexes.size).toBe(1)

    const index = rightCollection.indexes.values().next().value!
    expect(index.expression).toEqual({
      type: `ref`,
      path: [`id2`],
    })

    const tracker = createIndexUsageTracker(rightCollection)

    // Now send another item through the left collection
    // and check that it used the index to join it to items of the right collection

    leftCollection.insert({
      id: `other2`,
      name: `New Item`,
      age: 25,
      status: `active`,
      createdAt: new Date(),
    })

    expect(tracker.stats.queriesExecuted).toEqual([
      {
        type: `index`,
        operation: `in`,
        field: `id2`,
        value: [`other2`],
      },
    ])

    expect(liveQuery.size).toBe(testData.length + 1)

    tracker.restore()
  })

  it(`should create auto-indexes for join key on lazy collection when joining subquery`, async () => {
    const leftCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
      onInsert: async (_) => {},
    })

    const rightCollection = createCollection<TestItem2, string>({
      getKey: (item) => item.id2,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
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
          markReady()
        },
      },
    })

    await rightCollection.stateWhenReady()

    const liveQuery = createLiveQueryCollection({
      query: (q: any) =>
        q
          .from({ item: leftCollection })
          .join(
            {
              other: q
                .from({ other: rightCollection })
                .select(({ other }: any) => ({
                  id2: other.id2,
                  name: other.name,
                })),
            },
            ({ item, other }: any) => eq(item.id, other.id2),
            `left`,
          )
          .select(({ item, other }: any) => ({
            id: item.id,
            name: item.name,
            otherName: other.name,
          })),
      startSync: true,
    })

    await liveQuery.stateWhenReady()

    expect(liveQuery.size).toBe(testData.length)

    expect(rightCollection.indexes.size).toBe(1)

    const index = rightCollection.indexes.values().next().value!
    expect(index.expression).toEqual({
      type: `ref`,
      path: [`id2`],
    })

    const tracker = createIndexUsageTracker(rightCollection)

    // Now send another item through the left collection
    // and check that it used the index to join it to items of the right collection

    leftCollection.insert({
      id: `other2`,
      name: `New Item`,
      age: 25,
      status: `active`,
      createdAt: new Date(),
    })

    expect(tracker.stats.queriesExecuted).toEqual([
      {
        type: `index`,
        operation: `in`,
        field: `id2`,
        value: [`other2`],
      },
    ])

    expect(liveQuery.size).toBe(testData.length + 1)

    tracker.restore()
  })

  it(`should not create auto-indexes for unsupported operations`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Subscribe with unsupported operations
    const subscription1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: gt(length(row.name), 3),
    })

    const subscription2 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: not(eq(row.status, `active`)),
    })

    // Should not have created any auto-indexes for unsupported operations
    expect(autoIndexCollection.indexes.size).toBe(0)

    subscription1.unsubscribe()
    subscription2.unsubscribe()
  })

  it(`should use auto-created indexes for query optimization`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of testData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await autoIndexCollection.stateWhenReady()

    // Subscribe to create auto-index
    const subscription = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `active`),
    })

    // Verify auto-index was created
    expect(autoIndexCollection.indexes.size).toBe(1)

    // Test that the auto-index is used for queries
    withIndexTracking(autoIndexCollection, (tracker) => {
      const result = autoIndexCollection.currentStateAsChanges({
        where: eq(new PropRef([`status`]), `active`),
      })!

      expect(result.length).toBeGreaterThan(0)

      // Verify it used the auto-created index
      expectIndexUsage(tracker.stats, {
        shouldUseIndex: true,
        shouldUseFullScan: false,
        indexCallCount: 1,
        fullScanCallCount: 0,
      })
    })

    subscription.unsubscribe()
  })

  it(`should create auto-indexes for nested field paths`, async () => {
    interface NestedTestItem {
      id: string
      name: string
      profile?: {
        score: number
        bio: string
      }
      metadata?: {
        tags: Array<string>
        stats: {
          views: number
          likes: number
        }
      }
    }

    const nestedTestData: Array<NestedTestItem> = [
      {
        id: `1`,
        name: `Alice`,
        profile: { score: 85, bio: `Developer` },
        metadata: {
          tags: [`tech`, `coding`],
          stats: { views: 100, likes: 50 },
        },
      },
      {
        id: `2`,
        name: `Bob`,
        profile: { score: 92, bio: `Designer` },
        metadata: {
          tags: [`design`, `ui`],
          stats: { views: 200, likes: 75 },
        },
      },
      {
        id: `3`,
        name: `Charlie`,
        profile: { score: 78, bio: `Manager` },
        metadata: {
          tags: [`management`, `leadership`],
          stats: { views: 150, likes: 60 },
        },
      },
    ]

    const collection = createCollection<NestedTestItem, string>({
      getKey: (item) => item.id,
      autoIndex: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of nestedTestData) {
            write({
              type: `insert`,
              value: item,
            })
          }
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()

    // Should have no indexes initially
    expect(collection.indexes.size).toBe(0)

    // Test 1: Nested field one level deep (profile.score)
    const changes1: Array<any> = []
    const subscription1 = collection.subscribeChanges(
      (items) => {
        changes1.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: gt(new PropRef([`profile`, `score`]), 80),
      },
    )

    // Should have created an auto-index for profile.score
    const profileScoreIndex = Array.from(collection.indexes.values()).find(
      (index) =>
        index.expression.type === `ref` &&
        (index.expression as any).path.length === 2 &&
        (index.expression as any).path[0] === `profile` &&
        (index.expression as any).path[1] === `score`,
    )
    expect(profileScoreIndex).toBeDefined()

    // Verify the filtered results are correct
    expect(changes1.filter((c) => c.type === `insert`).length).toBe(2) // Alice (85) and Bob (92)

    subscription1.unsubscribe()

    // Test 2: Deeply nested field (metadata.stats.views)
    const changes2: Array<any> = []
    const subscription2 = collection.subscribeChanges(
      (items) => {
        changes2.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: eq(new PropRef([`metadata`, `stats`, `views`]), 200),
      },
    )

    // Should have created an auto-index for metadata.stats.views
    const viewsIndex = Array.from(collection.indexes.values()).find(
      (index) =>
        index.expression.type === `ref` &&
        (index.expression as any).path.length === 3 &&
        (index.expression as any).path[0] === `metadata` &&
        (index.expression as any).path[1] === `stats` &&
        (index.expression as any).path[2] === `views`,
    )
    expect(viewsIndex).toBeDefined()

    // Verify the filtered results are correct
    expect(changes2.filter((c) => c.type === `insert`).length).toBe(1) // Only Bob has 200 views

    subscription2.unsubscribe()

    // Test 3: Index usage verification with tracker
    withIndexTracking(collection, (tracker) => {
      const result = collection.currentStateAsChanges({
        where: gt(new PropRef([`profile`, `score`]), 80),
      })!

      expect(result.length).toBe(2) // Alice and Bob

      // Verify it used the auto-created index
      expectIndexUsage(tracker.stats, {
        shouldUseIndex: true,
        shouldUseFullScan: false,
        indexCallCount: 1,
        fullScanCallCount: 0,
      })
    })
  })
})
