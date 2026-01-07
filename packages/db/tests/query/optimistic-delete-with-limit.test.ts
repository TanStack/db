import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { like } from '../../src/query/builder/functions.js'
import type { ChangeMessage } from '../../src/types.js'
import type { Collection } from '../../src/collection/index.js'

type Item = {
  id: string
  value: number
  name: string
}

const initialData: Array<Item> = [
  { id: `1`, value: 100, name: `Item A` },
  { id: `2`, value: 90, name: `Item B` },
  { id: `3`, value: 80, name: `Item C` },
  { id: `4`, value: 70, name: `Item D` },
  { id: `5`, value: 60, name: `Item E` },
]

describe(`Optimistic delete with limit`, () => {
  let sourceCollection: Collection<Item>

  beforeEach(async () => {
    sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `items`,
        getKey: (item: Item) => item.id,
        initialData,
      }),
    )

    // Wait for the collection to be ready
    await sourceCollection.preload()
  })

  it(`should emit delete event with limit`, async () => {
    // Create a live query with orderBy and limit (matching the user's pattern)
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

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(3)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`, `3`])

    // Subscribe to changes on the live query collection
    const changeCallback = vi.fn()
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: false,
    })

    // Clear any initial calls from subscription setup
    changeCallback.mockClear()

    // Optimistically delete item 2 (which is in the visible top 3)
    sourceCollection.delete(`2`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The callback should have been called with the delete event
    expect(changeCallback).toHaveBeenCalled()

    // Get the changes from all calls
    const allChanges = changeCallback.mock.calls.flatMap((call) => call[0])
    console.log(
      `All changes (with limit):`,
      JSON.stringify(allChanges, null, 2),
    )

    // Should have a delete for item 2
    const deleteEvents = allChanges.filter(
      (c: ChangeMessage<Item>) => c.type === `delete`,
    )
    expect(deleteEvents.length).toBeGreaterThan(0)
    expect(deleteEvents.some((e: ChangeMessage<Item>) => e.key === `2`)).toBe(
      true,
    )

    subscription.unsubscribe()
  })

  it(`should emit delete event without limit (baseline)`, async () => {
    // Create a live query WITHOUT limit (for comparison)
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

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(5)

    // Subscribe to changes on the live query collection
    const changeCallback = vi.fn()
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: false,
    })

    // Clear any initial calls from subscription setup
    changeCallback.mockClear()

    // Optimistically delete item 2
    sourceCollection.delete(`2`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The callback should have been called with the delete event
    expect(changeCallback).toHaveBeenCalled()

    // Get the changes from all calls
    const allChanges = changeCallback.mock.calls.flatMap((call) => call[0])
    console.log(
      `All changes (without limit):`,
      JSON.stringify(allChanges, null, 2),
    )

    // Should have a delete for item 2
    const deleteEvents = allChanges.filter(
      (c: ChangeMessage<Item>) => c.type === `delete`,
    )
    expect(deleteEvents.length).toBeGreaterThan(0)
    expect(deleteEvents.some((e: ChangeMessage<Item>) => e.key === `2`)).toBe(
      true,
    )

    subscription.unsubscribe()
  })

  it(`should emit delete event with limit and includeInitialState: true`, async () => {
    // Create a live query with orderBy and limit (matching the user's exact pattern)
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

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(3)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`, `3`])

    // Subscribe to changes on the live query collection with includeInitialState: true
    // This is what the user is doing
    const changeCallback = vi.fn()
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Wait for initial state to be sent
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clear initial state calls
    changeCallback.mockClear()

    // Optimistically delete item 2 (which is in the visible top 3)
    sourceCollection.delete(`2`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The callback should have been called with the delete event
    expect(changeCallback).toHaveBeenCalled()

    // Get the changes from all calls
    const allChanges = changeCallback.mock.calls.flatMap((call) => call[0])
    console.log(
      `All changes (with limit, includeInitialState: true):`,
      JSON.stringify(allChanges, null, 2),
    )

    // Should have a delete for item 2
    const deleteEvents = allChanges.filter(
      (c: ChangeMessage<Item>) => c.type === `delete`,
    )
    expect(deleteEvents.length).toBeGreaterThan(0)
    expect(deleteEvents.some((e: ChangeMessage<Item>) => e.key === `2`)).toBe(
      true,
    )

    subscription.unsubscribe()
  })

  it(`should emit delete event with limit and offset`, async () => {
    // Create a live query with orderBy, limit AND offset (matching the user's exact pattern)
    const pageSize = 2
    const pageIndex = 0
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

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results - should be items 1 and 2 (highest values)
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(2)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`])

    // Subscribe to changes with includeInitialState: true (same as user)
    const changeCallback = vi.fn()
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Wait for initial state to be sent
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clear initial state calls
    changeCallback.mockClear()

    // Delete item 2 (which is in the visible page)
    sourceCollection.delete(`2`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The callback should have been called with the delete event
    console.log(
      `All changes (with limit+offset, includeInitialState: true):`,
      JSON.stringify(
        changeCallback.mock.calls.flatMap((call) => call[0]),
        null,
        2,
      ),
    )
    expect(changeCallback).toHaveBeenCalled()

    // Get the changes from all calls
    const allChanges = changeCallback.mock.calls.flatMap((call) => call[0])

    // Should have a delete for item 2
    const deleteEvents = allChanges.filter(
      (c: ChangeMessage<Item>) => c.type === `delete`,
    )
    expect(deleteEvents.length).toBeGreaterThan(0)
    expect(deleteEvents.some((e: ChangeMessage<Item>) => e.key === `2`)).toBe(
      true,
    )

    subscription.unsubscribe()
  })

  it(`should emit delete event with where clause, limit and offset (matching user's exact pattern)`, async () => {
    // Create a live query that matches the user's pattern:
    // query.where(...).orderBy(...).limit(pageSize).offset(pageIndex * pageSize)
    const pageSize = 2
    const pageIndex = 0
    const search = `Item` // Simulating their search filter

    const liveQueryCollection = createLiveQueryCollection((q) => {
      let query = q.from({ items: sourceCollection })
      // Add a where clause like the user does
      query = query.where(({ items }) => like(items.name, `%${search}%`))
      return query
        .orderBy(({ items }) => items.value, `desc`)
        .limit(pageSize)
        .offset(pageIndex * pageSize)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
          name: items.name,
        }))
    })

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results - should be items 1 and 2 (highest values matching search)
    const initialResults = Array.from(liveQueryCollection.values())
    console.log(
      `Initial results (where + limit + offset):`,
      JSON.stringify(initialResults, null, 2),
    )
    expect(initialResults).toHaveLength(2)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`])

    // Subscribe to changes with includeInitialState: true (same as user)
    const changeCallback = vi.fn()
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Wait for initial state to be sent
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clear initial state calls
    changeCallback.mockClear()

    // Delete item 2 (which is in the visible page)
    sourceCollection.delete(`2`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The callback should have been called with the delete event
    console.log(
      `All changes (where + limit + offset, includeInitialState: true):`,
      JSON.stringify(
        changeCallback.mock.calls.flatMap((call) => call[0]),
        null,
        2,
      ),
    )
    expect(changeCallback).toHaveBeenCalled()

    // Get the changes from all calls
    const allChanges = changeCallback.mock.calls.flatMap((call) => call[0])

    // Should have a delete for item 2
    const deleteEvents = allChanges.filter(
      (c: ChangeMessage<Item>) => c.type === `delete`,
    )
    expect(deleteEvents.length).toBeGreaterThan(0)
    expect(deleteEvents.some((e: ChangeMessage<Item>) => e.key === `2`)).toBe(
      true,
    )

    subscription.unsubscribe()
  })

  it(`should emit delete and update when deleting from different page (page 1 delete while viewing page 2)`, async () => {
    // This test captures the scenario from Marius's environment:
    // - Viewing page 2 (items 3 and 4 with offset=2, limit=2)
    // - Delete an item from page 1 (item 2)
    // - The live query should update because items shift:
    //   - After delete, sorted order is: 1, 3, 4, 5
    //   - Page 2 (offset=2, limit=2) should now show items 4 and 5
    //   - So: item 3 should be deleted from result, item 5 should be inserted

    const pageSize = 2
    const pageIndex = 1 // page 2 (0-indexed)

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

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results - page 2 should show items 3 and 4 (offset 2, limit 2)
    // Sorted by value desc: 1 (100), 2 (90), 3 (80), 4 (70), 5 (60)
    // Page 2 = offset 2 = items 3 and 4
    const initialResults = Array.from(liveQueryCollection.values())
    console.log(
      `Initial results (page 2):`,
      JSON.stringify(initialResults, null, 2),
    )
    expect(initialResults).toHaveLength(2)
    expect(initialResults.map((r) => r.id)).toEqual([`3`, `4`])

    // Subscribe to changes with includeInitialState: true
    const changeCallback = vi.fn()
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Wait for initial state to be sent
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clear initial state calls
    changeCallback.mockClear()

    // Delete item 2 (which is on page 1, NOT in current view)
    console.log(`Deleting item 2 (on page 1, not visible on page 2)...`)
    sourceCollection.delete(`2`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 50))

    // After deleting item 2:
    // - Sorted order becomes: 1 (100), 3 (80), 4 (70), 5 (60)
    // - Page 2 (offset 2, limit 2) should now show items 4 and 5
    // - So: item 3 should be deleted from result, item 5 should be inserted

    // Check the state after delete
    const resultsAfterDelete = Array.from(liveQueryCollection.values())
    console.log(
      `Results after delete:`,
      JSON.stringify(resultsAfterDelete, null, 2),
    )

    // The live query collection should now show items 4 and 5
    expect(resultsAfterDelete).toHaveLength(2)
    expect(resultsAfterDelete.map((r) => r.id)).toEqual([`4`, `5`])

    // Check that we got the expected change events
    console.log(
      `All changes (page 2 after deleting from page 1):`,
      JSON.stringify(
        changeCallback.mock.calls.flatMap((call) => call[0]),
        null,
        2,
      ),
    )

    // We should have received change events (delete for item 3, insert for item 5)
    expect(changeCallback).toHaveBeenCalled()

    const allChanges = changeCallback.mock.calls.flatMap((call) => call[0])

    // Should have a delete for item 3 (shifted out of page 2)
    const deleteEvents = allChanges.filter(
      (c: ChangeMessage<Item>) => c.type === `delete`,
    )
    expect(deleteEvents.some((e: ChangeMessage<Item>) => e.key === `3`)).toBe(
      true,
    )

    // Should have an insert for item 5 (shifted into page 2)
    const insertEvents = allChanges.filter(
      (c: ChangeMessage<Item>) => c.type === `insert`,
    )
    expect(insertEvents.some((e: ChangeMessage<Item>) => e.key === `5`)).toBe(
      true,
    )

    subscription.unsubscribe()
  })

  it(`should NOT update when deleting item beyond TopK window (no-op case)`, async () => {
    // Test scenario: delete an item that's AFTER the TopK window
    // - Page 1: items 1 and 2 (offset=0, limit=2)
    // - Delete item 5 (which is on page 3)
    // - Page 1 should NOT change (items 1 and 2 are still there)

    const pageSize = 2
    const pageIndex = 0 // page 1

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

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results - page 1 should show items 1 and 2
    const initialResults = Array.from(liveQueryCollection.values())
    console.log(
      `Initial results (page 1 for no-op test):`,
      JSON.stringify(initialResults, null, 2),
    )
    expect(initialResults).toHaveLength(2)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`])

    // Subscribe to changes
    const changeCallback = vi.fn()
    const subscription = liveQueryCollection.subscribeChanges(changeCallback, {
      includeInitialState: true,
    })

    // Wait for initial state to be sent
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clear initial state calls
    changeCallback.mockClear()

    // Delete item 5 (which is on page 3, beyond the TopK window)
    console.log(`Deleting item 5 (on page 3, beyond TopK window)...`)
    sourceCollection.delete(`5`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 50))

    // After deleting item 5:
    // - Sorted order becomes: 1 (100), 2 (90), 3 (80), 4 (70)
    // - Page 1 (offset 0, limit 2) still shows items 1 and 2
    // - No change to page 1

    // Check the state after delete
    const resultsAfterDelete = Array.from(liveQueryCollection.values())
    console.log(
      `Results after delete (no-op):`,
      JSON.stringify(resultsAfterDelete, null, 2),
    )

    // The live query collection should still show items 1 and 2
    expect(resultsAfterDelete).toHaveLength(2)
    expect(resultsAfterDelete.map((r) => r.id)).toEqual([`1`, `2`])

    // Check that we did NOT receive any change events
    console.log(
      `Change events (should be empty):`,
      JSON.stringify(
        changeCallback.mock.calls.flatMap((call) => call[0]),
        null,
        2,
      ),
    )

    // No changes expected since item 5 is outside the window
    const allChanges = changeCallback.mock.calls.flatMap((call) => call[0])
    expect(allChanges).toHaveLength(0)

    subscription.unsubscribe()
  })

  it(`should update state correctly after delete with limit`, async () => {
    // Create a live query with orderBy and limit
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

    // Wait for the live query collection to be ready
    await liveQueryCollection.preload()

    // Check initial results
    let results = Array.from(liveQueryCollection.values())
    expect(results.map((r) => r.id)).toEqual([`1`, `2`, `3`])

    // Subscribe to changes
    liveQueryCollection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    // Optimistically delete item 2 (which is in the visible top 3)
    sourceCollection.delete(`2`)

    // Wait for microtasks to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Check that the state is updated
    // Item 2 should be gone, and item 4 should move into the top 3
    results = Array.from(liveQueryCollection.values())
    expect(results.map((r) => r.id)).toEqual([`1`, `3`, `4`])
  })
})
