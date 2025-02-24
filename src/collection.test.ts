import { describe, it, expect } from "vitest"
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

          expect({
            changes: redactedChanges,
            transaction: redactedTransaction,
            attempt,
          }).toMatchInlineSnapshot(`
            {
              "attempt": 1,
              "changes": [
                {
                  "createdAt": "[REDACTED]",
                  "mutationId": "[REDACTED]",
                  "updatedAt": "[REDACTED]",
                  "value": "bar",
                },
              ],
              "transaction": {
                "attempts": [],
                "createdAt": "[REDACTED]",
                "current_attempt": 0,
                "id": "[REDACTED]",
                "isPersisted": {
                  "isPending": [Function],
                  "promise": Promise {},
                  "reject": [Function],
                  "resolve": [Function],
                },
                "isSynced": {
                  "isPending": [Function],
                  "promise": Promise {},
                  "reject": [Function],
                  "resolve": [Function],
                },
                "mutationId": "[REDACTED]",
                "mutations": {
                  "0": {
                    "changes": {
                      "value": "bar",
                    },
                    "createdAt": "[REDACTED]",
                    "key": "foo",
                    "metadata": undefined,
                    "modified": {
                      "value": "bar",
                    },
                    "mutationId": "[REDACTED]",
                    "original": {},
                    "type": "insert",
                    "updatedAt": "[REDACTED]",
                  },
                },
                "state": "persisting",
                "strategy": {
                  "type": "ordered",
                },
                "updatedAt": "[REDACTED]",
              },
            }
          `)

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

          expect({ transaction: redactedTransaction }).toMatchInlineSnapshot(`
            {
              "transaction": {
                "attempts": [],
                "createdAt": "[REDACTED]",
                "current_attempt": 0,
                "id": "[REDACTED]",
                "isPersisted": {
                  "isPending": [Function],
                  "promise": Promise {},
                  "reject": [Function],
                  "resolve": [Function],
                },
                "isSynced": {
                  "isPending": [Function],
                  "promise": Promise {},
                  "reject": [Function],
                  "resolve": [Function],
                },
                "mutationId": "[REDACTED]",
                "mutations": {
                  "0": {
                    "changes": {
                      "value": "bar",
                    },
                    "createdAt": "[REDACTED]",
                    "key": "foo",
                    "metadata": undefined,
                    "modified": {
                      "value": "bar",
                    },
                    "mutationId": "[REDACTED]",
                    "original": {},
                    "type": "insert",
                    "updatedAt": "[REDACTED]",
                  },
                },
                "state": "persisted_awaiting_sync",
                "strategy": {
                  "type": "ordered",
                },
                "updatedAt": "[REDACTED]",
              },
            }
          `)
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

    // after mutationFn returns, check that the transaction is updated &
    // optimistic update is gone & synced data & comibned state are all updated.
    expect(
      Array.from(collection.transactions.values())[0].state
    ).toMatchInlineSnapshot(`"completed"`)
    expect(collection.optimisticOperations.state).toEqual([])
    expect(collection.value).toEqual(new Map([[`foo`, { value: `bar` }]]))

    // TODO do same with update & delete
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
