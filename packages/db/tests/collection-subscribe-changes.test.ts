import { describe, expect, it, vi } from "vitest"
import mitt from "mitt"
import { createCollection } from "../src/collection"
import { createTransaction } from "../src/transactions"
import { eq } from "../src/query/builder/functions"
import type {
  ChangeMessage,
  ChangesPayload,
  MutationFn,
  PendingMutation,
} from "../src/types"

// Helper function to wait for changes to be processed
const waitForChanges = () => new Promise((resolve) => setTimeout(resolve, 10))

describe(`Collection.subscribeChanges`, () => {
  it(`should emit initial collection state as insert changes`, () => {
    const callback = vi.fn()

    // Create collection with pre-populated data
    const collection = createCollection<{ value: string }>({
      id: `initial-state-test`,
      getKey: (item) => item.value,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Immediately populate with initial data
          begin()
          write({
            type: `insert`,
            value: { value: `value1` },
          })
          write({
            type: `insert`,
            value: { value: `value2` },
          })
          commit()
        },
      },
    })

    // Wait for initial sync to complete
    // await waitForChanges()

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback, {
      includeInitialState: true,
    })

    // Verify that callback was called with initial state
    expect(callback).toHaveBeenCalledTimes(1)
    const changes = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(changes).toHaveLength(2)

    const insertedKeys = changes.map((change) => change.key)
    expect(insertedKeys).toContain(`value1`)
    expect(insertedKeys).toContain(`value2`)

    // Ensure all changes are insert type
    expect(changes.every((change) => change.type === `insert`)).toBe(true)

    // Clean up
    unsubscribe()
  })

  it(`should not emit initial collection state as insert changes by default`, () => {
    const callback = vi.fn()

    // Create collection with pre-populated data
    const collection = createCollection<{ value: string }>({
      id: `initial-state-test`,
      getKey: (item) => item.value,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Immediately populate with initial data
          begin()
          write({
            type: `insert`,
            value: { value: `value1` },
          })
          write({
            type: `insert`,
            value: { value: `value2` },
          })
          commit()
        },
      },
    })

    // Wait for initial sync to complete
    // await waitForChanges()

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback)

    // Verify that callback was called with initial state
    expect(callback).toHaveBeenCalledTimes(0)

    // Clean up
    unsubscribe()
  })

  it(`should emit changes from synced operations`, () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with sync capability using the mitt pattern from collection.test.ts
    const collection = createCollection<{ id: number; value: string }>({
      id: `sync-changes-test-with-mitt`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Setup a listener for our test events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.modified,
              })
            })
            commit()
          })

          // Start with empty data
          begin()
          commit()
        },
      },
    })

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback)

    // Reset mock to ignore initial state emission
    callback.mockReset()

    // Emit a sync insert change
    emitter.emit(`testEvent`, [
      {
        type: `insert`,
        modified: { id: 1, value: `sync value 1` },
      },
    ])

    // Verify that insert was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const insertChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(insertChanges).toHaveLength(1)

    const insertChange = insertChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(insertChange).toBeDefined()
    expect(insertChange.type).toBe(`insert`)
    expect(insertChange.value).toEqual({ id: 1, value: `sync value 1` })

    // Reset mock
    callback.mockReset()

    // Emit a sync update change
    emitter.emit(`testEvent`, [
      {
        type: `update`,
        modified: { id: 1, value: `updated sync value` },
      },
    ])

    // Verify that update was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const updateChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(updateChanges).toHaveLength(1)

    const updateChange = updateChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(updateChange).toBeDefined()
    expect(updateChange.type).toBe(`update`)
    expect(updateChange.value).toEqual({ id: 1, value: `updated sync value` })

    // Reset mock
    callback.mockReset()

    // Emit a sync delete change
    emitter.emit(`testEvent`, [
      {
        type: `delete`,
        modified: { id: 1, value: `updated sync value` },
      },
    ])

    // Verify that delete was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const deleteChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(deleteChanges).toHaveLength(1)

    const deleteChange = deleteChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(deleteChange).toBeDefined()
    expect(deleteChange.type).toBe(`delete`)

    // Clean up
    unsubscribe()
  })

  it(`should emit changes from optimistic operations`, () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with mutation capability
    const collection = createCollection<{
      id: number
      value: string
      updated?: boolean
    }>({
      id: `optimistic-changes-test`,
      getKey: (item) => {
        return item.id
      },
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Listen for sync events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.modified,
              })
            })
            commit()
          })
        },
      },
    })

    const mutationFn: MutationFn = async ({ transaction }) => {
      emitter.emit(`sync`, transaction.mutations)
      return Promise.resolve()
    }

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback)

    // Reset mock to ignore initial state emission
    callback.mockReset()

    // Perform optimistic insert
    const tx = createTransaction({ mutationFn })
    tx.mutate(() => collection.insert({ id: 1, value: `optimistic value` }))

    // Verify that insert was emitted immediately (optimistically)
    expect(callback).toHaveBeenCalledTimes(1)
    const insertChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(insertChanges).toHaveLength(1)

    const insertChange = insertChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(insertChange).toBeDefined()
    expect(insertChange).toEqual({
      key: 1,
      type: `insert`,
      value: { id: 1, value: `optimistic value` },
    })

    // Reset mock
    callback.mockReset()

    // Perform optimistic update
    const item = collection.state.get(1)
    if (!item) {
      throw new Error(`Item not found`)
    }
    const updateTx = createTransaction({ mutationFn })
    updateTx.mutate(() =>
      collection.update(item.id, (draft) => {
        draft.value = `updated optimistic value`
        draft.updated = true
      })
    )

    // Verify that update was emitted
    expect(callback).toHaveBeenCalledTimes(1)

    // Check that the call contains the correct update
    const updateChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
      updated?: boolean
    }>
    expect(updateChanges).toHaveLength(1)

    const updateChange = updateChanges[0]! as ChangeMessage<{
      value: string
      updated?: boolean
    }>
    expect(updateChange).toBeDefined()
    expect(updateChange.type).toBe(`update`)
    expect(updateChange.value).toEqual({
      id: 1,
      value: `updated optimistic value`,
      updated: true,
    })

    // Reset mock
    callback.mockReset()

    // Perform optimistic delete
    const deleteTx = createTransaction({ mutationFn })
    deleteTx.mutate(() => collection.delete(item.id))

    // Verify that delete was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const deleteChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(deleteChanges).toHaveLength(1)

    const deleteChange = deleteChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(deleteChange).toBeDefined()
    expect(deleteChange.type).toBe(`delete`)
    expect(deleteChange.key).toBe(1)

    // Clean up
    unsubscribe()
  })

  it(`should handle both synced and optimistic changes together`, async () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with both sync and mutation capabilities
    const collection = createCollection<{ id: number; value: string }>({
      id: `mixed-changes-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Setup a listener for our test events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.modified,
              })
            })
            commit()
          })

          // Start with empty data
          begin()
          commit()
        },
      },
    })

    const mutationFn: MutationFn = async ({ transaction }) => {
      emitter.emit(`sync`, transaction.mutations)
      return Promise.resolve()
    }

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback)

    // Reset mock to ignore initial state emission
    callback.mockReset()

    // First add a synced item
    emitter.emit(`sync`, [
      {
        type: `insert`,
        modified: { id: 1, value: `synced value` },
      },
    ])

    // Wait for changes to propagate
    await waitForChanges()

    // Verify synced insert was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]![0]).toEqual([
      {
        key: 1,
        type: `insert`,
        value: { id: 1, value: `synced value` },
      },
    ])
    callback.mockReset()

    // Now add an optimistic item
    const tx = createTransaction({ mutationFn })
    tx.mutate(() => collection.insert({ id: 2, value: `optimistic value` }))

    // Verify optimistic insert was emitted - this is the synchronous optimistic update
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]![0]).toEqual([
      {
        key: 2,
        type: `insert`,
        value: { id: 2, value: `optimistic value` },
      },
    ])
    callback.mockReset()

    await tx.isPersisted.promise

    // Verify no changes were emitted as the sync should match the optimistic state
    expect(callback).toHaveBeenCalledTimes(0)
    callback.mockReset()

    // Update both items in optimistic and synced ways
    // First update the optimistic item optimistically
    const optItem = collection.state.get(2)!
    expect(optItem).toBeDefined()
    const updateTx = createTransaction({ mutationFn })
    updateTx.mutate(() =>
      collection.update(optItem.id, (draft) => {
        draft.value = `updated optimistic value`
      })
    )

    // Verify the optimistic update was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]![0]).toEqual([
      {
        type: `update`,
        key: 2,
        value: {
          id: 2,
          value: `updated optimistic value`,
        },
        previousValue: {
          id: 2,
          value: `optimistic value`,
        },
      },
    ])
    callback.mockReset()

    await updateTx.isPersisted.promise

    // Verify no redundant sync events were emitted
    expect(callback).toHaveBeenCalledTimes(0)
    callback.mockReset()

    // Then update the synced item with a synced update
    emitter.emit(`sync`, [
      {
        type: `update`,
        modified: { id: 1, value: `updated synced value` },
      },
    ])

    // Wait for changes to propagate
    await waitForChanges()

    // Verify the synced update was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const updateChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>

    const updateChange = updateChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(updateChange).toBeDefined()
    expect(updateChange.type).toBe(`update`)
    expect(updateChange.value).toEqual({ id: 1, value: `updated synced value` })

    // Clean up
    unsubscribe()
  })

  it(`should only emit differences between states, not whole state`, async () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with initial data
    const collection = createCollection<{ id: number; value: string }>({
      id: `diff-changes-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Immediately populate with initial data
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `value1` },
          })
          write({
            type: `insert`,
            value: { id: 2, value: `value2` },
          })
          commit()

          // Listen for sync events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.modified,
              })
            })
            commit()
          })
        },
      },
    })
    const mutationFn: MutationFn = async ({ transaction }) => {
      emitter.emit(`sync`, transaction.mutations)
      return Promise.resolve()
    }

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback, {
      includeInitialState: true,
    })

    // First call should have initial state (2 items)
    expect(callback).toHaveBeenCalledTimes(1)
    const initialChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(initialChanges).toHaveLength(2)

    // Reset mock
    callback.mockReset()

    // Insert multiple items at once
    const tx1 = createTransaction({ mutationFn })
    tx1.mutate(() =>
      collection.insert([
        { id: 3, value: `batch1` },
        { id: 4, value: `batch2` },
        { id: 5, value: `batch3` },
      ])
    )

    // Verify only the 3 new items were emitted, not the existing ones
    expect(callback).toHaveBeenCalledTimes(1)
    const batchChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(batchChanges).toHaveLength(3)
    expect(batchChanges.every((change) => change.type === `insert`)).toBe(true)

    // Reset mock
    callback.mockReset()

    // Wait for changes to propagate
    await waitForChanges()

    // Verify no changes were emitted as the sync should match the optimistic state
    expect(callback).toHaveBeenCalledTimes(0)
    callback.mockReset()

    // Update one item only
    const itemToUpdate = collection.state.get(1)
    if (!itemToUpdate) {
      throw new Error(`Item not found`)
    }
    const tx2 = createTransaction({ mutationFn })
    tx2.mutate(() =>
      collection.update(itemToUpdate.id, (draft) => {
        draft.value = `updated value`
      })
    )

    // Verify only the updated item was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const updateChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(updateChanges).toHaveLength(1)

    const updateChange = updateChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(updateChange).toBeDefined()
    expect(updateChange.type).toBe(`update`)
    expect(updateChange.key).toBe(1)

    // Clean up
    unsubscribe()
  })

  it(`should correctly unsubscribe when returned function is called`, () => {
    const callback = vi.fn()

    // Create collection
    const collection = createCollection<{ id: number; value: string }>({
      id: `unsubscribe-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
    })
    const mutationFn = async () => {}

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback, {
      includeInitialState: true,
    })

    // Initial state emission
    expect(callback).toHaveBeenCalledTimes(1)

    // Reset mock
    callback.mockReset()

    // Unsubscribe
    unsubscribe()

    // Insert an item
    const tx = createTransaction({ mutationFn })
    tx.mutate(() => collection.insert({ id: 1, value: `test value` }))

    // Callback shouldn't be called after unsubscribe
    expect(callback).not.toHaveBeenCalled()
  })

  it(`should correctly handle filtered updates that transition between filter states`, () => {
    const callback = vi.fn()

    // Create collection with items that have a status field
    const collection = createCollection<{
      id: number
      value: string
      status: `active` | `inactive`
    }>({
      id: `filtered-updates-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Start with some initial data
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `item1`, status: `inactive` },
          })
          write({
            type: `insert`,
            value: { id: 2, value: `item2`, status: `active` },
          })
          commit()
        },
      },
    })

    const mutationFn: MutationFn = async () => {
      // Simulate sync by writing the mutations back
      const syncCollection = collection as any
      syncCollection.config.sync.sync({
        collection: syncCollection,
        begin: () => {
          syncCollection.pendingSyncedTransactions.push({
            committed: false,
            operations: [],
          })
        },
        write: (messageWithoutKey: any) => {
          const pendingTransaction =
            syncCollection.pendingSyncedTransactions[
              syncCollection.pendingSyncedTransactions.length - 1
            ]
          const key = syncCollection.getKeyFromItem(messageWithoutKey.value)
          const message = { ...messageWithoutKey, key }
          pendingTransaction.operations.push(message)
        },
        commit: () => {
          const pendingTransaction =
            syncCollection.pendingSyncedTransactions[
              syncCollection.pendingSyncedTransactions.length - 1
            ]
          pendingTransaction.committed = true
          syncCollection.commitPendingTransactions()
        },
        markReady: () => {
          syncCollection.markReady()
        },
      })
      return Promise.resolve()
    }

    // Subscribe to changes with a filter for active items only
    const unsubscribe = collection.subscribeChanges(callback, {
      includeInitialState: true,
      where: (row) => eq(row.status, `active`),
    })

    // Should only receive the active item in initial state
    expect(callback).toHaveBeenCalledTimes(1)
    const initialChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      id: number
      value: string
      status: `active` | `inactive`
    }>
    expect(initialChanges).toHaveLength(1)
    expect(initialChanges[0]!.key).toBe(2)
    expect(initialChanges[0]!.type).toBe(`insert`)

    // Reset mock
    callback.mockReset()

    // Test 1: Update an inactive item to active (should emit insert)
    const tx1 = createTransaction({ mutationFn })
    tx1.mutate(() =>
      collection.update(1, (draft) => {
        draft.status = `active`
      })
    )

    // Should emit an insert event for the newly active item
    expect(callback).toHaveBeenCalledTimes(1)
    const insertChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      id: number
      value: string
      status: `active` | `inactive`
    }>
    expect(insertChanges).toHaveLength(1)
    expect(insertChanges[0]!.type).toBe(`insert`)
    expect(insertChanges[0]!.key).toBe(1)
    expect(insertChanges[0]!.value.status).toBe(`active`)

    // Reset mock
    callback.mockReset()

    // Test 2: Update an active item to inactive (should emit delete)
    const tx2 = createTransaction({ mutationFn })
    tx2.mutate(() =>
      collection.update(2, (draft) => {
        draft.status = `inactive`
      })
    )

    // Should emit a delete event for the newly inactive item
    expect(callback).toHaveBeenCalledTimes(1)
    const deleteChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      id: number
      value: string
      status: `active` | `inactive`
    }>
    expect(deleteChanges).toHaveLength(1)
    expect(deleteChanges[0]!.type).toBe(`delete`)
    expect(deleteChanges[0]!.key).toBe(2)
    expect(deleteChanges[0]!.value.status).toBe(`active`) // Should be the previous value (active)

    // Reset mock
    callback.mockReset()

    // Test 3: Update an active item while keeping it active (should emit update)
    const tx3 = createTransaction({ mutationFn })
    tx3.mutate(() =>
      collection.update(1, (draft) => {
        draft.value = `updated item1`
      })
    )

    // Should emit an update event for the active item
    expect(callback).toHaveBeenCalledTimes(1)
    const updateChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      id: number
      value: string
      status: `active` | `inactive`
    }>
    expect(updateChanges).toHaveLength(1)
    expect(updateChanges[0]!.type).toBe(`update`)
    expect(updateChanges[0]!.key).toBe(1)
    expect(updateChanges[0]!.value.value).toBe(`updated item1`)

    // Reset mock
    callback.mockReset()

    // Test 4: Update an inactive item while keeping it inactive (should emit nothing)
    const tx4 = createTransaction({ mutationFn })
    tx4.mutate(() =>
      collection.update(2, (draft) => {
        draft.value = `updated inactive item`
      })
    )

    // Should not emit any events for inactive items
    expect(callback).not.toHaveBeenCalled()

    // Clean up
    unsubscribe()
  })
})
