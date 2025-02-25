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
        persist: async () => {},
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
      const transaction = manager.createTransaction(mutations, orderedStrategy)

      expect(transaction.id).toBeDefined()
      expect(transaction.state).toBe(`persisting`)
      expect(transaction.mutations).toEqual(mutations)
      expect(transaction.attempts).toEqual([])
      expect(transaction.currentAttempt).toBe(0)
    })

    it(`should update transaction state`, () => {
      const mutations = [createMockMutation(`test-2`)]
      const transaction = manager.createTransaction(mutations, orderedStrategy)

      // Add a small delay to ensure timestamps are different
      const beforeUpdate = transaction.updatedAt
      manager.updateTransactionState(transaction.id, `persisting`)

      const updated = manager.getTransaction(transaction.id)
      expect(updated?.state).toBe(`persisting`)
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(
        beforeUpdate.getTime()
      )
    })

    it(`should throw when updating non-existent transaction`, () => {
      expect(() =>
        manager.updateTransactionState(`non-existent`, `completed`)
      ).toThrow(`Transaction non-existent not found`)
    })
  })

  describe(`Retry Scheduling`, () => {
    it(`should schedule retry with exponential backoff`, () => {
      const mutations = [createMockMutation(`test-3`)]
      const transaction = manager.createTransaction(mutations, orderedStrategy)

      const now = Date.now()
      const originalNow = Date.now
      Date.now = vi.fn(() => now)

      manager.scheduleRetry(transaction.id, 0) // First retry

      const updated = manager.getTransaction(transaction.id)
      const attempt = updated?.attempts[0]

      expect(attempt?.id).toBeDefined()
      expect(attempt?.started_at).toBeDefined()
      expect(attempt?.retry_scheduled_for).toBeDefined()

      // Should be between 1-1.3 seconds for first retry (with jitter)
      const delay = attempt!.retry_scheduled_for.getTime() - now
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThanOrEqual(1300)

      Date.now = originalNow
    })

    it(`should increase delay with each retry attempt`, () => {
      const mutations = [createMockMutation(`test-4`)]
      const transaction = manager.createTransaction(mutations, orderedStrategy)

      const now = Date.now()
      const originalNow = Date.now
      Date.now = vi.fn(() => now)

      // Test first 3 retries
      const delays: number[] = []

      for (let i = 0; i < 3; i++) {
        manager.scheduleRetry(transaction.id, i)
        const updated = manager.getTransaction(transaction.id)
        const attempt = updated?.attempts[i]
        delays.push(attempt!.retry_scheduled_for.getTime() - now)
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
      const tx1 = manager.createTransaction(
        [createMockMutation(`object-1`)],
        orderedStrategy
      )
      expect(tx1.state).toBe(`persisting`)
      expect(tx1.queuedBehind).toBeUndefined()

      // Create second transaction also modifying object 1 - should be queued
      const tx2 = manager.createTransaction(
        [createMockMutation(`object-1`)],
        orderedStrategy
      )
      expect(tx2.state).toBe(`queued`)
      expect(tx2.queuedBehind).toBe(tx1.id)

      // Create third transaction modifying different object - should not be queued
      const tx3 = manager.createTransaction(
        [createMockMutation(`object-2`)],
        orderedStrategy
      )
      expect(tx3.state).toBe(`persisting`)
      expect(tx3.queuedBehind).toBeUndefined()

      // Complete first transaction
      manager.updateTransactionState(tx1.id, `completed`)

      // Check that second transaction is now pending
      const updatedTx2 = manager.getTransaction(tx2.id)!
      expect(updatedTx2.state).toBe(`persisting`)
    })

    it(`should not queue parallel transactions`, () => {
      // Create multiple parallel transactions modifying same object
      const tx1 = manager.createTransaction(
        [createMockMutation(`object-1`)],
        parallelStrategy
      )
      const tx2 = manager.createTransaction(
        [createMockMutation(`object-1`)],
        parallelStrategy
      )
      const tx3 = manager.createTransaction(
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
      const ordered1 = manager.createTransaction(
        [createMockMutation(`object-1`)],
        orderedStrategy
      )

      // Create a parallel transaction modifying object 1 - should not queue
      const parallel1 = manager.createTransaction(
        [createMockMutation(`object-1`)],
        parallelStrategy
      )

      // Create another ordered transaction modifying object 1 - should queue behind ordered1
      const ordered2 = manager.createTransaction(
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
      manager.updateTransactionState(ordered1.id, `completed`)

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
          const tx = manager.createTransaction(
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
  })
})
