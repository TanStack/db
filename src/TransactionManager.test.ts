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

  const mockStrategy: MutationStrategy = {
    type: 'ordered'
  }

  it('should create a transaction in pending state', async () => {
    const mutations = [createMockMutation('test-1')]
    const transaction = await manager.createTransaction(mutations, mockStrategy)

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
    const transaction = await manager.createTransaction(mutations, mockStrategy)
    
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

  it('should schedule retry with exponential backoff', async () => {
    const mutations = [createMockMutation('test-3')]
    const transaction = await manager.createTransaction(mutations, mockStrategy)
    
    // Mock Date.now() to have consistent test results
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
    
    // Cleanup
    Date.now = originalNow
  })

  it('should increase delay with each retry attempt', async () => {
    const mutations = [createMockMutation('test-4')]
    const transaction = await manager.createTransaction(mutations, mockStrategy)
    
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
    
    // Each delay should be roughly double the previous one (accounting for jitter)
    expect(delays[1]).toBeGreaterThan(delays[0] * 1.7) // Allow for jitter
    expect(delays[2]).toBeGreaterThan(delays[1] * 1.7)
    
    Date.now = originalNow
  })
})
