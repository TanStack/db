import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, gt } from '../src/query/index.js'
import { CollectionSubscription } from '../src/collection/subscription.js'
import { mockSyncCollectionOptions } from './utils.js'

/**
 * Tests for infinite loop prevention in ORDER BY + LIMIT queries.
 *
 * The issue: When a live query has ORDER BY + LIMIT, the TopK operator
 * requests data until it has `limit` items. If the WHERE clause filters
 * out most data, the TopK may never be filled, causing loadMoreIfNeeded
 * to be called repeatedly in an infinite loop.
 *
 * The infinite loop specifically occurs when:
 * 1. Initial load exhausts the local index (TopK still needs more items)
 * 2. Updates arrive (e.g., from Electric sync layer converting duplicate inserts to updates)
 * 3. maybeRunGraph processes the update and calls loadMoreIfNeeded
 * 4. loadMoreIfNeeded sees dataNeeded() > 0, calls loadNextItems
 * 5. loadNextItems finds nothing (index exhausted), but without tracking this,
 *    the next iteration repeats steps 3-5 indefinitely
 *
 * The fix: CollectionSubscriber tracks when the local index is exhausted
 * via `localIndexExhausted` flag, preventing repeated load attempts.
 * The flag resets when new inserts arrive, allowing the system to try again.
 */

type TestItem = {
  id: number
  value: number
  category: string
}

