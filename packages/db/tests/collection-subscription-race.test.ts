import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions } from './utils.js'
import type { ChangeMessage } from '../src/types.js'

/**
 * RACE CONDITION TEST
 * ===================
 *
 * This test reproduces a race condition in CollectionSubscription that causes
 * duplicate INSERT events, which breaks delete operations in live queries with
 * `.orderBy()` and `.limit()`.
 *
 * THE BUG:
 * --------
 * When `requestSnapshot` or `requestLimitedSnapshot` is called:
 * 1. They send changes via `this.callback(changes)`
 * 2. The callback is `callbackWithSentKeysTracking` which does:
 *    a. `callback(changes)` - original callback runs FIRST
 *    b. `this.trackSentKeys(changes)` - keys added AFTER
 * 3. If the original callback (a) triggers a mutation that causes `emitEvents`,
 *    that emitEvents goes through `filterAndFlipChanges`
 * 4. `filterAndFlipChanges` checks if keys are in `sentKeys`
 * 5. BUT `trackSentKeys` (b) hasn't run yet, so keys aren't in `sentKeys`!
 * 6. Result: Updates are flipped to inserts → duplicate INSERT events
 *
 * WHY DUPLICATES BREAK DELETES:
 * -----------------------------
 * The D2 (differential dataflow) pipeline uses multiplicity tracking:
 * - INSERT adds multiplicity: 0 → 1 (item visible)
 * - DUPLICATE INSERT: 1 → 2 (item still visible, but wrong multiplicity)
 * - DELETE subtracts: 2 → 1 (multiplicity > 0, so NO delete event emitted!)
 *
 * THE FIX:
 * --------
 * In `requestSnapshot` and `requestLimitedSnapshot`, add keys to `sentKeys`
 * BEFORE calling the callback, not after:
 *
 * ```typescript
 * // Add keys to sentKeys BEFORE calling callback
 * for (const change of changes) {
 *   this.sentKeys.add(change.key)
 * }
 * this.callback(changes)  // Now filterAndFlipChanges will see the keys
 * ```
 *
 * TO REPRODUCE:
 * -------------
 * 1. Subscribe WITHOUT `includeInitialState` (subscription added to set immediately)
 * 2. Call `requestSnapshot` WITH options (keeps `loadedInitialState=false`)
 * 3. In the callback, trigger a mutation on the same collection
 * 4. The mutation's emitEvents will call filterAndFlipChanges on the same subscription
 * 5. Keys aren't in sentKeys yet → updates flipped to inserts → duplicates!
 */

type TestItem = {
  id: string
  value: number
  processed: boolean
}

