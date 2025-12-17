import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'

type Item = {
  id: number
  value: number
  name: string
}

const initialData: Array<Item> = [
  { id: 1, value: 100, name: `Item A` },
  { id: 2, value: 90, name: `Item B` },
  { id: 3, value: 80, name: `Item C` },
  { id: 4, value: 70, name: `Item D` },
  { id: 5, value: 60, name: `Item E` },
]

describe(`Optimistic delete with limit`, () => {
  let sourceCollection: ReturnType<typeof createCollection<Item>>

  beforeEach(() => {
    sourceCollection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `test-source-collection`,
        getKey: (item) => item.id,
        initialData,
      }),
    )
  })

  it(`should emit delete event to live query subscribeChanges when deleting with limit`, async () => {
    // Create a live query with limit and orderBy
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
          name: items.name,
        })),
    )
    await liveQueryCollection.preload()

    // Verify initial state has 3 items (due to limit)
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(3)
    expect(initialResults.map((r) => r.id)).toEqual([1, 2, 3])

    // Subscribe to changes on the live query collection (matching user's pattern with includeInitialState: true)
    let callCount = 0
    const changeCallback = vi.fn(() => {
      callCount++
    })
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Initial state callback should have been called
    expect(changeCallback).toHaveBeenCalledTimes(1)
    changeCallback.mockClear()
    callCount = 0

    // Optimistically delete item 2 (which is in the visible top 3)
    sourceCollection.delete(2)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The callback should have been called after the delete
    // This is the core bug: with limit, the callback is not being called
    expect(callCount).toBeGreaterThan(0)

    // Clean up
    subscription.unsubscribe()
  })

  it(`should emit delete event when deleting without limit (baseline test)`, async () => {
    // Create a live query WITHOUT limit
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
          name: items.name,
        })),
    )
    await liveQueryCollection.preload()

    // Verify initial state has all 5 items
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(5)

    // Subscribe to changes on the live query collection
    let callCount = 0
    const changeCallback = vi.fn(() => {
      callCount++
    })
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Initial state callback should have been called
    expect(changeCallback).toHaveBeenCalledTimes(1)
    changeCallback.mockClear()
    callCount = 0

    // Optimistically delete item 2
    sourceCollection.delete(2)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The callback should have been called after the delete
    expect(callCount).toBeGreaterThan(0)

    // Clean up
    subscription.unsubscribe()
  })

  it(`should reflect delete in live query state even with limit`, async () => {
    // Create a live query with limit
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
          name: items.name,
        })),
    )
    await liveQueryCollection.preload()

    // Verify initial state: items 1, 2, 3 (top 3 by value desc)
    let results = Array.from(liveQueryCollection.values())
    expect(results.map((r) => r.id)).toEqual([1, 2, 3])

    // Delete item 2
    sourceCollection.delete(2)

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 10))

    // After delete, the live query should show items 1, 3, 4 (item 4 moves in)
    results = Array.from(liveQueryCollection.values())
    expect(results.map((r) => r.id)).toEqual([1, 3, 4])
  })

  it(`should emit delete event with limit AND offset (matching user's exact query pattern)`, async () => {
    // Create a live query with BOTH limit and offset - matching the user's exact pattern:
    // .orderBy(({ offers }) => offers.created_at, "desc")
    // .limit(pageSize)
    // .offset(pageIndex * pageSize);
    const pageSize = 2
    const pageIndex = 1 // Second page

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(pageSize)
        .offset(pageIndex * pageSize)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
          name: items.name,
        })),
    )
    await liveQueryCollection.preload()

    // With offset=2, limit=2, and orderBy value desc:
    // Full order: 1(100), 2(90), 3(80), 4(70), 5(60)
    // Page 2 (offset 2): 3(80), 4(70)
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(2)
    expect(initialResults.map((r) => r.id)).toEqual([3, 4])

    // Subscribe to changes on the live query collection
    let callCount = 0
    const changeCallback = vi.fn(() => {
      callCount++
    })
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Initial state callback should have been called
    expect(changeCallback).toHaveBeenCalledTimes(1)
    changeCallback.mockClear()
    callCount = 0

    // Delete item 3 (which is in the visible page)
    sourceCollection.delete(3)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The callback should have been called after the delete
    // This is the bug scenario reported by the user
    expect(callCount).toBeGreaterThan(0)

    // Verify state is updated correctly
    // After deleting 3, the new page 2 should be: 4(70), 5(60)
    const afterDeleteResults = Array.from(liveQueryCollection.values())
    expect(afterDeleteResults.map((r) => r.id)).toEqual([4, 5])

    // Clean up
    subscription.unsubscribe()
  })

  it(`should emit delete event when deleting item BEFORE the current page (with offset)`, async () => {
    // Test deleting an item that is before the visible offset window
    const pageSize = 2
    const pageIndex = 1 // Second page

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(pageSize)
        .offset(pageIndex * pageSize)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
          name: items.name,
        })),
    )
    await liveQueryCollection.preload()

    // Page 2: items 3, 4
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults.map((r) => r.id)).toEqual([3, 4])

    // Subscribe to changes
    let callCount = 0
    const changeCallback = vi.fn(() => {
      callCount++
    })
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    changeCallback.mockClear()
    callCount = 0

    // Delete item 1 (which is BEFORE the current page - on page 1)
    sourceCollection.delete(1)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The callback should have been called because the page shifts
    // After deleting 1: Full order becomes 2(90), 3(80), 4(70), 5(60)
    // Page 2 with offset 2: 4(70), 5(60)
    expect(callCount).toBeGreaterThan(0)

    const afterDeleteResults = Array.from(liveQueryCollection.values())
    expect(afterDeleteResults.map((r) => r.id)).toEqual([4, 5])

    subscription.unsubscribe()
  })
})
