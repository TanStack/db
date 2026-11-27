import { DuplicateTransactionIdError, createTransaction } from '@tanstack/db'
import { OutboxTransactionNotFoundError } from '../outbox/OutboxManager'
import { DefaultRetryPolicy } from '../retry/RetryPolicy'
import { NonRetriableError } from '../types'
import type { KeyScheduler } from './KeyScheduler'
import type { OutboxManager } from '../outbox/OutboxManager'
import type {
  OfflineConfig,
  OfflineTransaction,
  TransactionSignaler,
} from '../types'

const HANDLED_EXECUTION_ERROR = Symbol(`HandledExecutionError`)

function toError(value: unknown): Error {
  return value instanceof Error ||
    Object.prototype.toString.call(value) === `[object Error]`
    ? (value as Error)
    : new Error(String(value))
}

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
  // Writes beforeRetry excluded whose rejection cleanup has not finished.
  private readonly excluding = new Set<string>()
  // Excluded writes whose cleanup failed, with their rejection. Retried on a
  // timer and on connectivity, outside the queue, while this tab leads.
  // Each with whether its decision is already persisted.
  private readonly failedCleanups = new Map<
    string,
    { error: Error; committed: boolean }
  >()
  // The replay of the current term, which admissions wait for.
  private replay: Promise<void> | null = null
  // The leadership term whose replay last completed.
  private replayedTerm: number | undefined | null = null
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null
  private cleanupAttempts = 0
  private cleaning = false

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
    // Another executor over the same Collections reads that this call runs.
    this.offlineExecutor.trackIssued?.(transaction.id, true)
    try {
      await this.runTransaction(transaction)
    } finally {
      this.offlineExecutor.trackIssued?.(transaction.id, false)
    }
  }

  private async runTransaction(transaction: OfflineTransaction): Promise<void> {
    try {
      const terminalError =
        transaction.outboxPhase === `rejection-pending`
          ? this.getTerminalError(transaction)
          : undefined
      this.scheduler.markStarted(transaction)

      if (!transaction.outboxPhase) {
        try {
          await this.runMutationFn(transaction)
        } catch (error) {
          const err = toError(error)

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
        // A rejection waits until it is recorded and its row removed.
        if (
          !(await this.removeSettledTransaction(
            deletionPending,
            !transaction.outboxPhase,
          ))
        )
          return
      } catch (error) {
        const storageError = error as Error
        // A cleanup fault is not the write's outcome. Another tab's writer
        // waits for a leader that finishes the removal.
        this.offlineExecutor.rejectTransaction(
          transaction.id,
          terminalError ?? storageError,
          terminalError !== undefined,
        )
        throw storageError
      }

      if (terminalError) {
        this.offlineExecutor.rejectTransaction(transaction.id, terminalError)
      } else {
        this.offlineExecutor.resolveTransaction(transaction.id, undefined)
      }
    } catch (error) {
      if (
        error !== null &&
        typeof error === `object` &&
        (error as Record<symbol, unknown>)[HANDLED_EXECUTION_ERROR] === true
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
    // Development-only oracle probes read this. The published build removes
    // this guard and its probes (scripts/strip-oracle-probes.mjs). A bundler
    // that sets NODE_ENV and bundles these sources folds it to `false` and
    // removes them; the typeof check keeps an unbundled module from throwing
    // where `process` does not exist.
    const probing =
      typeof process === `undefined`
        ? false
        : process.env.NODE_ENV !== `production`
    let shouldRetry: boolean
    let hookFailure: Error | undefined
    if (error instanceof NonRetriableError) {
      shouldRetry = false
    } else {
      let decision: boolean | undefined
      try {
        decision = this.config.shouldRetry?.(error, transaction.retryCount)
        if (decision !== undefined && typeof decision !== `boolean`) {
          // An async hook is invalid, but its rejection must stay row-local.
          void Promise.resolve(decision).catch(() => {})
          throw new TypeError(
            `OfflineConfig.shouldRetry must return true, false, or undefined`,
          )
        }
      } catch (hookError) {
        hookFailure = toError(hookError)
      }
      if (hookFailure) {
        shouldRetry = false
      } else {
        shouldRetry =
          decision ??
          this.retryPolicy.shouldRetry(error, transaction.retryCount)
      }
    }

    if (!shouldRetry) {
      const terminalError = hookFailure ?? error
      const rejectionPending: OfflineTransaction = {
        ...transaction,
        outboxPhase: `rejection-pending`,
        lastError: {
          name: terminalError.name,
          message: terminalError.message,
          stack: terminalError.stack,
        },
      }
      if (hookFailure) {
        console.warn(
          `Retry decision failed for transaction ${transaction.id}:`,
          hookFailure,
          `Named mutation function error:`,
          error,
        )
      } else {
        console.warn(`Transaction ${transaction.id} failed permanently:`, error)
      }
      // Development-only oracle probe; a production build removes it.
      probing &&
        (
          globalThis as {
            __oracleProbe?: (name: string, condition: unknown) => void
          }
        ).__oracleProbe?.(
          `offline-transactions#permanent-failure-before-peer`,
          this.scheduler.getPendingCount() > 1,
        )
      try {
        // A rejection waits until it is recorded and its row removed.
        if (!(await this.removeSettledTransaction(rejectionPending, true)))
          return
      } catch (storageError) {
        this.offlineExecutor.rejectTransaction(transaction.id, terminalError)
        throw storageError
      }

      this.offlineExecutor.rejectTransaction(transaction.id, terminalError)
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

    // Development-only oracle probe; a production build removes it.
    probing &&
      (
        globalThis as {
          __oracleProbe?: (name: string, condition: unknown) => void
        }
      ).__oracleProbe?.(
        `offline-transactions#retry-before-peer`,
        this.scheduler.getPendingCount() > 1,
      )
    this.scheduler.updateTransaction(updatedTransaction)

    try {
      await this.outbox.update(transaction.id, updatedTransaction)
      // This leader accepted and sent the write; a former leader's decision
      // that landed meanwhile must not settle it at a later replay.
      if (this.offlineExecutor.recordsOutcomes)
        await this.outbox.removeDecisions(transaction.id).catch(() => {})
    } catch (persistError) {
      // Public removal can finish while the named mutation function runs.
      // The removed row cannot be retried, but its caller still owns the
      // provider failure and later queued work must be able to run.
      if (persistError instanceof OutboxTransactionNotFoundError) {
        this.scheduler.markCompleted(transaction)
        this.offlineExecutor.rejectTransaction(transaction.id, error)
        return
      }
      throw persistError
    } finally {
      this.scheduler.markFailed(transaction)
    }
  }

  /** False when its rejection could not be recorded and the row stays. */
  private async removeSettledTransaction(
    transaction: OfflineTransaction,
    persistMarker: boolean,
  ): Promise<boolean> {
    // Read by this function's development-only oracle probes, as above.
    const probing =
      typeof process === `undefined`
        ? false
        : process.env.NODE_ENV !== `production`
    try {
      if (persistMarker) {
        try {
          await this.outbox.update(transaction.id, transaction)
        } catch (error) {
          // A removal in another runtime can finish while the provider runs.
          if (!(error instanceof OutboxTransactionNotFoundError)) {
            // Development-only oracle probe; a production build removes it.
            probing &&
              (
                globalThis as {
                  __oracleProbe?: (name: string, condition: unknown) => void
                }
              ).__oracleProbe?.(`offline-transactions#phase-write-fault`, true)
            throw error
          }
        }
      }
      // A writer in another tab that misses the settlement message reads a
      // rejection here; a write with no record completed.
      if (
        transaction.outboxPhase === `rejection-pending` &&
        this.recordsFor(transaction.id)
      ) {
        try {
          await this.outbox.recordRejection(
            transaction.id,
            this.getTerminalError(transaction),
          )
        } catch (error) {
          // The terminal row stays; a later attempt records the rejection and
          // removes it without calling the provider. Other writes keep running.
          console.warn(
            `Failed to record rejection of transaction ${transaction.id}:`,
            error,
          )
          this.scheduler.updateTransaction({
            ...transaction,
            nextAttemptAt:
              Date.now() +
              this.retryPolicy.calculateDelay(transaction.retryCount),
          })
          this.scheduler.markFailed(transaction)
          return false
        }
      }
      await this.outbox.remove(transaction.id)
      this.scheduler.markCompleted(transaction)
      return true
    } catch (error) {
      const storageError = toError(error)
      // Development-only oracle probe; a production build removes it. The
      // failed transaction is still pending, so any other pending one is a peer.
      probing &&
        (
          globalThis as {
            __oracleProbe?: (name: string, condition: unknown) => void
          }
        ).__oracleProbe?.(
          `offline-transactions#fault-before-peer`,
          this.scheduler.getPendingCount() > 1,
        )
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
    // An admission waits for this replay, which settles decided rows and
    // fills `excluding` before any of them can be scheduled.
    let finish!: () => void
    const replay = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.replay = replay
    const term = this.offlineExecutor.leadershipTerm
    try {
      // A replay that outlived its term must not reopen admission for an
      // older one.
      if (
        (await this.loadPending()) &&
        term === this.offlineExecutor.leadershipTerm
      )
        this.replayedTerm = term
    } finally {
      if (this.replay === replay) this.replay = null
      finish()
    }
  }

  /** Whether this term's replay failed and none is running. */
  get replayFailed(): boolean {
    return (
      this.offlineExecutor.isOfflineEnabled &&
      this.replay === null &&
      this.replayedTerm !== this.offlineExecutor.leadershipTerm
    )
  }

  /** False when the read was stale for this term and changed nothing. */
  private async loadPending(): Promise<boolean> {
    let reconciled = false
    let removedIds: Array<string> = []
    // Rows a former leader decided to reject: settled here, never sent.
    let decided: Array<OfflineTransaction> = []
    const term = this.offlineExecutor.leadershipTerm
    // Decisions exist only where outcomes are recorded.
    const decisions = new Map<string, { name: string; message: string }>()
    await this.outbox.withAll(
      (transactions) => {
        const { isOfflineEnabled } = this.offlineExecutor
        // A read that spans a change of leadership is stale: another leader
        // may have sent its rows, and this term's own load reads them again.
        if (!isOfflineEnabled || term !== this.offlineExecutor.leadershipTerm)
          return
        decided = transactions.filter(
          (transaction) =>
            !transaction.outboxPhase &&
            decisions.has(transaction.id) &&
            !this.scheduler.isRunning(transaction.id),
        )
        const providerPending = transactions.filter(
          (transaction) =>
            !transaction.outboxPhase && !decided.includes(transaction),
        )
        const selectedProvider = this.config.beforeRetry
          ? this.config.beforeRetry(providerPending)
          : providerPending
        const selectedById = new Map(selectedProvider.map((tx) => [tx.id, tx]))
        const filteredTransactions = transactions.flatMap((transaction) => {
          if (decided.includes(transaction)) return []
          if (transaction.outboxPhase) return [transaction]
          const selected = selectedById.get(transaction.id)
          return selected ? [selected] : []
        })

        // The retry hook is user code and may synchronously revoke replay rights.
        if (!this.offlineExecutor.isOfflineEnabled) return

        // A removal deciding a row admits it again if it does not commit.
        const newlyLoaded = filteredTransactions.filter(
          (transaction) =>
            !this.offlineExecutor.isRemoving?.(transaction.id) &&
            this.scheduler.schedule(transaction),
        )

        removedIds = providerPending
          .filter(({ id }) => !selectedById.has(id))
          .map(({ id }) => id)
        removedIds = this.scheduler.removePendingTransactions(removedIds)
        // A late admission must not run a write this hook excluded; one a
        // later replay accepts is admissible again.
        for (const id of this.excluding)
          if (selectedById.has(id)) this.excluding.delete(id)
        for (const id of removedIds) this.excluding.add(id)
        for (const { id } of decided) this.excluding.add(id)

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
        reconciled = true
      },
      this.offlineExecutor.recordsOutcomes ? decisions : undefined,
    )

    const cleanUp = async (id: string, error: Error, committed: boolean) => {
      if (await this.cleanUpExcluded(id, error, term, committed)) return
      // Retried only while this decision stands: a later term's replay may
      // have accepted the write. Until then no admission runs it.
      if (
        !this.offlineExecutor.isOfflineEnabled ||
        term !== this.offlineExecutor.leadershipTerm ||
        !this.excluding.has(id)
      )
        return
      this.failedCleanups.set(id, { error, committed })
      this.scheduleCleanupRetry()
    }
    // A former leader's decision settles without the network, and startup
    // does not wait for it.
    void Promise.all(
      decided.map((transaction) => {
        const { name, message } = decisions.get(transaction.id)!
        const error =
          name === `NonRetriableError`
            ? new NonRetriableError(message)
            : new Error(message)
        error.name = name
        return cleanUp(transaction.id, error, true)
      }),
    )
    const exclusion = new NonRetriableError(
      `Transaction excluded by beforeRetry`,
    )
    await Promise.all(removedIds.map((id) => cleanUp(id, exclusion, false)))
    return reconciled
  }

  /** Records and removes one excluded write; false when that failed. */
  private async cleanUpExcluded(
    id: string,
    error: Error,
    term: number | undefined,
    committed = false,
  ): Promise<boolean> {
    try {
      // The decision is recorded before anything else, so a later leader's
      // replay settles the row rather than send it. One that does not commit
      // within this term is withdrawn: the next leader decides the write.
      const leads = () =>
        this.offlineExecutor.isOfflineEnabled &&
        term === this.offlineExecutor.leadershipTerm
      const decides = this.offlineExecutor.recordsOutcomes === true
      // A decision a former leader made is adopted under this tab's own key,
      // so it survives that leader withdrawing its own until this cleanup
      // finishes.
      let token: string | undefined
      if (decides) {
        token = await this.outbox.recordDecision(id, error)
        if (!leads()) {
          await this.outbox.removeDecision(id, token).catch(() => {})
          return true
        }
      }
      // Without decisions, a write the next leader now decides is left.
      if (!committed && !decides && !leads()) return true
      // Only a committed decision reaches a writer in another tab, and the
      // deletion and settlement follow even across a handover.
      if (this.recordsFor(id)) await this.outbox.recordRejection(id, error)
      await this.outbox.remove(id)
      if (token !== undefined)
        await this.outbox.removeDecision(id, token).catch(() => {})
      this.excluding.delete(id)
      this.offlineExecutor.rejectTransaction(id, error)
      return true
    } catch (cleanupError) {
      console.warn(
        `Failed to remove transaction excluded by beforeRetry:`,
        id,
        cleanupError,
      )
      return false
    }
  }

  // Only a writer in another tab, which shares the channel, reads a record.
  private recordsFor(id: string): boolean {
    return (
      this.offlineExecutor.recordsOutcomes === true &&
      !this.offlineExecutor.ownsWrite?.(id)
    )
  }

  private scheduleCleanupRetry(): void {
    if (this.cleanupTimer || this.failedCleanups.size === 0) return
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null
      this.cleanupAttempts++
      void this.retryFailedCleanups()
    }, this.retryPolicy.calculateDelay(this.cleanupAttempts))
  }

  /** Retries the cleanups of excluded writes, without calling the provider. */
  async retryFailedCleanups(): Promise<void> {
    if (this.cleaning || !this.offlineExecutor.isOfflineEnabled) return
    this.cleaning = true
    const term = this.offlineExecutor.leadershipTerm
    try {
      for (const [id, { error, committed }] of [...this.failedCleanups]) {
        // A change of leadership drops the rest; the next replay owns them.
        if (!this.failedCleanups.has(id)) continue
        if (!(await this.cleanUpExcluded(id, error, term, committed))) continue
        // Only the term that made the attempt may clear its entry.
        if (term === this.offlineExecutor.leadershipTerm)
          this.failedCleanups.delete(id)
      }
    } finally {
      this.cleaning = false
    }
    // A change of leadership or a disposal emptied the map.
    if (this.failedCleanups.size === 0) this.cleanupAttempts = 0
    else this.scheduleCleanupRetry()
  }

  /** Finishes a committed removal whose deletion failed, outside the queue. */
  retryDecided(id: string, error: Error): void {
    if (!this.offlineExecutor.isOfflineEnabled) return
    this.excluding.add(id)
    this.failedCleanups.set(id, { error, committed: true })
    this.scheduleCleanupRetry()
  }

  private dropFailedCleanups(): void {
    this.failedCleanups.clear()
    this.cleanupAttempts = 0
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer)
    this.cleanupTimer = null
  }

  /**
   * Schedules one transaction that a follower tab saved to the shared outbox.
   * It rejects only when the read fails.
   */
  async admitTransaction(id: string): Promise<void> {
    // A read that the transaction's removal overtakes returns null. One that
    // spans a change of leadership is dropped: another leader may have sent
    // the write, and this term's outbox load already has it if it remains.
    // Every replay in flight finishes first, a newer one included.
    while (this.replay) await this.replay
    const term = this.offlineExecutor.leadershipTerm
    // Only a successful replay of this term has loaded its decisions; the
    // admission is retried after a failed one.
    if (this.offlineExecutor.isOfflineEnabled && this.replayedTerm !== term)
      throw new Error(`The outbox replay for this leadership has not completed`)
    const transaction = await this.outbox.getCurrent(id)
    // A row this leader decided to reject, or loaded with a decision, is in
    // `excluding` and is settled, never sent; one a removal is deciding waits
    // for that removal.
    if (
      !transaction ||
      !this.offlineExecutor.isOfflineEnabled ||
      term !== this.offlineExecutor.leadershipTerm ||
      this.excluding.has(id) ||
      this.offlineExecutor.isRemoving?.(id)
    )
      return
    // A duplicate message is harmless: both steps ignore a known transaction.
    this.scheduler.schedule(transaction)
    if (transaction.outboxPhase !== `rejection-pending`)
      this.restoreOptimisticState([transaction])
    // A queue error belongs to its execution, not to this admission.
    this.executeAll().catch((error) => {
      console.warn(`Failed to execute transactions:`, error)
    })
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

        restorationTx.applyMutations(offlineTx.mutations)

        // Register with each affected Collection. If one cannot track it, roll
        // it back, so no Collection keeps a restoration nothing will settle.
        try {
          // The serializer resolves every mutation's Collection or throws.
          for (const mutation of offlineTx.mutations) {
            if (mutation.collection._state.trackTransaction(restorationTx))
              mutation.collection._state.recomputeOptimisticState(true)
          }
        } catch (error) {
          // A secondary rollback settles only this restoration; it must not
          // roll back the user's live transactions on the same keys.
          restorationTx.rollback({ isSecondaryRollback: true })
          throw error
        }

        this.offlineExecutor.registerRestorationTransaction(
          offlineTx.id,
          restorationTx,
        )
      } catch (error) {
        // A live transaction with this id already shows these mutations.
        if (error instanceof DuplicateTransactionIdError) continue
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
    this.dropFailedCleanups()
  }

  pause(): void {
    // Retain queued work and let the issued call finish its acknowledgment.
    this.clearRetryTimer()
    this.dropFailedCleanups()
  }

  /**
   * Drops queued work that has not started. Another leader may send and
   * remove it; a later leadership gain loads what remains from the outbox.
   */
  dropPending(): void {
    this.scheduler.removePendingTransactions(
      this.scheduler.getAllPendingTransactions().map(({ id }) => id),
    )
    this.clearRetryTimer()
    // The next leader's replay excludes these writes again.
    this.dropFailedCleanups()
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
