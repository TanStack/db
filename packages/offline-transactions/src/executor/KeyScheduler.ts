import type { OfflineTransaction } from '../types'

export class KeyScheduler {
  private pendingTransactions: Array<OfflineTransaction> = []
  private activeTransactionId: string | undefined

  schedule(transaction: OfflineTransaction): boolean {
    // Development-only oracle probes read this. A bundler that sets NODE_ENV
    // folds it to `false`, inlines it, and removes them; the typeof check keeps
    // an unbundled module from throwing where `process` does not exist.
    const probing =
      typeof process === `undefined`
        ? false
        : process.env.NODE_ENV !== `production`
    const duplicate = this.pendingTransactions.some(
      (pending) => pending.id === transaction.id,
    )
    // Development-only oracle probe; a production build removes it.
    probing &&
      (
        globalThis as {
          __oracleProbe?: (name: string, condition: unknown) => void
        }
      ).__oracleProbe?.(`offline-transactions#duplicate-schedule`, duplicate)
    if (duplicate) return false
    this.pendingTransactions.push(transaction)
    // Sort by creation time to maintain FIFO order
    this.pendingTransactions.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
    return true
  }

  getNext(): OfflineTransaction | undefined {
    if (
      this.activeTransactionId !== undefined ||
      this.pendingTransactions.length === 0
    ) {
      return undefined
    }
    const firstTransaction = this.pendingTransactions[0]!
    return this.isReadyToRun(firstTransaction) ? firstTransaction : undefined
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
    this.updateTransactions([transaction])
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
    const updatedById = new Map(
      updatedTransactions.map((transaction) => [transaction.id, transaction]),
    )
    this.pendingTransactions = this.pendingTransactions.map(
      (transaction) => updatedById.get(transaction.id) ?? transaction,
    )
    // Re-sort to maintain FIFO order after updates
    this.pendingTransactions.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
  }
}
