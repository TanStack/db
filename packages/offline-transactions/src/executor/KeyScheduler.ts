import { withSyncSpan } from '../telemetry/tracer'
import type { OfflineTransaction } from '../types'

export class KeyScheduler {
  private pendingTransactions: Array<OfflineTransaction> = []
  private activeTransactionId: string | undefined

  schedule(transaction: OfflineTransaction): boolean {
    return withSyncSpan(
      `scheduler.schedule`,
      {
        'transaction.id': transaction.id,
        queueLength: this.pendingTransactions.length,
      },
      () => {
        if (
          this.pendingTransactions.some(
            (pending) => pending.id === transaction.id,
          )
        ) {
          return false
        }
        this.pendingTransactions.push(transaction)
        // Sort by creation time to maintain FIFO order
        this.pendingTransactions.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )
        return true
      },
    )
  }

  getNext(): OfflineTransaction | undefined {
    return withSyncSpan(
      `scheduler.getNext`,
      { pendingCount: this.pendingTransactions.length },
      (span) => {
        if (
          this.activeTransactionId !== undefined ||
          this.pendingTransactions.length === 0
        ) {
          span.setAttribute(`result`, `empty`)
          return undefined
        }

        const firstTransaction = this.pendingTransactions[0]!

        if (!this.isReadyToRun(firstTransaction)) {
          span.setAttribute(`result`, `waiting_for_first`)
          span.setAttribute(`transaction.id`, firstTransaction.id)
          return undefined
        }

        span.setAttribute(`result`, `found`)
        span.setAttribute(`transaction.id`, firstTransaction.id)
        return firstTransaction
      },
    )
  }

  private isReadyToRun(transaction: OfflineTransaction): boolean {
    return Date.now() >= transaction.nextAttemptAt
  }

  markStarted(transaction: OfflineTransaction): void {
    this.activeTransactionId = transaction.id
  }

  markCompleted(transaction: OfflineTransaction): void {
    this.removeTransaction(transaction)
    this.activeTransactionId = undefined
  }

  markFailed(_transaction: OfflineTransaction): void {
    this.activeTransactionId = undefined
  }

  private removeTransaction(transaction: OfflineTransaction): void {
    const index = this.pendingTransactions.findIndex(
      (tx) => tx.id === transaction.id,
    )
    if (index >= 0) {
      this.pendingTransactions.splice(index, 1)
    }
  }

  updateTransaction(transaction: OfflineTransaction): void {
    const index = this.pendingTransactions.findIndex(
      (tx) => tx.id === transaction.id,
    )
    if (index >= 0) {
      this.pendingTransactions[index] = transaction
      // Re-sort to maintain FIFO order after update
      this.pendingTransactions.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )
    }
  }

  getPendingCount(): number {
    return this.pendingTransactions.length
  }

  getRunningCount(): number {
    return this.activeTransactionId === undefined ? 0 : 1
  }

  clear(): void {
    this.pendingTransactions = []
    this.activeTransactionId = undefined
  }

  /** @internal Reconcile one replay snapshot without canceling issued work. */
  removePendingTransactions(transactionIds: Iterable<string>): Array<string> {
    const ids = new Set(transactionIds)
    if (this.activeTransactionId !== undefined)
      ids.delete(this.activeTransactionId)
    this.pendingTransactions = this.pendingTransactions.filter(
      ({ id }) => !ids.has(id),
    )
    return [...ids]
  }

  getAllPendingTransactions(): Array<OfflineTransaction> {
    return [...this.pendingTransactions]
  }

  updateTransactions(updatedTransactions: Array<OfflineTransaction>): void {
    for (const updatedTx of updatedTransactions) {
      const index = this.pendingTransactions.findIndex(
        (tx) => tx.id === updatedTx.id,
      )
      if (index >= 0) {
        this.pendingTransactions[index] = updatedTx
      }
    }
    // Re-sort to maintain FIFO order after updates
    this.pendingTransactions.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
  }
}
