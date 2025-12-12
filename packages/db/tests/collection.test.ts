import mitt from 'mitt'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import {
  CollectionRequiresConfigError,
  DuplicateKeyError,
  InvalidKeyError,
  KeyUpdateNotAllowedError,
  MissingDeleteHandlerError,
  MissingInsertHandlerError,
  MissingUpdateHandlerError,
} from '../src/errors'
import { createTransaction } from '../src/transactions'
import {
  flushPromises,
  mockSyncCollectionOptionsNoInitialState,
  withExpectedRejection,
} from './utils'
import type { ChangeMessage, MutationFn, PendingMutation } from '../src/types'

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
      new Map([[insertedKey, { id: 1, value: `bar` }]]),
    )

    // check there's a transaction in peristing state
    expect(
      // @ts-expect-error possibly undefined is ok in test
      tx.mutations[0].changes,
    ).toEqual({
      id: 1,
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertKey = 1
    expect(collection._state.optimisticUpserts.has(insertKey)).toBe(true)
    expect(collection._state.optimisticUpserts.get(insertKey)).toEqual({
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
    expect(collection._state.transactions.size).toEqual(0) // Transaction should be cleaned up
    expect(collection.state).toEqual(
      new Map([[insertedKey, { id: 1, value: `bar` }]]),
    )
    expect(collection._state.optimisticUpserts.size).toEqual(0)

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
      }),
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
        },
      ),
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
        },
      )
      collection.update(
        insertedKey,
        { metadata: { updated: true } },
        (item) => {
          item.value = `bar3`
          item.newProp = `new value`
        },
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
        },
      ),
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
      }),
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
      }),
    )

    // The merged value should immediately contain the new insert
    expect(collection.state).toEqual(new Map([[1, { id: 1, value: `bar` }]]))

    // check there's a transaction in peristing state
    expect(
      // @ts-expect-error possibly undefined is ok in test
      Array.from(collection._state.transactions.values())[0].mutations[0]
        .changes,
    ).toEqual({
      id: 1,
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertKey = 1
    expect(collection._state.optimisticUpserts.has(insertKey)).toBe(true)
    expect(collection._state.optimisticUpserts.get(insertKey)).toEqual({
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
      tx2.mutate(() => collection.delete(`non-existent-id`)),
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

  it(`should not allow bulk inserting documents with duplicate IDs in the same batch`, async () => {
    const collection = createCollection<{ id: number; value: string }>({
      id: `bulk-duplicate-id-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()

    const mutationFn = async () => {}
    const tx = createTransaction({ mutationFn })

    // Try to bulk insert documents with duplicate IDs within the same batch
    expect(() => {
      tx.mutate(() =>
        collection.insert([
          { id: 1, value: `first` },
          { id: 1, value: `second` }, // Same ID - should throw
        ]),
      )
    }).toThrow(DuplicateKeyError)

    // Should be able to bulk insert documents with different IDs
    const tx2 = createTransaction({ mutationFn })
    expect(() => {
      tx2.mutate(() =>
        collection.insert([
          { id: 2, value: `first` },
          { id: 3, value: `second` },
        ]),
      )
    }).not.toThrow()

    // Verify both items were inserted
    expect(collection.state.get(2)).toEqual({ id: 2, value: `first` })
    expect(collection.state.get(3)).toEqual({ id: 3, value: `second` })
  })

  it(`should throw InvalidKeyError when getKey returns null`, async () => {
    const collection = createCollection<{ id: null; value: string }>({
      id: `null-key-test`,
      // @ts-expect-error - testing runtime behavior when getKey returns null
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()

    const mutationFn = async () => {}
    const tx = createTransaction({ mutationFn })

    expect(() => {
      tx.mutate(() => collection.insert({ id: null, value: `test` }))
    }).toThrow(InvalidKeyError)
  })

  it(`should throw InvalidKeyError when getKey returns an object`, async () => {
    const collection = createCollection<{
      id: { nested: string }
      value: string
    }>({
      id: `object-key-test`,
      // @ts-expect-error - testing runtime behavior when getKey returns an object
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()

    const mutationFn = async () => {}
    const tx = createTransaction({ mutationFn })

    expect(() => {
      tx.mutate(() =>
        collection.insert({ id: { nested: `value` }, value: `test` }),
      )
    }).toThrow(InvalidKeyError)
  })

  it(`should throw InvalidKeyError when getKey returns a boolean`, async () => {
    const collection = createCollection<{ id: boolean; value: string }>({
      id: `boolean-key-test`,
      // @ts-expect-error - testing runtime behavior when getKey returns a boolean
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()

    const mutationFn = async () => {}
    const tx = createTransaction({ mutationFn })

    expect(() => {
      tx.mutate(() => collection.insert({ id: true, value: `test` }))
    }).toThrow(InvalidKeyError)
  })

  it(`should accept valid string and number keys`, async () => {
    const stringKeyCollection = createCollection<{ id: string; value: string }>(
      {
        id: `string-key-test`,
        getKey: (item) => item.id,
        startSync: true,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            begin()
            commit()
            markReady()
          },
        },
      },
    )

    const numberKeyCollection = createCollection<{ id: number; value: string }>(
      {
        id: `number-key-test`,
        getKey: (item) => item.id,
        startSync: true,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            begin()
            commit()
            markReady()
          },
        },
      },
    )

    await Promise.all([
      stringKeyCollection.stateWhenReady(),
      numberKeyCollection.stateWhenReady(),
    ])

    const mutationFn = async () => {}

    // String key should work
    const tx1 = createTransaction({ mutationFn })
    expect(() => {
      tx1.mutate(() =>
        stringKeyCollection.insert({ id: `string-id`, value: `test` }),
      )
    }).not.toThrow()

    // Number key should work
    const tx2 = createTransaction({ mutationFn })
    expect(() => {
      tx2.mutate(() => numberKeyCollection.insert({ id: 123, value: `test` }))
    }).not.toThrow()

    // Empty string key should work
    const tx3 = createTransaction({ mutationFn })
    expect(() => {
      tx3.mutate(() => stringKeyCollection.insert({ id: ``, value: `empty` }))
    }).not.toThrow()

    // Zero key should work
    const tx4 = createTransaction({ mutationFn })
    expect(() => {
      tx4.mutate(() => numberKeyCollection.insert({ id: 0, value: `zero` }))
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
      }),
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
      { optimistic: false },
    )

    // Debug: Check the mutation was created with optimistic: false
    expect(nonOptimisticInsertTx.mutations[0]?.optimistic).toBe(false)

    // The item should NOT appear in the collection state immediately
    expect(collection.state.has(2)).toBe(false)
    expect(collection._state.optimisticUpserts.has(2)).toBe(false)
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
      },
    )

    // The original value should still be there immediately
    expect(collection.state.get(1)?.value).toBe(`initial value`)
    expect(collection._state.optimisticUpserts.has(1)).toBe(false)

    // Now resolve the update mutation and wait for completion
    pendingMutations[1]?.()
    await nonOptimisticUpdateTx.isPersisted.promise

    // Now the update should be reflected
    expect(collection.state.get(1)?.value).toBe(`non-optimistic update`)

    // Test non-optimistic delete
    const nonOptimisticDeleteTx = collection.delete(2, { optimistic: false })

    // The item should still be there immediately
    expect(collection.state.has(2)).toBe(true)
    expect(collection._state.optimisticDeletes.has(2)).toBe(false)

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
    expect(collection._state.optimisticUpserts.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({
      id: 2,
      value: `default optimistic`,
    })

    await defaultOptimisticTx.isPersisted.promise

    // Test explicit optimistic: true
    const explicitOptimisticTx = collection.insert(
      { id: 3, value: `explicit optimistic` },
      { optimistic: true },
    )

    // The item should appear immediately
    expect(collection.state.has(3)).toBe(true)
    expect(collection._state.optimisticUpserts.has(3)).toBe(true)
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
      },
    )

    // The update should be reflected immediately
    expect(collection.state.get(1)?.value).toBe(`optimistic update`)
    expect(collection._state.optimisticUpserts.has(1)).toBe(true)

    await optimisticUpdateTx.isPersisted.promise

    // Test optimistic delete
    const optimisticDeleteTx = collection.delete(3, { optimistic: true })

    // The item should be gone immediately
    expect(collection.state.has(3)).toBe(false)
    expect(collection._state.optimisticDeletes.has(3)).toBe(true)

    await optimisticDeleteTx.isPersisted.promise
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

  it(`should handle basic truncate operations`, async () => {
    let testSyncFunctions: any = null

    const collection = createCollection<{ id: number; value: string }>({
      id: `truncate-basic-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, truncate, markReady }) => {
          // Initialize with some data
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value 1` },
          })
          write({
            type: `insert`,
            value: { id: 2, value: `initial value 2` },
          })
          commit()
          markReady()

          // Store the sync functions for testing
          testSyncFunctions = { begin, write, commit, truncate }
        },
      },
    })

    await collection.stateWhenReady()

    // Verify initial state
    expect(collection.state.size).toBe(2)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `initial value 1` })
    expect(collection.state.get(2)).toEqual({ id: 2, value: `initial value 2` })

    // Test truncate operation
    const { begin, truncate, commit } = testSyncFunctions
    begin()
    truncate()
    commit()

    // Verify collection is cleared
    expect(collection.state.size).toBe(0)
    expect(collection._state.syncedData.size).toBe(0)
    expect(collection._state.syncedMetadata.size).toBe(0)
  })

  it(`should keep operations written after truncate in the same transaction`, async () => {
    let testSyncFunctions: any = null

    const collection = createCollection<{ id: number; value: string }>({
      id: `truncate-operations-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, truncate, markReady }) => {
          // Initialize with some data
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: `initial value` },
          })
          commit()
          markReady()

          // Store the sync functions for testing
          testSyncFunctions = { begin, write, commit, truncate }
        },
      },
    })

    await collection.stateWhenReady()

    // Verify initial state
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `initial value` })

    // Test truncate operation with additional operations in the same transaction
    const { begin, write, truncate, commit } = testSyncFunctions

    begin()

    // Add some operations to the transaction
    write({
      type: `insert`,
      value: { id: 2, value: `should be cleared` },
    })
    write({
      type: `update`,
      value: { id: 1, value: `should be cleared` },
    })

    // Call truncate - this should clear the operations and mark as truncate
    truncate()

    // Add more operations after truncate (these should not be cleared)
    write({
      type: `insert`,
      value: { id: 3, value: `should not be cleared` },
    })

    commit()

    // Verify only post-truncate operations are kept
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(3)).toEqual({
      id: 3,
      value: `should not be cleared`,
    })
    expect(collection._state.syncedData.size).toBe(1)
    expect(collection._state.syncedMetadata.size).toBe(1)
  })

  it(`should handle truncate with empty collection`, async () => {
    let testSyncFunctions: any = null

    const collection = createCollection<{ id: number; value: string }>({
      id: `truncate-empty-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, truncate, markReady }) => {
          // Initialize with empty collection
          begin()
          commit()
          markReady()

          // Store the sync functions for testing
          testSyncFunctions = { begin, commit, truncate }
        },
      },
    })

    await collection.stateWhenReady()

    // Verify initial state is empty
    expect(collection.state.size).toBe(0)

    // Test truncate operation on empty collection
    const { begin, truncate, commit } = testSyncFunctions
    begin()
    truncate()
    commit()

    // Verify collection remains empty
    expect(collection.state.size).toBe(0)
    expect(collection._state.syncedData.size).toBe(0)
    expect(collection._state.syncedMetadata.size).toBe(0)
  })

  it(`open sync transaction isn't applied when optimistic mutation is resolved/rejected`, async () => {
    type Row = { id: number; name: string }

    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<Row>({
        id: `repro-truncate-open-transaction`,
        getKey: (r) => r.id,
      }),
    )
    const preloadPromise = collection.preload()

    collection.utils.begin()
    collection.utils.write({ type: `insert`, value: { id: 1, name: `one` } })
    collection.utils.write({ type: `insert`, value: { id: 2, name: `two` } })
    collection.utils.commit()
    collection.utils.markReady()

    await preloadPromise

    expect(collection.state.size).toBe(2)

    // start a transaction with a truncate, but don't commit it
    collection.utils.begin()
    collection.utils.truncate()

    // expect the state to still be the same
    expect(collection.state.size).toBe(2)

    // we now do a local optimistic insert
    collection.insert({ id: 3, name: `three` })

    // we should immediately see the optimistic state
    expect(collection.state.size).toBe(3)
    expect(collection.state.get(3)?.name).toBe(`three`)

    // we now reject the sync, this should trigger a rollback of the open transaction
    // and the optimistic state should be removed
    // it should *not* trigger the open sync transaction to be applied to the synced state
    await withExpectedRejection(`trigger rollback`, () => {
      collection.utils.rejectSync(new Error(`trigger rollback`))
      return flushPromises()
    })

    // we should now be back to the original state, the optimistic state has
    // been removed
    expect(collection.state.size).toBe(2)

    // write the new row back via sync
    collection.utils.write({
      type: `insert`,
      value: { id: 3, name: `tree (from sync)` },
    })

    // expect the state to still be the same
    expect(collection.state.size).toBe(2)

    // now commit the sync transaction
    collection.utils.commit()

    // we truncated everything, so we should only have one item left that synced
    expect(collection.state.size).toBe(1)
  })

  it(`should allow multiple sync transactions before marking collection ready and data should be visible`, async () => {
    let testSyncFunctions: any = null

    const collection = createCollection<{ id: number; value: string }>({
      id: `multiple-sync-before-ready`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Store the sync functions for testing
          testSyncFunctions = { begin, write, commit, markReady }
        },
      },
    })

    // Collection should start in loading state
    expect(collection.status).toBe(`loading`)
    expect(collection.size).toBe(0)

    const { begin, write, commit, markReady } = testSyncFunctions

    // First sync transaction
    begin()
    write({ type: `insert`, value: { id: 1, value: `first batch item 1` } })
    write({ type: `insert`, value: { id: 2, value: `first batch item 2` } })
    commit()

    // Data should be visible even though not ready
    expect(collection.status).toBe(`loading`)
    expect(collection.size).toBe(2)
    expect(collection.state.get(1)).toEqual({
      id: 1,
      value: `first batch item 1`,
    })
    expect(collection.state.get(2)).toEqual({
      id: 2,
      value: `first batch item 2`,
    })

    // Second sync transaction
    begin()
    write({ type: `insert`, value: { id: 3, value: `second batch item 1` } })
    write({
      type: `update`,
      value: { id: 1, value: `first batch item 1 updated` },
    })
    commit()

    // More data should be visible
    expect(collection.status).toBe(`loading`)
    expect(collection.size).toBe(3)
    expect(collection.state.get(1)).toEqual({
      id: 1,
      value: `first batch item 1 updated`,
    })
    expect(collection.state.get(3)).toEqual({
      id: 3,
      value: `second batch item 1`,
    })

    // Third sync transaction
    begin()
    write({ type: `delete`, value: { id: 2, value: `first batch item 2` } })
    write({ type: `insert`, value: { id: 4, value: `third batch item 1` } })
    commit()

    // Updates should be reflected
    expect(collection.status).toBe(`loading`)
    expect(collection.size).toBe(3) // Deleted 2, added 4
    expect(collection.state.get(2)).toBeUndefined()
    expect(collection.state.get(4)).toEqual({
      id: 4,
      value: `third batch item 1`,
    })

    // Now mark as ready
    markReady()

    // Should transition to ready with all data intact
    expect(collection.status).toBe(`ready`)
    expect(collection.size).toBe(3)
    expect(Array.from(collection.state.keys()).sort()).toEqual([1, 3, 4])

    // Verify we can use stateWhenReady
    const state = await collection.stateWhenReady()
    expect(state.size).toBe(3)
  })

  it(`should allow deleting a row by passing only the key to write function`, async () => {
    let testSyncFunctions: any = null

    const collection = createCollection<{ id: number; value: string }>({
      id: `delete-by-key`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Store the sync functions for testing
          testSyncFunctions = { begin, write, commit, markReady }
        },
      },
    })

    // Collection should start in loading state
    expect(collection.status).toBe(`loading`)
    expect(collection.size).toBe(0)

    const { begin, write, commit, markReady } = testSyncFunctions

    // Insert some initial data
    begin()
    write({ type: `insert`, value: { id: 1, value: `item 1` } })
    write({ type: `insert`, value: { id: 2, value: `item 2` } })
    write({ type: `insert`, value: { id: 3, value: `item 3` } })
    commit()

    // Verify data was inserted
    expect(collection.size).toBe(3)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `item 1` })
    expect(collection.state.get(2)).toEqual({ id: 2, value: `item 2` })
    expect(collection.state.get(3)).toEqual({ id: 3, value: `item 3` })

    // Delete a row by passing only the key (no value)
    begin()
    write({ type: `delete`, key: 2 })
    commit()

    // Verify the row is gone
    expect(collection.size).toBe(2)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `item 1` })
    expect(collection.state.get(2)).toBeUndefined()
    expect(collection.state.get(3)).toEqual({ id: 3, value: `item 3` })

    // Delete another row by key only
    begin()
    write({ type: `delete`, key: 1 })
    commit()

    // Verify both rows are gone
    expect(collection.size).toBe(1)
    expect(collection.state.get(1)).toBeUndefined()
    expect(collection.state.get(2)).toBeUndefined()
    expect(collection.state.get(3)).toEqual({ id: 3, value: `item 3` })

    // Mark as ready
    markReady()

    // Verify final state
    expect(collection.status).toBe(`ready`)
    expect(collection.size).toBe(1)
    expect(Array.from(collection.state.keys())).toEqual([3])
  })

  it(`should allow deleting a row by key with string keys`, async () => {
    let testSyncFunctions: any = null

    const collection = createCollection<{ id: string; name: string }>({
      id: `delete-by-string-key`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Store the sync functions for testing
          testSyncFunctions = { begin, write, commit, markReady }
        },
      },
    })

    const { begin, write, commit, markReady } = testSyncFunctions

    // Insert initial data
    begin()
    write({ type: `insert`, value: { id: `a`, name: `Alice` } })
    write({ type: `insert`, value: { id: `b`, name: `Bob` } })
    write({ type: `insert`, value: { id: `c`, name: `Charlie` } })
    commit()

    // Verify data was inserted
    expect(collection.size).toBe(3)
    expect(collection.state.get(`a`)).toEqual({ id: `a`, name: `Alice` })
    expect(collection.state.get(`b`)).toEqual({ id: `b`, name: `Bob` })
    expect(collection.state.get(`c`)).toEqual({ id: `c`, name: `Charlie` })

    // Delete by key only
    begin()
    write({ type: `delete`, key: `b` })
    commit()

    // Verify the row is gone
    expect(collection.size).toBe(2)
    expect(collection.state.get(`a`)).toEqual({ id: `a`, name: `Alice` })
    expect(collection.state.get(`b`)).toBeUndefined()
    expect(collection.state.get(`c`)).toEqual({ id: `c`, name: `Charlie` })

    markReady()
    expect(collection.status).toBe(`ready`)
  })
})

