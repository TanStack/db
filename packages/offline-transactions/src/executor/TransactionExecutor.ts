import { createTransaction } from '@tanstack/db'
import { OutboxTransactionNotFoundError } from '../outbox/OutboxManager'
import { DefaultRetryPolicy } from '../retry/RetryPolicy'
import { NonRetriableError } from '../types'
import { withNestedSpan } from '../telemetry/tracer'
import type { KeyScheduler } from './KeyScheduler'
import type { OutboxManager } from '../outbox/OutboxManager'
import type {
  OfflineConfig,
  OfflineTransaction,
  TransactionSignaler,
} from '../types'

const HANDLED_EXECUTION_ERROR = Symbol(`HandledExecutionError`)

export class TransactionExecutor {
  private scheduler: KeyScheduler
  private outbox: OutboxManager
  private config: OfflineConfig
  private retryPolicy: DefaultRetryPolicy
  private isExecuting = false
  private executionPromise: Promise<void> | null = null
  private offlineExecutor: TransactionSignaler
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private fatalError: Error | null = null

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
    this.assertHealthy()
    this.scheduler.schedule(transaction)
    await this.executeAll()
  }

  async executeAll(): Promise<void> {
    this.assertHealthy()
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
      this.scheduleNextRetry()
    }
  }

  private async runExecution(): Promise<void> {
    while (this.scheduler.getPendingCount() > 0) {
      if (!this.canExecute()) {
        break
      }

      const transaction = this.scheduler.getNext()

      if (!transaction) {
        break
      }

      await this.executeTransaction(transaction)
    }
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
          const terminalError =
            transaction.outboxPhase === `rejection-pending`
              ? this.getTerminalError(transaction)
              : undefined
          this.scheduler.markStarted(transaction)

          if (transaction.retryCount > 0) {
            span.setAttribute(`retry.attempt`, transaction.retryCount)
          }

          if (!transaction.outboxPhase) {
            try {
              await this.runMutationFn(transaction)
            } catch (error) {
              const err =
                error instanceof Error ? error : new Error(String(error))

              span.setAttribute(`result`, `error`)

              await this.handleError(transaction, err)
              ;(err as any)[HANDLED_EXECUTION_ERROR] = true
              throw err
            }
          }

          // A successful provider call can outlive this executor. Persist that
          // fact before removal so a restarted executor only retries deletion.
          const deletionPending: OfflineTransaction = transaction.outboxPhase
            ? transaction
            : { ...transaction, outboxPhase: `deletion-pending` }
          try {
            await this.removeSettledTransaction(
              deletionPending,
              !transaction.outboxPhase,
            )
          } catch (error) {
            const storageError = error as Error
            span.recordException(storageError)
            span.setAttribute(`result`, `outbox_failure`)
            this.offlineExecutor.rejectTransaction(
              transaction.id,
              terminalError ?? storageError,
            )
            throw storageError
          }

          if (terminalError) {
            span.setAttribute(`result`, `permanent_failure`)
            this.offlineExecutor.rejectTransaction(
              transaction.id,
              terminalError,
            )
          } else {
            span.setAttribute(`result`, `success`)
            this.offlineExecutor.resolveTransaction(transaction.id, undefined)
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
          const rejectionPending: OfflineTransaction = {
            ...transaction,
            outboxPhase: `rejection-pending`,
            lastError: {
              name: error.name,
              message: error.message,
              stack: error.stack,
            },
          }
          console.warn(
            `Transaction ${transaction.id} failed permanently:`,
            error,
          )
          try {
            await this.removeSettledTransaction(rejectionPending, true)
          } catch (storageError) {
            span.recordException(storageError as Error)
            span.setAttribute(`result`, `outbox_failure`)
            this.offlineExecutor.rejectTransaction(transaction.id, error)
            throw storageError
          }

          span.setAttribute(`result`, `permanent_failure`)
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

        this.scheduler.updateTransaction(updatedTransaction)

        try {
          await this.outbox.update(transaction.id, updatedTransaction)
          span.setAttribute(`result`, `scheduled_retry`)
        } catch (persistError) {
          span.recordException(persistError as Error)
          span.setAttribute(`result`, `persist_failed`)
          throw persistError
        } finally {
          this.scheduler.markFailed(transaction)
        }
      },
    )
  }

  private async removeSettledTransaction(
    transaction: OfflineTransaction,
    persistMarker: boolean,
  ): Promise<void> {
    try {
      if (persistMarker) {
        try {
          await this.outbox.update(transaction.id, transaction)
        } catch (error) {
          // A public removal can finish while the provider is still running.
          if (!(error instanceof OutboxTransactionNotFoundError)) throw error
        }
      }
      await this.outbox.remove(transaction.id)
      this.scheduler.markCompleted(transaction)
    } catch (error) {
      const storageError =
        error instanceof Error ? error : new Error(String(error))
      this.fatalError = storageError
      this.scheduler.markFailed(transaction)
      this.clearRetryTimer()
      throw storageError
    }
  }

  assertHealthy(): void {
    if (this.fatalError) throw this.fatalError
  }

  private getTerminalError(transaction: OfflineTransaction): Error {
    if (!transaction.lastError)
      throw new Error(`Terminal transaction ${transaction.id} has no error`)
    const { name, message, stack } = transaction.lastError
    const error =
      name === `NonRetriableError`
        ? new NonRetriableError(message)
        : new Error(message)
    error.name = name
    error.stack = stack
    return error
  }

  async loadPendingTransactions(): Promise<void> {
    let removedIds: Array<string> = []
    await this.outbox.withAll((transactions) => {
      const { isOfflineEnabled } = this.offlineExecutor
      if (!isOfflineEnabled) return
      const providerPending = transactions.filter(
        (transaction) => !transaction.outboxPhase,
      )
      const selectedProvider = this.config.beforeRetry
        ? this.config.beforeRetry(providerPending)
        : providerPending
      const selectedById = new Map(selectedProvider.map((tx) => [tx.id, tx]))
      const filteredTransactions = transactions.flatMap((transaction) => {
        if (transaction.outboxPhase) return [transaction]
        const selected = selectedById.get(transaction.id)
        return selected ? [selected] : []
      })

      // The retry hook is user code and may synchronously revoke replay rights.
      if (!this.offlineExecutor.isOfflineEnabled) return

      const newlyLoaded = filteredTransactions.filter((transaction) =>
        this.scheduler.schedule(transaction),
      )

      removedIds = providerPending
        .filter(({ id }) => !selectedById.has(id))
        .map(({ id }) => id)
      removedIds = this.scheduler.removePendingTransactions(removedIds)

      // Restore optimistic state for loaded transactions
      // This ensures the UI shows the optimistic data while transactions are pending
      this.restoreOptimisticState(
        newlyLoaded.filter(
          (transaction) => transaction.outboxPhase !== `rejection-pending`,
        ),
      )

      // Reset retry delays for all loaded transactions so they can run immediately
      this.resetRetryDelays()

      // Schedule retry timer for loaded transactions
      this.scheduleNextRetry()
    })

    if (removedIds.length > 0) {
      const error = new NonRetriableError(`Transaction excluded by beforeRetry`)
      await Promise.all(
        removedIds.map(async (id) => {
          try {
            await this.outbox.remove(id)
            this.offlineExecutor.rejectTransaction(id, error)
          } catch (cleanupError) {
            console.warn(
              `Failed to remove transaction excluded by beforeRetry:`,
              id,
              cleanupError,
            )
          }
        }),
      )
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
        // Create a restoration transaction that holds mutations for optimistic state display.
        // It will never commit - the real mutation is handled by the offline executor.
        const restorationTx = createTransaction({
          id: offlineTx.id,
          autoCommit: false,
          mutationFn: async () => {},
        })

        // Prevent unhandled promise rejection when cleanup calls rollback()
        // We don't care about this promise - it's just for holding mutations
        restorationTx.isPersisted.promise.catch(() => {
          // Intentionally ignored - restoration transactions are cleaned up
          // via cleanupRestorationTransaction, not through normal commit flow
        })

        restorationTx.applyMutations(offlineTx.mutations)

        // Register with each affected collection's state manager
        const touchedCollections = new Set<string>()
        for (const mutation of offlineTx.mutations) {
          // Defensive check for corrupted deserialized data
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!mutation.collection) {
            continue
          }
          const collectionId = mutation.collection.id
          if (touchedCollections.has(collectionId)) {
            continue
          }
          touchedCollections.add(collectionId)

          mutation.collection._state.trackTransaction(restorationTx)
          mutation.collection._state.recomputeOptimisticState(true)
        }

        this.offlineExecutor.registerRestorationTransaction(
          offlineTx.id,
          restorationTx,
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
  }

  pause(): void {
    // Retain queued work and let the issued call finish its acknowledgment.
    this.clearRetryTimer()
  }

  getPendingCount(): number {
    return this.scheduler.getPendingCount()
  }

  private scheduleNextRetry(): void {
    // Clear existing timer
    this.clearRetryTimer()

    if (this.fatalError || !this.canExecute()) {
      return
    }

    const nextRetryTime = this.getNextRetryTime()

    if (nextRetryTime === null) {
      return // No transactions pending retry
    }

    const delay = Math.max(0, nextRetryTime - Date.now())

    this.retryTimer = setTimeout(() => {
      this.executeAll().catch((error) => {
        console.warn(`Failed to execute retry batch:`, error)
      })
    }, delay)
  }

  private getNextRetryTime(): number | null {
    const allTransactions = this.scheduler.getAllPendingTransactions()

    if (allTransactions.length === 0) {
      return null
    }

    // Later transactions cannot overtake the FIFO head, even if they are ready.
    return allTransactions[0]!.nextAttemptAt
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private canExecute(): boolean {
    return (
      this.offlineExecutor.isOfflineEnabled && this.offlineExecutor.isOnline()
    )
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