describe(`Infinite loop prevention`, () => {
  // The infinite loop bug occurs when:
  // 1. Query has ORDER BY + LIMIT + WHERE that filters most data
  // 2. Sync layer (like Electric) continuously sends updates
  // 3. These updates trigger pendingWork() to remain true during maybeRunGraph
  // 4. Without the localIndexExhausted fix, loadMoreIfNeeded keeps trying to load
  //    from the exhausted local index
  //
  // These tests verify the localIndexExhausted flag works correctly:
  // - Prevents repeated load attempts when the local index is exhausted
  // - Resets when new inserts arrive, allowing the system to try again

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

  it(`should not infinite loop when updates arrive after local index is exhausted`, async () => {
    // This test simulates the Electric scenario where:
    // 1. Initial data loads, but TopK can't be filled (WHERE filters too much)
    // 2. Updates arrive from sync layer (like Electric converting duplicate inserts to updates)
    // 3. Without the fix, each update would trigger loadMoreIfNeeded which tries
    //    to load from the exhausted local index, causing an infinite loop
    //
    // The fix: localIndexExhausted flag prevents repeated load attempts.
    // The flag only resets when NEW INSERTS arrive (not updates/deletes).

    const initialData: Array<TestItem> = []
    for (let i = 1; i <= 10; i++) {
      initialData.push({
        id: i,
        value: i * 10, // values: 10, 20, 30, ... 100
        category: `A`,
      })
    }

    const { utils, ...options } = mockSyncCollectionOptions({
      id: `electric-update-loop-test`,
      getKey: (item: TestItem) => item.id,
      initialData,
    })

    const sourceCollection = createCollection(options)
    await sourceCollection.preload()

    // Query: WHERE value > 95, ORDER BY value DESC, LIMIT 5
    // Only item with value=100 matches, but we want 5 items
    // This exhausts the local index after the first item
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

    // Preload should complete without hanging
    const preloadPromise = liveQueryCollection.preload()
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`Timeout during preload - possible infinite loop`)),
        5000,
      ),
    )

    await expect(
      Promise.race([preloadPromise, timeoutPromise]),
    ).resolves.toBeUndefined()

    // Should have 1 item (value=100)
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(1)
    expect(results[0]!.value).toBe(100)

    // Now simulate Electric sending updates (like duplicate insert → update conversion)
    // Without the fix, this would trigger infinite loop because:
    // 1. Update arrives, triggers maybeRunGraph
    // 2. loadMoreIfNeeded sees dataNeeded() > 0 (TopK still needs 4 more)
    // 3. loadNextItems finds nothing (index exhausted)
    // 4. Without localIndexExhausted flag, loop would repeat indefinitely
    const updatePromise = (async () => {
      // Send several updates that don't change the result set
      // These simulate Electric's duplicate handling
      for (let i = 0; i < 5; i++) {
        utils.begin()
        // Update an item that doesn't match WHERE - this shouldn't affect results
        // but could trigger the infinite loop bug
        utils.write({
          type: `update`,
          value: { id: 5, value: 50 + i, category: `A` }, // Still doesn't match WHERE
        })
        utils.commit()

        // Small delay between updates to simulate real Electric behavior
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })()

    const updateTimeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`Timeout during updates - possible infinite loop`)),
        5000,
      ),
    )

    await expect(
      Promise.race([updatePromise, updateTimeoutPromise]),
    ).resolves.toBeUndefined()

    // Results should still be the same (updates didn't add matching items)
    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(1)
    expect(results[0]!.value).toBe(100)
  })

  it(`should reset localIndexExhausted when new inserts arrive`, async () => {
    // This test verifies that the localIndexExhausted flag properly resets
    // when new inserts arrive, allowing the system to load more data

    const { utils, ...options } = mockSyncCollectionOptions({
      id: `reset-exhausted-flag-test`,
      getKey: (item: TestItem) => item.id,
      initialData: [{ id: 1, value: 100, category: `A` }],
    })

    const sourceCollection = createCollection(options)
    await sourceCollection.preload()

    // Query: WHERE value > 50, ORDER BY value DESC, LIMIT 5
    // Initially only 1 item matches, but we want 5
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

    // Should have 1 item initially
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(1)

    // Send updates (should NOT reset the flag, should NOT trigger more loads)
    utils.begin()
    utils.write({ type: `update`, value: { id: 1, value: 101, category: `A` } })
    utils.commit()

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Still 1 item (updated value)
    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(1)
    expect(results[0]!.value).toBe(101)

    // Now send NEW INSERTS - this SHOULD reset the flag and load more
    utils.begin()
    utils.write({ type: `insert`, value: { id: 2, value: 90, category: `B` } })
    utils.write({ type: `insert`, value: { id: 3, value: 80, category: `B` } })
    utils.commit()

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Now should have 3 items (new inserts reset the flag, allowing more to load)
    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.value)).toEqual([101, 90, 80])
  })

  it(`should limit requestLimitedSnapshot calls when index is exhausted`, async () => {
    // This test verifies that the localIndexExhausted optimization actually limits
    // how many times we try to load from an exhausted index.
    //
    // We patch CollectionSubscription.prototype.requestLimitedSnapshot to count calls,
    // then send multiple updates and verify the call count stays low (not unbounded).

    // Patch prototype before creating anything
    let requestLimitedSnapshotCallCount = 0
    const originalRequestLimitedSnapshot =
      CollectionSubscription.prototype.requestLimitedSnapshot

    CollectionSubscription.prototype.requestLimitedSnapshot = function (
      ...args: Array<any>
    ) {
      requestLimitedSnapshotCallCount++
      return originalRequestLimitedSnapshot.apply(this, args as any)
    }

    try {
      const initialData: Array<TestItem> = [
        { id: 1, value: 100, category: `A` }, // Only this matches WHERE > 95
        { id: 2, value: 50, category: `A` },
        { id: 3, value: 40, category: `A` },
      ]

      const { utils, ...options } = mockSyncCollectionOptions({
        id: `limited-snapshot-calls-test`,
        getKey: (item: TestItem) => item.id,
        initialData,
      })

      const sourceCollection = createCollection(options)
      await sourceCollection.preload()

      // Query: WHERE value > 95, ORDER BY value DESC, LIMIT 5
      // Only 1 item matches (value=100), but we want 5
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

      // Record how many calls happened during initial load
      const initialLoadCalls = requestLimitedSnapshotCallCount

      // Should have 1 item initially
      let results = Array.from(liveQueryCollection.values())
      expect(results).toHaveLength(1)
      expect(results[0]!.value).toBe(100)

      // Send 20 updates that match the WHERE clause
      // Without the fix, each update would trigger loadMoreIfNeeded which would
      // call requestLimitedSnapshot. With the fix, localIndexExhausted prevents
      // repeated calls.
      for (let i = 0; i < 20; i++) {
        utils.begin()
        utils.write({
          type: `update`,
          value: { id: 1, value: 100 + i, category: `A` },
        })
        utils.commit()
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      // Wait for all processing to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Calculate calls after the updates
      const callsAfterUpdates =
        requestLimitedSnapshotCallCount - initialLoadCalls

      // With the fix, requestLimitedSnapshot should be called very few times
      // after the initial load (ideally 0 since index was already exhausted)
      // Without the fix, it would be called ~20 times (once per update)
      expect(callsAfterUpdates).toBeLessThan(5)

      // Results should show the latest value
      results = Array.from(liveQueryCollection.values())
      expect(results).toHaveLength(1)
      expect(results[0]!.value).toBeGreaterThanOrEqual(100)
    } finally {
      // Restore original method
      CollectionSubscription.prototype.requestLimitedSnapshot =
        originalRequestLimitedSnapshot
    }
  })

  // NOTE: The actual Electric infinite loop involves async timing that's hard to reproduce
  // in unit tests. The test above verifies the optimization limits repeated calls,
  // which is the core behavior the localIndexExhausted flag provides.
})
