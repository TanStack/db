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
    console.log(`All changes (with limit):`, JSON.stringify(allChanges, null, 2))

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
    console.log(`All changes (without limit):`, JSON.stringify(allChanges, null, 2))

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
