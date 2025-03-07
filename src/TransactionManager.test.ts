import { describe, it, expect, beforeEach, vi } from "vitest"
import { TransactionManager } from "./TransactionManager"
import { TransactionStore } from "./TransactionStore"
import type { PendingMutation, MutationStrategy } from "./types"
import "fake-indexeddb/auto"
import { Collection } from "./collection"

describe(`TransactionManager`, () => {
  let store: TransactionStore
  let collection: Collection
  let manager: TransactionManager

  beforeEach(() => {
    // Reset indexedDB for each test using the fake-indexeddb implementation
    store = new TransactionStore()
    collection = new Collection({
      sync: {
        id: `mock`,
        sync: () => {},
      },
      mutationFn: {
        persist: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1))
        },
      },
    })
    manager = new TransactionManager(store, collection)
    store.clearAll()
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
    state: `created`,
  })

  const orderedStrategy: MutationStrategy = {
    type: `ordered`,
  }

  const parallelStrategy: MutationStrategy = {
    type: `parallel`,
  }

  describe(`Basic Transaction Management`, () => {
    it(`should create a transaction in pending state`, () => {
      const mutations = [createMockMutation(`test-1`)]
      const transaction = manager.applyTransaction(mutations, orderedStrategy)

      expect(transaction.id).toBeDefined()
      expect(transaction.state).toBe(`persisting`)
      expect(transaction.mutations).toEqual(mutations)
      expect(transaction.attempts).toEqual([])
      expect(transaction.currentAttempt).toBe(0)
    })

    it(`should update transaction state`, () => {
      const mutations = [createMockMutation(`test-2`)]
      const transaction = manager.applyTransaction(mutations, orderedStrategy)

      // Add a small delay to ensure timestamps are different
      const beforeUpdate = transaction.updatedAt
      manager.setTransactionState(transaction.id, `persisting`)

      const updated = manager.getTransaction(transaction.id)
      expect(updated?.state).toBe(`persisting`)
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

  describe(`Retry Scheduling`, () => {
    it(`should schedule retry with exponential backoff`, () => {
      const mutations = [createMockMutation(`test-3`)]
      const transaction = manager.applyTransaction(mutations, orderedStrategy)

      const now = Date.now()
      const originalNow = Date.now
      Date.now = vi.fn(() => now)

      manager.scheduleRetry(transaction.id, 0) // First retry

      const updated = manager.getTransaction(transaction.id)
      const attempt = updated?.attempts[0]

      expect(attempt?.id).toBeDefined()
      expect(attempt?.startedAt).toBeDefined()
      expect(attempt?.retryScheduledFor).toBeDefined()

      // Should be between 1-1.3 seconds for first retry (with jitter)
      const delay = attempt!.retryScheduledFor.getTime() - now
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThanOrEqual(1300)

      Date.now = originalNow
    })

    it(`should increase delay with each retry attempt`, () => {
      const mutations = [createMockMutation(`test-4`)]
      const transaction = manager.applyTransaction(mutations, orderedStrategy)

      const now = Date.now()
      const originalNow = Date.now
      Date.now = vi.fn(() => now)

      // Test first 3 retries
      const delays: number[] = []

      for (let i = 0; i < 3; i++) {
        manager.scheduleRetry(transaction.id, i)
        const updated = manager.getTransaction(transaction.id)
        const attempt = updated?.attempts[i]
        delays.push(attempt!.retryScheduledFor.getTime() - now)
      }

      // Each delay should be at least double the previous one
      // (even with max jitter, 2x - 30% will be > 1.4x)
      expect(delays[1]).toBeGreaterThan(delays[0] * 1.4)
      expect(delays[2]).toBeGreaterThan(delays[1] * 1.4)

      // Verify each delay has expected bounds
      expect(delays[0]).toBeGreaterThanOrEqual(1000) // 1s base
      expect(delays[0]).toBeLessThanOrEqual(1300) // 1s + 30% jitter
      expect(delays[1]).toBeGreaterThanOrEqual(2000) // 2s base
      expect(delays[1]).toBeLessThanOrEqual(2600) // 2s + 30% jitter
      expect(delays[2]).toBeGreaterThanOrEqual(4000) // 4s base
      expect(delays[2]).toBeLessThanOrEqual(5200) // 4s + 30% jitter

      Date.now = originalNow
    })
  })

  describe(`Ordered vs Parallel Transactions`, () => {
    it(`should queue ordered transactions with overlapping mutations`, () => {
      // Create first transaction modifying object 1
      const tx1 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        orderedStrategy
      )
      expect(tx1.state).toBe(`persisting`)
      expect(tx1.queuedBehind).toBeUndefined()

      // Create second transaction also modifying object 1 - should be queued
      const tx2 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        orderedStrategy
      )
      expect(tx2.state).toBe(`queued`)
      expect(tx2.queuedBehind).toBe(tx1.id)

      // Create third transaction modifying different object - should not be queued
      const tx3 = manager.applyTransaction(
        [createMockMutation(`object-2`)],
        orderedStrategy
      )
      expect(tx3.state).toBe(`persisting`)
      expect(tx3.queuedBehind).toBeUndefined()

      // Complete first transaction
      manager.setTransactionState(tx1.id, `completed`)

      // Check that second transaction is now pending
      const updatedTx2 = manager.getTransaction(tx2.id)!
      expect(updatedTx2.state).toBe(`persisting`)
    })

    it(`should not queue parallel transactions`, () => {
      // Create multiple parallel transactions modifying same object
      const tx1 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        parallelStrategy
      )
      const tx2 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        parallelStrategy
      )
      const tx3 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        parallelStrategy
      )

      // All should be in pending state and not queued
      expect(tx1.state).toBe(`pending`)
      expect(tx1.queuedBehind).toBeUndefined()
      expect(tx2.state).toBe(`pending`)
      expect(tx2.queuedBehind).toBeUndefined()
      expect(tx3.state).toBe(`pending`)
      expect(tx3.queuedBehind).toBeUndefined()
    })

    it(`should mix ordered and parallel transactions correctly`, () => {
      // Create an ordered transaction modifying object 1
      const ordered1 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        orderedStrategy
      )

      // Create a parallel transaction modifying object 1 - should not queue
      const parallel1 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        parallelStrategy
      )

      // Create another ordered transaction modifying object 1 - should queue behind ordered1
      const ordered2 = manager.applyTransaction(
        [createMockMutation(`object-1`)],
        orderedStrategy
      )

      expect(ordered1.state).toBe(`persisting`)
      expect(ordered1.queuedBehind).toBeUndefined()
      expect(parallel1.state).toBe(`pending`)
      expect(parallel1.queuedBehind).toBeUndefined()
      expect(ordered2.state).toBe(`queued`)
      expect(ordered2.queuedBehind).toBe(ordered1.id)

      // Complete ordered1, ordered2 should become pending
      manager.setTransactionState(ordered1.id, `completed`)

      const updatedOrdered2 = manager.getTransaction(ordered2.id)!
      expect(updatedOrdered2.state).toBe(`persisting`)
      expect(updatedOrdered2.queuedBehind).toBeUndefined()
    })
  })

  describe(`Transaction Ordering`, () => {
    it(`should maintain transactions sorted by createdAt`, async () => {
      // Create transactions with different timestamps
      const now = Date.now()
      const timestamps = [now, now - 1000, now - 2000]

      // Create transactions in reverse chronological order
      await Promise.all(
        timestamps.map(async (timestamp, i) => {
          const tx = manager.applyTransaction(
            [createMockMutation(`test-${i + 1}`)],
            parallelStrategy
          )
          // Force the createdAt time
          const updatedTx = {
            ...tx.toObject(),
            createdAt: new Date(timestamp),
          }
          manager.transactions.setState((sortedMap) => {
            sortedMap.set(updatedTx.id, updatedTx)
            return sortedMap
          })
          return updatedTx
        })
      )

      // Verify transactions are returned in chronological order (oldest first)
      const sortedTransactions = Array.from(manager.transactions.state.values())
      expect(sortedTransactions[0].createdAt.getTime()).toBe(timestamps[2]) // Oldest
      expect(sortedTransactions[1].createdAt.getTime()).toBe(timestamps[1])
      expect(sortedTransactions[2].createdAt.getTime()).toBe(timestamps[0]) // Newest
    })

    it(`should create a new transaction when no existing transactions with overlapping keys exist`, () => {
      // Create a new transaction
      const mutations = [createMockMutation(`test-apply-1`)]
      const transaction = manager.applyTransaction(mutations, orderedStrategy)

      // Verify transaction was created with the expected properties
      expect(transaction.id).toBeDefined()
      expect(transaction.state).toBe(`persisting`)
      expect(transaction.mutations).toEqual(mutations)
      expect(transaction.attempts).toEqual([])
      expect(transaction.currentAttempt).toBe(0)
    })

    it(`should overwrite mutations for the same key in existing pending transactions`, () => {
      // Create first transaction with a mutation
      const originalMutation = {
        ...createMockMutation(`test-apply-2`),
        modified: { id: `test-apply-2`, value: `original-value` },
        changes: { value: `original-value` },
      }

      manager.applyTransaction([originalMutation], orderedStrategy)

      // Create second transaction with a mutation - this should be queued behind the first.
      const tx1 = manager.applyTransaction([originalMutation], orderedStrategy)
      expect(tx1.mutations[0].modified.value).toBe(`original-value`)

      // Apply a new transaction with a mutation for the same key but different value.
      const newMutation = {
        ...createMockMutation(`test-apply-2`),
        modified: { id: `test-apply-2`, value: `updated-value` },
        changes: { value: `updated-value` },
      }

      const tx2 = manager.applyTransaction([newMutation], orderedStrategy)

      // Should reuse the same transaction ID
      expect(tx2.id).toBe(tx1.id)

      // Should have updated the mutation
      expect(tx2.mutations.length).toBe(1)
      expect(tx2.mutations[0].modified.value).toBe(`updated-value`)
      expect(tx2.mutations[0].changes.value).toBe(`updated-value`)
    })

    it(`should add new mutations while preserving existing ones for different keys`, () => {
      // Create first transaction with a mutation
      const mutation1 = createMockMutation(`test-apply-3a`)
      const tx1 = manager.applyTransaction([mutation1], orderedStrategy)

      // Apply a new transaction with a mutation for a different key
      const mutation2 = createMockMutation(`test-apply-3b`)
      const tx2 = manager.applyTransaction([mutation2], orderedStrategy)

      // Should create a new transaction since keys don't overlap
      expect(tx2.id).not.toBe(tx1.id)
      expect(tx2.mutations.length).toBe(1)
      expect(tx2.mutations[0].key).toBe(`test-apply-3b`)
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
      manager.applyTransaction([mutationA1, mutationB1], orderedStrategy)
      const tx1 = manager.applyTransaction(
        [mutationA1, mutationB1],
        orderedStrategy
      )

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
      const tx2 = manager.applyTransaction(
        [mutationB2, mutationC1],
        orderedStrategy
      )

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
      const tx1 = manager.applyTransaction(
        [createMockMutation(`key-1`)],
        orderedStrategy
      )
      const tx2 = manager.applyTransaction(
        [createMockMutation(`key-2`)],
        orderedStrategy
      )

      // Apply a transaction with a new non-overlapping key
      const tx3 = manager.applyTransaction(
        [createMockMutation(`key-3`)],
        orderedStrategy
      )

      // Should be a new transaction
      expect(tx3.id).not.toBe(tx1.id)
      expect(tx3.id).not.toBe(tx2.id)
      expect(tx3.mutations.length).toBe(1)
      expect(tx3.mutations[0].key).toBe(`key-3`)

      // Original transactions should be unchanged
      const updatedTx1 = manager.getTransaction(tx1.id)
      const updatedTx2 = manager.getTransaction(tx2.id)

      expect(updatedTx1?.mutations.length).toBe(1)
      expect(updatedTx1?.mutations[0].key).toBe(`key-1`)

      expect(updatedTx2?.mutations.length).toBe(1)
      expect(updatedTx2?.mutations[0].key).toBe(`key-2`)
    })

    it(`should only consider active transactions for applying updates`, () => {
      // Create a transaction and mark it as completed
      const mutation1 = createMockMutation(`completed-key`)
      const tx1 = manager.applyTransaction([mutation1], orderedStrategy)
      manager.setTransactionState(tx1.id, `completed`)

      // Apply a new transaction with the same key
      const mutation2 = {
        ...createMockMutation(`completed-key`),
        modified: { id: `completed-key`, value: `new-value` },
        changes: { value: `new-value` },
      }

      const tx2 = manager.applyTransaction([mutation2], orderedStrategy)

      // Should create a new transaction since the existing one is completed
      expect(tx2.id).not.toBe(tx1.id)
      expect(tx2.mutations.length).toBe(1)
      expect(tx2.mutations[0].modified.value).toBe(`new-value`)
    })
  })

  describe(`Error Handling`, () => {
    it(`should reject both isPersisted and isSynced promises when persist fails`, async () => {
      // Create a collection with a persist function that throws an error
      const errorCollection = new Collection({
        id: `foo`,
        sync: {
          sync: () => {},
        },
        mutationFn: {
          persist: async () => {
            throw new Error(`Persist error affecting both promises`)
          },
          // Add awaitSync to ensure isSynced is initialized
          awaitSync: async () => {},
        },
      })
      const errorManager = new TransactionManager(store, errorCollection)

      // Apply a transaction
      const mutations = [createMockMutation(`error-test-5`)]
      const transaction = errorManager.applyTransaction(
        mutations,
        orderedStrategy
      )

      await expect(transaction.isPersisted?.promise).rejects.toThrow(
        `Persist error affecting both promises`
      )
      await expect(transaction.isSynced?.promise).rejects.toThrow(
        `Persist error affecting both promises`
      )

      // Verify the transaction state
      expect(transaction?.state).toBe(`failed`)
      expect(transaction?.error?.message).toBe(
        `Persist error affecting both promises`
      )
    })

    it(`should reject the isSynced promise when awaitSync fails`, async () => {
      // Create a collection with an awaitSync function that throws an error
      const syncErrorCollection = new Collection({
        id: `failing-sync`,
        sync: {
          sync: () => {},
        },
        mutationFn: {
          persist: async () => {
            return Promise.resolve()
          },
          awaitSync: async () => {
            return Promise.reject(new Error(`Sync promise error`))
          },
        },
      })
      const syncErrorManager = new TransactionManager(
        store,
        syncErrorCollection
      )

      // Apply a transaction
      const mutations = [createMockMutation(`error-test-4`)]
      const transaction = syncErrorManager.applyTransaction(
        mutations,
        orderedStrategy
      )

      await expect(transaction.isSynced?.promise).rejects.toThrow(
        `Sync promise error`
      )

      // Verify the transaction state
      expect(transaction?.state).toBe(`failed`)
      expect(transaction?.error?.message).toBe(`Sync promise error`)
    })
  })

  describe(`Terminal State Handling`, () => {
    it(`should delete transactions from IndexedDB when they reach a terminal state`, async () => {
      // Clear all existing transactions first
      await store.clearAll()

      // Create a transaction
      const tx = manager.applyTransaction(
        [createMockMutation(`test-object`)],
        parallelStrategy
      )

      // Verify transaction exists in IndexedDB
      let transactions = await store.getTransactions()
      expect(transactions.length).toBe(1)
      expect(transactions[0].id).toBe(tx.id)

      // Update to 'completed' state (terminal)
      manager.setTransactionState(tx.id, `completed`)

      // Verify transaction is deleted from IndexedDB
      transactions = await store.getTransactions()
      expect(transactions.length).toBe(0)

      // Create another transaction
      const tx2 = manager.applyTransaction(
        [createMockMutation(`test-object-2`)],
        parallelStrategy
      )

      // Verify transaction exists in IndexedDB
      transactions = await store.getTransactions()
      expect(transactions.length).toBe(1)
      expect(transactions[0].id).toBe(tx2.id)

      // Update to 'failed' state (terminal)
      manager.setTransactionState(tx2.id, `failed`)

      // Verify transaction is deleted from IndexedDB
      transactions = await store.getTransactions()
      expect(transactions.length).toBe(0)
    })
  })
})
