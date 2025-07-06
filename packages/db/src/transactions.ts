import { createDeferred } from "./deferred"
import type { Deferred } from "./deferred"
import type {
  MutationFn,
  OperationType,
  PendingMutation,
  TransactionConfig,
  TransactionState,
  TransactionWithMutations,
} from "./types"

const transactions: Array<Transaction<any>> = []
let transactionStack: Array<Transaction<any>> = []

let sequenceNumber = 0

export function createTransaction<
  TData extends object = Record<string, unknown>,
>(config: TransactionConfig<TData>): Transaction<TData> {
  const newTransaction = new Transaction<TData>(config)
  transactions.push(newTransaction)
  return newTransaction
}

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

class Transaction<
  T extends object = Record<string, unknown>,
  TOperation extends OperationType = OperationType,
> {
  public id: string
  public state: TransactionState
  public mutationFn: MutationFn<T>
  public mutations: Array<PendingMutation<T, TOperation>>
  public isPersisted: Deferred<Transaction<T, TOperation>>
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
      throw `mutationFn is required when creating a transaction`
    }
    this.id = config.id ?? crypto.randomUUID()
    this.mutationFn = config.mutationFn
    this.state = `pending`
    this.mutations = []
    this.isPersisted = createDeferred<Transaction<T, TOperation>>()
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

  mutate(callback: () => void): Transaction<T> {
    if (this.state !== `pending`) {
      throw `You can no longer call .mutate() as the transaction is no longer pending`
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

  rollback(config?: { isSecondaryRollback?: boolean }): Transaction<T> {
    const isSecondaryRollback = config?.isSecondaryRollback ?? false
    if (this.state === `completed`) {
      throw `You can no longer call .rollback() as the transaction is already completed`
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

  async commit(): Promise<Transaction<T>> {
    if (this.state !== `pending`) {
      throw `You can no longer call .commit() as the transaction is no longer pending`
    }

    this.setState(`persisting`)

    if (this.mutations.length === 0) {
      this.setState(`completed`)

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
