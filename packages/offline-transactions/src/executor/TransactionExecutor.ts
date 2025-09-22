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
  private offlineExecutor: any // Reference to OfflineExecutor for signaling
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    scheduler: KeyScheduler,
    outbox: OutboxManager,
    config: OfflineConfig,
    offlineExecutor: any
  ) {
    this.scheduler = scheduler
    this.outbox = outbox
    this.config = config
    this.retryPolicy = new DefaultRetryPolicy(10, config.jitter ?? true)
    this.offlineExecutor = offlineExecutor
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

    // Schedule next retry after execution completes
    this.scheduleNextRetry()
  }

  private async executeTransaction(
    transaction: OfflineTransaction
  ): Promise<void> {
    this.scheduler.markStarted(transaction)

    try {
      const result = await this.runMutationFn(transaction)

      this.scheduler.markCompleted(transaction)
      await this.outbox.remove(transaction.id)

      // Signal success to the waiting transaction
      this.offlineExecutor.resolveTransaction(transaction.id, result)
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

    // Mutations are already PendingMutation objects with collections attached
    // from the deserializer, so we can use them directly
    const transactionWithMutations = {
      id: transaction.id,
      mutations: transaction.mutations,
      metadata: transaction.metadata ?? {},
    }

    await mutationFn({
      transaction: transactionWithMutations as any,
      idempotencyKey: transaction.idempotencyKey,
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

      // Signal permanent failure to the waiting transaction
      this.offlineExecutor.rejectTransaction(transaction.id, error)
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

    // Schedule retry timer
    this.scheduleNextRetry()
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

    // Reset retry delays for all loaded transactions so they can run immediately
    this.resetRetryDelays()

    // Schedule retry timer for loaded transactions
    this.scheduleNextRetry()

    const removedTransactions = transactions.filter(
      (tx) => !filteredTransactions.some((filtered) => filtered.id === tx.id)
    )

    if (removedTransactions.length > 0) {
      await this.outbox.removeMany(removedTransactions.map((tx) => tx.id))
    }
  }

  clear(): void {
    this.scheduler.clear()
    this.clearRetryTimer()
  }

  getPendingCount(): number {
    return this.scheduler.getPendingCount()
  }

  private scheduleNextRetry(): void {
    // Clear existing timer
    this.clearRetryTimer()

    // Find the earliest retry time among pending transactions
    const earliestRetryTime = this.getEarliestRetryTime()

    if (earliestRetryTime === null) {
      return // No transactions pending retry
    }

    const delay = Math.max(0, earliestRetryTime - Date.now())

    this.retryTimer = setTimeout(() => {
      this.executeAll().catch((error) => {
        console.warn(`Failed to execute retry batch:`, error)
      })
    }, delay)
  }

  private getEarliestRetryTime(): number | null {
    const allTransactions = this.scheduler.getAllPendingTransactions()

    if (allTransactions.length === 0) {
      return null
    }

    return Math.min(...allTransactions.map((tx) => tx.nextAttemptAt))
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  getRunningCount(): number {
    return this.scheduler.getRunningCount()
  }

  resetRetryDelays(): void {
    const allTransactions = this.scheduler.getAllPendingTransactions()
    const updatedTransactions = allTransactions.map((transaction) => ({
      ...transaction,
      nextAttemptAt: Date.now(),
    }))

    this.scheduler.updateTransactions(updatedTransactions)
  }
}
