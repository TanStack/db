import { Store } from "@tanstack/store"
import type {
  Transaction,
  TransactionState,
  PendingMutation,
  MutationStrategy,
  Attempt,
} from "./types"
import { TransactionStore } from "./TransactionStore"
import { SortedMap } from "./SortedMap"
import { Collection } from "./collection"
import { createDeferred } from "./deferred"

// Singleton instance of TransactionManager with type map
// eslint-disable-next-line
const transactionManagerInstances = new Map<string, TransactionManager<any>>()

/**
 * Get the global TransactionManager instance for a specific type
 * Creates a new instance if one doesn't exist for that type
 *
 * @param store - The transaction store for persistence
 * @param collection - The collection this manager is associated with
 * @returns The TransactionManager instance
 */
export function getTransactionManager<
  T extends object = Record<string, unknown>,
>(store?: TransactionStore, collection?: Collection<T>): TransactionManager<T> {
  if (!store || !collection) {
    throw new Error(
      `TransactionManager not initialized. You must provide store and collection parameters on first call.`
    )
  }

  if (!transactionManagerInstances.has(collection.id)) {
    transactionManagerInstances.set(
      collection.id,
      new TransactionManager(store, collection)
    )
  }
  return transactionManagerInstances.get(collection.id) as TransactionManager<T>
}

export class TransactionManager<T extends object = Record<string, unknown>> {
  private store: TransactionStore
  private collection: Collection<T>
  public transactions: Store<SortedMap<string, Transaction>>

