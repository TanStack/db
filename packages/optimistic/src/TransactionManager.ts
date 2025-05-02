import { Store } from "@tanstack/store"
import { SortedMap } from "./SortedMap"
import { createDeferred } from "./deferred"
import type { Collection } from "./collection"
import type { PendingMutation, Transaction, TransactionState } from "./types"

// Singleton instance of TransactionManager with type map

const transactionManagerInstances = new Map<string, TransactionManager<any>>()

/**
 * Get the global TransactionManager instance for a specific type
 * Creates a new instance if one doesn't exist for that type
 *
 * @param collection - The collection this manager is associated with
 * @returns The TransactionManager instance
 */
export function getTransactionManager<
  T extends object = Record<string, unknown>,
>(collection?: Collection<T>): TransactionManager<T> {
  if (!collection) {
    throw new Error(
      `TransactionManager not initialized. You must provide its collection on the first call.`
    )
  }

  if (!transactionManagerInstances.has(collection.id)) {
    transactionManagerInstances.set(
      collection.id,
      new TransactionManager(collection)
    )
  }
  return transactionManagerInstances.get(collection.id) as TransactionManager<T>
}

export class TransactionManager<T extends object = Record<string, unknown>> {
  private collection: Collection<T>
  public transactions: Store<SortedMap<string, Transaction>>

  /**
   * Creates a new TransactionManager instance
   *
   * @param collection - The collection this manager is associated with
   */
  constructor(collection: Collection<T>) {
    this.collection = collection
    // Initialize store with SortedMap that sorts by createdAt
    this.transactions = new Store(
      new SortedMap<string, Transaction>(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )
    )
  }

  /**
   * Retrieves a transaction by its ID
   *
   * @param id - The unique identifier of the transaction
   * @returns The transaction if found, undefined otherwise
   */
  getTransaction(id: string): Transaction | undefined {
    const transaction = this.transactions.state.get(id)

    return transaction
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
          console.warn(
            `Direct modification of transaction properties is not allowed. Use setTransactionState if updating the state`
          )
          return true
        },
      }
    )
  }

  /**
   * Applies mutations to the current transaction. A given transaction accumulates mutations
   * within a single event loop.
   *
   * @param mutations - Array of pending mutations to apply
   * @returns A live reference to the created or updated transaction
   */
  applyTransaction(mutations: Array<PendingMutation>): Transaction {
    // See if there's an existing transaction with overlapping queued mutation.
    const mutationKeys = mutations.map((m) => m.key)
    let transaction: Transaction | undefined = Array.from(
      this.transactions.state.values()
    ).filter(
      (t) =>
        t.state === `pending` &&
        t.mutations.some((m) => mutationKeys.includes(m.key))
    )[0]

    // If there's a transaction, overwrite matching mutations.
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
    } else {
      // Create a new transaction if none exists
      transaction = {
        id: crypto.randomUUID(),
        state: `pending`,
        createdAt: new Date(),
        updatedAt: new Date(),
        mutations,
        metadata: {},
        isPersisted: createDeferred(),
      } as Transaction
    }

    this.setTransaction(transaction)

    // Start processing in the next event loop tick.
    setTimeout(() => {
      this.processTransaction(transaction.id)
    }, 0)

    // Return a live reference to the transaction
    return this.createLiveTransactionReference(transaction.id)
  }

  /**
   * Process a transaction through the mutation function
   *
   * @param transactionId - The ID of the transaction to process
   * @private
   */
  private processTransaction(transactionId: string): void {
    const transaction = this.getTransaction(transactionId)
    if (!transaction) return

    // Throw an error if no mutation function is provided
    if (!this.collection.config.mutationFn) {
      throw new Error(
        `No mutation function provided for transaction ${transactionId}`
      )
    }

    // Set transaction state to persisting
    this.setTransactionState(transactionId, `persisting`)

    // Create a live reference to the transaction that always returns the latest state
    const transactionRef = this.createLiveTransactionReference(transactionId)

    // Call the mutation function
    this.collection.config
      .mutationFn({
        transaction: transactionRef,
        collection: this.collection,
      })
      .then(() => {
        const tx = this.getTransaction(transactionId)
        if (!tx) return

        // Mark as persisted
        tx.isPersisted?.resolve(true)
        this.setTransactionState(transactionId, `completed`)
      })
      .catch((error) => {
        const tx = this.getTransaction(transactionId)
        if (!tx) return

        // Update transaction with error information
        tx.error = {
          message: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error : new Error(String(error)),
        }

        // Reject the promise
        tx.isPersisted?.reject(tx.error.error)

        // Set transaction state to failed
        this.setTransactionState(transactionId, `failed`)
      })
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
  }

  /**
   * Gets all active transactions (those not in completed or failed state)
   *
   * @returns Array of active transactions
   */
  getActiveTransactions(): Array<Transaction> {
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
    mutations1: Array<PendingMutation>,
    mutations2: Array<PendingMutation>
  ): boolean {
    const ids1 = new Set(mutations1.map((m) => m.original.id))
    const ids2 = new Set(mutations2.map((m) => m.original.id))
    return Array.from(ids1).some((id) => ids2.has(id))
  }
}