describe(`Collection isLoadingSubset property`, () => {
  it(`isLoadingSubset is false initially`, () => {
    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
    })

    expect(collection.isLoadingSubset).toBe(false)
  })

  it(`isLoadingSubset becomes true when loadSubset returns a promise`, async () => {
    let resolveLoadSubset: () => void
    const loadSubsetPromise = new Promise<void>((resolve) => {
      resolveLoadSubset = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => loadSubsetPromise,
          }
        },
      },
    })

    expect(collection.isLoadingSubset).toBe(false)

    collection._sync.loadSubset({})
    expect(collection.isLoadingSubset).toBe(true)

    resolveLoadSubset!()
    await flushPromises()

    expect(collection.isLoadingSubset).toBe(false)
  })

  it(`isLoadingSubset becomes false when promise resolves`, async () => {
    let resolveLoadSubset: () => void
    const loadSubsetPromise = new Promise<void>((resolve) => {
      resolveLoadSubset = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => loadSubsetPromise,
          }
        },
      },
    })

    collection._sync.loadSubset({})
    expect(collection.isLoadingSubset).toBe(true)

    resolveLoadSubset!()
    await flushPromises()

    expect(collection.isLoadingSubset).toBe(false)
  })

  it(`concurrent loadSubset calls keep isLoadingSubset true until all resolve`, async () => {
    let resolveLoadSubset1: () => void
    let resolveLoadSubset2: () => void
    let callCount = 0

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              callCount++
              if (callCount === 1) {
                return new Promise<void>((resolve) => {
                  resolveLoadSubset1 = resolve
                })
              } else {
                return new Promise<void>((resolve) => {
                  resolveLoadSubset2 = resolve
                })
              }
            },
          }
        },
      },
    })

    collection._sync.loadSubset({})
    collection._sync.loadSubset({})

    expect(collection.isLoadingSubset).toBe(true)

    resolveLoadSubset1!()
    await flushPromises()

    // Should still be loading because second promise is pending
    expect(collection.isLoadingSubset).toBe(true)

    resolveLoadSubset2!()
    await flushPromises()

    // Now should be false
    expect(collection.isLoadingSubset).toBe(false)
  })

  it(`emits loadingSubset:change event`, async () => {
    let resolveLoadSubset: () => void
    const loadSubsetPromise = new Promise<void>((resolve) => {
      resolveLoadSubset = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => loadSubsetPromise,
          }
        },
      },
    })

    const loadingChanges: Array<{
      isLoadingSubset: boolean
      previousIsLoadingSubset: boolean
    }> = []

    collection.on(`loadingSubset:change`, (event) => {
      loadingChanges.push({
        isLoadingSubset: event.isLoadingSubset,
        previousIsLoadingSubset: event.previousIsLoadingSubset,
      })
    })

    collection._sync.loadSubset({})
    await flushPromises()

    expect(loadingChanges).toHaveLength(1)
    expect(loadingChanges[0]).toEqual({
      isLoadingSubset: true,
      previousIsLoadingSubset: false,
    })

    resolveLoadSubset!()
    await flushPromises()

    expect(loadingChanges).toHaveLength(2)
    expect(loadingChanges[1]).toEqual({
      isLoadingSubset: false,
      previousIsLoadingSubset: true,
    })
  })

  it(`rejected promises still clean up`, async () => {
    let rejectLoadSubset: (error: Error) => void
    const loadSubsetPromise = new Promise<void>((_, reject) => {
      rejectLoadSubset = reject
    })
    // Attach catch handler before rejecting to avoid unhandled rejection
    const handledPromise = loadSubsetPromise.catch(() => {})

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => handledPromise,
          }
        },
      },
    })

    collection._sync.loadSubset({})
    expect(collection.isLoadingSubset).toBe(true)

    // Reject the promise
    rejectLoadSubset!(new Error(`Load failed`))
    await flushPromises()

    expect(collection.isLoadingSubset).toBe(false)
  })

  it(`isLoadingSubset stays false when loadSubset returns true (no work to do)`, () => {
    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => true, // No work to do
          }
        },
      },
    })

    expect(collection.isLoadingSubset).toBe(false)

    // Call loadSubset - it should return true and not track any promise
    const result = collection._sync.loadSubset({})
    expect(result).toBe(true)
    expect(collection.isLoadingSubset).toBe(false)
  })
})
