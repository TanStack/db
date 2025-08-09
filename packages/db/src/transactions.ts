import { createDeferred } from "./deferred"
import {
  MissingMutationFunctionError,
  TransactionAlreadyCompletedRollbackError,
  TransactionNotPendingCommitError,
  TransactionNotPendingMutateError,
} from "./errors"
import type { Deferred } from "./deferred"
import type {
  MutationFn,
  PendingMutation,
  TransactionConfig,
  TransactionState,
  TransactionWithMutations,
} from "./types"

const transactions: Array<Transaction<any>> = []
let transactionStack: Array<Transaction<any>> = []

let sequenceNumber = 0

/**
 * Creates a new transaction for grouping multiple collection operations
 * @param config - Transaction configuration with mutation function
 * @returns A new Transaction instance
 * @example
 * // Basic transaction usage
 * const tx = createTransaction({
 *   mutationFn: async ({ transaction }) => {
 *     // Send all mutations to API
 *     await api.saveChanges(transaction.mutations)
 *   }
 * })
 *
 * tx.mutate(() => {
 *   collection.insert({ id: "1", text: "Buy milk" })
 *   collection.update("2", draft => { draft.completed = true })
 * })
 *
 * await tx.isPersisted.promise
 *
 * @example
 * // Handle transaction errors
 * try {
 *   const tx = createTransaction({
 *     mutationFn: async () => { throw new Error("API failed") }
 *   })
 *
 *   tx.mutate(() => {
 *     collection.insert({ id: "1", text: "New item" })
 *   })
 *
 *   await tx.isPersisted.promise
 * } catch (error) {
 *   console.log('Transaction failed:', error)
 * }
 *
 * @example
 * // Manual commit control
 * const tx = createTransaction({
 *   autoCommit: false,
 *   mutationFn: async () => {
 *     // API call
 *   }
 * })
 *
 * tx.mutate(() => {
 *   collection.insert({ id: "1", text: "Item" })
 * })
 *
 * // Commit later
 * await tx.commit()
 */
export function createTransaction<T extends object = Record<string, unknown>>(
  config: TransactionConfig<T>
): Transaction<T> {
  const newTransaction = new Transaction<T>(config)
  transactions.push(newTransaction)
  return newTransaction
}

/**
 * Gets the currently active ambient transaction, if any
 * Used internally by collection operations to join existing transactions
 * @returns The active transaction or undefined if none is active
 * @example
 * // Check if operations will join an ambient transaction
 * const ambientTx = getActiveTransaction()
 * if (ambientTx) {
 *   console.log('Operations will join transaction:', ambientTx.id)
 * }
 */
export function getActiveTransaction(): Transaction | undefined {
  if (transactionStack.length > 0) {
    return transactionStack.slice(-1)[0]
  } else {
    return undefined
  }
}

function registerTransaction(tx: Transaction<any>) {
  transactionStack.push(tx)
}

function unregisterTransaction(tx: Transaction<any>) {
  transactionStack = transactionStack.filter((t) => t.id !== tx.id)
}

function removeFromPendingList(tx: Transaction<any>) {
  const index = transactions.findIndex((t) => t.id === tx.id)
  if (index !== -1) {
    transactions.splice(index, 1)
  }
}

class Transaction<T extends object = Record<string, unknown>> {
  public id: string
  public state: TransactionState
  public mutationFn: MutationFn<T>
  public mutations: Array<PendingMutation<T>>
  public isPersisted: Deferred<Transaction<T>>
  public autoCommit: boolean
  public createdAt: Date
  public sequenceNumber: number
  public metadata: Record<string, unknown>
  public error?: {
    message: string
    error: Error
  }

  constructor(config: TransactionConfig<T>) {
    if (typeof config.mutationFn === `undefined`) {
      throw new MissingMutationFunctionError()
    }
    this.id = config.id ?? crypto.randomUUID()
    this.mutationFn = config.mutationFn
    this.state = `pending`
    this.mutations = []
    this.isPersisted = createDeferred<Transaction<T>>()
    this.autoCommit = config.autoCommit ?? true
    this.createdAt = new Date()
    this.sequenceNumber = sequenceNumber++
    this.metadata = config.metadata ?? {}
  }

  setState(newState: TransactionState) {
    this.state = newState

    if (newState === `completed` || newState === `failed`) {
      removeFromPendingList(this)
    }
  }

  /**
   * Execute collection operations within this transaction
   * @param callback - Function containing collection operations to group together
   * @returns This transaction for chaining
   * @example
   * // Group multiple operations
   * const tx = createTransaction({ mutationFn: async () => {
   *   // Send to API
   * }})
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Buy milk" })
   *   collection.update("2", draft => { draft.completed = true })
   *   collection.delete("3")
   * })
   *
   * await tx.isPersisted.promise
   *
   * @example
   * // Handle mutate errors
   * try {
   *   tx.mutate(() => {
   *     collection.insert({ id: "invalid" }) // This might throw
   *   })
   * } catch (error) {
   *   console.log('Mutation failed:', error)
   * }
   *
   * @example
   * // Manual commit control
   * const tx = createTransaction({ autoCommit: false, mutationFn: async () => {} })
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Item" })
   * })
   *
   * // Commit later when ready
   * await tx.commit()
   */
  mutate(callback: () => void): Transaction<T> {
    if (this.state !== `pending`) {
      throw new TransactionNotPendingMutateError()
    }

    registerTransaction(this)
    try {
      callback()
    } finally {
      unregisterTransaction(this)
    }

    if (this.autoCommit) {
      this.commit()
    }

    return this
  }

