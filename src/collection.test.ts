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

    // insert
    const transaction = collection.insert({
      key: `foo`,
      data: { value: `bar` },
    })

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
    expect(collection.value).toEqual(new Map([[`foo`, { value: `bar` }]]))

    // update with data object
    // Reset the mocks for update test
    persistMock.mockClear()
    syncMock.mockClear()

    const updateTransaction = collection.update({
      key: `foo`,
      data: { value: `bar2` },
    })

    // The merged value should immediately contain the new update
    expect(collection.value).toEqual(new Map([[`foo`, { value: `bar2` }]]))

    // check there's a transaction in peristing state
    expect(
      Array.from(collection.transactions.values())[1].mutations[0].changes
    ).toEqual({
      value: `bar2`,
    })

    // Check the optimistic operation is there
    const updateOperation: ChangeMessage = {
      key: `foo`,
      value: { value: `bar2` },
      type: `update`,
    }
    expect(collection.optimisticOperations.state[0]).toEqual(updateOperation)

    // Check persist data for update (moved outside the persist callback)
    const updatePersistData = persistMock.mock.calls[0][0]
    // Check that the transaction is in the right state during persist
    expect(updatePersistData.transaction.state).toBe(`persisting`)
    // Check mutation type is correct
    expect(updatePersistData.transaction.mutations[0].type).toBe(`update`)
    // Check changes are correct
    expect(updatePersistData.transaction.mutations[0].changes).toEqual({
      value: `bar2`,
    })
    // Check original data is correct
    expect(updatePersistData.transaction.mutations[0].original).toEqual({
      value: `bar`,
    })

    await updateTransaction.isSynced?.promise

    // Check sync data for update (moved outside the awaitSync callback)
    const updateSyncData = syncMock.mock.calls[0][0]
    // Check that the transaction is in the right state during sync waiting
    expect(updateSyncData.transaction.state).toBe(`completed`)
    // Check mutation type is correct
    expect(updateSyncData.transaction.mutations[0].type).toBe(`update`)
    // Check changes are correct
    expect(updateSyncData.transaction.mutations[0].changes).toEqual({
      value: `bar2`,
    })

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(
      Array.from(collection.transactions.values())[1].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(new Map([[`foo`, { value: `bar2` }]]))

    // update with callback
    // Reset the mocks for update test with callback
    persistMock.mockClear()
    syncMock.mockClear()

    const updateWithCallbackTransaction = collection.update({
      key: `foo`,
      callback: (proxy) => {
        proxy.value = `bar3`
        proxy.newProp = `new value`
      },
    })

    // The merged value should immediately contain the new update
    expect(collection.value).toEqual(
      new Map([[`foo`, { value: `bar3`, newProp: `new value` }]])
    )

    // check there's a transaction in peristing state
    expect(
      Array.from(collection.transactions.values())[2].mutations[0].changes
    ).toEqual({
      value: `bar3`,
      newProp: `new value`,
    })

    // Check the optimistic operation is there
    const updateWithCallbackOperation: ChangeMessage = {
      key: `foo`,
      value: { value: `bar3`, newProp: `new value` },
      type: `update`,
    }
    expect(collection.optimisticOperations.state[0]).toEqual(
      updateWithCallbackOperation
    )

    await updateWithCallbackTransaction.isSynced?.promise

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(
      Array.from(collection.transactions.values())[2].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(
      new Map([[`foo`, { value: `bar3`, newProp: `new value` }]])
    )

    // update multiple items with array callback
    // Reset the mocks for update test with array callback
    persistMock.mockClear()
    syncMock.mockClear()

    // Insert another item
    await collection.insert({
      key: `bar`,
      data: { value: `baz` },
    }).isSynced?.promise

    persistMock.mockClear()
    syncMock.mockClear()

    const updateMultipleTransaction = collection.update({
      key: [`foo`, `bar`],
      callback: (proxies) => {
        proxies[0].value = `bar4`
        proxies[1].value = `baz2`
      },
    })

    // The merged value should immediately contain the new updates
    expect(collection.value).toEqual(
      new Map([
        [`foo`, { value: `bar4`, newProp: `new value` }],
        [`bar`, { value: `baz2` }],
      ])
    )

    // check there's a transaction with two mutations
    const multiUpdateTransaction = Array.from(
      collection.transactions.values()
    )[4]
    expect(multiUpdateTransaction.mutations.length).toBe(2)

    // Check first mutation
    expect(multiUpdateTransaction.mutations[0].key).toBe(`foo`)
    expect(multiUpdateTransaction.mutations[0].changes).toEqual({
      value: `bar4`,
    })

    // Check second mutation
    expect(multiUpdateTransaction.mutations[1].key).toBe(`bar`)
    expect(multiUpdateTransaction.mutations[1].changes).toEqual({
      value: `baz2`,
    })

    await updateMultipleTransaction.isSynced?.promise

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(updateMultipleTransaction.state).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(
      new Map([
        [`foo`, { value: `bar4`, newProp: `new value` }],
        [`bar`, { value: `baz2` }],
      ])
    )

    // delete
    // Reset the mocks for delete test
    persistMock.mockClear()
    syncMock.mockClear()

    const deleteTransaction = collection.delete({
      key: `foo`,
    })

    // The merged value should immediately contain the new update
    expect(collection.value).toEqual(new Map([[`bar`, { value: `baz2` }]]))

    // check there's a transaction in peristing state
    expect(
      Array.from(collection.transactions.values())[5].mutations[0].changes
    ).toEqual({
      _deleted: true,
    })

    // Check the optimistic operation is there
    const deleteOperation: ChangeMessage = {
      key: `foo`,
      type: `delete`,
      value: {
        _deleted: true,
      },
    }
    expect(collection.optimisticOperations.state[0]).toEqual(deleteOperation)

    // Check persist data for update (moved outside the persist callback)
    const deletePersistData = persistMock.mock.calls[0][0]
    // Check that the transaction is in the right state during persist
    expect(deletePersistData.transaction.state).toBe(`persisting`)
    // Check mutation type is correct
    expect(deletePersistData.transaction.mutations[0].type).toBe(`delete`)
    // Check original data is correct
    expect(deletePersistData.transaction.mutations[0].original).toEqual({
      value: `bar4`,
      newProp: `new value`,
    })

    await deleteTransaction.isSynced?.promise

    // Check sync data for update (moved outside the awaitSync callback)
    const deleteSyncData = syncMock.mock.calls[0][0]
    // Check that the transaction is in the right state during sync waiting
    expect(deleteTransaction.state).toBe(`completed`)
    // Check mutation type is correct
    expect(deleteSyncData.transaction.mutations[0].type).toBe(`delete`)
    // Check changes are correct
    expect(deleteSyncData.transaction.mutations[0].changes).toEqual({
      _deleted: true,
    })
    // Check original data is correct
    expect(deleteSyncData.transaction.mutations[0].original).toEqual({
      value: `bar4`,
      newProp: `new value`,
    })

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(
      Array.from(collection.transactions.values())[5].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(new Map([[`bar`, { value: `baz2` }]]))
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
    const transaction = collection.insert({
      key: `foo`,
      data: { value: `bar` },
    })

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

    collection.insert({
      key: `user1`,
      data: validUser,
    })

    // Invalid data should throw SchemaValidationError
    const invalidUser = {
      name: ``, // Empty name (fails min length)
      age: -5, // Negative age (fails positive)
      email: `not-an-email`, // Invalid email
    }

    try {
      collection.insert({
        key: `user2`,
        data: invalidUser,
      })
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
    collection.update({
      key: `user1`,
      data: {
        age: 31,
      },
    })

    // Partial updates should fail with invalid data
    try {
      collection.update({
        key: `user1`,
        data: {
          age: -1,
        },
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
