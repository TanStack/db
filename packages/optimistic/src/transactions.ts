import { createDeferred } from "./deferred"
import type { Deferred } from "./deferred"
import type {
  PendingMutation,
  TransactionConfig,
  TransactionState,
} from "./types"

function generateUUID() {
  // Check if crypto.randomUUID is available (modern browsers and Node.js 15+)
  if (
    typeof crypto !== `undefined` &&
    typeof crypto.randomUUID === `function`
  ) {
    return crypto.randomUUID()
  }

  // Fallback implementation for older environments
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === `x` ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const transactions: Array<Transaction> = []

export function createTransaction(config: TransactionConfig): Transaction {
  if (typeof config.mutationFn === `undefined`) {
    throw `mutationFn is required when creating a transaction`
  }

  let transactionId = config.id
  if (!transactionId) {
    transactionId = generateUUID()
  }
  const newTransaction = new Transaction({ ...config, id: transactionId })
  transactions.push(newTransaction)

  return newTransaction
}

let transactionStack: Array<Transaction> = []

export function getActiveTransaction(): Transaction | undefined {
  if (transactionStack.length > 0) {
    return transactionStack.slice(-1)[0]
  } else {
    return undefined
  }
}

function registerTransaction(tx: Transaction) {
  transactionStack.push(tx)
}

function unregisterTransaction(tx: Transaction) {
  transactionStack = transactionStack.filter((t) => t.id !== tx.id)
}

export class Transaction {
  public id: string
  public state: TransactionState
  public mutationFn
  public mutations: Array<PendingMutation<any>>
  public isPersisted: Deferred<Transaction>
  public autoCommit: boolean
  public createdAt: Date
  public metadata: Record<string, unknown>
  public error?: {
    message: string
    error: Error
  }

  constructor(config: TransactionConfig) {
    this.id = config.id!
    this.mutationFn = config.mutationFn
    this.state = `pending`
    this.mutations = []
    this.isPersisted = createDeferred()
    this.autoCommit = config.autoCommit ?? true
    this.createdAt = new Date()
    this.metadata = config.metadata ?? {}
  }

  setState(newState: TransactionState) {
    this.state = newState
  }

  mutate(callback: () => void): Transaction {
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
        (m) => m.key === newMutation.key
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

  rollback(config?: { isSecondaryRollback?: boolean }): Transaction {
    const isSecondaryRollback = config?.isSecondaryRollback ?? false
    if (this.state === `completed`) {
      throw `You can no longer call .rollback() as the transaction is already completed`
    }

    console.log(`set state to failed`, this)
    this.setState(`failed`)

    // See if there's any other transactions w/ mutations on the same keys
    // and roll them back as well.
    if (!isSecondaryRollback) {
      const mutationKeys = new Set()
      this.mutations.forEach((m) => mutationKeys.add(m.key))
      transactions.forEach(
        (t) =>
          t.state === `pending` &&
          t.mutations.some((m) => mutationKeys.has(m.key)) &&
          t.rollback({ isSecondaryRollback: true })
      )
    }

    // Reject the promise
    this.isPersisted.reject(this.error?.error)

    console.log(`touching collection`, this)
    this.touchCollection()

    console.log(`done rolling back`)

    return this
  }

  // Tell collection that something has changed with the transaction
  touchCollection(): void {
    const hasCalled = new Set()
    this.mutations.forEach((mutation) => {
      if (!hasCalled.has(mutation.collection.id)) {
        mutation.collection.transactions.setState((state) => state)
        mutation.collection.commitPendingTransactions()
        hasCalled.add(mutation.collection.id)
      }
    })
  }

  async commit(): Promise<Transaction> {
    if (this.state !== `pending`) {
      throw `You can no longer call .commit() as the transaction is no longer pending`
    }

    this.setState(`persisting`)

    if (this.mutations.length === 0) {
      this.setState(`completed`)
    }

    // Run mutationFn
    try {
      await this.mutationFn({ transaction: this })

      this.setState(`completed`)
      this.touchCollection()

      this.isPersisted.resolve(this)
    } catch (error) {
      console.error(`Caught error:`, error) // Add this to confirm error capture

      console.log(`DEBUG: Value of 'this' is:`, this)

      console.log(
        `DEBUG: Type of 'error' is:`,
        typeof error,
        `Is instanceof Error?`,
        error instanceof Error
      )
      if (error && typeof error === `object` && !(error instanceof Error)) {
        console.log(
          `DEBUG: 'error' is an object but not an Error instance. Keys:`,
          Object.keys(error)
        )
      }

      try {
        // Update transaction with error information
        this.error = {
          message: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error : new Error(String(error)),
        }
      } catch (assignmentError) {
        console.error(`!!! FAILED TO ASSIGN 'this.error' !!!`)
        console.error(`Assignment error was:`, assignmentError)
        console.error(`Original error object was:`, error)
        console.error(`Value of 'this' during assignment error:`, this)
        // You might want to re-throw or handle this critical failure differently
        // For now, just logging it helps immensely.
      }

      console.log(`after this.error`, this.error)

      // rollback the transaction
      return this.rollback()
    }

    return this
  }
}