describe(`Subscription race condition`, () => {
  it(`should not emit duplicate inserts when requestSnapshot callback triggers mutation on registered subscription`, async () => {
    const initialData: Array<TestItem> = [
      { id: `1`, value: 100, processed: false },
      { id: `2`, value: 90, processed: false },
    ]

    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `race-test-real`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await collection.preload()

    const allChanges: Array<ChangeMessage<TestItem>> = []
    let callCount = 0

    // Subscribe WITHOUT includeInitialState - this means the subscription
    // is added to changeSubscriptions IMMEDIATELY (not after requestSnapshot)
    const subscription = collection.subscribeChanges(
      (changes) => {
        callCount++
        console.log(
          `[TEST] Callback #${callCount}:`,
          JSON.stringify(
            changes.map((c) => ({
              type: c.type,
              key: c.key,
              processed: c.value.processed,
            })),
          ),
        )
        allChanges.push(...changes)

        // During this callback, trigger a mutation.
        // Since the subscription is already in changeSubscriptions,
        // the mutation will trigger emitEvents which will call
        // subscription.emitEvents() on THIS subscription.
        for (const change of changes) {
          if (change.type === `insert` && !change.value.processed) {
            console.log(
              `[TEST] Triggering update for key ${change.key} during callback #${callCount}`,
            )
            collection.update(change.key, (draft) => {
              draft.processed = true
            })
          }
        }
      },
      { includeInitialState: false }, // <-- Key: subscription is registered first
    )

    // At this point, the subscription IS in changeSubscriptions
    // Now manually call requestSnapshot WITH OPTIONS to trigger the race condition
    // IMPORTANT: If we call requestSnapshot() without options, it sets loadedInitialState=true
    // which bypasses filterAndFlipChanges entirely. We need to pass options to keep
    // loadedInitialState=false so that filterAndFlipChanges is actually called.
    console.log(`[TEST] Manually calling requestSnapshot with options...`)

    // Pass empty options to keep loadedInitialState=false
    // This simulates what happens during lazy loading / pagination
    const snapshotLoaded = subscription.requestSnapshot({
      trackLoadSubsetPromise: false,
    })
    console.log(`[TEST] requestSnapshot returned:`, snapshotLoaded)

    // Wait for any async processing
    await new Promise((resolve) => setTimeout(resolve, 10))

    console.log(`[TEST] Total callback calls:`, callCount)
    console.log(
      `[TEST] All changes:`,
      allChanges.map((c) => ({ type: c.type, key: c.key })),
    )

    // Count inserts per key
    const insertCounts = new Map<string, number>()
    for (const change of allChanges) {
      if (change.type === `insert`) {
        insertCounts.set(
          change.key as string,
          (insertCounts.get(change.key as string) || 0) + 1,
        )
      }
    }

    console.log(
      `[TEST] Insert counts per key:`,
      Object.fromEntries(insertCounts),
    )

    // THE RACE CONDITION BUG:
    // Without the fix, each key has 2 inserts:
    // 1. First insert from requestSnapshot's callback
    // 2. Second insert from emitEvents (update flipped to insert because key not in sentKeys)
    //
    // With the fix (adding keys BEFORE callback), each key should have only 1 insert
    for (const [key, count] of insertCounts) {
      expect(
        count,
        `Key ${key} should only have 1 insert, but got ${count}. ` +
          `This indicates the race condition is present - ` +
          `updates are being flipped to inserts because sentKeys isn't populated yet.`,
      ).toBe(1)
    }

    subscription.unsubscribe()
  })

  it(`should handle deletes correctly after the race condition is fixed`, async () => {
    const initialData: Array<TestItem> = [
      { id: `1`, value: 100, processed: false },
      { id: `2`, value: 90, processed: false },
    ]

    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `race-test-delete`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await collection.preload()

    const allChanges: Array<ChangeMessage<TestItem>> = []
    let initialLoadComplete = false

    const subscription = collection.subscribeChanges(
      (changes) => {
        allChanges.push(...changes)

        if (!initialLoadComplete) {
          for (const change of changes) {
            if (change.type === `insert` && !change.value.processed) {
              collection.update(change.key, (draft) => {
                draft.processed = true
              })
            }
          }
        }
      },
      { includeInitialState: false },
    )

    // Manually request initial snapshot with options to trigger potential race
    subscription.requestSnapshot({ trackLoadSubsetPromise: false })

    await new Promise((resolve) => setTimeout(resolve, 10))
    initialLoadComplete = true

    // Count initial inserts to understand multiplicity
    const initialInserts = allChanges.filter((c) => c.type === `insert`).length
    console.log(`[TEST] Initial inserts:`, initialInserts)

    // Clear and test delete
    allChanges.length = 0
    collection.delete(`1`)

    await new Promise((resolve) => setTimeout(resolve, 10))

    console.log(
      `[TEST] Changes after delete:`,
      allChanges.map((c) => ({ type: c.type, key: c.key })),
    )

    // If there were duplicate inserts (race condition), the delete might not
    // properly remove the item because D2 multiplicity would be > 1
    const deleteEvents = allChanges.filter((c) => c.type === `delete`)
    expect(deleteEvents.length).toBeGreaterThan(0)
    expect(deleteEvents.some((e) => e.key === `1`)).toBe(true)

    subscription.unsubscribe()
  })

  it(`should not emit duplicate inserts with live query orderBy + limit`, async () => {
    const initialData: Array<TestItem> = [
      { id: `1`, value: 100, processed: false },
      { id: `2`, value: 90, processed: false },
      { id: `3`, value: 80, processed: false },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `race-lq-source`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    // Create live query with orderBy + limit (uses TopKWithFractionalIndexOperator)
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(2)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
          processed: items.processed,
        })),
    )

    await liveQueryCollection.preload()

    // Verify initial results
    const initialResults = Array.from(liveQueryCollection.values())
    console.log(
      `[TEST] Initial results:`,
      JSON.stringify(initialResults, null, 2),
    )
    expect(initialResults).toHaveLength(2)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`])

    // Subscribe to changes with includeInitialState: true
    const allChanges: Array<ChangeMessage<TestItem>> = []
    const subscription = liveQueryCollection.subscribeChanges(
      (changes) => {
        allChanges.push(...changes)
      },
      { includeInitialState: true },
    )

    // Wait for initial state
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Count inserts - should be exactly 2 (one per item in the limit)
    const insertCounts = new Map<string, number>()
    for (const change of allChanges) {
      if (change.type === `insert`) {
        insertCounts.set(
          change.key as string,
          (insertCounts.get(change.key as string) || 0) + 1,
        )
      }
    }

    console.log(
      `[TEST] Insert counts after initial state:`,
      Object.fromEntries(insertCounts),
    )

    // Each key should only have ONE insert
    for (const [key, count] of insertCounts) {
      expect(
        count,
        `Key ${key} should only have 1 insert after initial state, got ${count}`,
      ).toBe(1)
    }

    // Clear changes
    allChanges.length = 0

    // Now delete item 2 (which is in the visible set)
    sourceCollection.delete(`2`)

    // Wait for delete to propagate
    await new Promise((resolve) => setTimeout(resolve, 50))

    console.log(
      `[TEST] Changes after delete:`,
      JSON.stringify(allChanges, null, 2),
    )

    // There should be a delete event for key 2
    const deleteEvents = allChanges.filter((c) => c.type === `delete`)
    expect(
      deleteEvents.some((e) => e.key === `2`),
      `Expected delete event for key 2, got: ${JSON.stringify(allChanges)}`,
    ).toBe(true)

    // And an insert for key 3 (which moves into the top 2)
    const insertEvents = allChanges.filter((c) => c.type === `insert`)
    expect(
      insertEvents.some((e) => e.key === `3`),
      `Expected insert event for key 3, got: ${JSON.stringify(allChanges)}`,
    ).toBe(true)

    subscription.unsubscribe()
  })
})
