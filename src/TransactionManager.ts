import { Store } from "@tanstack/store"
import type {
  Transaction,
  TransactionState,
  PendingMutation,
  MutationStrategy,
} from "./types"
import { TransactionStore } from "./TransactionStore"
import { SortedMap } from "./SortedMap"
import { Collection } from "./collection"

export class TransactionManager {
  private store: TransactionStore
  private collection: Collection
  public transactions: Store<SortedMap<string, Transaction>>

  constructor(store: TransactionStore, collection: Collection) {
    this.store = store
    this.collection = collection
    // Initialize store with SortedMap that sorts by created_at
    this.transactions = new Store(
      new SortedMap<string, Transaction>(
        (a, b) => a.created_at.getTime() - b.created_at.getTime()
      )
    )

    // Load transactions from store on init
    this.store.getTransactions().then((transactions) => {
      transactions.forEach((tx) => {
        this.transactions.setState((sortedMap) => {
          sortedMap.set(tx.id, tx)
          return sortedMap
        })
      })
    })
  }

  getTransaction(id: string): Transaction | undefined {
    return this.transactions.state.get(id)
  }

  private setTransaction(transaction: Transaction): void {
    this.transactions.setState((sortedMap) => {
      sortedMap.set(transaction.id, transaction)
      return sortedMap
    })
  }

  createTransaction(
    mutations: PendingMutation[],
    strategy: MutationStrategy
  ): Transaction {
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      state: `pending`,
      created_at: new Date(),
      updated_at: new Date(),
      mutations,
      attempts: [],
      current_attempt: 0,
      strategy,
    }

    // For ordered transactions, check if we need to queue behind another transaction
    if (strategy.type === `ordered`) {
      const activeTransactions = this.getActiveTransactions()
      const orderedTransactions = activeTransactions.filter(
        (tx) => tx.strategy.type === `ordered` && tx.state !== `queued`
      )

      // Find any active transaction that has overlapping mutations
      const conflictingTransaction = orderedTransactions.find((tx) =>
        this.hasOverlappingMutations(tx.mutations, mutations)
      )

      if (conflictingTransaction) {
        transaction.state = `queued`
        transaction.queued_behind = conflictingTransaction.id
      } else {
        transaction.state = `persisting`
        this.setTransaction(transaction)
        console.log(`about to persist`)
        this.collection.config.mutationFn
          .persist({
            transaction,
            attempt: 1,
            changes: transaction.mutations.map((mutation) => mutation.changes),
          })
          .then(() => {
            if (this.collection.config.mutationFn.awaitSync) {
              transaction.state = `persisted_awaiting_sync`
              this.collection.config.mutationFn.awaitSync({ transaction })
            }
            transaction.state = `completed`
            this.setTransaction(transaction)
          })
      }
    }

    this.setTransaction(transaction)
    // Persist async
    this.store.putTransaction(transaction)
    return transaction
  }

  updateTransactionState(id: string, newState: TransactionState): void {
    const transaction = this.getTransaction(id)
    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    // Force a small delay to ensure updated_at is different
    const updatedTransaction: Transaction = {
      ...transaction,
      state: newState,
      updated_at: new Date(Date.now() + 1),
    }

    this.setTransaction(updatedTransaction)
    // Persist async
    this.store.putTransaction(updatedTransaction)

    // If this transaction is completing, check if any are queued behind it
    if (
      (newState === `completed` || newState === `failed`) &&
      transaction.strategy.type === `ordered`
    ) {
      // Get all ordered transactions that are queued behind this one
      const queuedTransactions = Array.from(
        this.transactions.state.values()
      ).filter(
        (tx) =>
          tx.state === `queued` &&
          tx.strategy.type === `ordered` &&
          tx.queued_behind === transaction.id
      )

      // Find the next transaction to run (the one with earliest created_at)
      if (queuedTransactions.length > 0) {
        const nextTransaction = queuedTransactions.reduce(
          (earliest, current) =>
            earliest.created_at < current.created_at ? earliest : current
        )

        // Check if this transaction needs to be queued behind any other active transactions
        const activeTransactions = this.getActiveTransactions()
        const orderedTransactions = activeTransactions.filter(
          (tx) =>
            tx.strategy.type === `ordered` &&
            tx.state !== `queued` &&
            tx.id !== nextTransaction.id
        )

        const conflictingTransaction = orderedTransactions.find((tx) =>
          this.hasOverlappingMutations(tx.mutations, nextTransaction.mutations)
        )

        const updatedNextTransaction: Transaction = {
          ...nextTransaction,
          state: conflictingTransaction ? `queued` : `pending`,
          queued_behind: conflictingTransaction?.id,
          updated_at: new Date(Date.now() + 1),
        }
        this.setTransaction(updatedNextTransaction)

        // Persist async
        this.store.putTransaction(updatedNextTransaction)
      }
    }
  }

  scheduleRetry(id: string, attemptNumber: number): void {
    const transaction = this.getTransaction(id)
    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    // Exponential backoff with jitter
    // Base delay is 1 second, max delay is 30 seconds
    const baseDelay = 1000
    const maxDelay = 30000
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(2, attemptNumber),
      maxDelay
    )

    // Add jitter by increasing delay up to 30%
    const jitterAmount = exponentialDelay * 0.3 // 30% jitter
    const delay = exponentialDelay + Math.random() * jitterAmount

    const retryTime = new Date(Date.now() + delay)

    const attempt = {
      id: crypto.randomUUID(),
      started_at: new Date(),
      retry_scheduled_for: retryTime,
    }

    const updatedTransaction: Transaction = {
      ...transaction,
      attempts: [...transaction.attempts, attempt],
      current_attempt: transaction.current_attempt + 1,
      updated_at: new Date(Date.now() + 1),
    }

    this.setTransaction(updatedTransaction)

    // Persist async
    this.store.putTransaction(updatedTransaction)
  }

  private hasOverlappingMutations(
    mutations1: PendingMutation[],
    mutations2: PendingMutation[]
  ): boolean {
    const ids1 = new Set(mutations1.map((m) => m.original.id))
    const ids2 = new Set(mutations2.map((m) => m.original.id))
    return Array.from(ids1).some((id) => ids2.has(id))
  }

  private getActiveTransactions(): Transaction[] {
    return Array.from(this.transactions.state.values()).filter(
      (tx) => tx.state !== `completed` && tx.state !== `failed`
    )
  }
}
