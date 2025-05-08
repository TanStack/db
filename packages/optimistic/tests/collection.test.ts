import { describe, expect, it, vi } from "vitest"
import mitt from "mitt"
import { z } from "zod"
import { Collection, SchemaValidationError } from "../src/collection"
import { createTransaction } from "../src/transactions"
import type {
  ChangeMessage,
  MutationFn,
  OptimisticChangeMessage,
  PendingMutation,
} from "../src/types"

describe(`Collection`, () => {
  it(`should throw if there's no sync config`, () => {
    expect(() => new Collection()).toThrow(`Collection requires a sync config`)
  })

  it(`should throw an error when trying to use mutation operations outside of a transaction`, async () => {
    // Create a collection with sync but no mutationFn
    const collection = new Collection<{ value: string }>({
      id: `foo`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Immediately execute the sync cycle
          begin()
          write({
            type: `insert`,
            key: `initial`,
            value: { value: `initial value` },
          })
          commit()
        },
      },
    })

    // Wait for the collection to be ready
    await collection.stateWhenReady()

    // Verify initial state
    expect(collection.state.get(`initial`)).toEqual({ value: `initial value` })

    // Verify that insert throws an error
    expect(() => {
      collection.insert({ value: `new value` }, { key: `new-key` })
    }).toThrow(`no transaction found when calling collection.insert`)

    // Verify that update throws an error
    expect(() => {
      collection.update(collection.state.get(`initial`)!, (draft) => {
        draft.value = `updated value`
      })
    }).toThrow(`no transaction found when calling collection.update`)

    // Verify that delete throws an error
    expect(() => {
      collection.delete(`initial`)
    }).toThrow(`no transaction found when calling collection.delete`)
  })

  it(`It shouldn't expose any state until the initial sync is finished`, () => {
    // Create a collection with a mock sync plugin
    new Collection<{ name: string }>({
      id: `foo`,
      sync: {
        sync: ({ collection, begin, write, commit }) => {
          // Initial state should be empty
          expect(collection.state).toEqual(new Map())

          // Start a batch of operations
          begin()

          // Write some test data
          const operations: Array<ChangeMessage<{ name: string }>> = [
            { key: `user1`, value: { name: `Alice` }, type: `insert` },
            { key: `user2`, value: { name: `Bob` }, type: `insert` },
          ]

          for (const op of operations) {
            write(op)
            // Data should still be empty during writes
            expect(collection.state).toEqual(new Map())
          }

          // Commit the changes
          commit()

          // Now the data should be visible
          const expectedData = new Map([
            [`user1`, { name: `Alice` }],
            [`user2`, { name: `Bob` }],
          ])
          expect(collection.state).toEqual(expectedData)
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
    const collection = new Collection<{ value: string; newProp?: string }>({
      id: `mock`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // @ts-expect-error don't trust mitt's typing
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
    const data = { value: `bar` }
    // TODO create transaction manually with the above mutationFn & get assertions passing.
    const tx = createTransaction({ mutationFn })
    tx.mutate(() => collection.insert(data))

    // @ts-expect-error possibly undefined is ok in test
    const insertedKey = tx.mutations[0].key

    // The merged value should immediately contain the new insert
    expect(collection.state).toEqual(new Map([[insertedKey, { value: `bar` }]]))

    // check there's a transaction in peristing state
    expect(
      // @ts-expect-error possibly undefined is ok in test
      tx.mutations[0].changes
    ).toEqual({
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertOperation: OptimisticChangeMessage = {
      key: insertedKey,
      value: { value: `bar` },
      type: `insert`,
      isActive: true,
    }
    expect(collection.optimisticOperations.state[0]).toEqual(insertOperation)

    // Check persist data (moved outside the persist callback)
    // @ts-expect-error possibly undefined is ok in test
    const persistData = persistMock.mock.calls[0][0]
    // Check that the transaction is in the right state during persist
    expect(persistData.transaction.state).toBe(`persisting`)
    // Check mutation type is correct
    expect(persistData.transaction.mutations[0].type).toBe(`insert`)
    // Check changes are correct
    expect(persistData.transaction.mutations[0].changes).toEqual({
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
    expect(syncData.transaction.mutations[0].changes).toEqual({ value: `bar` })

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(
      // @ts-expect-error possibly undefined is ok in test
      Array.from(collection.transactions.state.values())[0].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.state).toEqual(new Map([[insertedKey, { value: `bar` }]]))
    expect(
      collection.optimisticOperations.state.filter((o) => o.isActive)
    ).toEqual([])

    // Test insert with provided key
    const tx2 = createTransaction({ mutationFn })
    tx2.mutate(() => collection.insert({ value: `baz` }, { key: `custom-key` }))
    expect(collection.state.get(`custom-key`)).toEqual({ value: `baz` })
    await tx2.isPersisted.promise

    // Test bulk insert
    const tx3 = createTransaction({ mutationFn })
    const bulkData = [{ value: `item1` }, { value: `item2` }]
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
      collection.update([collection.state.get(insertedKey)!], (item) => {
        // @ts-expect-error possibly undefined is ok in test
        item[0].value = `bar2`
      })
    )

    // The merged value should contain the update.
    expect(collection.state.get(insertedKey)).toEqual({ value: `bar2` })
    await tx4.isPersisted.promise

    const tx5 = createTransaction({ mutationFn })
    // Test update with config and callback
    tx5.mutate(() =>
      collection.update(
        collection.state.get(insertedKey)!,
        { metadata: { updated: true } },
        (item) => {
          item.value = `bar3`
          item.newProp = `new value`
        }
      )
    )

    // The merged value should contain the update
    expect(collection.state.get(insertedKey)).toEqual({
      value: `bar3`,
      newProp: `new value`,
    })

    await tx5.isPersisted.promise

    // If there are two updates, the second should overwrite the first.
    const tx55 = createTransaction({ mutationFn })
    // Test update with config and callback
    tx55.mutate(() => {
      collection.update(
        collection.state.get(insertedKey)!,
        { metadata: { updated: true } },
        (item) => {
          item.value = `bar3.1`
          item.newProp = `new value.1`
        }
      )
      collection.update(
        collection.state.get(insertedKey)!,
        { metadata: { updated: true } },
        (item) => {
          item.value = `bar3`
          item.newProp = `new value`
        }
      )
    })

    // The merged value should contain the update
    expect(collection.state.get(insertedKey)).toEqual({
      value: `bar3`,
      newProp: `new value`,
    })
    expect(tx55.mutations).toHaveLength(1)

    await tx55.isPersisted.promise

    const tx6 = createTransaction({ mutationFn })
    // Test bulk update
    const items = [
      // @ts-expect-error possibly undefined is ok in test
      collection.state.get(keys[2])!,
      // @ts-expect-error possibly undefined is ok in test
      collection.state.get(keys[3])!,
    ]
    tx6.mutate(() =>
      collection.update(items, { metadata: { bulkUpdate: true } }, (drafts) => {
        drafts.forEach((draft) => {
          draft.value += `-updated`
        })
      })
    )

    // Check bulk updates
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[2])).toEqual({ value: `item1-updated` })
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[3])).toEqual({ value: `item2-updated` })
    await tx6.isPersisted.promise

    const tx7 = createTransaction({ mutationFn })
    const toBeDeleted = collection.state.get(insertedKey)!
    // Test delete single item
    tx7.mutate(() => collection.delete(toBeDeleted))
    expect(collection.state.has(insertedKey)).toBe(false)
    expect(collection.objectKeyMap.has(toBeDeleted)).toBe(false)
    await tx7.isPersisted.promise

    // Test delete with metadata
    const tx8 = createTransaction({ mutationFn })
    tx8.mutate(() =>
      collection.delete(collection.state.get(`custom-key`)!, {
        metadata: { reason: `test` },
      })
    )
    expect(collection.state.has(`custom-key`)).toBe(false)
    await tx8.isPersisted.promise

    // Test bulk delete
    const tx9 = createTransaction({ mutationFn })
    tx9.mutate(() =>
      collection.delete([
        // @ts-expect-error possibly undefined is ok in test
        collection.state.get(keys[2])!,
        // @ts-expect-error possibly undefined is ok in test
        collection.state.get(keys[3])!,
      ])
    )
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.has(keys[2])).toBe(false)
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.has(keys[3])).toBe(false)
    await tx9.isPersisted.promise
  })

  it(`synced updates should be applied while there's an ongoing transaction`, async () => {
    const emitter = mitt()

    // new collection w/ mock sync/mutation
    const collection = new Collection<{ value: string }>({
      id: `mock`,
      sync: {
        sync: ({ begin, write, commit }) => {
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

    const mutationFn: MutationFn = ({ transaction }) => {
      // Sync something and check that that it isn't applied because
      // we're still in the middle of persisting a transaction.
      emitter.emit(`update`, [
        { key: `the-key`, type: `insert`, changes: { bar: `value` } },
        // This update is ignored because the optimistic update overrides it.
        { key: `foo`, type: `update`, changes: { bar: `value2` } },
      ])
      expect(collection.state).toEqual(new Map([[`foo`, { value: `bar` }]]))
      // Remove it so we don't have to assert against it below
      emitter.emit(`update`, [{ key: `the-key`, type: `delete` }])

      emitter.emit(`update`, transaction.mutations)
      return Promise.resolve()
    }

    const tx1 = createTransaction({ mutationFn })

    // insert
    tx1.mutate(() =>
      collection.insert(
        {
          value: `bar`,
        },
        { key: `foo` }
      )
    )

    // The merged value should immediately contain the new insert
    expect(collection.state).toEqual(new Map([[`foo`, { value: `bar` }]]))

    // check there's a transaction in peristing state
    expect(
      // @ts-expect-error possibly undefined is ok in test
      Array.from(collection.transactions.state.values())[0].mutations[0].changes
    ).toEqual({
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertOperation: OptimisticChangeMessage = {
      key: `foo`,
      value: { value: `bar` },
      type: `insert`,
      isActive: true,
    }
    expect(collection.optimisticOperations.state[0]).toEqual(insertOperation)

    await tx1.isPersisted.promise

    expect(collection.state).toEqual(new Map([[`foo`, { value: `bar` }]]))
  })

  it(`should handle sparse key arrays for bulk inserts`, () => {
    const collection = new Collection<{ value: string }>({
      id: `test`,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
    })
    const mutationFn = async () => {}

    // Insert multiple items with a sparse key array
    const items = [
      { value: `item1` },
      { value: `item2` },
      { value: `item3` },
      { value: `item4` },
    ]

    const tx1 = createTransaction({ mutationFn })
    // Only provide keys for first and third items
    tx1.mutate(() =>
      collection.insert(items, {
        key: [`key1`, undefined, `key3`],
      })
    )

    // Get all keys from the transaction
    const keys = tx1.mutations.map((m) => m.key)

    // Verify explicit keys were used
    expect(keys[0]).toBe(`key1`)
    expect(keys[2]).toBe(`key3`)

    // Verify auto-generated keys for undefined positions
    expect(keys[1]).toHaveLength(43)
    expect(keys[3]).toHaveLength(43)

    // Verify all items were inserted with correct values
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[0])).toEqual({ value: `item1` })
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[1])).toEqual({ value: `item2` })
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[2])).toEqual({ value: `item3` })
    // @ts-expect-error possibly undefined is ok in test
    expect(collection.state.get(keys[3])).toEqual({ value: `item4` })

    const tx2 = createTransaction({ mutationFn })
    // Test error case: more keys than items
    expect(() => {
      tx2.mutate(() =>
        collection.insert([{ value: `test` }], {
          key: [`key1`, `key2`],
        })
      )
    }).toThrow(`More keys provided than items to insert`)
  })

  it(`should throw errors when deleting items not in the collection`, () => {
    const collection = new Collection<{ name: string }>({
      id: `delete-errors`,
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

    // Should throw when trying to delete an object not in the collection
    const notInCollection = { name: `Not In Collection` }
    const tx2 = createTransaction({ mutationFn })
    expect(() => tx2.mutate(() => collection.delete(notInCollection))).toThrow(
      `Object not found in collection`
    )

    // Should throw when trying to delete an invalid type
    const tx3 = createTransaction({ mutationFn })
    // @ts-expect-error testing error handling with invalid type
    expect(() => tx3.mutate(() => collection.delete(123))).toThrow(
      `Invalid item type for delete - must be an object or string key`
    )

    // Should not throw when deleting by string key (even if key doesn't exist)
    const tx4 = createTransaction({ mutationFn })
    expect(() =>
      tx4.mutate(() => collection.delete(`non-existent-key`))
    ).not.toThrow()

    // Should not throw when deleting an object that exists in the collection
    const tx5 = createTransaction({ mutationFn })
    expect(() => tx5.mutate(() => collection.delete(item))).not.toThrow()
  })
})

describe(`Collection with schema validation`, () => {
  it(`should validate data against schema on insert`, () => {
    // Create a Zod schema for a user
    const userSchema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
      email: z.string().email().optional(),
    })

    // Create a collection with the schema
    const collection = new Collection<z.infer<typeof userSchema>>({
      id: `test`,
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
    tx1.mutate(() => collection.insert(validUser, { key: `user1` }))

    // Invalid data should throw SchemaValidationError
    const invalidUser = {
      name: ``, // Empty name (fails min length)
      age: -5, // Negative age (fails positive)
      email: `not-an-email`, // Invalid email
    }

    try {
      const tx2 = createTransaction({ mutationFn })
      tx2.mutate(() => collection.insert(invalidUser, { key: `user2` }))
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
      collection.update(collection.state.get(`user1`)!, (draft) => {
        draft.age = 31
      })
    )

    // Partial updates should fail with invalid data
    try {
      const tx4 = createTransaction({ mutationFn })
      tx4.mutate(() =>
        collection.update(collection.state.get(`user1`)!, (draft) => {
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
})
