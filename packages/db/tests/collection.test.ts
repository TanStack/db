import { type } from "arktype"
import mitt from "mitt"
import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/collection"
import {
  CollectionRequiresConfigError,
  DuplicateKeyError,
  KeyUpdateNotAllowedError,
  MissingDeleteHandlerError,
  MissingInsertHandlerError,
  MissingUpdateHandlerError,
  SchemaValidationError,
} from "../src/errors"
import { createTransaction } from "../src/transactions"
import type {
  ChangeMessage,
  MutationFn,
  OperationType,
  PendingMutation,
  ResolveTransactionChanges,
} from "../src/types"

describe(`Collection`, () => {
  it(`should throw if there's no sync config`, () => {
    // @ts-expect-error we're testing for throwing when there's no config passed in
    expect(() => createCollection()).toThrow(CollectionRequiresConfigError)
  })

  it(`should throw an error when trying to use mutation operations outside of a transaction`, async () => {
    // Create a collection with sync but no mutationFn
    const collection = createCollection<{ value: string }>({
      id: `foo`,
      getKey: (item) => item.value,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Immediately execute the sync cycle
          begin()
          write({
            type: `insert`,
            value: { value: `initial value` },
          })
          commit()
        },
      },
    })

    // Wait for the collection to be ready
    await collection.stateWhenReady()

    // Verify initial state
    expect(Array.from(collection.state.values())).toEqual([
      { value: `initial value` },
    ])

    // Verify that insert throws an error
    expect(() => {
      collection.insert({ value: `new value` })
    }).toThrow(MissingInsertHandlerError)

    // Verify that update throws an error
    expect(() => {
      collection.update(`initial`, (draft) => {
        draft.value = `updated value`
      })
    }).toThrow(MissingUpdateHandlerError)

    // Verify that delete throws an error
    expect(() => {
      collection.delete(`initial`)
    }).toThrow(MissingDeleteHandlerError)
  })

  it(`should throw an error when trying to update an item's ID`, async () => {
    const collection = createCollection<{ id: string; value: string }>({
      id: `id-update-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          write({
            type: `insert`,
            value: { id: `item-1`, value: `initial value` },
          })
          commit()
        },
      },
    })

    await collection.stateWhenReady()

    const tx = createTransaction({
      mutationFn: async () => {
        // No-op mutationFn for this test, as we expect a client-side error
      },
    })

    expect(() => {
      tx.mutate(() => {
        collection.update(`item-1`, (draft) => {
          draft.id = `item-2` // Attempt to change the ID
          draft.value = `updated value`
        })
      })
    }).toThrow(KeyUpdateNotAllowedError)
  })

  it(`It shouldn't expose any state until the initial sync is finished`, () => {
    // Create a collection with a mock sync plugin
    createCollection<{ name: string }>({
      id: `foo`,
      getKey: (item) => item.name,
      startSync: true,
      sync: {
        sync: ({ collection, begin, write, commit }) => {
          // Initial state should be empty
          expect(collection.state).toEqual(new Map())

          // Start a batch of operations
          begin()

          // Write some test data
          const operations: Array<
            Omit<ChangeMessage<{ name: string }>, `key`>
          > = [
            { value: { name: `Alice` }, type: `insert` },
            { value: { name: `Bob` }, type: `insert` },
          ]

          for (const op of operations) {
            write(op)
            // Data should still be empty during writes
            expect(collection.state).toEqual(new Map())
          }

          // Commit the changes
          commit()

          // Now the data should be visible
          const expectedData = [{ name: `Alice` }, { name: `Bob` }]
          expect(Array.from(collection.state.values())).toEqual(expectedData)
        },
      },
    })
  })

  it(`Calling mutation operators should trigger creating & persisting a new transaction`, async () => {
    const emitter = mitt()
    // Create mock functions that will capture the data for later assertions
    const persistMock = vi.fn()
    const syncMock = vi.fn()

    // new collection w/ mock sync/mutation
    const collection = createCollection<{
      id: number
      value: string
      boolean?: boolean
      newProp?: string
    }>({
      id: `mock`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          // @ts-expect-error don't trust mitt's typing
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

    const mutationFn: MutationFn = ({ transaction }) => {
      // Redact time-based and random fields
      const redactedTransaction = {
        ...transaction,
        mutations: {
          ...transaction.mutations.map((mutation) => {
            return {
              ...mutation,
              createdAt: `[REDACTED]`,
              updatedAt: `[REDACTED]`,
              mutationId: `[REDACTED]`,
            }
          }),
        },
      }

      // Call the mock function with the redacted transaction
      persistMock({ transaction: redactedTransaction })

      // Call the mock function with the transaction
      syncMock({ transaction })

      emitter.emit(`sync`, transaction.mutations)
      return Promise.resolve()
    }

    // Test insert with auto-generated key
    const data = { id: 1, value: `bar` }
    // TODO create transaction manually with the above mutationFn & get assertions passing.
    const tx = createTransaction({ mutationFn })
    tx.mutate(() => collection.insert(data))

    // @ts-expect-error possibly undefined is ok in test
    const insertedKey = tx.mutations[0].key as string

    // The merged value should immediately contain the new insert
    expect(collection.state).toEqual(
      new Map([[insertedKey, { id: 1, value: `bar` }]])
    )

    // check there's a transaction in peristing state
    expect(
      // @ts-expect-error possibly undefined is ok in test
      tx.mutations[0].changes
    ).toEqual({
      id: 1,
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertKey = 1
    expect(collection.optimisticUpserts.has(insertKey)).toBe(true)
    expect(collection.optimisticUpserts.get(insertKey)).toEqual({
      id: 1,
      value: `bar`,
    })

    // Check persist data (moved outside the persist callback)
    // @ts-expect-error possibly undefined is ok in test
    const persistData = persistMock.mock.calls[0][0]
    // Check that the transaction is in the right state during persist
    expect(persistData.transaction.state).toBe(`persisting`)
    // Check mutation type is correct
    expect(persistData.transaction.mutations[0].type).toBe(`insert`)
    // Check changes are correct
    expect(persistData.transaction.mutations[0].changes).toEqual({
      id: 1,
      value: `bar`,
    })

    await tx.isPersisted.promise

    // @ts-expect-error possibly undefined is ok in test
    const syncData = syncMock.mock.calls[0][0]
    // Check that the transaction is in the right state during sync waiting
    expect(syncData.transaction.state).toBe(`completed`)
    // Check mutation type is correct
    expect(syncData.transaction.mutations[0].type).toBe(`insert`)
    // Check changes are correct
    expect(syncData.transaction.mutations[0].changes).toEqual({
      id: 1,
      value: `bar`,
    })

    // after mutationFn returns, check that the transaction is cleaned up,
    // optimistic update is gone & synced data & combined state are all updated.
    expect(collection.transactions.size).toEqual(0) // Transaction should be cleaned up
    expect(collection.state).toEqual(
      new Map([[insertedKey, { id: 1, value: `bar` }]])
    )
    expect(collection.optimisticUpserts.size).toEqual(0)

    // Test insert with provided key
    const tx2 = createTransaction({ mutationFn })
    tx2.mutate(() => collection.insert({ id: 2, value: `baz` }))
    expect(collection.state.get(2)).toEqual({
      id: 2,
      value: `baz`,
    })
    await tx2.isPersisted.promise

    // Test bulk insert
    const tx3 = createTransaction({ mutationFn })
    const bulkData = [
      { id: 3, value: `item1` },
      { id: 4, value: `item2` },
    ]
    tx3.mutate(() => collection.insert(bulkData))
    const keys = Array.from(collection.state.keys())
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[2])).toEqual(bulkData[0])
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[3])).toEqual(bulkData[1])
    await tx3.isPersisted.promise

    const tx4 = createTransaction({ mutationFn })
    // Test update with callback
    tx4.mutate(() =>
      collection.update([1], (item) => {
        // @ts-expect-error possibly undefined is ok in test
        item[0].value = `bar2`
      })
    )

    // The merged value should contain the update.
    expect(collection.state.get(insertedKey)).toEqual({ id: 1, value: `bar2` })
    await tx4.isPersisted.promise

    const tx5 = createTransaction({ mutationFn })
    // Test update with config and callback
    tx5.mutate(() =>
      collection.update(
        insertedKey,
        { metadata: { updated: true } },
        (item) => {
          item.value = `bar3`
          item.newProp = `new value`
        }
      )
    )

    // The merged value should contain the update
    expect(collection.state.get(insertedKey)).toEqual({
      id: 1,
      value: `bar3`,
      newProp: `new value`,
    })

    await tx5.isPersisted.promise

    // If there are two updates, the second should overwrite the first.
    const tx55 = createTransaction({ mutationFn })
    // Test update with config and callback
    tx55.mutate(() => {
      collection.update(
        insertedKey,
        { metadata: { updated: true } },
        (item) => {
          item.value = `bar3.1`
          item.newProp = `new value.1`
        }
      )
      collection.update(
        insertedKey,
        { metadata: { updated: true } },
        (item) => {
          item.value = `bar3`
          item.newProp = `new value`
        }
      )
    })

    // The merged value should contain the update
    expect(collection.state.get(insertedKey)).toEqual({
      id: 1,
      value: `bar3`,
      newProp: `new value`,
    })
    expect(tx55.mutations).toHaveLength(1)

    await tx55.isPersisted.promise

    const tx6 = createTransaction({ mutationFn })
    // Test bulk update
    tx6.mutate(() =>
      collection.update(
        [keys[2], keys[3]],
        { metadata: { bulkUpdate: true } },
        (drafts) => {
          drafts.forEach((draft) => {
            draft.value += `-updated`
            draft.boolean = true
          })
        }
      )
    )

    // Check bulk updates
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[2])).toEqual({
      boolean: true,
      id: 3,
      value: `item1-updated`,
    })
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[3])).toEqual({
      boolean: true,
      id: 4,
      value: `item2-updated`,
    })
    await tx6.isPersisted.promise

    const tx7 = createTransaction({ mutationFn })
    // Test delete single item
    tx7.mutate(() => collection.delete(insertedKey))
    expect(collection.state.has(insertedKey)).toBe(false)
    // objectKeyMap check removed as it no longer exists
    await tx7.isPersisted.promise

    // Test delete with metadata
    const tx8Insert = createTransaction({ mutationFn })
    tx8Insert.mutate(() => collection.insert({ id: 5, value: `foostyle` }))
    // @ts-expect-error possibly undefined is ok in test
    const tx8insertKey = tx8Insert.mutations[0].key
    await tx8Insert.isPersisted.promise
    const tx8 = createTransaction({ mutationFn })
    tx8.mutate(() =>
      collection.delete(tx8insertKey, {
        metadata: { reason: `test delete` },
      })
    )
    expect(tx8.mutations[0]?.metadata).toEqual({ reason: `test delete` })
    expect(collection.state.has(tx8insertKey)).toBe(false)
    await tx8.isPersisted.promise

    // Test bulk delete
    const tx9 = createTransaction({ mutationFn })
    tx9.mutate(() => collection.delete([keys[2]!, keys[3]!]))
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.has(keys[2])).toBe(false)
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.has(keys[3])).toBe(false)
    await tx9.isPersisted.promise
  })

  it(`synced updates should *not* be applied while there's a persisting transaction`, async () => {
    const emitter = mitt()

    // new collection w/ mock sync/mutation
    const collection = createCollection<{ id: number; value: string }>({
      id: `mock`,
      getKey: (item) => {
        return item.id
      },
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          // @ts-expect-error don't trust Mitt's typing and this works.
          emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
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

    const mutationFn: MutationFn = ({ transaction }) => {
      // Sync something and check that that it isn't applied because
      // we're still in the middle of persisting a transaction.
      emitter.emit(`update`, [
        // This update is ignored because the optimistic update overrides it.
        { type: `insert`, changes: { id: 2, bar: `value2` } },
      ])
      expect(collection.state).toEqual(new Map([[1, { id: 1, value: `bar` }]]))
      // Remove it so we don't have to assert against it below
      emitter.emit(`update`, [{ changes: { id: 2 }, type: `delete` }])

      emitter.emit(`update`, transaction.mutations)
      return Promise.resolve()
    }

    const tx1 = createTransaction({ mutationFn })

    // insert
    tx1.mutate(() =>
      collection.insert({
        id: 1,
        value: `bar`,
      })
    )

    // The merged value should immediately contain the new insert
    expect(collection.state).toEqual(new Map([[1, { id: 1, value: `bar` }]]))

    // check there's a transaction in peristing state
    expect(
      // @ts-expect-error possibly undefined is ok in test
      Array.from(collection.transactions.values())[0].mutations[0].changes
    ).toEqual({
      id: 1,
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertKey = 1
    expect(collection.optimisticUpserts.has(insertKey)).toBe(true)
    expect(collection.optimisticUpserts.get(insertKey)).toEqual({
      id: 1,
      value: `bar`,
    })

    await tx1.isPersisted.promise

    expect(collection.state).toEqual(new Map([[1, { id: 1, value: `bar` }]]))
  })

  it(`should throw errors when deleting items not in the collection`, () => {
    const collection = createCollection<{ name: string }>({
      id: `delete-errors`,
      getKey: (val) => val.name,
      startSync: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
    })

    const mutationFn = () => Promise.resolve()

    // Add an item to the collection
    const item = { name: `Test Item` }
    const tx1 = createTransaction({ mutationFn })
    tx1.mutate(() => collection.insert(item))

    // Throw when trying to delete a non-existent ID
    const tx2 = createTransaction({ mutationFn })
    expect(() =>
      tx2.mutate(() => collection.delete(`non-existent-id`))
    ).toThrow()

    // Should not throw when deleting by ID
    const tx5 = createTransaction({ mutationFn })
    // Get the ID from the first item that was inserted
    const itemId = Array.from(collection.state.keys())[0]
    expect(() => tx5.mutate(() => collection.delete(itemId!))).not.toThrow()
  })

  it(`should not allow inserting documents with IDs that already exist`, async () => {
    const collection = createCollection<{ id: number; value: string }>({
      id: `duplicate-id-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value` },
          })
          commit()
        },
      },
    })

    await collection.stateWhenReady()

    const mutationFn = async () => {}
    const tx = createTransaction({ mutationFn })

    // Try to insert a document with the same ID
    expect(() => {
      tx.mutate(() => collection.insert({ id: 1, value: `duplicate value` }))
    }).toThrow(DuplicateKeyError)

    // Should be able to insert a document with a different ID
    const tx2 = createTransaction({ mutationFn })
    expect(() => {
      tx2.mutate(() => collection.insert({ id: 2, value: `new value` }))
    }).not.toThrow()
  })

  it(`should support operation handler functions`, async () => {
    // Create mock handler functions
    const onInsertMock = vi.fn()
    const onUpdateMock = vi.fn()
    const onDeleteMock = vi.fn()

    // Create a collection with handler functions
    const collection = createCollection<{ id: number; value: string }>({
      id: `handlers-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value` },
          })
          commit()
        },
      },
      // Add the new handler functions
      onInsert: onInsertMock,
      onUpdate: onUpdateMock,
      onDelete: onDeleteMock,
    })

    await collection.stateWhenReady()

    // Create a transaction to test the handlers
    const mutationFn = async () => {}
    const tx = createTransaction({ mutationFn, autoCommit: false })

    // Test insert handler
    tx.mutate(() => collection.insert({ id: 2, value: `new value` }))

    // Test update handler
    tx.mutate(() =>
      collection.update(1, (draft) => {
        draft.value = `updated value`
      })
    )

    // Test delete handler
    tx.mutate(() => collection.delete(1))

    // Verify the handler functions were defined correctly
    // We're not testing actual invocation since that would require modifying the Collection class
    expect(typeof collection.config.onInsert).toBe(`function`)
    expect(typeof collection.config.onUpdate).toBe(`function`)
    expect(typeof collection.config.onDelete).toBe(`function`)
  })

  it(`should execute operations outside of explicit transactions using handlers`, async () => {
    // Create handler functions that resolve after a short delay to simulate async operations
    const onInsertMock = vi.fn().mockImplementation(async () => {
      // Wait a bit to simulate an async operation
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { success: true, operation: `insert` }
    })

    const onUpdateMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { success: true, operation: `update` }
    })

    const onDeleteMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { success: true, operation: `delete` }
    })

    // Create a collection with handler functions
    const collection = createCollection<{ id: number; value: string }>({
      id: `direct-operations-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value` },
          })
          commit()
        },
      },
      // Add the handler functions
      onInsert: onInsertMock,
      onUpdate: onUpdateMock,
      onDelete: onDeleteMock,
    })

    await collection.stateWhenReady()

    // Test direct insert operation
    const insertTx = collection.insert({ id: 2, value: `inserted directly` })
    expect(insertTx).toBeDefined()
    expect(onInsertMock).toHaveBeenCalledTimes(1)

    // Test direct update operation
    const updateTx = collection.update(1, (draft) => {
      draft.value = `updated directly`
    })
    expect(updateTx).toBeDefined()
    expect(onUpdateMock).toHaveBeenCalledTimes(1)

    // Test direct delete operation
    const deleteTx = collection.delete(1)
    expect(deleteTx).toBeDefined()
    expect(onDeleteMock).toHaveBeenCalledTimes(1)

    // Wait for all transactions to complete
    await Promise.all([
      insertTx.isPersisted.promise,
      updateTx.isPersisted.promise,
      deleteTx.isPersisted.promise,
    ])

    // Verify the transactions were created with the correct configuration
    expect(insertTx.autoCommit).toBe(true)
    expect(updateTx.autoCommit).toBe(true)
    expect(deleteTx.autoCommit).toBe(true)
  })

  it(`should throw errors when operations are called outside transactions without handlers`, async () => {
    // Create a collection without handler functions
    const collection = createCollection<{ id: number; value: string }>({
      id: `no-handlers-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value` },
          })
          commit()
        },
      },
      // No handler functions defined
    })

    await collection.stateWhenReady()

    // Test insert without handler
    expect(() => {
      collection.insert({ id: 2, value: `should fail` })
    }).toThrow(MissingInsertHandlerError)

    // Test update without handler
    expect(() => {
      collection.update(1, (draft) => {
        draft.value = `should fail`
      })
    }).toThrow(MissingUpdateHandlerError)

    // Test delete without handler
    expect(() => {
      collection.delete(`1`) // Convert number to string to match expected type
    }).toThrow(MissingDeleteHandlerError)
  })

  it(`should not apply optimistic updates when optimistic: false`, async () => {
    const emitter = mitt()
    const pendingMutations: Array<() => void> = []

    const mutationFn = vi.fn().mockImplementation(async ({ transaction }) => {
      // Don't sync immediately - return a promise that can be resolved later
      return new Promise<void>((resolve) => {
        pendingMutations.push(() => {
          emitter.emit(`sync`, transaction.mutations)
          resolve()
        })
      })
    })

    const collection = createCollection<{ id: number; value: string }>({
      id: `non-optimistic-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Initialize with some data
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value` },
          })
          commit()

          // @ts-expect-error don't trust mitt's typing
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
      onInsert: mutationFn,
      onUpdate: mutationFn,
      onDelete: mutationFn,
    })

    await collection.stateWhenReady()

    // Test non-optimistic insert
    const nonOptimisticInsertTx = collection.insert(
      { id: 2, value: `non-optimistic insert` },
      { optimistic: false }
    )

    // Debug: Check the mutation was created with optimistic: false
    expect(nonOptimisticInsertTx.mutations[0]?.optimistic).toBe(false)

    // The item should NOT appear in the collection state immediately
    expect(collection.state.has(2)).toBe(false)
    expect(collection.optimisticUpserts.has(2)).toBe(false)
    expect(collection.state.size).toBe(1) // Only the initial item

    // Now resolve the mutation and wait for completion
    pendingMutations[0]?.()
    await nonOptimisticInsertTx.isPersisted.promise

    // Now the item should appear after server confirmation
    expect(collection.state.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({
      id: 2,
      value: `non-optimistic insert`,
    })

    // Test non-optimistic update
    const nonOptimisticUpdateTx = collection.update(
      1,
      { optimistic: false },
      (draft) => {
        draft.value = `non-optimistic update`
      }
    )

    // The original value should still be there immediately
    expect(collection.state.get(1)?.value).toBe(`initial value`)
    expect(collection.optimisticUpserts.has(1)).toBe(false)

    // Now resolve the update mutation and wait for completion
    pendingMutations[1]?.()
    await nonOptimisticUpdateTx.isPersisted.promise

    // Now the update should be reflected
    expect(collection.state.get(1)?.value).toBe(`non-optimistic update`)

    // Test non-optimistic delete
    const nonOptimisticDeleteTx = collection.delete(2, { optimistic: false })

    // The item should still be there immediately
    expect(collection.state.has(2)).toBe(true)
    expect(collection.optimisticDeletes.has(2)).toBe(false)

    // Now resolve the delete mutation and wait for completion
    pendingMutations[2]?.()
    await nonOptimisticDeleteTx.isPersisted.promise

    // Now the item should be gone
    expect(collection.state.has(2)).toBe(false)
  })

  it(`should apply optimistic updates by default and with explicit optimistic: true`, async () => {
    const emitter = mitt()
    const mutationFn = vi.fn().mockImplementation(async ({ transaction }) => {
      // Simulate server persistence
      emitter.emit(`sync`, transaction.mutations)
      return Promise.resolve()
    })

    const collection = createCollection<{ id: number; value: string }>({
      id: `optimistic-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Initialize with some data
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value` },
          })
          commit()

          // @ts-expect-error don't trust mitt's typing
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
      onInsert: mutationFn,
      onUpdate: mutationFn,
      onDelete: mutationFn,
    })

    await collection.stateWhenReady()

    // Test default optimistic behavior (should be true)
    const defaultOptimisticTx = collection.insert({
      id: 2,
      value: `default optimistic`,
    })

    // The item should appear immediately
    expect(collection.state.has(2)).toBe(true)
    expect(collection.optimisticUpserts.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({
      id: 2,
      value: `default optimistic`,
    })

    await defaultOptimisticTx.isPersisted.promise

    // Test explicit optimistic: true
    const explicitOptimisticTx = collection.insert(
      { id: 3, value: `explicit optimistic` },
      { optimistic: true }
    )

    // The item should appear immediately
    expect(collection.state.has(3)).toBe(true)
    expect(collection.optimisticUpserts.has(3)).toBe(true)
    expect(collection.state.get(3)).toEqual({
      id: 3,
      value: `explicit optimistic`,
    })

    await explicitOptimisticTx.isPersisted.promise

    // Test optimistic update
    const optimisticUpdateTx = collection.update(
      1,
      { optimistic: true },
      (draft) => {
        draft.value = `optimistic update`
      }
    )

    // The update should be reflected immediately
    expect(collection.state.get(1)?.value).toBe(`optimistic update`)
    expect(collection.optimisticUpserts.has(1)).toBe(true)

    await optimisticUpdateTx.isPersisted.promise

    // Test optimistic delete
    const optimisticDeleteTx = collection.delete(3, { optimistic: true })

    // The item should be gone immediately
    expect(collection.state.has(3)).toBe(false)
    expect(collection.optimisticDeletes.has(3)).toBe(true)

    await optimisticDeleteTx.isPersisted.promise
  })
})