  applyMutations(mutations: Array<PendingMutation<any>>): void {
    for (const newMutation of mutations) {
      const existingIndex = this.mutations.findIndex(
        (m) => m.globalKey === newMutation.globalKey
      )

      if (existingIndex >= 0) {
        // Replace existing mutation
        this.mutations[existingIndex] = newMutation
      } else {
        // Insert new mutation
        this.mutations.push(newMutation)
      }
    }
  }

  /**
   * Rollback the transaction and any conflicting transactions
   * @param config - Configuration for rollback behavior
   * @returns This transaction for chaining
   * @example
   * // Manual rollback
   * const tx = createTransaction({ mutationFn: async () => {
   *   // Send to API
   * }})
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Buy milk" })
   * })
   *
   * // Rollback if needed
   * if (shouldCancel) {
   *   tx.rollback()
   * }
   *
   * @example
   * // Handle rollback cascade (automatic)
   * const tx1 = createTransaction({ mutationFn: async () => {} })
   * const tx2 = createTransaction({ mutationFn: async () => {} })
   *
   * tx1.mutate(() => collection.update("1", draft => { draft.value = "A" }))
   * tx2.mutate(() => collection.update("1", draft => { draft.value = "B" })) // Same item
   *
   * tx1.rollback() // This will also rollback tx2 due to conflict
   *
   * @example
   * // Handle rollback in error scenarios
   * try {
   *   await tx.isPersisted.promise
   * } catch (error) {
   *   console.log('Transaction was rolled back:', error)
   *   // Transaction automatically rolled back on mutation function failure
   * }
   */
  rollback(config?: { isSecondaryRollback?: boolean }): Transaction<T> {
    const isSecondaryRollback = config?.isSecondaryRollback ?? false
    if (this.state === `completed`) {
      throw new TransactionAlreadyCompletedRollbackError()
    }

    this.setState(`failed`)

    // See if there's any other transactions w/ mutations on the same ids
    // and roll them back as well.
    if (!isSecondaryRollback) {
      const mutationIds = new Set()
      this.mutations.forEach((m) => mutationIds.add(m.globalKey))
      for (const t of transactions) {
        t.state === `pending` &&
          t.mutations.some((m) => mutationIds.has(m.globalKey)) &&
          t.rollback({ isSecondaryRollback: true })
      }
    }

    // Reject the promise
    this.isPersisted.reject(this.error?.error)
    this.touchCollection()

    return this
  }

  // Tell collection that something has changed with the transaction
  touchCollection(): void {
    const hasCalled = new Set()
    for (const mutation of this.mutations) {
      if (!hasCalled.has(mutation.collection.id)) {
        mutation.collection.onTransactionStateChange()

        // Only call commitPendingTransactions if there are pending sync transactions
        if (mutation.collection.pendingSyncedTransactions.length > 0) {
          mutation.collection.commitPendingTransactions()
        }

        hasCalled.add(mutation.collection.id)
      }
    }
  }

  /**
   * Commit the transaction and execute the mutation function
   * @returns Promise that resolves to this transaction when complete
   * @example
   * // Manual commit (when autoCommit is false)
   * const tx = createTransaction({
   *   autoCommit: false,
   *   mutationFn: async ({ transaction }) => {
   *     await api.saveChanges(transaction.mutations)
   *   }
   * })
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Buy milk" })
   * })
   *
   * await tx.commit() // Manually commit
   *
   * @example
   * // Handle commit errors
   * try {
   *   const tx = createTransaction({
   *     mutationFn: async () => { throw new Error("API failed") }
   *   })
   *
   *   tx.mutate(() => {
   *     collection.insert({ id: "1", text: "Item" })
   *   })
   *
   *   await tx.commit()
   * } catch (error) {
   *   console.log('Commit failed, transaction rolled back:', error)
   * }
   *
   * @example
   * // Check transaction state after commit
   * await tx.commit()
   * console.log(tx.state) // "completed" or "failed"
   */
  async commit(): Promise<Transaction<T>> {
    if (this.state !== `pending`) {
      throw new TransactionNotPendingCommitError()
    }

    this.setState(`persisting`)

    if (this.mutations.length === 0) {
      this.setState(`completed`)
      this.isPersisted.resolve(this)

      return this
    }

    // Run mutationFn
    try {
      // At this point we know there's at least one mutation
      // We've already verified mutations is non-empty, so this cast is safe
      // Use a direct type assertion instead of object spreading to preserve the original type
      await this.mutationFn({
        transaction: this as unknown as TransactionWithMutations<T>,
      })

      this.setState(`completed`)
      this.touchCollection()

      this.isPersisted.resolve(this)
    } catch (error) {
      // Update transaction with error information
      this.error = {
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error : new Error(String(error)),
      }

      // rollback the transaction
      return this.rollback()
    }

    return this
  }

  /**
   * Compare two transactions by their createdAt time and sequence number in order
   * to sort them in the order they were created.
   * @param other - The other transaction to compare to
   * @returns -1 if this transaction was created before the other, 1 if it was created after, 0 if they were created at the same time
   */
  compareCreatedAt(other: Transaction<any>): number {
    const createdAtComparison =
      this.createdAt.getTime() - other.createdAt.getTime()
    if (createdAtComparison !== 0) {
      return createdAtComparison
    }
    return this.sequenceNumber - other.sequenceNumber
  }
}

export type { Transaction }
