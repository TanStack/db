import { beforeEach, describe, expect, it } from "vitest"
import { TransactionManager } from "../src/TransactionManager"
import { Collection } from "../src/collection"
import type { PendingMutation } from "../src/types"

describe(`TransactionManager`, () => {
  let collection: Collection
  let manager: TransactionManager

  beforeEach(() => {
    collection = new Collection({
      id: `foo`,
      sync: {
        sync: () => {},
      },
      mutationFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
      },
    })
    manager = new TransactionManager(collection)
  })

  const createMockMutation = (id: string): PendingMutation => ({
    mutationId: id,
    original: { id, value: `original` },
    modified: { id, value: `modified` },
    changes: { value: `modified` },
    type: `insert`,
    key: id,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    syncMetadata: {},
  })

  describe(`Basic Transaction Management`, () => {
    it(`should create a transaction in pending state`, () => {
      const mutations = [createMockMutation(`test-1`)]
      const transaction = manager.applyTransaction(mutations)

      expect(transaction.id).toBeDefined()
      expect(transaction.state).toBe(`pending`)
      expect(transaction.mutations).toEqual(mutations)
    })

    it(`should update transaction state`, () => {
      const mutations = [createMockMutation(`test-2`)]
      const transaction = manager.applyTransaction(mutations)

      // Add a small delay to ensure timestamps are different
      const beforeUpdate = transaction.updatedAt
      manager.setTransactionState(transaction.id, `pending`)

      const updated = manager.getTransaction(transaction.id)
      expect(updated?.state).toBe(`pending`)
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(
        beforeUpdate.getTime()
      )
    })

    it(`should throw when updating non-existent transaction`, () => {
      expect(() =>
        manager.setTransactionState(`non-existent`, `completed`)
      ).toThrow(`Transaction non-existent not found`)
    })
  })

  describe(`Ordered vs Parallel Transactions`, () => {
    it(`should not queue transactions`, () => {
      // Create multiple parallel transactions modifying same object
      const tx1 = manager.applyTransaction([createMockMutation(`object-1`)])
      const tx2 = manager.applyTransaction([createMockMutation(`object-1`)])
      const tx3 = manager.applyTransaction([createMockMutation(`object-1`)])

      // All should be in pending state and not queued
      expect(tx1.state).toBe(`pending`)
      expect(tx2.state).toBe(`pending`)
      expect(tx3.state).toBe(`pending`)
    })
  })

  describe(`Transaction Ordering`, () => {
    it(`should maintain transactions sorted by createdAt`, async () => {
      // Create transactions with different timestamps
      const now = Date.now()
      const timestamps = [now, now - 1000, now - 2000]

      // Create transactions in reverse chronological order
      await Promise.all(
        timestamps.map((timestamp, i) => {
          const tx = manager.applyTransaction([
            createMockMutation(`test-${i + 1}`),
          ])
          // Force the createdAt time
          const updatedTx = {
            ...tx.toObject(),
            createdAt: new Date(timestamp),
          }

          manager.transactions.setState((sortedMap) => {
            // @ts-expect-error this is fine for a test
            sortedMap.set(updatedTx.id, updatedTx)
            return sortedMap
          })
          return updatedTx
        })
      )

      // Verify transactions are returned in chronological order (oldest first)
      const sortedTransactions = Array.from(manager.transactions.state.values())
      expect(sortedTransactions[0]?.createdAt.getTime()).toBe(timestamps[2]) // Oldest
      expect(sortedTransactions[1]?.createdAt.getTime()).toBe(timestamps[1])
      expect(sortedTransactions[2]?.createdAt.getTime()).toBe(timestamps[0]) // Newest
    })

    it(`should create a new transaction when no existing transactions with overlapping keys exist`, () => {
      // Create a new transaction
      const mutations = [createMockMutation(`test-apply-1`)]
      const transaction = manager.applyTransaction(mutations)

      // Verify transaction was created with the expected properties
      expect(transaction.id).toBeDefined()
      expect(transaction.state).toBe(`pending`)
      expect(transaction.mutations).toEqual(mutations)
    })

    it(`should overwrite mutations for the same key in existing pending transactions`, () => {
      // Create first transaction with a mutation
      const originalMutation = {
        ...createMockMutation(`test-apply-2`),
        modified: { id: `test-apply-2`, value: `original-value` },
        changes: { value: `original-value` },
      }

      manager.applyTransaction([originalMutation])

      // Create second transaction with a mutation - this should be queued behind the first.
      const tx1 = manager.applyTransaction([originalMutation])
      expect(tx1.mutations[0]?.modified.value).toBe(`original-value`)

      // Apply a new transaction with a mutation for the same key but different value.
      const newMutation = {
        ...createMockMutation(`test-apply-2`),
        modified: { id: `test-apply-2`, value: `updated-value` },
        changes: { value: `updated-value` },
      }

      const tx2 = manager.applyTransaction([newMutation])

      // Should reuse the same transaction ID
      expect(tx2.id).toBe(tx1.id)

      // Should have updated the mutation
      expect(tx2.mutations.length).toBe(1)
      expect(tx2.mutations[0]?.modified.value).toBe(`updated-value`)
      expect(tx2.mutations[0]?.changes.value).toBe(`updated-value`)
    })

    it(`should add new mutations while preserving existing ones for different keys`, () => {
      // Create first transaction with a mutation
      const mutation1 = createMockMutation(`test-apply-3a`)
      const tx1 = manager.applyTransaction([mutation1])

      // Apply a new transaction with a mutation for a different key
      const mutation2 = createMockMutation(`test-apply-3b`)
      const tx2 = manager.applyTransaction([mutation2])

      // Should create a new transaction since keys don't overlap
      expect(tx2.id).not.toBe(tx1.id)
      expect(tx2.mutations.length).toBe(1)
      expect(tx2.mutations[0]?.key).toBe(`test-apply-3b`)
    })

    it(`should handle multiple transactions with overlapping keys`, () => {
      // Create first transaction with mutations for keys A and B
      const mutationA1 = {
        ...createMockMutation(`key-A`),
        modified: { id: `key-A`, value: `A-original` },
        changes: { value: `A-original` },
      }

      const mutationB1 = {
        ...createMockMutation(`key-B`),
        modified: { id: `key-B`, value: `B-original` },
        changes: { value: `B-original` },
      }

      // Apply an initial one so the second is queued behind it.
      manager.applyTransaction([mutationA1, mutationB1])
      const tx1 = manager.applyTransaction([mutationA1, mutationB1])

      // Create second transaction with mutations for keys B and C
      const mutationB2 = {
        ...createMockMutation(`key-B`),
        modified: { id: `key-B`, value: `B-updated` },
        changes: { value: `B-updated` },
      }

      const mutationC1 = {
        ...createMockMutation(`key-C`),
        modified: { id: `key-C`, value: `C-original` },
        changes: { value: `C-original` },
      }

      // Apply the new transaction
      const tx2 = manager.applyTransaction([mutationB2, mutationC1])

      // Should update tx1 since it has an overlapping key (B)
      expect(tx2.id).toBe(tx1.id)

      // Should have 3 mutations now (A, B-updated, C)
      expect(tx2.mutations.length).toBe(3)

      // Find each mutation by key
      const mutationA = tx2.mutations.find((m) => m.key === `key-A`)
      const mutationB = tx2.mutations.find((m) => m.key === `key-B`)
      const mutationC = tx2.mutations.find((m) => m.key === `key-C`)

      // Verify A is unchanged
      expect(mutationA).toBeDefined()
      expect(mutationA?.modified.value).toBe(`A-original`)

      // Verify B is updated
      expect(mutationB).toBeDefined()
      expect(mutationB?.modified.value).toBe(`B-updated`)

      // Verify C is added
      expect(mutationC).toBeDefined()
      expect(mutationC?.modified.value).toBe(`C-original`)
    })

    it(`should handle the case where mutations don't overlap at all`, () => {
      // Create three transactions with non-overlapping mutations
      const tx1 = manager.applyTransaction([createMockMutation(`key-1`)])
      const tx2 = manager.applyTransaction([createMockMutation(`key-2`)])

      // Apply a transaction with a new non-overlapping key
      const tx3 = manager.applyTransaction([createMockMutation(`key-3`)])

      // Should be a new transaction
      expect(tx3.id).not.toBe(tx1.id)
      expect(tx3.id).not.toBe(tx2.id)
      expect(tx3.mutations.length).toBe(1)
      expect(tx3.mutations[0]?.key).toBe(`key-3`)

      // Original transactions should be unchanged
      const updatedTx1 = manager.getTransaction(tx1.id)
      const updatedTx2 = manager.getTransaction(tx2.id)

      expect(updatedTx1?.mutations.length).toBe(1)
      expect(updatedTx1?.mutations[0]?.key).toBe(`key-1`)

      expect(updatedTx2?.mutations.length).toBe(1)
      expect(updatedTx2?.mutations[0]?.key).toBe(`key-2`)
    })

    it(`should only consider active transactions for applying updates`, () => {
      // Create a transaction and mark it as completed
      const mutation1 = createMockMutation(`completed-key`)
      const tx1 = manager.applyTransaction([mutation1])
      manager.setTransactionState(tx1.id, `completed`)

      // Apply a new transaction with the same key
      const mutation2 = {
        ...createMockMutation(`completed-key`),
        modified: { id: `completed-key`, value: `new-value` },
        changes: { value: `new-value` },
      }

      const tx2 = manager.applyTransaction([mutation2])

      // Should create a new transaction since the existing one is completed
      expect(tx2.id).not.toBe(tx1.id)
      expect(tx2.mutations.length).toBe(1)
      expect(tx2.mutations[0]?.modified.value).toBe(`new-value`)
    })
  })

  describe(`Error Handling`, () => {
    it(`should reject isPersisted persist fails`, async () => {
      // Create a collection with a persist function that throws an error
      const errorCollection = new Collection({
        id: `foo`,
        sync: {
          sync: () => {},
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        mutationFn: async () => {
          throw new Error(`Persist error`)
        },
      })
      const errorManager = new TransactionManager(errorCollection)

      // Apply a transaction
      const mutations = [createMockMutation(`error-test-5`)]
      const transaction = errorManager.applyTransaction(mutations)

      await expect(transaction.isPersisted?.promise).rejects.toThrow(
        `Persist error`
      )

      // Verify the transaction state
      expect(transaction.state).toBe(`failed`)
      expect(transaction.error?.message).toBe(`Persist error`)
    })

    it.only(`should handle non-Error objects thrown during persist`, async () => {
      // Create a collection with a persist function that throws a non-Error object
      const nonErrorCollection = new Collection({
        id: `non-error-object`,
        sync: {
          sync: () => {},
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        mutationFn: async () => {
          // Throw a string instead of an Error object
          throw `String error message`
        },
      })
      const nonErrorManager = new TransactionManager(nonErrorCollection)

      // Apply a transaction
      const mutations = [createMockMutation(`non-error-test`)]
      const transaction = nonErrorManager.applyTransaction(mutations)

      // The promise should reject with a converted Error
      await expect(transaction.isPersisted?.promise).rejects.toThrow(
        `String error message`
      )
      transaction.isPersisted?.promise.catch(() => {})

      // Verify the transaction state and error handling
      expect(transaction.state).toBe(`failed`)
      expect(transaction.error?.message).toBe(`String error message`)
      expect(transaction.error?.error).toBeInstanceOf(Error)
    })

    // TODO figure out why this isn't working.
    // it(`should handle non-Error objects thrown during awaitSync`, async () => {
    //   // Create a collection with an awaitSync function that throws a non-Error object
    //   const nonErrorSyncCollection = new Collection({
    //     id: `non-error-sync-object`,
    //     sync: {
    //       sync: () => {},
    //     },
    //     mutationFn: {
    //       persist: () => {
    //         return Promise.resolve({ success: true })
    //       },
    //       awaitSync: () => {
    //         // Throw a number instead of an Error object
    //         throw 123
    //       },
    //     },
    //   })
    //   const nonErrorSyncManager = new TransactionManager(
    //     nonErrorSyncCollection
    //   )
    //
    //   // Apply a transaction
    //   const mutations = [createMockMutation(`non-error-sync-test`)]
    //   const transaction = nonErrorSyncManager.applyTransaction(
    //     mutations,
    //
    //   )
    //
    //   // The promise should reject with a converted Error
    //   // await expect(transaction.isPersisted?.promise).rejects.toThrow(`123`)
    //   try {
    //     await transaction.isPersisted?.promise
    //   } catch (e) {
    //     console.log(e)
    //   }
    //
    //   // Verify the transaction state and error handling
    //   expect(transaction.state).toBe(`failed`)
    //   expect(transaction.error?.message).toBe(`123`)
    //   expect(transaction.error?.error).toBeInstanceOf(Error)
    // })
  })
})
