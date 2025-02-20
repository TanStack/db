import type { Transaction, TransactionState, PendingMutation, MutationStrategy } from './types'
import { TransactionStore } from './TransactionStore'

export class TransactionManager {
  private store: TransactionStore

  constructor(store: TransactionStore) {
    this.store = store
  }

  async createTransaction(mutations: PendingMutation[], strategy: MutationStrategy): Promise<Transaction> {
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      state: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      mutations,
      attempts: [],
      current_attempt: 0,
      strategy
    }

    await this.store.putTransaction(transaction)
    return transaction
  }

  async updateTransactionState(id: string, newState: TransactionState): Promise<void> {
    const transaction = await this.getTransaction(id)
    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    const updatedTransaction: Transaction = {
      ...transaction,
      state: newState,
      updated_at: new Date()
    }

    await this.store.putTransaction(updatedTransaction)
  }

  async scheduleRetry(id: string, attemptNumber: number): Promise<void> {
    const transaction = await this.getTransaction(id)
    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    // Exponential backoff with jitter
    // Base delay is 1 second, max delay is 30 seconds
    const baseDelay = 1000
    const maxDelay = 30000
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay)
    
    // Add jitter after calculating the exponential delay
    const minDelay = exponentialDelay
    const maxJitteredDelay = exponentialDelay * 1.3 // 30% jitter
    const delay = minDelay + Math.random() * (maxJitteredDelay - minDelay)

    const retryTime = new Date(Date.now() + delay)

    const attempt = {
      id: crypto.randomUUID(),
      started_at: new Date(),
      retry_scheduled_for: retryTime
    }

    const updatedTransaction: Transaction = {
      ...transaction,
      attempts: [...transaction.attempts, attempt],
      current_attempt: transaction.current_attempt + 1,
      updated_at: new Date()
    }

    await this.store.putTransaction(updatedTransaction)
  }

  private async getTransaction(id: string): Promise<Transaction | undefined> {
    const transactions = await this.store.getTransactions()
    return transactions.find(tx => tx.id === id)
  }
}
