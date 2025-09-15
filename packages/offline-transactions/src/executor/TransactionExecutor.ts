import { DefaultRetryPolicy } from "../retry/RetryPolicy"
import { NonRetriableError } from "../types"
import type { KeyScheduler } from "./KeyScheduler"
import type { OutboxManager } from "../outbox/OutboxManager"
import type { OfflineConfig, OfflineTransaction } from "../types"

export class TransactionExecutor {
  private scheduler: KeyScheduler
  private outbox: OutboxManager
  private config: OfflineConfig
  private retryPolicy: DefaultRetryPolicy
  private isExecuting = false
  private executionPromise: Promise<void> | null = null

  constructor(
    scheduler: KeyScheduler,
    outbox: OutboxManager,
    config: OfflineConfig
  ) {
    this.scheduler = scheduler
    this.outbox = outbox
    this.config = config
    this.retryPolicy = new DefaultRetryPolicy(10, config.jitter ?? true)
  }

  async execute(transaction: OfflineTransaction): Promise<void> {
    this.scheduler.schedule(transaction)
    await this.executeAll()
  }

  async executeAll(): Promise<void> {
    if (this.isExecuting) {
      return this.executionPromise!
    }

    this.isExecuting = true
    this.executionPromise = this.runExecution()

    try {
      await this.executionPromise
    } finally {
      this.isExecuting = false
      this.executionPromise = null
    }
  }

  private async runExecution(): Promise<void> {
    const maxConcurrency = this.config.maxConcurrency ?? 3

    while (this.scheduler.getPendingCount() > 0) {
      const batch = this.scheduler.getNextBatch(maxConcurrency)

      if (batch.length === 0) {
        break
      }

      const executions = batch.map((transaction) =>
        this.executeTransaction(transaction)
      )
      await Promise.allSettled(executions)
    }
  }

  private async executeTransaction(
    transaction: OfflineTransaction
  ): Promise<void> {
    this.scheduler.markStarted(transaction)

    try {
      await this.runMutationFn(transaction)

      this.scheduler.markCompleted(transaction)
      await this.outbox.remove(transaction.id)
    } catch (error) {
      await this.handleError(transaction, error as Error)
    }
  }

  private async runMutationFn(transaction: OfflineTransaction): Promise<void> {
    const mutationFn = this.config.mutationFns[transaction.mutationFnName]

    if (!mutationFn) {
      const errorMessage = `Unknown mutation function: ${transaction.mutationFnName}`

      if (this.config.onUnknownMutationFn) {
        this.config.onUnknownMutationFn(transaction.mutationFnName, transaction)
      }

      throw new NonRetriableError(errorMessage)
    }

    const reconstructedMutations = this.reconstructMutations(transaction)

    const transactionWithMutations = {
      id: transaction.id,
      mutations: reconstructedMutations,
      metadata: transaction.metadata ?? {},
    }

    await mutationFn({
      transaction: transactionWithMutations as any,
      idempotencyKey: transaction.idempotencyKey,
    })
  }

  private reconstructMutations(transaction: OfflineTransaction): Array<any> {
    return transaction.mutations.map((mutation) => {
      const collectionId = (mutation as any).collectionId
      const collection = this.config.collections[collectionId]

      if (!collection) {
        throw new NonRetriableError(`Collection ${collectionId} not found`)
      }

      return {
        ...mutation,
        collection,
      }
    })
  }

  private async handleError(
    transaction: OfflineTransaction,
    error: Error
  ): Promise<void> {
    const shouldRetry = this.retryPolicy.shouldRetry(
      error,
      transaction.retryCount
    )

    if (!shouldRetry) {
      this.scheduler.markCompleted(transaction)
      await this.outbox.remove(transaction.id)
      console.warn(`Transaction ${transaction.id} failed permanently:`, error)
      return
    }

    const delay = this.retryPolicy.calculateDelay(transaction.retryCount)
    const updatedTransaction: OfflineTransaction = {
      ...transaction,
      retryCount: transaction.retryCount + 1,
      nextAttemptAt: Date.now() + delay,
      lastError: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    }

    this.scheduler.markFailed(transaction)
    this.scheduler.updateTransaction(updatedTransaction)
    await this.outbox.update(transaction.id, updatedTransaction)
  }

  async loadPendingTransactions(): Promise<void> {
    const transactions = await this.outbox.getAll()
    let filteredTransactions = transactions

    if (this.config.beforeRetry) {
      filteredTransactions = this.config.beforeRetry(transactions)
    }

    for (const transaction of filteredTransactions) {
      this.scheduler.schedule(transaction)
    }

    const removedTransactions = transactions.filter(
      (tx) => !filteredTransactions.some((filtered) => filtered.id === tx.id)
    )

    if (removedTransactions.length > 0) {
      await this.outbox.removeMany(removedTransactions.map((tx) => tx.id))
    }
  }

  clear(): void {
    this.scheduler.clear()
  }

  getPendingCount(): number {
    return this.scheduler.getPendingCount()
  }

  getRunningCount(): number {
    return this.scheduler.getRunningCount()
  }
}
