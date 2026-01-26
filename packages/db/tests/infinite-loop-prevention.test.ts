import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, gt } from '../src/query/index.js'
import { mockSyncCollectionOptions } from './utils.js'

/**
 * Tests for infinite loop prevention in ORDER BY + LIMIT queries.
 *
 * The issue: When a live query has ORDER BY + LIMIT, the TopK operator
 * requests data until it has `limit` items. If the WHERE clause filters
 * out most data, the TopK may never be filled, causing excessive iterations.
 *
 * The band-aid fix: Safety limits that cap iterations and throw detailed
 * error messages with diagnostic info when exceeded:
 * - D2 graph: 100,000 iterations
 * - maybeRunGraph: 10,000 iterations
 * - requestLimitedSnapshot: 10,000 iterations
 *
 * These tests verify that queries complete without hitting safety limits.
 */

type TestItem = {
  id: number
  value: number
  category: string
}

describe(`Infinite loop prevention`, () => {
  it(`should complete ORDER BY + LIMIT query when WHERE filters out most data`, async () => {
    // Scenario: Query wants 10 items with value > 90, but only 2 exist
    // Should complete without hitting safety limits
    const initialData: Array<TestItem> = []
    for (let i = 1; i <= 20; i++) {
      initialData.push({
        id: i,
        value: i * 5, // values: 5, 10, 15, ... 95, 100
        category: i <= 10 ? `A` : `B`,
      })
    }

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `infinite-loop-test`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .where(({ items }) => gt(items.value, 90))
        .orderBy(({ items }) => items.value, `desc`)
        .limit(10)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    // Should complete without hanging or hitting safety limits
    await liveQueryCollection.preload()

    // Verify results
    const results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.value)).toEqual([100, 95])

    // Verify not in error state (didn't hit safety limit)
    expect(
      liveQueryCollection.status,
      `Query should not be in error state`,
    ).not.toBe(`error`)
  })

  it(`should load new data when it arrives after initial load`, async () => {
    // Start with data that doesn't match WHERE clause
    const initialData: Array<TestItem> = [
      { id: 1, value: 10, category: `A` },
      { id: 2, value: 20, category: `A` },
      { id: 3, value: 30, category: `A` },
    ]

    const { utils, ...options } = mockSyncCollectionOptions({
      id: `resume-loading-test`,
      getKey: (item: TestItem) => item.id,
      initialData,
    })

    const sourceCollection = createCollection(options)
    await sourceCollection.preload()

    // Query wants items with value > 50, ordered by value, limit 5
    // Initially 0 items match
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .where(({ items }) => gt(items.value, 50))
        .orderBy(({ items }) => items.value, `desc`)
        .limit(5)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    // Initially 0 results
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(0)

    // Add new data that matches WHERE clause
    utils.begin()
    utils.write({ type: `insert`, value: { id: 4, value: 60, category: `A` } })
    utils.write({ type: `insert`, value: { id: 5, value: 70, category: `A` } })
    utils.commit()

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should now have 2 items
    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.value)).toEqual([70, 60])

    // Verify not in error state
    expect(liveQueryCollection.status).not.toBe(`error`)
  })

  it(`should handle updates without entering error state`, async () => {
    const initialData: Array<TestItem> = [
      { id: 1, value: 100, category: `A` }, // Only this matches WHERE > 95
      { id: 2, value: 50, category: `A` },
      { id: 3, value: 40, category: `A` },
    ]

    const { utils, ...options } = mockSyncCollectionOptions({
      id: `updates-test`,
      getKey: (item: TestItem) => item.id,
      initialData,
    })

    const sourceCollection = createCollection(options)
    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .where(({ items }) => gt(items.value, 95))
        .orderBy(({ items }) => items.value, `desc`)
        .limit(5)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    // Should have 1 item initially
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(1)

    // Send several updates
    for (let i = 0; i < 10; i++) {
      utils.begin()
      utils.write({
        type: `update`,
        value: { id: 1, value: 100 + i, category: `A` },
      })
      utils.commit()
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should still have results and not be in error state
    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(1)
    expect(results[0]!.value).toBeGreaterThanOrEqual(100)
    expect(liveQueryCollection.status).not.toBe(`error`)
  })
})
