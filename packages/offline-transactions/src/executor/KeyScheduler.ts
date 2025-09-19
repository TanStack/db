import type { OfflineTransaction } from "../types"

export class KeyScheduler {
  private keyQueues: Map<string, Array<OfflineTransaction>> = new Map()
  private runningKeys: Set<string> = new Set()
  private pendingTransactions: Array<OfflineTransaction> = []

  schedule(transaction: OfflineTransaction): void {
    this.pendingTransactions.push(transaction)
    this.organizeQueues()
  }

  private organizeQueues(): void {
    this.keyQueues.clear()

    for (const transaction of this.pendingTransactions) {
      for (const key of transaction.keys) {
        if (!this.keyQueues.has(key)) {
          this.keyQueues.set(key, [])
        }
        this.keyQueues.get(key)!.push(transaction)
      }
    }

    for (const [, transactions] of this.keyQueues) {
      transactions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    }
  }

  getNextBatch(maxConcurrency: number): Array<OfflineTransaction> {
    const batch: Array<OfflineTransaction> = []
    const seenTransactions = new Set<string>()
    const currentlyRunningCount = this.runningKeys.size

    if (currentlyRunningCount >= maxConcurrency) {
      return batch
    }

    const remainingCapacity = maxConcurrency - currentlyRunningCount

    for (const [key, transactions] of this.keyQueues) {
      if (this.runningKeys.has(key)) {
        continue
      }

      if (batch.length >= remainingCapacity) {
        break
      }

      const nextTransaction = transactions.find(
        (tx) => !seenTransactions.has(tx.id) && this.isReadyToRun(tx)
      )

      if (nextTransaction) {
        const hasConflict = this.hasKeyConflictWithBatch(nextTransaction, batch)

        if (!hasConflict) {
          batch.push(nextTransaction)
          seenTransactions.add(nextTransaction.id)
        }
      }
    }

    return batch
  }

  private isReadyToRun(transaction: OfflineTransaction): boolean {
    return Date.now() >= transaction.nextAttemptAt
  }

  private hasKeyConflictWithBatch(
    transaction: OfflineTransaction,
    batch: Array<OfflineTransaction>
  ): boolean {
    const transactionKeys = new Set(transaction.keys)

    for (const batchTransaction of batch) {
      for (const key of batchTransaction.keys) {
        if (transactionKeys.has(key)) {
          return true
        }
      }
    }

    return false
  }

  markStarted(transaction: OfflineTransaction): void {
    for (const key of transaction.keys) {
      this.runningKeys.add(key)
    }
  }

  markCompleted(transaction: OfflineTransaction): void {
    this.removeTransaction(transaction)
    this.markFinished(transaction)
  }

  markFailed(transaction: OfflineTransaction): void {
    this.markFinished(transaction)
  }

  private markFinished(transaction: OfflineTransaction): void {
    for (const key of transaction.keys) {
      this.runningKeys.delete(key)
    }
  }

  private removeTransaction(transaction: OfflineTransaction): void {
    const index = this.pendingTransactions.findIndex(
      (tx) => tx.id === transaction.id
    )
    if (index >= 0) {
      this.pendingTransactions.splice(index, 1)
      this.organizeQueues()
    }
  }

  updateTransaction(transaction: OfflineTransaction): void {
    const index = this.pendingTransactions.findIndex(
      (tx) => tx.id === transaction.id
    )
    if (index >= 0) {
      this.pendingTransactions[index] = transaction
      this.organizeQueues()
    }
  }

  getPendingCount(): number {
    return this.pendingTransactions.length
  }

  getRunningCount(): number {
    return this.runningKeys.size
  }

  clear(): void {
    this.keyQueues.clear()
    this.runningKeys.clear()
    this.pendingTransactions = []
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
    this.organizeQueues()
  }
}