  /**
   * Creates a new TransactionManager instance
   *
   * @param store - The transaction store for persistence
   * @param collection - The collection this manager is associated with
   */
  constructor(store: TransactionStore, collection: Collection<T>) {
    this.store = store
    this.collection = collection
    // Initialize store with SortedMap that sorts by createdAt
    this.transactions = new Store(
      new SortedMap<string, Transaction>(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
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

  /**
   * Retrieves a transaction by its ID
   *
   * @param id - The unique identifier of the transaction
   * @returns The transaction if found, undefined otherwise
   */
  getTransaction(id: string): Transaction | undefined {
    return this.transactions.state.get(id)
  }

  private setTransaction(transaction: Transaction): void {
    this.transactions.setState((sortedMap) => {
      sortedMap.set(transaction.id, transaction)
      return sortedMap
    })

    this.collection.commitPendingTransactions()
  }

  /**
   * Create a live transaction reference that always returns the latest values
   * @param id Transaction ID
   * @returns A proxy that always gets the latest transaction values
   */
  createLiveTransactionReference(id: string): Transaction {
    // eslint-disable-next-line
    const self: TransactionManager<T> = this
    return new Proxy(
      {
        // Implement the toObject method directly on the proxy target
        toObject() {
          const transaction = self.getTransaction(id)
          if (!transaction) {
            throw new Error(`Transaction with id ${id} not found`)
          }

          // Create a shallow copy of the transaction without the toObject method
          // eslint-disable-next-line
          const { toObject, ...transactionData } = transaction
          return { ...transactionData }
        },
      } as Transaction,
      {
        get(target, prop) {
          // If the property is toObject, return the method from the target
          if (prop === `toObject`) {
            return target.toObject
          }

          // Otherwise, get the latest transaction data
          const latest = self.getTransaction(id)
          if (!latest) {
            throw new Error(`Transaction with id ${id} not found`)
          }
          return latest[prop as keyof Transaction]
        },
        set() {
          // We don't allow direct setting of properties on the transaction
          // Use setTransactionState or setMetadata instead
          console.warn(
            `Direct modification of transaction properties is not allowed. Use setTransactionState or setMetadata instead.`
          )
          return true
        },
      }
    )
  }

  /**
   * Applies a transaction with the given mutations using the specified strategy
   *
   * @param mutations - Array of pending mutations to apply
   * @param strategy - Strategy to use when applying the transaction
   * @returns A live reference to the created or updated transaction
   */
  applyTransaction(
    mutations: PendingMutation[],
    strategy: MutationStrategy
  ): Transaction {
    // See if there's an existing overlapping queued mutation.
    const mutationKeys = mutations.map((m) => m.key)
    let transaction: Transaction = Array.from(
      this.transactions.state.values()
    ).filter(
      (t) =>
        t.state === `queued` &&
        t.mutations.some((m) => mutationKeys.includes(m.key))
    )[0]

    // If there's a map, overwrite matching mutations.
    if (transaction) {
      for (const newMutation of mutations) {
        const existingIndex = transaction.mutations.findIndex(
          (m) => m.key === newMutation.key
        )

        if (existingIndex >= 0) {
          // Replace existing mutation
          // TODO this won't work for cases where different mutations modify different keys
          transaction.mutations[existingIndex] = newMutation
        } else {
          // Insert new mutation
          transaction.mutations.push(newMutation)
        }
      }
      // Else create a new transaction.
    } else {
      transaction = {
        id: crypto.randomUUID(),
        state: `pending`,
        createdAt: new Date(),
        updatedAt: new Date(),
        mutations,
        metadata: {},
        attempts: [],
        currentAttempt: 0,
        strategy,
        isSynced: createDeferred(),
        isPersisted: createDeferred(),
      }
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
        transaction.queuedBehind = conflictingTransaction.id
      } else {
        transaction.state = `persisting`
        this.setTransaction(transaction)
        this.collection.config.mutationFn
          .persist({
            transaction: this.createLiveTransactionReference(transaction.id),
            attempt: 1,
            collection: this.collection,
          })
          .then(() => {
            const tx = this.getTransaction(transaction.id)
            if (!tx) return

            tx.isPersisted?.resolve(true)
            if (this.collection.config.mutationFn.awaitSync) {
              this.setTransactionState(
                transaction.id,
                `persisted_awaiting_sync`
              )

              this.collection.config.mutationFn
                .awaitSync({
                  transaction: this.createLiveTransactionReference(
                    transaction.id
                  ),
                  collection: this.collection,
                })
                .then(() => {
                  const updatedTx = this.getTransaction(transaction.id)
                  if (!updatedTx) return

                  updatedTx.isSynced?.resolve(true)
                  this.setTransactionState(transaction.id, `completed`)
                })
                // Catch awaitSync errors
                .catch((error) => {
                  const updatedTx = this.getTransaction(transaction.id)
                  if (!updatedTx) return

                  // Update transaction with error information
                  updatedTx.error = {
                    message: error.message || `Error during sync`,
                    error:
                      error instanceof Error ? error : new Error(String(error)),
                  }

                  // Reject the isSynced promise
                  updatedTx.isSynced?.reject(error)

                  // Set transaction state to failed
                  this.setTransaction(updatedTx)
                  this.setTransactionState(transaction.id, `failed`)
                })
            } else {
              this.setTransactionState(transaction.id, `completed`)
            }
          })
          .catch((error) => {
            const tx = this.getTransaction(transaction.id)
            if (!tx) return

            // Update transaction with error information
            tx.error = {
              message: error.message || `Error during persist`,
              error: error instanceof Error ? error : new Error(String(error)),
            }

            // Reject both promises
            tx.isPersisted?.reject(error)
            tx.isSynced?.reject(error)

            // Set transaction state to failed
            this.setTransactionState(transaction.id, `failed`)
          })
      }
    }

    this.setTransaction(transaction)
    // Persist async
    this.store.putTransaction(transaction)

    // Return a live reference to the transaction
    return this.createLiveTransactionReference(transaction.id)
  }

  /**
   * Updates the state of a transaction
   *
   * @param id - The unique identifier of the transaction
   * @param newState - The new state to set
   * @throws Error if the transaction is not found
   */
  setTransactionState(id: string, newState: TransactionState): void {
    const transaction = this.getTransaction(id)
    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    // Force a small delay to ensure updatedAt is different
    const updatedTransaction: Transaction = {
      ...transaction,
      state: newState,
      updatedAt: new Date(Date.now() + 1),
    }

    this.setTransaction(updatedTransaction)

    // Check if the transaction is in a terminal state
    if (newState === `completed` || newState === `failed`) {
      // Delete from IndexedDB if in terminal state
      this.store.deleteTransaction(id)
    } else {
      // Persist async only if not in terminal state
      this.store.putTransaction(updatedTransaction)
    }

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
          tx.queuedBehind === transaction.id
      )

      // Process each queued transaction
      for (const queuedTransaction of queuedTransactions) {
        queuedTransaction.queuedBehind = undefined
        this.setTransaction(queuedTransaction)
        this.setTransactionState(queuedTransaction.id, `persisting`)
        this.collection.config.mutationFn
          .persist({
            transaction: this.createLiveTransactionReference(
              queuedTransaction.id
            ),
            attempt: 1,
            collection: this.collection,
          })
          .then(() => {
            const tx = this.getTransaction(queuedTransaction.id)
            if (!tx) return

            tx.isPersisted?.resolve(true)
            if (this.collection.config.mutationFn.awaitSync) {
              this.setTransactionState(
                queuedTransaction.id,
                `persisted_awaiting_sync`
              )

              this.collection.config.mutationFn
                .awaitSync({
                  transaction: this.createLiveTransactionReference(
                    queuedTransaction.id
                  ),
                  collection: this.collection,
                })
                .then(() => {
                  const updatedTx = this.getTransaction(queuedTransaction.id)
                  if (!updatedTx) return

                  updatedTx.isSynced?.resolve(true)
                  this.setTransactionState(queuedTransaction.id, `completed`)
                })
            } else {
              this.setTransactionState(queuedTransaction.id, `completed`)
            }
          })
      }
    }
  }

