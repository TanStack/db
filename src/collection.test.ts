import { describe, it, vi, expect } from "vitest"
import { Collection } from "./collection"
import type { ChangeMessage } from "./types"
import "fake-indexeddb/auto"
import mitt from "mitt"

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

  it.only(`Calling mutation operators should trigger creating & persisting a new transaction`, async () => {
    const emitter = mitt()
    // Create mock functions that will capture the data for later assertions
    const persistMock = vi.fn()
    const syncMock = vi.fn()

    // new collection w/ mock sync/mutation
    const collection = new Collection({
      sync: {
        id: `mock`,
        sync: ({ begin, write, commit }) => {
          emitter.on(`*`, (type, { changes }) => {
            begin()
            changes.map((change) =>
              write({ key: `key`, type: `insert`, value: change })
            )
            commit()
          })
        },
      },
      mutationFn: {
        persist({ changes, transaction, attempt }) {
          // Redact time-based and random fields
          const redactedChanges = changes.map((change) => ({
            ...change,
            createdAt: `[REDACTED]`,
            updatedAt: `[REDACTED]`,
            mutationId: `[REDACTED]`,
          }))
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
            createdAt: `[REDACTED]`,
            updatedAt: `[REDACTED]`,
            id: `[REDACTED]`,
            mutationId: `[REDACTED]`,
          }

          // Store the data for later assertion
          persistMock({
            changes: redactedChanges,
            transaction: redactedTransaction,
            attempt,
          })

          return Promise.resolve()
        },
        awaitSync({ transaction }) {
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
            createdAt: `[REDACTED]`,
            updatedAt: `[REDACTED]`,
            mutationId: `[REDACTED]`,
            id: `[REDACTED]`,
          }

          // Store the data for later assertion
          syncMock({ transaction: redactedTransaction })

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
    expect(syncData.transaction.state).toBe(`persisted_awaiting_sync`)
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

    // TODO do same with update & delete & withMutation
    //
    // update
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
    expect(updateSyncData.transaction.state).toBe(`persisted_awaiting_sync`)
    // Check mutation type is correct
    expect(updateSyncData.transaction.mutations[0].type).toBe(`update`)
    // Check changes are correct
    expect(updateSyncData.transaction.mutations[0].changes).toEqual({
      value: `bar2`,
    })
    // Check original data is correct
    expect(updateSyncData.transaction.mutations[0].original).toEqual({
      value: `bar`,
    })

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(
      Array.from(collection.transactions.values())[1].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(new Map([[`foo`, { value: `bar2` }]]))
    //
    // delete
    // Reset the mocks for delete test
    persistMock.mockClear()
    syncMock.mockClear()

    const deleteTransaction = collection.delete({
      key: `foo`,
    })

    // The merged value should immediately contain the new update
    expect(collection.value).toEqual(new Map())

    // check there's a transaction in peristing state
    expect(
      Array.from(collection.transactions.values())[2].mutations[0].changes
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
    expect(updatePersistData.transaction.mutations[0].original).toEqual({
      value: `bar`,
    })

    await deleteTransaction.isSynced?.promise

    // Check sync data for update (moved outside the awaitSync callback)
    const deleteSyncData = syncMock.mock.calls[0][0]
    // Check that the transaction is in the right state during sync waiting
    expect(deleteSyncData.transaction.state).toBe(`persisted_awaiting_sync`)
    // Check mutation type is correct
    expect(deleteSyncData.transaction.mutations[0].type).toBe(`delete`)
    // Check changes are correct
    expect(deleteSyncData.transaction.mutations[0].changes).toEqual({
      _deleted: true,
    })
    // Check original data is correct
    expect(deleteSyncData.transaction.mutations[0].original).toEqual({
      value: `bar2`,
    })

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(
      Array.from(collection.transactions.values())[2].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(new Map())
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
