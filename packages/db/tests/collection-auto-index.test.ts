import { describe, expect, it } from "vitest"
import { createCollection } from "../src/collection"
import {
  and,
  eq,
  gt,
  length,
  lte,
  not,
  or,
} from "../src/query/builder/functions"
import { createSingleRowRefProxy } from "../src/query/builder/ref-proxy"
import { expectIndexUsage, withIndexTracking } from "./utls"

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
    const unsubscribe = autoIndexCollection.subscribeChanges(
      (items) => {
        changes.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: eq(row.status, `active`),
      }
    )

    // Should still have no indexes after subscription
    expect(autoIndexCollection.indexes.size).toBe(0)

    unsubscribe()
  })

  it(`should create auto-indexes by default when autoIndex is not specified`, async () => {
    const autoIndexCollection = createCollection<TestItem, string>({
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

    await autoIndexCollection.stateWhenReady()

    // Should have no indexes initially
    expect(autoIndexCollection.indexes.size).toBe(0)

    // Subscribe with a where expression
    const changes: Array<any> = []
    const unsubscribe = autoIndexCollection.subscribeChanges(
      (items) => {
        changes.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: eq(row.status, `active`),
      }
    )

    // Should have created an auto-index for the status field (default is eager)
    expect(autoIndexCollection.indexes.size).toBe(1)

    const autoIndex = Array.from(autoIndexCollection.indexes.values())[0]!
    expect(autoIndex.expression.type).toBe(`ref`)
    expect((autoIndex.expression as any).path).toEqual([`status`])

    unsubscribe()
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
    const unsubscribe = autoIndexCollection.subscribeChanges(
      (items) => {
        changes.push(...items)
      },
      {
        includeInitialState: true,
        whereExpression: eq(row.status, `active`),
      }
    )

    // Should have created an auto-index for the status field
    expect(autoIndexCollection.indexes.size).toBe(1)

    const autoIndex = Array.from(autoIndexCollection.indexes.values())[0]!
    expect(autoIndex.expression.type).toBe(`ref`)
    expect((autoIndex.expression as any).path).toEqual([`status`])

    unsubscribe()
  })

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
    const unsubscribe1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `active`),
    })

    const unsubscribe2 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `inactive`),
    })

    const unsubscribe3 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `pending`),
    })

    // Should only have one index for the status field
    expect(autoIndexCollection.indexes.size).toBe(1)

    const autoIndex = Array.from(autoIndexCollection.indexes.values())[0]!
    expect(autoIndex.expression.type).toBe(`ref`)
    expect((autoIndex.expression as any).path).toEqual([`status`])

    unsubscribe1()
    unsubscribe2()
    unsubscribe3()
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
    const unsubscribe1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `active`),
    })

    const unsubscribe2 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: gt(row.age, 25),
    })

    const unsubscribe3 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: lte(row.score!, 90),
    })

    // Should have created indexes for each field
    expect(autoIndexCollection.indexes.size).toBe(3)

    const indexPaths = Array.from(autoIndexCollection.indexes.values()).map(
      (index) => (index.expression as any).path
    )

    expect(indexPaths).toContainEqual([`status`])
    expect(indexPaths).toContainEqual([`age`])
    expect(indexPaths).toContainEqual([`score`])

    unsubscribe1()
    unsubscribe2()
    unsubscribe3()
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
    const unsubscribe1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: and(eq(row.status, `active`), gt(row.age, 25)),
    })

    // Should have created indexes for both fields in the AND expression
    expect(autoIndexCollection.indexes.size).toBe(2)

    const indexPaths = Array.from(autoIndexCollection.indexes.values()).map(
      (index) => (index.expression as any).path
    )

    expect(indexPaths).toContainEqual([`status`])
    expect(indexPaths).toContainEqual([`age`])

    unsubscribe1()
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
    const unsubscribe1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: or(eq(row.status, `active`), eq(row.status, `pending`)),
    })

    // Should not have created any auto-indexes for OR expressions
    expect(autoIndexCollection.indexes.size).toBe(0)

    unsubscribe1()
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
    const unsubscribe1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: and(
        eq(row.status, `active`),
        gt(row.age, 25),
        lte(row.score!, 90)
      ),
    })

    // Should have created indexes for all three fields in the AND expression
    expect(autoIndexCollection.indexes.size).toBe(3)

    const indexPaths = Array.from(autoIndexCollection.indexes.values()).map(
      (index) => (index.expression as any).path
    )

    expect(indexPaths).toContainEqual([`status`])
    expect(indexPaths).toContainEqual([`age`])
    expect(indexPaths).toContainEqual([`score`])

    unsubscribe1()
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
    const unsubscribe1 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: gt(length(row.name), 3),
    })

    const unsubscribe2 = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: not(eq(row.status, `active`)),
    })

    // Should not have created any auto-indexes for unsupported operations
    expect(autoIndexCollection.indexes.size).toBe(0)

    unsubscribe1()
    unsubscribe2()
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
    const unsubscribe = autoIndexCollection.subscribeChanges(() => {}, {
      whereExpression: eq(row.status, `active`),
    })

    // Verify auto-index was created
    expect(autoIndexCollection.indexes.size).toBe(1)

    // Test that the auto-index is used for queries
    withIndexTracking(autoIndexCollection, (tracker) => {
      const result = autoIndexCollection.currentStateAsChanges({
        whereExpression: eq(row.status, `active`),
      })

      expect(result.length).toBeGreaterThan(0)

      // Verify it used the auto-created index
      expectIndexUsage(tracker.stats, {
        shouldUseIndex: true,
        shouldUseFullScan: false,
        indexCallCount: 1,
        fullScanCallCount: 0,
      })
    })

    unsubscribe()
  })
})
