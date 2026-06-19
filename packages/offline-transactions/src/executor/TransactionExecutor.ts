import { DefaultRetryPolicy } from '../retry/RetryPolicy'
import { NonRetriableError } from '../types'
import { withNestedSpan } from '../telemetry/tracer'
import { createOptimisticHold } from './OptimisticHold'
import type { OptimisticHold } from './OptimisticHold'
import type { KeyScheduler } from './KeyScheduler'
import type { OutboxManager } from '../outbox/OutboxManager'
import type {
  OfflineConfig,
  OfflineTransaction,
  TransactionSignaler,
} from '../types'
import type { PendingMutation } from '@tanstack/db'

const HANDLED_EXECUTION_ERROR = Symbol(`HandledExecutionError`)

// Default safety cap for `OfflineConfig.confirmWrite` holds. See the field's
// docs in types.ts: each hold adds O(transactions) recompute cost, so a large,
// fast drain is bounded to avoid O(n^2) churn.
const DEFAULT_MAX_CONFIRMATION_HOLDS = 1000

export class TransactionExecutor {
  private scheduler: KeyScheduler
  private outbox: OutboxManager
  private config: OfflineConfig
  private retryPolicy: DefaultRetryPolicy
  private isExecuting = false
  private executionPromise: Promise<void> | null = null
  private offlineExecutor: TransactionSignaler
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  // Optimistic holds kept alive across the post-commit confirmation window
  // (see `OfflineConfig.confirmWrite`). Tracked so they can all be released on
  // `clear()` (logout / outbox clear / company-switch).
  private confirmationHolds = new Set<OptimisticHold>()

  constructor(
    scheduler: KeyScheduler,
    outbox: OutboxManager,
    config: OfflineConfig,
    offlineExecutor: TransactionSignaler,
  ) {
    this.scheduler = scheduler
    this.outbox = outbox
    this.config = config
    this.retryPolicy = new DefaultRetryPolicy(
      Number.POSITIVE_INFINITY,
      config.jitter ?? true,
    )
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
    while (this.scheduler.getPendingCount() > 0) {
      if (!this.isOnline()) {
        break
      }

      const transaction = this.scheduler.getNext()

      if (!transaction) {
        break
      }

      await this.executeTransaction(transaction)
    }

    // Schedule next retry after execution completes
    this.scheduleNextRetry()
  }

