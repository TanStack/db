import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import { mockSyncCollectionOptions } from './utils.js'
import type { ChangeMessage } from '../src/types.js'

/**
 * Tests for duplicate insert prevention in the D2 pipeline.
 *
 * The issue: When using live queries with orderBy + limit, the D2 pipeline
 * uses multiplicity tracking. Each insert adds 1 to multiplicity, each delete
 * subtracts 1. For an item to disappear, multiplicity must go from 1 to 0.
 *
 * If duplicate inserts reach D2, multiplicity becomes > 1, and deletes won't
 * properly remove items (multiplicity goes from 2 to 1, not triggering removal).
 *
 * The fix: CollectionSubscriber tracks keys sent to D2 (sentToD2Keys) and
 * filters out duplicate inserts before they reach the pipeline.
 *
 * Additionally, for JOIN queries with lazy sources:
 * - The includeInitialState fix ensures internal lazy-loading subscriptions
 *   don't trigger markAllStateAsSeen() which would disable filtering.
 */

type TestItem = {
  id: string
  value: number
}

type User = {
  id: string
  name: string
}

type Order = {
  id: string
  userId: string
  amount: number
}

describe(`CollectionSubscriber duplicate insert prevention`, () => {
  it(`should properly delete items from live query with orderBy + limit`, async () => {
    // This test verifies that items can be properly deleted from a live query
    // with orderBy + limit. If duplicate inserts reach D2, the delete won't work.

    const initialData: Array<TestItem> = [
      { id: `1`, value: 100 },
      { id: `2`, value: 90 },
      { id: `3`, value: 80 },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `duplicate-d2-source`,
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
        })),
    )

    await liveQueryCollection.preload()

    // Verify initial results
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(2)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`])

    // Subscribe to changes to verify events
    const allChanges: Array<ChangeMessage<TestItem>> = []
    const subscription = liveQueryCollection.subscribeChanges(
      (changes) => {
        allChanges.push(...changes)
      },
      { includeInitialState: true },
    )

    // Wait for initial state
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clear changes
    allChanges.length = 0

    // Delete item 2 (which is in the visible set)
    sourceCollection.delete(`2`)

    // Wait for delete to propagate
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Verify delete event was emitted
    const deleteEvents = allChanges.filter((c) => c.type === `delete`)
    expect(
      deleteEvents.some((e) => e.key === `2`),
      `Expected delete event for key 2, but got: ${JSON.stringify(allChanges.map((c) => ({ type: c.type, key: c.key })))}`,
    ).toBe(true)

    // Verify item 3 moved into the visible set
    const insertEvents = allChanges.filter((c) => c.type === `insert`)
    expect(
      insertEvents.some((e) => e.key === `3`),
      `Expected insert event for key 3, but got: ${JSON.stringify(allChanges.map((c) => ({ type: c.type, key: c.key })))}`,
    ).toBe(true)

    // Verify final state
    const finalResults = Array.from(liveQueryCollection.values())
    expect(finalResults).toHaveLength(2)
    expect(finalResults.map((r) => r.id)).toEqual([`1`, `3`])

    subscription.unsubscribe()
  })

  it(`should not emit duplicate inserts to live query subscribers`, async () => {
    // This test checks that live query subscribers don't receive duplicate inserts
    // which would indicate D2 multiplicity issues

    const initialData: Array<TestItem> = [
      { id: `1`, value: 100 },
      { id: `2`, value: 90 },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `duplicate-d2-count`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(2)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    const allChanges: Array<ChangeMessage<TestItem>> = []
    const subscription = liveQueryCollection.subscribeChanges(
      (changes) => {
        allChanges.push(...changes)
      },
      { includeInitialState: true },
    )

    // Wait for initial state
    await new Promise((resolve) => setTimeout(resolve, 10))

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

    // Each key should only have ONE insert
    for (const [key, count] of insertCounts) {
      expect(
        count,
        `Key ${key} should only have 1 insert after initial state, got ${count}. ` +
          `This indicates duplicate inserts are reaching D2.`,
      ).toBe(1)
    }

    subscription.unsubscribe()
  })

  it(`should handle rapid updates without duplicate inserts`, async () => {
    // This test simulates rapid updates that could cause race conditions
    // leading to duplicate inserts

    const initialData: Array<TestItem> = [
      { id: `1`, value: 100 },
      { id: `2`, value: 90 },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `duplicate-d2-rapid`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(2)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    const allChanges: Array<ChangeMessage<TestItem>> = []
    const subscription = liveQueryCollection.subscribeChanges(
      (changes) => {
        allChanges.push(...changes)
      },
      { includeInitialState: true },
    )

    // Wait for initial state
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clear changes
    allChanges.length = 0

    // Rapid updates to simulate potential race conditions
    for (let i = 0; i < 5; i++) {
      sourceCollection.update(`1`, (draft) => {
        draft.value = 100 + i
      })
    }

    // Wait for updates to propagate
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should have update events, not duplicate inserts
    const insertCounts = new Map<string, number>()
    for (const change of allChanges) {
      if (change.type === `insert`) {
        insertCounts.set(
          change.key as string,
          (insertCounts.get(change.key as string) || 0) + 1,
        )
      }
    }

    // No duplicate inserts should occur during updates
    for (const [key, count] of insertCounts) {
      expect(
        count,
        `Key ${key} should not have duplicate inserts during updates, got ${count}.`,
      ).toBeLessThanOrEqual(1)
    }

    subscription.unsubscribe()
  })

  it(`should handle mutation during live query subscription setup`, async () => {
    // This test checks for race conditions where a mutation occurs
    // during live query subscription initialization

    const initialData: Array<TestItem> = [
      { id: `1`, value: 100 },
      { id: `2`, value: 90 },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `duplicate-d2-mutation-during-setup`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(2)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    const allChanges: Array<ChangeMessage<TestItem>> = []

    // Subscribe and immediately mutate the source
    const subscription = liveQueryCollection.subscribeChanges(
      (changes) => {
        allChanges.push(...changes)

        // Trigger mutation during callback (similar to race condition test)
        const firstInsert = changes.find(
          (c) => c.type === `insert` && c.key === `1`,
        )
        if (firstInsert) {
          sourceCollection.update(`1`, (draft) => {
            draft.value = 101
          })
        }
      },
      { includeInitialState: true },
    )

    // Wait for everything to settle
    await new Promise((resolve) => setTimeout(resolve, 50))

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
      `Insert counts:`,
      Object.fromEntries(insertCounts),
      `All changes:`,
      allChanges.map((c) => ({ type: c.type, key: c.key })),
    )

    // Each key should only have ONE insert initially
    // (updates after initial insert are ok, but not duplicate inserts)
    for (const [key, count] of insertCounts) {
      expect(
        count,
        `Key ${key} should only have 1 insert, got ${count}. ` +
          `Duplicate inserts indicate D2 multiplicity issues.`,
      ).toBe(1)
    }

    // Verify we can still delete items (multiplicity is correct)
    allChanges.length = 0
    sourceCollection.delete(`2`)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const deleteEvents = allChanges.filter((c) => c.type === `delete`)
    expect(deleteEvents.some((e) => e.key === `2`)).toBe(true)

    subscription.unsubscribe()
  })

  it(`should properly handle deletes in join queries with lazy sources`, async () => {
    // This test verifies that items can be properly deleted from a live query
    // with a join where one collection is loaded lazily.
    // The bug: includeInitialState: false was being passed to lazy sources,
    // which triggered markAllStateAsSeen(), disabling filtering.

    const users: Array<User> = [
      { id: `u1`, name: `Alice` },
      { id: `u2`, name: `Bob` },
    ]

    const orders: Array<Order> = [
      { id: `o1`, userId: `u1`, amount: 100 },
      { id: `o2`, userId: `u1`, amount: 200 },
      { id: `o3`, userId: `u2`, amount: 150 },
    ]

    const usersCollection = createCollection(
      mockSyncCollectionOptions({
        id: `join-lazy-users`,
        getKey: (item: User) => item.id,
        initialData: users,
      }),
    )

    const ordersCollection = createCollection(
      mockSyncCollectionOptions({
        id: `join-lazy-orders`,
        getKey: (item: Order) => item.id,
        initialData: orders,
      }),
    )

    await Promise.all([usersCollection.preload(), ordersCollection.preload()])

    // Create a join query - the orders collection should be lazy loaded
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ users: usersCollection })
        .join({ orders: ordersCollection }, ({ users, orders }) =>
          eq(users.id, orders.userId),
        )
        .select(({ users, orders }) => ({
          orderId: orders!.id,
          userName: users.name,
          amount: orders!.amount,
        })),
    )

    await liveQueryCollection.preload()

    // Verify initial results
    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(3)

    // Subscribe to changes
    const allChanges: Array<ChangeMessage<any>> = []
    const subscription = liveQueryCollection.subscribeChanges(
      (changes) => {
        allChanges.push(...changes)
      },
      { includeInitialState: true },
    )

    // Wait for initial state
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Clear changes
    allChanges.length = 0

    // Delete an order
    ordersCollection.delete(`o1`)

    // Wait for delete to propagate
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Verify delete event was emitted
    const deleteEvents = allChanges.filter((c) => c.type === `delete`)
    expect(
      deleteEvents.length,
      `Expected at least 1 delete event, but got: ${JSON.stringify(allChanges.map((c) => ({ type: c.type, key: c.key })))}`,
    ).toBeGreaterThan(0)

    // Verify final state
    const finalResults = Array.from(liveQueryCollection.values())
    expect(finalResults).toHaveLength(2)

    subscription.unsubscribe()
  })
})
