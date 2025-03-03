import { describe, it, vi, expect } from "vitest"
import { Collection } from "./collection"
import type { ChangeMessage } from "./types"
import "fake-indexeddb/auto"
import mitt from "mitt"
import { z } from "zod"
import { SchemaValidationError } from "./collection"

describe(`Collection`, () => {
  it(`should throw if there's no sync config`, () => {
    expect(() => new Collection()).toThrow(`Collection requires a sync config`)
  })

  it(`should throw if there's no mutationFn`, () => {
    expect(
      () =>
        new Collection({
          sync: { id: `test`, sync: async () => {} },
        })
    ).toThrow(`Collection requires a mutationFn`)
  })

  it(`It shouldn't expose any state until the initial sync is finished`, async () => {
    // Create a collection with a mock sync plugin
    new Collection({
      sync: {
        id: `test`,
        sync: ({ collection, begin, write, commit }) => {
          // Initial state should be empty
          expect(collection.value).toEqual(new Map())

          // Start a batch of operations
          begin()

          // Write some test data
          const operations: ChangeMessage[] = [
            { key: `user1`, value: { name: `Alice` }, type: `insert` },
            { key: `user2`, value: { name: `Bob` }, type: `insert` },
          ]

          for (const op of operations) {
            write(op)
            // Data should still be empty during writes
            expect(collection.value).toEqual(new Map())
          }

          // Commit the changes
          commit()

          // Now the data should be visible
          const expectedData = new Map([
            [`user1`, { name: `Alice` }],
            [`user2`, { name: `Bob` }],
          ])
          expect(collection.value).toEqual(expectedData)
        },
      },
      mutationFn: {
        persist: async () => {},
      },
    })
  })

  it(`Calling mutation operators should trigger creating & persisting a new transaction`, async () => {
    const emitter = mitt()
    // Create mock functions that will capture the data for later assertions
    const persistMock = vi.fn()
    const syncMock = vi.fn()

    // new collection w/ mock sync/mutation
    const collection = new Collection({
      sync: {
        id: `mock`,
        sync: ({ begin, write, commit }) => {
          emitter.on(`*`, (type, changes) => {
            begin()
            changes.forEach((change) => {
              write({
                key: change.key,
                type: change.type,
                value: change.changes,
              })
            })
            commit()
          })
        },
      },
      mutationFn: {
        persist({ transaction, attempt }) {
          // Redact time-based and random fields
          const redactedTransaction = {
            ...transaction.toObject(),
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
          persistMock({ transaction: redactedTransaction, attempt })
          return Promise.resolve()
        },
        awaitSync({ transaction }) {
          // Call the mock function with the transaction
          syncMock({ transaction })

          emitter.emit(`sync`, transaction.mutations)
          return Promise.resolve()
        },
      },
    })

    // Test insert with auto-generated key
    const data = { value: `bar` }
    const transaction = collection.insert(data)
    const insertedKey = transaction.mutations[0].key

    // The merged value should immediately contain the new insert
    expect(collection.value).toEqual(new Map([[insertedKey, { value: `bar` }]]))

    // check there's a transaction in peristing state
    expect(
      Array.from(collection.transactions.values())[0].mutations[0].changes
    ).toEqual({
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertOperation: ChangeMessage = {
      key: insertedKey,
      value: { value: `bar` },
      type: `insert`,
    }
    expect(collection.optimisticOperations.state[0]).toEqual(insertOperation)

    // Check persist data (moved outside the persist callback)
    const persistData = persistMock.mock.calls[0][0]
    // Check that the transaction is in the right state during persist
    expect(persistData.transaction.state).toBe(`persisting`)
    // Check mutation type is correct
    expect(persistData.transaction.mutations[0].type).toBe(`insert`)
    // Check changes are correct
    expect(persistData.transaction.mutations[0].changes).toEqual({
      value: `bar`,
    })

    await transaction.isSynced?.promise

    // Check sync data (moved outside the awaitSync callback)
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
      Array.from(collection.transactions.values())[0].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(new Map([[insertedKey, { value: `bar` }]]))

    // Test insert with provided key
    collection.insert({ value: `baz` }, { key: `custom-key` })
    expect(collection.value.get(`custom-key`)).toEqual({ value: `baz` })

    // Test bulk insert
    const bulkData = [{ value: `item1` }, { value: `item2` }]
    collection.insert(bulkData)
    const keys = Array.from(collection.value.keys())
    expect(collection.value.get(keys[2])).toEqual(bulkData[0])
    expect(collection.value.get(keys[3])).toEqual(bulkData[1])

    // Test update with callback
    collection.update(collection.value.get(insertedKey)!, (item) => {
      item.value = `bar2`
    })

    // The merged value should contain the update.
    expect(collection.value.get(insertedKey)).toEqual({ value: `bar2` })

    // Test update with config and callback
    collection.update(
      collection.value.get(insertedKey)!,
      { metadata: { updated: true } },
      (item) => {
        item.value = `bar3`
        item.newProp = `new value`
      }
    )

    // The merged value should contain the update
    expect(collection.value.get(insertedKey)).toEqual({
      value: `bar3`,
      newProp: `new value`,
    })

    // Test bulk update
    const items = [
      collection.value.get(keys[2])!,
      collection.value.get(keys[3])!,
    ]
    collection.update(items, { metadata: { bulkUpdate: true } }, (items) => {
      items.forEach((item) => {
        item.value += `-updated`
      })
    })

    // Check bulk updates
    expect(collection.value.get(keys[2])).toEqual({ value: `item1-updated` })
    expect(collection.value.get(keys[3])).toEqual({ value: `item2-updated` })

    const toBeDeleted = collection.value.get(insertedKey)!
    // Test delete single item
    collection.delete(toBeDeleted)
    expect(collection.value.has(insertedKey)).toBe(false)
    expect(collection.objectKeyMap.has(toBeDeleted)).toBe(false)

    // Test delete with metadata
    collection.delete(collection.value.get(`custom-key`)!, {
      metadata: { reason: `test` },
    })
    expect(collection.value.has(`custom-key`)).toBe(false)

    // Test bulk delete
    collection.delete([
      collection.value.get(keys[2])!,
      collection.value.get(keys[3])!,
    ])
    expect(collection.value.has(keys[2])).toBe(false)
    expect(collection.value.has(keys[3])).toBe(false)
  })

  it(`synced updates shouldn't be applied while there's an ongoing transaction`, async () => {
    const emitter = mitt()

    // new collection w/ mock sync/mutation
    const collection = new Collection({
      sync: {
        id: `mock`,
        sync: ({ begin, write, commit }) => {
          emitter.on(`*`, (type, changes) => {
            begin()
            changes.forEach((change) => {
              write({
                key: change.key,
                type: change.type,
                value: change.changes,
              })
            })
            commit()
          })
        },
      },
      mutationFn: {
        persist() {
          // Sync something and check that that it isn't applied because
          // we're still in the middle of persisting a transaction.
          emitter.emit(`update`, [
            { key: `the-key`, type: `insert`, changes: { bar: `value` } },
          ])
          expect(collection.value).toEqual(new Map([[`foo`, { value: `bar` }]]))
          // Remove it so we don't have to assert against it below
          emitter.emit(`update`, [{ key: `the-key`, type: `delete` }])
          return Promise.resolve()
        },
        awaitSync({ transaction }) {
          emitter.emit(`update`, transaction.mutations)
          return Promise.resolve()
        },
      },
    })

    // insert
    const transaction = collection.insert(
      {
        value: `bar`,
      },
      { key: `foo` }
    )

    // The merged value should immediately contain the new insert
    expect(collection.value).toEqual(new Map([[`foo`, { value: `bar` }]]))

    // check there's a transaction in peristing state
    expect(
      Array.from(collection.transactions.values())[0].mutations[0].changes
    ).toEqual({
      value: `bar`,
    })

    // Check the optimistic operation is there
    const insertOperation: ChangeMessage = {
      key: `foo`,
      value: { value: `bar` },
      type: `insert`,
    }
    expect(collection.optimisticOperations.state[0]).toEqual(insertOperation)

    await transaction.isSynced?.promise

    expect(collection.value).toEqual(new Map([[`foo`, { value: `bar` }]]))
  })

  // Skip until e2e working
  it(`If the mutationFn throws error, it get retried`, () => {
    // new collection w/ mock sync/mutation
    // insert
    // mutationFn fails the first time and then succeeds
  })

  // Skip until e2e working
  it(`If the mutationFn throws NonRetriableError, it doesn't get retried and optimistic state is rolled back`, () => {
    // new collection w/ mock sync/mutation
    // insert
    // mutationFn fails w/ NonRetriableError and the check that optimistic state is rolledback.
  })

  it(`should handle sparse key arrays for bulk inserts`, async () => {
    const collection = new Collection({
      sync: {
        id: `test`,
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      mutationFn: {
        persist: async () => {},
      },
    })

    // Insert multiple items with a sparse key array
    const items = [
      { value: `item1` },
      { value: `item2` },
      { value: `item3` },
      { value: `item4` },
    ]

    // Only provide keys for first and third items
    const transaction = collection.insert(items, {
      key: [`key1`, undefined, `key3`],
    })

    // Get all keys from the transaction
    const keys = transaction.mutations.map((m) => m.key)

    // Verify explicit keys were used
    expect(keys[0]).toBe(`key1`)
    expect(keys[2]).toBe(`key3`)

    // Verify auto-generated keys for undefined positions
    expect(keys[1]).toHaveLength(6)
    expect(keys[3]).toHaveLength(6)

    // Verify all items were inserted with correct values
    expect(collection.value.get(keys[0])).toEqual({ value: `item1` })
    expect(collection.value.get(keys[1])).toEqual({ value: `item2` })
    expect(collection.value.get(keys[2])).toEqual({ value: `item3` })
    expect(collection.value.get(keys[3])).toEqual({ value: `item4` })

    // Test error case: more keys than items
    expect(() => {
      collection.insert([{ value: `test` }], {
        key: [`key1`, `key2`],
      })
    }).toThrow(`More keys provided than items to insert`)
  })
})

describe(`Collection with schema validation`, () => {
  it(`should validate data against schema on insert`, async () => {
    // Create a Zod schema for a user
    const userSchema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
      email: z.string().email().optional(),
    })

    // Create a collection with the schema
    const collection = new Collection<z.infer<typeof userSchema>>({
      sync: {
        id: `test`,
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      mutationFn: {
        persist: async () => {},
      },
      schema: userSchema,
    })

    // Valid data should work
    const validUser = {
      name: `Alice`,
      age: 30,
      email: `alice@example.com`,
    }

    collection.insert(validUser, { key: `user1` })

    // Invalid data should throw SchemaValidationError
    const invalidUser = {
      name: ``, // Empty name (fails min length)
      age: -5, // Negative age (fails positive)
      email: `not-an-email`, // Invalid email
    }

    try {
      collection.insert(invalidUser, { key: `user2` })
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`insert`)
        expect(error.issues.length).toBeGreaterThan(0)
        // Check that we have validation errors for each invalid field
        expect(error.issues.some((issue) => issue?.path.includes(`name`))).toBe(
          true
        )
        expect(error.issues.some((issue) => issue?.path.includes(`age`))).toBe(
          true
        )
        expect(
          error.issues.some((issue) => issue?.path.includes(`email`))
        ).toBe(true)
      }
    }

    // Partial updates should work with valid data
    collection.update(collection.value.get(`user1`), (draft) => {
      draft.age = 31
    })

    // Partial updates should fail with invalid data
    try {
      collection.update(collection.value.get(`user1`), (draft) => {
        draft.age = -1
      })
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`update`)
        expect(error.issues.length).toBeGreaterThan(0)
        expect(error.issues.some((issue) => issue?.path.includes(`age`))).toBe(
          true
        )
      }
    }
  })
})