describe(`Collection with schema validation`, () => {
  it(`should validate data against arktype schema on insert`, () => {
    // Create a Zod schema for a user
    const userSchema = type({
      name: `string > 0`,
      age: `number.integer > 0`,
      "email?": `string.email`,
    })

    // Create a collection with the schema
    const collection = createCollection<typeof userSchema.infer>({
      id: `test`,
      getKey: (item) => item.name,
      startSync: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })
    const mutationFn = async () => {}

    // Valid data should work
    const validUser = {
      name: `Alice`,
      age: 30,
      email: `alice@example.com`,
    }

    const tx1 = createTransaction({ mutationFn })
    tx1.mutate(() => collection.insert(validUser))

    // Invalid data should throw SchemaValidationError
    const invalidUser = {
      name: ``, // Empty name (fails min length)
      age: -5, // Negative age (fails positive)
      email: `not-an-email`, // Invalid email
    }

    try {
      const tx2 = createTransaction({ mutationFn })
      tx2.mutate(() => collection.insert(invalidUser))
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`insert`)
        expect(error.issues.length).toBeGreaterThan(0)
        // Check that we have validation errors for each invalid field
        expect(error.issues.some((issue) => issue.path?.includes(`name`))).toBe(
          true
        )
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
        expect(
          error.issues.some((issue) => issue.path?.includes(`email`))
        ).toBe(true)
      }
    }

    // Partial updates should work with valid data
    const tx3 = createTransaction({ mutationFn })
    tx3.mutate(() =>
      collection.update(`Alice`, (draft) => {
        draft.age = 31
      })
    )

    // Partial updates should fail with invalid data
    try {
      const tx4 = createTransaction({ mutationFn })
      tx4.mutate(() =>
        collection.update(`Alice`, (draft) => {
          draft.age = -1
        })
      )
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`update`)
        expect(error.issues.length).toBeGreaterThan(0)
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
      }
    }
  })

  it(`should validate data against schema on insert`, () => {
    // Create a Zod schema for a user
    const userSchema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
      email: z.string().email().optional(),
    })

    // Create a collection with the schema
    const collection = createCollection<z.infer<typeof userSchema>>({
      id: `test`,
      getKey: (item) => item.name,
      startSync: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })
    const mutationFn = async () => {}

    // Valid data should work
    const validUser = {
      name: `Alice`,
      age: 30,
      email: `alice@example.com`,
    }

    const tx1 = createTransaction({ mutationFn })
    tx1.mutate(() => collection.insert(validUser))

    // Invalid data should throw SchemaValidationError
    const invalidUser = {
      name: ``, // Empty name (fails min length)
      age: -5, // Negative age (fails positive)
      email: `not-an-email`, // Invalid email
    }

    try {
      const tx2 = createTransaction({ mutationFn })
      tx2.mutate(() => collection.insert(invalidUser))
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`insert`)
        expect(error.issues.length).toBeGreaterThan(0)
        // Check that we have validation errors for each invalid field
        expect(error.issues.some((issue) => issue.path?.includes(`name`))).toBe(
          true
        )
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
        expect(
          error.issues.some((issue) => issue.path?.includes(`email`))
        ).toBe(true)
      }
    }

    // Partial updates should work with valid data
    const tx3 = createTransaction({ mutationFn })
    tx3.mutate(() =>
      collection.update(`Alice`, (draft) => {
        draft.age = 31
      })
    )

    // Partial updates should fail with invalid data
    try {
      const tx4 = createTransaction({ mutationFn })
      tx4.mutate(() =>
        collection.update(`Alice`, (draft) => {
          draft.age = -1
        })
      )
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`update`)
        expect(error.issues.length).toBeGreaterThan(0)
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
      }
    }
  })

  it(`should apply schema defaults on insert`, () => {
    const todoSchema = z.object({
      id: z
        .string()
        .default(() => `todo-${Math.random().toString(36).substr(2, 9)}`),
      text: z.string(),
      completed: z.boolean().default(false),
      createdAt: z.coerce.date().default(() => new Date()),
      updatedAt: z.coerce.date().default(() => new Date()),
    })

    // Define inferred types for clarity and use in assertions
    type Todo = z.infer<typeof todoSchema>
    type TodoInput = z.input<typeof todoSchema>

    // NOTE: `createCollection<Todo>` breaks the schema type inference.
    // We have to use only the schema, and not the type generic, like so:
    const collection = createCollection({
      id: `defaults-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: todoSchema,
    })

    // Type test: should allow inserting input type (with missing fields that have defaults)
    // Important: Input type is different from the output type (which is inferred using z.infer)
    // For more details, @see https://github.com/colinhacks/zod/issues/4179#issuecomment-2811669261
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<InsertParam>().toEqualTypeOf<TodoInput | Array<TodoInput>>()

    const mutationFn = async () => {}

    // Minimal data
    const tx1 = createTransaction<Todo>({ mutationFn })
    tx1.mutate(() => collection.insert({ text: `task-1` }))

    // Type assertions on the mutation structure
    expect(tx1.mutations).toHaveLength(1)
    const mutation = tx1.mutations[0]!

    // Test the mutation type structure
    expectTypeOf(mutation).toExtend<PendingMutation<Todo>>()
    expectTypeOf(mutation.type).toEqualTypeOf<OperationType>()
    expectTypeOf(mutation.changes).toEqualTypeOf<
      ResolveTransactionChanges<Todo>
    >()
    expectTypeOf(mutation.modified).toEqualTypeOf<Todo>()

    // Runtime assertions for actual values
    expect(mutation.type).toBe(`insert`)
    expect(mutation.changes).toEqual({ text: `task-1` })
    expect(mutation.modified.text).toBe(`task-1`)
    expect(mutation.modified.completed).toBe(false)
    expect(mutation.modified.id).toBeDefined()
    expect(mutation.modified.createdAt).toBeInstanceOf(Date)
    expect(mutation.modified.updatedAt).toBeInstanceOf(Date)

    let insertedItems = Array.from(collection.state.values())
    expect(insertedItems).toHaveLength(1)
    const insertedItem = insertedItems[0]!
    expect(insertedItem.text).toBe(`task-1`)
    expect(insertedItem.completed).toBe(false)
    expect(insertedItem.id).toBeDefined()
    expect(typeof insertedItem.id).toBe(`string`)
    expect(insertedItem.createdAt).toBeInstanceOf(Date)
    expect(insertedItem.updatedAt).toBeInstanceOf(Date)

    // Partial data
    const tx2 = createTransaction<Todo>({ mutationFn })
    tx2.mutate(() => collection.insert({ text: `task-2`, completed: true }))

    insertedItems = Array.from(collection.state.values())
    expect(insertedItems).toHaveLength(2)

    const secondItem = insertedItems.find((item) => item.text === `task-2`)!
    expect(secondItem).toBeDefined()
    expect(secondItem.text).toBe(`task-2`)
    expect(secondItem.completed).toBe(true)
    expect(secondItem.id).toBeDefined()
    expect(typeof secondItem.id).toBe(`string`)
    expect(secondItem.createdAt).toBeInstanceOf(Date)
    expect(secondItem.updatedAt).toBeInstanceOf(Date)

    // All fields provided
    const tx3 = createTransaction<Todo>({ mutationFn })

    tx3.mutate(() =>
      collection.insert({
        id: `task-id-3`,
        text: `task-3`,
        completed: true,
        createdAt: new Date(`2023-01-01T00:00:00Z`),
        updatedAt: new Date(`2023-01-01T00:00:00Z`),
      })
    )
    insertedItems = Array.from(collection.state.values())
    expect(insertedItems).toHaveLength(3)

    // using insertedItems[2] was finding wrong item for some reason.
    const thirdItem = insertedItems.find((item) => item.text === `task-3`)
    expect(thirdItem).toBeDefined()
    expect(thirdItem!.text).toBe(`task-3`)
    expect(thirdItem!.completed).toBe(true)
    expect(thirdItem!.createdAt).toEqual(new Date(`2023-01-01T00:00:00Z`))
    expect(thirdItem!.updatedAt).toEqual(new Date(`2023-01-01T00:00:00Z`))
    expect(thirdItem!.id).toBe(`task-id-3`)
  })

  it(`should not block user actions when keys are recently synced`, async () => {
    // This test reproduces the ACTUAL issue where rapid user actions get blocked
    // when optimistic updates back up with slow sync responses
    const txResolvers: Array<() => void> = []
    const emitter = mitt()
    const changeEvents: Array<any> = []

    const mutationFn = vi.fn().mockImplementation(async ({ transaction }) => {
      // Simulate SLOW server operation - this is key to reproducing the issue
      return new Promise((resolve) => {
        txResolvers.push(() => {
          emitter.emit(`sync`, transaction.mutations)
          resolve(null)
        })
      })
    })

    const collection = createCollection<{ id: number; checked: boolean }>({
      id: `user-action-blocking-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Initialize with checkboxes
          begin()
          for (let i = 1; i <= 3; i++) {
            write({
              type: `insert`,
              value: { id: i, checked: false },
            })
          }
          commit()
          markReady()

          // Listen for sync events - this triggers the problematic batching
          // @ts-expect-error don't trust mitt's typing
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
      onUpdate: mutationFn,
    })

    // Listen to change events to verify they're emitted (this was the actual problem)
    collection.subscribeChanges((changes) => {
      changeEvents.push(...changes)
    })

    await collection.stateWhenReady()

    // CRITICAL: Simulate rapid clicking WITHOUT waiting for transactions to complete
    // This is what actually triggers the bug - multiple pending transactions

    // Step 1: First click
    const tx1 = collection.update(1, (draft) => {
      draft.checked = true
    })
    expect(collection.state.get(1)?.checked).toBe(true)
    const initialEventCount = changeEvents.length

    // Step 2: Second click immediately (before first completes)
    const tx2 = collection.update(1, (draft) => {
      draft.checked = false
    })
    expect(collection.state.get(1)?.checked).toBe(false)

    // Step 3: Third click immediately (before others complete)
    const tx3 = collection.update(1, (draft) => {
      draft.checked = true
    })
    expect(collection.state.get(1)?.checked).toBe(true)

    // CRITICAL TEST: Verify events are still being emitted for rapid user actions
    // Before the fix, these would be batched and UI would freeze
    expect(changeEvents.length).toBeGreaterThan(initialEventCount)
    expect(mutationFn).toHaveBeenCalledTimes(3)

    // Now complete the first transaction to trigger sync and batching
    txResolvers[0]?.()
    await tx1.isPersisted.promise

    // Step 4: More rapid clicks after sync starts (this is where the bug occurred)
    const eventCountBeforeRapidClicks = changeEvents.length

    const tx4 = collection.update(1, (draft) => {
      draft.checked = false
    })
    const tx5 = collection.update(1, (draft) => {
      draft.checked = true
    })

    // CRITICAL: Verify that even after sync/batching starts, user actions still emit events
    expect(changeEvents.length).toBeGreaterThan(eventCountBeforeRapidClicks)
    expect(collection.state.get(1)?.checked).toBe(true) // Last action should win

    // Clean up remaining transactions
    for (let i = 1; i < txResolvers.length; i++) {
      txResolvers[i]?.()
    }
    await Promise.all([
      tx2.isPersisted.promise,
      tx3.isPersisted.promise,
      tx4.isPersisted.promise,
      tx5.isPersisted.promise,
    ])
  })
})