  private async executeTransaction(
    transaction: OfflineTransaction,
  ): Promise<void> {
    try {
      await withNestedSpan(
        `transaction.execute`,
        {
          'transaction.id': transaction.id,
          'transaction.mutationFnName': transaction.mutationFnName,
          'transaction.retryCount': transaction.retryCount,
          'transaction.keyCount': transaction.keys.length,
        },
        async (span) => {
          this.scheduler.markStarted(transaction)

          if (transaction.retryCount > 0) {
            span.setAttribute(`retry.attempt`, transaction.retryCount)
          }

          try {
            const result = await this.runMutationFn(transaction)

            this.scheduler.markCompleted(transaction)
            await this.outbox.remove(transaction.id)

            span.setAttribute(`result`, `success`)
            // Resolve the waiting transaction and, if `confirmWrite` is set, hold
            // its optimistic state until confirmation completes — OFF this serial
            // path, so it never blocks the next transaction below.
            this.resolveWithOptionalConfirmation(transaction, result)
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error))

            span.setAttribute(`result`, `error`)

            await this.handleError(transaction, err)
            ;(err as any)[HANDLED_EXECUTION_ERROR] = true
            throw err
          }
        },
      )
    } catch (error) {
      if (
        error instanceof Error &&
        (error as any)[HANDLED_EXECUTION_ERROR] === true
      ) {
        return
      }

      throw error
    }
  }

  private async runMutationFn(
    transaction: OfflineTransaction,
  ): Promise<unknown> {
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

    // Return the result so it can be surfaced to the waiting transaction and to
    // `confirmWrite` (e.g. a server-assigned txid). Previously this value was
    // awaited and discarded.
    return await mutationFn({
      transaction: transactionWithMutations as any,
      idempotencyKey: transaction.idempotencyKey,
    })
  }

  /**
   * Resolve the waiting transaction, then — if `confirmWrite` is configured —
   * keep its optimistic state painted until confirmation completes.
   *
   * The confirmation runs OFF the serial drain path: this method returns
   * immediately so the executor can move on to the next transaction. The hold is
   * created BEFORE `resolveTransaction` so the optimistic overlay is owned
   * continuously (resolveTransaction drops the original/restoration transaction's
   * overlay; the hold keeps the rows painted across that boundary, no flicker).
   */
  private resolveWithOptionalConfirmation(
    transaction: OfflineTransaction,
    result: unknown,
  ): void {
    const confirmWrite = this.config.confirmWrite

    // No hook, or nothing to hold: behave exactly as before the hook existed.
    if (!confirmWrite || transaction.mutations.length === 0) {
      this.offlineExecutor.resolveTransaction(transaction.id, result)
      return
    }

    const maxHolds =
      this.config.maxConfirmationHolds ?? DEFAULT_MAX_CONFIRMATION_HOLDS
    if (this.confirmationHolds.size >= maxHolds) {
      // Safety valve: too many concurrent holds. Skip the hold — the optimistic
      // overlay drops at resolve as it would without the hook. The write is
      // already durably committed, so correctness is unaffected.
      this.offlineExecutor.resolveTransaction(transaction.id, result)
      return
    }

    const hold = this.createConfirmationHold(transaction.mutations)
    this.offlineExecutor.resolveTransaction(transaction.id, result)

    if (!hold) {
      // Hold creation failed (already logged). The write is committed; just let
      // the optimistic state drop as it did before the hook existed.
      return
    }

    this.runConfirmation(confirmWrite, transaction, result, hold)
  }

  // Never throws: a throw here would propagate into the serial drain and make
  // the executor treat an already-committed write as failed.
  private createConfirmationHold(
    mutations: Array<PendingMutation>,
  ): OptimisticHold | null {
    try {
      const hold = createOptimisticHold(mutations)
      this.confirmationHolds.add(hold)
      return hold
    } catch (error) {
      console.warn(`Failed to create confirmation hold:`, error)
      return null
    }
  }

  private runConfirmation(
    confirmWrite: NonNullable<OfflineConfig[`confirmWrite`]>,
    transaction: OfflineTransaction,
    result: unknown,
    hold: OptimisticHold,
  ): void {
    const release = (): void => {
      this.confirmationHolds.delete(hold)
      try {
        hold.release()
      } catch (error) {
        console.warn(`Failed to release confirmation hold:`, error)
      }
    }

    // Off the serial drain: `confirmWrite` must never block the next
    // transaction, and a rejection must never surface as an unhandled rejection
    // (the write already committed). Whatever happens, release exactly once.
    void Promise.resolve()
      .then(() =>
        confirmWrite({
          transactionId: transaction.id,
          mutations: transaction.mutations,
          result,
          metadata: transaction.metadata,
        }),
      )
      .catch((error) => {
        // The write is durably committed; a failed confirmation only means we
        // stop holding the optimistic overlay (a possible brief flicker).
        console.warn(`confirmWrite rejected for ${transaction.id}:`, error)
      })
      .finally(release)
  }

  /** Release every active confirmation hold immediately. */
  releaseConfirmationHolds(): void {
    for (const hold of [...this.confirmationHolds]) {
      this.confirmationHolds.delete(hold)
      try {
        hold.release()
      } catch (error) {
        console.warn(`Failed to release confirmation hold:`, error)
      }
    }
  }

  /** Diagnostics / tests: holds currently keeping optimistic state painted. */
  getActiveConfirmationHoldCount(): number {
    return this.confirmationHolds.size
  }

  private async handleError(
    transaction: OfflineTransaction,
    error: Error,
  ): Promise<void> {
    return withNestedSpan(
      `transaction.handleError`,
      {
        'transaction.id': transaction.id,
        'error.name': error.name,
        'error.message': error.message,
      },
      async (span) => {
        const shouldRetry = this.retryPolicy.shouldRetry(
          error,
          transaction.retryCount,
        )

        span.setAttribute(`shouldRetry`, shouldRetry)

        if (!shouldRetry) {
          this.scheduler.markCompleted(transaction)
          await this.outbox.remove(transaction.id)
          console.warn(
            `Transaction ${transaction.id} failed permanently:`,
            error,
          )

          span.setAttribute(`result`, `permanent_failure`)
          // Signal permanent failure to the waiting transaction
          this.offlineExecutor.rejectTransaction(transaction.id, error)
          return
        }

        const delay = Math.max(
          0,
          this.retryPolicy.calculateDelay(transaction.retryCount),
        )
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

        span.setAttribute(`retryDelay`, delay)
        span.setAttribute(`nextRetryCount`, updatedTransaction.retryCount)

        this.scheduler.markFailed(transaction)
        this.scheduler.updateTransaction(updatedTransaction)

        try {
          await this.outbox.update(transaction.id, updatedTransaction)
          span.setAttribute(`result`, `scheduled_retry`)
        } catch (persistError) {
          span.recordException(persistError as Error)
          span.setAttribute(`result`, `persist_failed`)
          throw persistError
        }

        // Schedule retry timer
        this.scheduleNextRetry()
      },
    )
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

    // Restore optimistic state for loaded transactions
    // This ensures the UI shows the optimistic data while transactions are pending
    this.restoreOptimisticState(filteredTransactions)

    // Reset retry delays for all loaded transactions so they can run immediately
    this.resetRetryDelays()

    // Schedule retry timer for loaded transactions
    this.scheduleNextRetry()

    const removedTransactions = transactions.filter(
      (tx) => !filteredTransactions.some((filtered) => filtered.id === tx.id),
    )

    if (removedTransactions.length > 0) {
      await this.outbox.removeMany(removedTransactions.map((tx) => tx.id))
    }
  }

  /**
   * Restore optimistic state from loaded transactions.
   * Creates internal transactions to hold the mutations so the collection's
   * state manager can show optimistic data while waiting for sync.
   */
  private restoreOptimisticState(
    transactions: Array<OfflineTransaction>,
  ): void {
    for (const offlineTx of transactions) {
      if (offlineTx.mutations.length === 0) {
        continue
      }

      try {
        // Hold the mutations for optimistic display while the write is pending.
        // It will never commit - the real mutation is handled by the offline
        // executor, which tears the hold down via cleanupRestorationTransaction
        // (keyed by the offline transaction id) once the write resolves.
        const hold = createOptimisticHold(offlineTx.mutations, {
          id: offlineTx.id,
        })

        this.offlineExecutor.registerRestorationTransaction(
          offlineTx.id,
          hold.transaction,
        )
      } catch (error) {
        console.warn(
          `Failed to restore optimistic state for transaction ${offlineTx.id}:`,
          error,
        )
      }
    }
  }

  clear(): void {
    this.scheduler.clear()
    this.clearRetryTimer()
    this.releaseConfirmationHolds()
  }

  getPendingCount(): number {
    return this.scheduler.getPendingCount()
  }

  private scheduleNextRetry(): void {
    // Clear existing timer
    this.clearRetryTimer()

    if (!this.isOnline()) {
      return
    }

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

  private isOnline(): boolean {
    return this.offlineExecutor.isOnline()
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
