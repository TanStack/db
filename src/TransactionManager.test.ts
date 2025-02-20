import { describe, it, expect, beforeEach } from 'vitest'
import { TransactionManager } from './TransactionManager'
import { TransactionStore } from './TransactionStore'
import type { PendingMutation, MutationStrategy } from './types'
import 'fake-indexeddb/auto'

describe('TransactionManager', () => {
  let store: TransactionStore
  let manager: TransactionManager

  beforeEach(async () => {
    // Reset indexedDB for each test
    indexedDB = new IDBFactory()
    store = new TransactionStore()
    manager = new TransactionManager(store)
    await store.clearAll()
  })

  const createMockMutation = (id: string): PendingMutation => ({
    mutationId: id,
    original: { id, value: 'original' },
    modified: { id, value: 'modified' },
    changes: { value: 'modified' },
    metadata: null,
    created_at: new Date(),
    updated_at: new Date(),
    state: 'created'
  })

  const orderedStrategy: MutationStrategy = {
    type: 'ordered'
  }

  const parallelStrategy: MutationStrategy = {
    type: 'parallel'
  }

  describe('Basic Transaction Management', () => {
    it('should create a transaction in pending state', async () => {
      const mutations = [createMockMutation('test-1')]
      const transaction = await manager.createTransaction(mutations, orderedStrategy)

      expect(transaction.id).toBeDefined()
      expect(transaction.state).toBe('pending')
      expect(transaction.mutations).toEqual(mutations)
      expect(transaction.attempts).toEqual([])
      expect(transaction.current_attempt).toBe(0)
      
      // Verify it was stored
      const stored = await store.getTransactions()
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe(transaction.id)
    })

    it('should update transaction state', async () => {
      const mutations = [createMockMutation('test-2')]
      const transaction = await manager.createTransaction(mutations, orderedStrategy)
      
      // Add a small delay to ensure timestamps are different
      await new Promise(resolve => setTimeout(resolve, 1))
      await manager.updateTransactionState(transaction.id, 'persisting')
      
      const stored = await store.getTransactions()
      expect(stored[0].state).toBe('persisting')
      expect(stored[0].updated_at.getTime()).toBeGreaterThan(transaction.updated_at.getTime())
    })

    it('should throw when updating non-existent transaction', async () => {
      await expect(manager.updateTransactionState('non-existent', 'completed'))
        .rejects.toThrow('Transaction non-existent not found')
    })
  })

  describe('Retry Scheduling', () => {
    it('should schedule retry with exponential backoff', async () => {
      const mutations = [createMockMutation('test-3')]
      const transaction = await manager.createTransaction(mutations, orderedStrategy)
      
      const now = Date.now()
      const originalNow = Date.now
      Date.now = vi.fn(() => now)

      await manager.scheduleRetry(transaction.id, 0) // First retry
      
      const stored = await store.getTransactions()
      const attempt = stored[0].attempts[0]
      
      expect(attempt.id).toBeDefined()
      expect(attempt.started_at).toBeDefined()
      expect(attempt.retry_scheduled_for).toBeDefined()
      
      // Should be between 1-1.3 seconds for first retry (with jitter)
      const delay = attempt.retry_scheduled_for.getTime() - now
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThanOrEqual(1300)
      
      Date.now = originalNow
    })

    it('should increase delay with each retry attempt', async () => {
      const mutations = [createMockMutation('test-4')]
      const transaction = await manager.createTransaction(mutations, orderedStrategy)
      
      const now = Date.now()
      const originalNow = Date.now
      Date.now = vi.fn(() => now)

      // Test first 3 retries
      const delays: number[] = []
      
      for (let i = 0; i < 3; i++) {
        await manager.scheduleRetry(transaction.id, i)
        const stored = await store.getTransactions()
        const attempt = stored[0].attempts[i]
        delays.push(attempt.retry_scheduled_for.getTime() - now)
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

  describe('Ordered vs Parallel Transactions', () => {
    it('should queue ordered transactions with overlapping mutations', async () => {
      // Create first transaction modifying object 1
      const tx1 = await manager.createTransaction(
        [createMockMutation('object-1')],
        orderedStrategy
      )
      expect(tx1.state).toBe('pending')
      expect(tx1.queued_behind).toBeUndefined()

      // Create second transaction also modifying object 1 - should be queued
      const tx2 = await manager.createTransaction(
        [createMockMutation('object-1')],
        orderedStrategy
      )
      expect(tx2.state).toBe('queued')
      expect(tx2.queued_behind).toBe(tx1.id)

      // Create third transaction modifying different object - should not be queued
      const tx3 = await manager.createTransaction(
        [createMockMutation('object-2')],
        orderedStrategy
      )
      expect(tx3.state).toBe('pending')
      expect(tx3.queued_behind).toBeUndefined()

      // Complete first transaction
      await manager.updateTransactionState(tx1.id, 'completed')

      // Check that second transaction is now pending
      const updated = await store.getTransactions()
      const updatedTx2 = updated.find(t => t.id === tx2.id)!
      expect(updatedTx2.state).toBe('pending')
    })

    it('should not queue parallel transactions', async () => {
      // Create multiple parallel transactions modifying same object
      const tx1 = await manager.createTransaction(
        [createMockMutation('object-1')],
        parallelStrategy
      )
      const tx2 = await manager.createTransaction(
        [createMockMutation('object-1')],
        parallelStrategy
      )
      const tx3 = await manager.createTransaction(
        [createMockMutation('object-1')],
        parallelStrategy
      )

      // All should be in pending state and not queued
      expect(tx1.state).toBe('pending')
      expect(tx1.queued_behind).toBeUndefined()
      expect(tx2.state).toBe('pending')
      expect(tx2.queued_behind).toBeUndefined()
      expect(tx3.state).toBe('pending')
      expect(tx3.queued_behind).toBeUndefined()
    })

    it('should mix ordered and parallel transactions correctly', async () => {
      // Create an ordered transaction modifying object 1
      const ordered1 = await manager.createTransaction(
        [createMockMutation('object-1')],
        orderedStrategy
      )
      
      // Create a parallel transaction modifying object 1 - should not queue
      const parallel1 = await manager.createTransaction(
        [createMockMutation('object-1')],
        parallelStrategy
      )
      
      // Create another ordered transaction modifying object 1 - should queue
      const ordered2 = await manager.createTransaction(
        [createMockMutation('object-1')],
        orderedStrategy
      )
      
      // Create another ordered transaction modifying object 2 - should not queue
      const ordered3 = await manager.createTransaction(
        [createMockMutation('object-2')],
        orderedStrategy
      )

      expect(ordered1.state).toBe('pending')
      expect(ordered1.queued_behind).toBeUndefined()
      expect(parallel1.state).toBe('pending')
      expect(parallel1.queued_behind).toBeUndefined()
      expect(ordered2.state).toBe('queued')
      expect(ordered2.queued_behind).toBe(ordered1.id)
      expect(ordered3.state).toBe('pending')
      expect(ordered3.queued_behind).toBeUndefined()
    })
  })
})
