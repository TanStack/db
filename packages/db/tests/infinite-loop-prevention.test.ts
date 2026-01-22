import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, gt } from '../src/query/index.js'
import { mockSyncCollectionOptions } from './utils.js'

/**
 * Tests for infinite loop prevention in ORDER BY + LIMIT queries.
 *
 * The issue: When a live query has ORDER BY + LIMIT, the TopK operator
 * requests data until it has `limit` items. If the WHERE clause filters
 * out most data, the TopK may never be filled, causing loadMoreIfNeeded
 * to be called repeatedly in an infinite loop.
 *
 * The fix: CollectionSubscriber tracks when the local index is exhausted
 * via `localIndexExhausted` flag, preventing repeated load attempts.
 */

type TestItem = {
  id: number
  value: number
  category: string
}

describe(`Infinite loop prevention`, () => {
  it(`should not infinite loop when WHERE filters out most data for ORDER BY + LIMIT query`, async () => {
    // This test verifies that the localIndexExhausted optimization prevents
    // unnecessary load attempts when the TopK can't be filled.
    //
    // The scenario:
    // 1. Query wants 10 items with value > 90
    // 2. Only 2 items match (values 95 and 100)
    // 3. Without the fix, loadMoreIfNeeded would keep trying to load more
    // 4. With the fix, localIndexExhausted stops unnecessary attempts

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

    // Should complete without hanging or hitting safeguard
    await liveQueryCollection.preload()

    // Verify results
    const results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.value)).toEqual([100, 95])

    // Verify not in error state (didn't hit safeguard)
    expect(
      liveQueryCollection.status,
      `Query should not be in error state`,
    ).not.toBe(`error`)
  })

  it(`should resume loading when new matching data arrives`, async () => {
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

    // Should have 0 items initially
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(0)

    // Now add items that match the WHERE clause
    utils.begin()
    utils.write({ type: `insert`, value: { id: 4, value: 60, category: `B` } })
    utils.write({ type: `insert`, value: { id: 5, value: 70, category: `B` } })
    utils.commit()

    // Wait for changes to propagate
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should now have 2 items (localIndexExhausted was reset by new inserts)
    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.value)).toEqual([70, 60])
  })

  it(`should handle updates that move items out of WHERE clause`, async () => {
    // All items initially match WHERE clause
    const initialData: Array<TestItem> = [
      { id: 1, value: 100, category: `A` },
      { id: 2, value: 90, category: `A` },
      { id: 3, value: 80, category: `A` },
      { id: 4, value: 70, category: `A` },
      { id: 5, value: 60, category: `A` },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `update-out-of-where-test`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    // Query: WHERE value > 50, ORDER BY value DESC, LIMIT 3
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .where(({ items }) => gt(items.value, 50))
        .orderBy(({ items }) => items.value, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    // Should have top 3: 100, 90, 80
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.value)).toEqual([100, 90, 80])

    // Update items to move them OUT of WHERE clause
    // This could trigger the infinite loop if not handled properly
    sourceCollection.update(1, (draft) => {
      draft.value = 40 // Now < 50, filtered out
    })
    sourceCollection.update(2, (draft) => {
      draft.value = 30 // Now < 50, filtered out
    })

    // Wait for changes to propagate
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should now have: 80, 70, 60 (items 3, 4, 5)
    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.value)).toEqual([80, 70, 60])
  })
})