  /**
   * Sets metadata for a transaction
   *
   * @param id - The unique identifier of the transaction
   * @param metadata - The metadata to set or merge with existing metadata
   * @throws Error if the transaction is not found
   */
  setMetadata(id: string, metadata: Record<string, unknown>): Transaction {
    const transaction = this.getTransaction(id)
    if (!transaction) {
      throw new Error(`Transaction ${id} not found`)
    }

    // Create a new metadata object by merging the existing metadata with the new one
    const updatedMetadata = {
      ...(transaction.metadata || {}),
      ...metadata,
    }

    // Create updated transaction with new metadata
    const updatedTransaction: Transaction = {
      ...transaction,
      metadata: updatedMetadata,
      updatedAt: new Date(),
    }

    // Update in memory
    this.setTransaction(updatedTransaction)

    // Persist to storage
    this.store.putTransaction(updatedTransaction)

    // Return a live reference to the transaction
    return this.createLiveTransactionReference(id)
  }

  /**
   * Schedules a retry for a failed transaction
   *
   * @param id - The unique identifier of the transaction
   * @param attemptNumber - The attempt number for this retry
   */
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

    const attempt: Attempt = {
      id: crypto.randomUUID(),
      startedAt: new Date(),
      retryScheduledFor: retryTime,
    }

    const updatedTransaction: Transaction = {
      ...transaction,
      attempts: [...transaction.attempts, attempt],
      currentAttempt: transaction.currentAttempt + 1,
      updatedAt: new Date(Date.now() + 1),
    }

    this.setTransaction(updatedTransaction)

    // Persist async
    this.store.putTransaction(updatedTransaction)
  }

  /**
   * Gets all active transactions (those not in completed or failed state)
   *
   * @returns Array of active transactions
   */
  getActiveTransactions(): Transaction[] {
    return Array.from(this.transactions.state.values()).filter(
      (tx) => tx.state !== `completed` && tx.state !== `failed`
    )
  }

  /**
   * Checks if two sets of mutations have overlapping keys
   *
   * @param mutations1 - First set of mutations
   * @param mutations2 - Second set of mutations
   * @returns True if there are overlapping mutations, false otherwise
   */
  hasOverlappingMutations(
    mutations1: PendingMutation[],
    mutations2: PendingMutation[]
  ): boolean {
    const ids1 = new Set(mutations1.map((m) => m.original.id))
    const ids2 = new Set(mutations2.map((m) => m.original.id))
    return Array.from(ids1).some((id) => ids2.has(id))
  }
}
