import { withSyncSpan } from '../telemetry/tracer'
import type { OfflineTransaction } from '../types'

export class KeyScheduler {
  private pendingTransactions: Array<OfflineTransaction> = []
  private isRunning = false

  schedule(transaction: OfflineTransaction): void {
    withSyncSpan(
      `scheduler.schedule`,
      {
        'transaction.id': transaction.id,
        queueLength: this.pendingTransactions.length,
      },
      () => {
        this.pendingTransactions.push(transaction)
        // Sort by creation time to maintain FIFO order
        this.pendingTransactions.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )
      },
    )
  }

  getNext(): OfflineTransaction | undefined {
    return withSyncSpan(
      `scheduler.getNext`,
      { pendingCount: this.pendingTransactions.length },
      (span) => {
        if (this.isRunning || this.pendingTransactions.length === 0) {
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

  markStarted(_transaction: OfflineTransaction): void {
    this.isRunning = true
  }

  markCompleted(transaction: OfflineTransaction): void {
    this.removeTransaction(transaction)
    this.isRunning = false
  }

  markFailed(_transaction: OfflineTransaction): void {
    this.isRunning = false
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
    return this.isRunning ? 1 : 0
  }

  clear(): void {
    this.pendingTransactions = []
    this.isRunning = false
  }

  getAllPendingTransactions(): Array<OfflineTransaction> {
    return [...this.pendingTransactions]
  }

  getEarliestRetryTime(): number | null {
    let earliestRetryTime: number | null = null

    for (const transaction of this.pendingTransactions) {
      earliestRetryTime =
        earliestRetryTime === null
          ? transaction.nextAttemptAt
          : Math.min(earliestRetryTime, transaction.nextAttemptAt)
    }

    return earliestRetryTime
  }

  updateTransactions(updatedTransactions: Array<OfflineTransaction>): void {
    if (updatedTransactions.length === 0) {
      return
    }

    const updatedById = new Map(
      updatedTransactions.map((transaction) => [transaction.id, transaction]),
    )

    for (let index = 0; index < this.pendingTransactions.length; index++) {
      const updatedTransaction = updatedById.get(
        this.pendingTransactions[index]!.id,
      )
      if (updatedTransaction) {
        this.pendingTransactions[index] = updatedTransaction
      }
    }

    // Re-sort to maintain FIFO order after updates
    this.pendingTransactions.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
  }
}
