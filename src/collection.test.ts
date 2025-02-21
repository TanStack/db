import { describe, it, expect } from "vitest"
import { Collection } from "./collection"
import type { ChangeMessage } from "./types"
import "fake-indexeddb/auto"

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
    // new collection w/ mock sync/mutation
    const collection = new Collection({
      sync: {
        id: `mock`,
        sync: () => {},
      },
      mutationFn: { persist: async () => {} },
    })

    // insert
    const transaction = collection.insert({
      key: `foo`,
      data: { value: `bar` },
    })

    // check there's a transaction in peristing state
    console.log(`transactions`, Array.from(collection.transactions.values()))
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
    // TODO optimisticOperations should be a derived array from looping over transactions (which are a store).
    expect(collection.optimisticOperations.state[0]).toEqual(insertOperation)

    console.log({ transaction })
    await transaction.synced

    // after mutationFn returns, check that it was called & transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual([])

    // do same with update & delete
  })

  it(`If the mutationFn throws error, it get retried`, () => {
    // new collection w/ mock sync/mutation
    // insert
    // mutationFn fails the first time and then succeeds
  })

  it(`If the mutationFn throws NonRetriableError, it doesn't get retried and optimistic state is rolled back`, () => {
    // new collection w/ mock sync/mutation
    // insert
    // mutationFn fails w/ NonRetriableError and the check that optimistic state is rolledback.
  })
})
