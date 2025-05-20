import { describe, expect, it, vi } from "vitest"
import mitt from "mitt"
import { Collection } from "../src/collection"
import { createTransaction } from "../src/transactions"
import type {
  ChangeMessage,
  ChangesPayload,
  PendingMutation,
  Transaction,
  TransactionConfig,
} from "../src/types"

// Helper function to wait for changes to be processed
const waitForChanges = () => new Promise((resolve) => setTimeout(resolve, 10))

describe(`Collection.subscribeChanges`, () => {
  it(`should emit initial collection state as insert changes`, () => {
    const callback = vi.fn()

    // Create collection with pre-populated data
    const collection = new Collection<{ value: string }>({
      id: `initial-state-test`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Immediately populate with initial data
          begin()
          write({
            type: `insert`,
            key: `item1`,
            value: { value: `value1` },
          })
          write({
            type: `insert`,
            key: `item2`,
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
    expect(callback).toHaveBeenCalledTimes(1)
    const changes = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(changes).toHaveLength(2)

    const insertedKeys = changes.map((change) => change.key)
    expect(insertedKeys).toContain(`item1`)
    expect(insertedKeys).toContain(`item2`)

    // Ensure all changes are insert type
    expect(changes.every((change) => change.type === `insert`)).toBe(true)

    // Clean up
    unsubscribe()
  })

  it(`should emit changes from synced operations using mitt emitter`, () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with sync capability using the mitt pattern from collection.test.ts
    const collection = new Collection<{ value: string }>({
      id: `sync-changes-test-with-mitt`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Setup a listener for our test events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                key: change.key,
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.changes,
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
        key: `syncItem1`,
        changes: { value: `sync value 1` },
      },
    ])

    // Verify that insert was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const insertChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(insertChanges).toHaveLength(1)

    if (insertChanges.length > 0) {
      const insertChange = insertChanges[0]! as ChangeMessage<{
        value: string
      }>
      expect(insertChange).toBeDefined()
      expect(insertChange.type).toBe(`insert`)
      expect(insertChange.key).toBe(`syncItem1`)
      expect(insertChange.value).toEqual({ value: `sync value 1` })
    }

    // Reset mock
    callback.mockReset()

    // Emit a sync update change
    emitter.emit(`testEvent`, [
      {
        type: `update`,
        key: `syncItem1`,
        changes: { value: `updated sync value` },
      },
    ])

    // Verify that update was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    const undateChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(undateChanges).toHaveLength(1)

    const updateChange = undateChanges[0]! as ChangeMessage<{
      value: string
    }>
    expect(updateChange).toBeDefined()
    expect(updateChange.type).toBe(`update`)
    expect(updateChange.key).toBe(`syncItem1`)
    expect(updateChange.value).toEqual({ value: `updated sync value` })

    // Reset mock
    callback.mockReset()

    // Emit a sync delete change
    emitter.emit(`testEvent`, [
      {
        type: `delete`,
        key: `syncItem1`,
        changes: { value: `updated sync value` },
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
    expect(deleteChange.key).toBe(`syncItem1`)

    // Clean up
    unsubscribe()
  })

  it(`should emit changes from optimistic operations`, () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with mutation capability
    const collection = new Collection<{ value: string; updated?: boolean }>({
      id: `optimistic-changes-test`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Listen for sync events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                key: change.key,
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.changes,
              })
            })
            commit()
          })
        },
      },
    })

    const mutationFn = async ({ transaction }) => {
      emitter.emit(`sync`, transaction.mutations)
      return Promise.resolve()
    }

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback)

    // Reset mock to ignore initial state emission
    callback.mockReset()

    // Perform optimistic insert
    const tx = createTransaction({ mutationFn })
    tx.mutate(() =>
      collection.insert(
        { value: `optimistic value` },
        { key: `optimisticItem` }
      )
    )

    // Verify that insert was emitted immediately (optimistically)
    expect(callback).toHaveBeenCalledTimes(1)
    const insertChanges = callback.mock.calls[0]![0] as ChangesPayload<{
      value: string
    }>
    expect(insertChanges).toHaveLength(1)

    if (insertChanges.length > 0) {
      const insertChange = insertChanges[0]! as ChangeMessage<{
        value: string
      }>
      expect(insertChange).toBeDefined()
      expect(insertChange).toEqual({
        type: `insert`,
        key: `optimisticItem`,
        value: { value: `optimistic value` },
      })
    }

    // Reset mock
    callback.mockReset()

    // Perform optimistic update
    const item = collection.state.get(`optimisticItem`)
    if (!item) {
      throw new Error(`Item not found`)
    }
    const updateTx = createTransaction({ mutationFn })
    updateTx.mutate(() =>
      collection.update(item, (draft) => {
        draft.value = `updated optimistic value`
        draft.updated = true
      })
    )

    // Verify that update was emitted
    expect(callback).toHaveBeenCalledTimes(1)
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
    expect(updateChange.key).toBe(`optimisticItem`)
    expect(updateChange.value).toEqual({
      value: `updated optimistic value`,
      updated: true,
    })

    // Reset mock
    callback.mockReset()

    // Perform optimistic delete
    const deleteTx = createTransaction({ mutationFn })
    deleteTx.mutate(() => collection.delete(`optimisticItem`))

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
    expect(deleteChange.key).toBe(`optimisticItem`)

    // Clean up
    unsubscribe()
  })

  it(`should handle both synced and optimistic changes together`, async () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with both sync and mutation capabilities
    const collection = new Collection<{ value: string }>({
      id: `mixed-changes-test`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Setup a listener for our test events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                key: change.key,
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.changes,
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

    const mutationFn = async ({ transaction }) => {
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
        key: `syncedItem`,
        changes: { value: `synced value` },
      },
    ])

    // Wait for changes to propagate
    await waitForChanges()

    // Verify synced insert was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]![0]).toEqual([
      {
        type: `insert`,
        key: `syncedItem`,
        value: { value: `synced value` },
      },
    ])
    callback.mockReset()

    // Now add an optimistic item
    const tx = createTransaction({ mutationFn })
    tx.mutate(() =>
      collection.insert(
        { value: `optimistic value` },
        { key: `optimisticItem` }
      )
    )

    // Verify optimistic insert was emitted - this is the synchronous optimistic update
    // and so we don't await here
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]![0]).toEqual([
      {
        type: `insert`,
        key: `optimisticItem`,
        value: { value: `optimistic value` },
      },
    ])
    callback.mockReset()

    await tx.isPersisted.promise

    // Verify synced update was emitted
    expect(callback).toHaveBeenCalledTimes(2) // FIXME: this should ideally be 0 - we currently see a delete and an insert
    // This is called 1 time when the mutationFn call returns
    // and the optimistic state is dropped and the synced state applied.
    callback.mockReset()

    // Update both items in optimistic and synced ways
    // First update the optimistic item optimistically
    const optItem = collection.state.get(`optimisticItem`)
    let updateTx
    if (optItem) {
      updateTx = createTransaction({ mutationFn })
      updateTx.mutate(() =>
        collection.update(optItem, (draft) => {
          draft.value = `updated optimistic value`
        })
      )
    }

    // We don't await here as the optimistic update is sync

    // Verify the optimistic update was emitted
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]![0]).toEqual([
      {
        type: `update`,
        key: `optimisticItem`,
        value: {
          value: `updated optimistic value`,
        },
        previousValue: {
          value: `optimistic value`,
        },
      },
    ])
    callback.mockReset()

    await updateTx?.isPersisted.promise

    // Verify synced update was emitted
    expect(callback).toHaveBeenCalledTimes(2) // FIXME: check is we can reduce this
    // This is called 1 time when the mutationFn call returns
    // and the optimistic state is dropped and the synced state applied.
    callback.mockReset()

    // Then update the synced item with a synced update
    emitter.emit(`sync`, [
      {
        type: `update`,
        key: `syncedItem`,
        changes: { value: `updated synced value` },
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
    expect(updateChange.key).toBe(`syncedItem`)
    expect(updateChange.value).toEqual({ value: `updated synced value` })

    // Clean up
    unsubscribe()
  })

  it(`should only emit differences between states, not whole state`, async () => {
    const emitter = mitt()
    const callback = vi.fn()

    // Create collection with initial data
    const collection = new Collection<{ value: string }>({
      id: `diff-changes-test`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Immediately populate with initial data
          begin()
          write({
            type: `insert`,
            key: `item1`,
            value: { value: `value1` },
          })
          write({
            type: `insert`,
            key: `item2`,
            value: { value: `value2` },
          })
          commit()

          // Listen for sync events
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
                key: change.key,
                type: change.type,
                // @ts-expect-error TODO type changes
                value: change.changes,
              })
            })
            commit()
          })
        },
      },
    })
    const mutationFn = async ({ transaction }) => {
      emitter.emit(`sync`, transaction.mutations)
      return Promise.resolve()
    }

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback)

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
        { value: `batch1` },
        { value: `batch2` },
        { value: `batch3` },
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

    // Verify synced update was emitted
    expect(callback).toHaveBeenCalledTimes(2) // FIXME: this should ideally be 0 - we currently see a delete and an insert
    // This is called when the mutationFn returns and
    // the optimistic state is dropped and synced state is
    // applied.
    callback.mockReset()

    // Update one item only
    const itemToUpdate = collection.state.get(`item1`)
    if (!itemToUpdate) {
      throw new Error(`Item not found`)
    }
    const tx2 = createTransaction({ mutationFn })
    tx2.mutate(() =>
      collection.update(itemToUpdate, (draft) => {
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
    expect(updateChange.key).toBe(`item1`)

    // Clean up
    unsubscribe()
  })

  it(`should correctly unsubscribe when returned function is called`, () => {
    const callback = vi.fn()

    // Create collection
    const collection = new Collection<{ value: string }>({
      id: `unsubscribe-test`,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
    })
    const mutationFn = async () => {}

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(callback)

    // Initial state emission
    expect(callback).toHaveBeenCalledTimes(1)

    // Reset mock
    callback.mockReset()

    // Unsubscribe
    unsubscribe()

    // Insert an item
    const tx = createTransaction({ mutationFn })
    tx.mutate(() => collection.insert({ value: `test value` }))

    // Callback shouldn't be called after unsubscribe
    expect(callback).not.toHaveBeenCalled()
  })
})
