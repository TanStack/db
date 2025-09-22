import type { OfflineTransaction } from "../types"

export class KeyScheduler {
  private pendingTransactions: Array<OfflineTransaction> = []
  private isRunning = false

  schedule(transaction: OfflineTransaction): void {
    this.pendingTransactions.push(transaction)
    // Sort by creation time to maintain FIFO order
    this.pendingTransactions.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )
  }

  getNextBatch(_maxConcurrency: number): Array<OfflineTransaction> {
    // For sequential processing, we ignore maxConcurrency and only process one transaction at a time
    if (this.isRunning || this.pendingTransactions.length === 0) {
      return []
    }

    // Find the first transaction that's ready to run
    const readyTransaction = this.pendingTransactions.find((tx) =>
      this.isReadyToRun(tx)
    )

    return readyTransaction ? [readyTransaction] : []
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
      (tx) => tx.id === transaction.id
    )
    if (index >= 0) {
      this.pendingTransactions.splice(index, 1)
    }
  }

  updateTransaction(transaction: OfflineTransaction): void {
    const index = this.pendingTransactions.findIndex(
      (tx) => tx.id === transaction.id
    )
    if (index >= 0) {
      this.pendingTransactions[index] = transaction
      // Re-sort to maintain FIFO order after update
      this.pendingTransactions.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
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

  updateTransactions(updatedTransactions: Array<OfflineTransaction>): void {
    for (const updatedTx of updatedTransactions) {
      const index = this.pendingTransactions.findIndex(
        (tx) => tx.id === updatedTx.id
      )
      if (index >= 0) {
        this.pendingTransactions[index] = updatedTx
      }
    }
    // Re-sort to maintain FIFO order after updates
    this.pendingTransactions.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )
  }
}
