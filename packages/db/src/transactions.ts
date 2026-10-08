import { createDeferred } from './deferred'
import { deepEquals } from './utils'
import { safeRandomUUID } from './utils/uuid'
import { normalizeError } from './utils/error.js'
import './duplicate-instance-check'
import {
  MissingMutationFunctionError,
  TransactionAlreadyCompletedRollbackError,
  TransactionNotPendingCommitError,
  TransactionNotPendingMutateError,
} from './errors'
import { transactionScopedScheduler } from './scheduler.js'
import { takeTransactionCommitWork } from './transaction-commit-work.js'
import { codedMessage, devBuild } from './error-message.js'
import type { Deferred } from './deferred'
import type { Collection } from './collection/index.js'
import type {
  MutationFn,
  PendingMutation,
  TransactionConfig,
  TransactionState,
  TransactionWithMutations,
} from './types'

export class TransactionScope {
  private transactions: Array<Transaction<any>> = []
  private transactionStack: Array<Transaction<any>> = []
  private sequenceNumber = 0

  createTransaction<T extends object = Record<string, unknown>>(
    config: TransactionConfig<T>,
  ): Transaction<T> {
    const transaction = new Transaction<T>(config, this, this.sequenceNumber++)
    this.transactions.push(transaction)
    return transaction
  }

  getActiveTransaction(): Transaction | undefined {
    return this.transactionStack.at(-1)
  }

  getActiveTransactionForCollection(): Transaction | undefined {
    const activeTransaction = this.getActiveTransaction()
    if (activeTransaction) {
      return activeTransaction
    }

    if (this === defaultTransactionScope) {
      return undefined
    }

    return defaultTransactionScope.claimActiveTransaction(this)
  }

  private claimActiveTransaction(
    targetScope: TransactionScope,
  ): Transaction | undefined {
    const transaction = this.getActiveTransaction()
    if (!transaction) {
      return undefined
    }

    const owner = getTransactionScope(transaction)
    if (owner === targetScope) {
      return transaction
    }
    if (owner !== this) {
      throw new Error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `A transaction created with createTransaction() cannot mutate collections from multiple DbClient instances. Use dbClient.createTransaction() for explicit client scope.`
          : codedMessage(162),
      )
    }

    this.removeTransaction(transaction)
    targetScope.transactions.push(transaction)
    targetScope.transactionStack.push(transaction)
    transaction.sequenceNumber = targetScope.sequenceNumber++
    transactionScopes.set(transaction, targetScope)
    return transaction
  }

  registerTransaction(transaction: Transaction<any>): void {
    // Clear stale work left by an aborted mutate scope before reusing the id.
    transactionScopedScheduler.clear(transaction.id)
    this.transactionStack.push(transaction)
  }

  unregisterTransaction(
    transaction: Transaction<any>,
    contextAlreadyCleared = false,
  ): void {
    try {
      transactionScopedScheduler.flush(transaction.id)
    } finally {
      if (!contextAlreadyCleared) this.clearTransactionContext(transaction)
    }
  }

  clearTransactionContext(transaction: Transaction<any>): void {
    const index = this.transactionStack.lastIndexOf(transaction)
    if (index !== -1) this.transactionStack.splice(index, 1)
  }

  removeTransaction(transaction: Transaction<any>): void {
    const index = this.transactions.indexOf(transaction)
    if (index !== -1) {
      this.transactions.splice(index, 1)
    }
  }

  /** Rolls back every conflicting candidate and returns their errors. */
  rollbackConflictingTransactions(
    transaction: Transaction<any>,
    mutationIds: Set<string>,
  ): Array<unknown> {
    const errors: Array<unknown> = []
    for (const candidate of [...this.transactions]) {
      if (
        candidate !== transaction &&
        candidate.state === `pending` &&
        candidate.mutations.some((mutation) =>
          mutationIds.has(mutation.globalKey),
        )
      ) {
        try {
          errors.push(...candidate.rollbackSettlingErrors(true))
        } catch (error) {
          errors.push(error)
        }
      }
    }
    return errors
  }

  clear(): void {
    const transactionIds = new Set([
      ...this.transactions.map((transaction) => transaction.id),
      ...this.transactionStack.map((transaction) => transaction.id),
    ])
    for (const transactionId of transactionIds) {
      transactionScopedScheduler.clear(transactionId)
    }
    this.transactions = []
    this.transactionStack = []
  }
}

const defaultTransactionScope = new TransactionScope()
const transactionScopes = new WeakMap<object, TransactionScope>()
const transactionAmbientScopes = new WeakMap<object, TransactionScope>()

function getTransactionScope(transaction: object): TransactionScope {
  const scope = transactionScopes.get(transaction)
  if (!scope) {
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Transaction is not associated with a TransactionScope.`
        : codedMessage(163),
    )
  }
  return scope
}

/** One flat `AggregateError` of settlement errors, caused by the first. */
function settlementFailure(errors: Array<unknown>): AggregateError {
  return new AggregateError(
    errors,
    devBuild() && process.env.NODE_ENV !== `production`
      ? `Transaction settlement failed`
      : codedMessage(234),
    { cause: errors[0] },
  )
}

/** Rethrows one settlement error as is, or several as an `AggregateError`. */
function throwSettlementErrors(errors: Array<unknown>): void {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw settlementFailure(errors)
}

function getTransactionAmbientScope(transaction: object): TransactionScope {
  const scope = transactionAmbientScopes.get(transaction)
  if (!scope) {
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Transaction is not associated with an ambient scope.`
        : codedMessage(164),
    )
  }
  return scope
}

/**
 * Merges two pending mutations for the same item within a transaction
 *
 * Merge behavior truth table:
 * - (insert, update) → insert (merge changes, keep empty original)
 * - (insert, delete) → null (cancel both mutations)
 * - (update, delete) → delete (delete dominates)
 * - (update, update) → update (replace with latest, union changes)
 * - (delete, delete) → delete (replace with latest)
 * - (insert, insert) → insert (replace with latest)
 * - (delete, insert) → insert without an authoritative row, null if restoring
 *   the authoritative row, otherwise update
 *
 * Note: (delete, update) should never occur as the collection layer prevents
 * update operations on deleted items within the same transaction.
 *
 * @param existing - The existing mutation in the transaction
 * @param incoming - The new mutation being applied
 * @returns The merged mutation, or null if both should be removed
 */
function mergePendingMutations<T extends object>(
  existing: PendingMutation<T>,
  incoming: PendingMutation<T>,
): PendingMutation<T> | null {
  // Truth table implementation
  switch (`${existing.type}-${incoming.type}` as const) {
    case `insert-update`: {
      // Update after insert: keep as insert but merge changes
      // For insert-update, the key should remain the same since collections don't allow key changes
      return {
        ...existing,
        type: `insert` as const,
        original: {},
        modified: incoming.modified,
        changes: { ...existing.changes, ...incoming.changes },
        // Keep existing keys (key changes not allowed in updates)
        key: existing.key,
        globalKey: existing.globalKey,
        // Merge metadata (last-write-wins)
        metadata: incoming.metadata ?? existing.metadata,
        syncMetadata: { ...existing.syncMetadata, ...incoming.syncMetadata },
        // Update tracking info
        mutationId: incoming.mutationId,
        updatedAt: incoming.updatedAt,
      }
    }

    case `insert-delete`:
      // Delete after insert: cancel both mutations
      return null

    case `update-delete`:
    case `delete-delete`:
      // Delete dominates an update or earlier delete.
      return incoming

    case `update-update`: {
      // Update after update: replace with latest, union changes
      return {
        ...incoming,
        // Keep original from first update
        original: existing.original,
        // Union the changes from both updates
        changes: { ...existing.changes, ...incoming.changes },
        // Merge metadata
        metadata: incoming.metadata ?? existing.metadata,
        syncMetadata: { ...existing.syncMetadata, ...incoming.syncMetadata },
      }
    }

    case `insert-insert`:
      // Same type: replace with latest
      return incoming

    case `delete-insert`: {
      const original = existing.collection._state.syncedData.get(existing.key)
      if (original === undefined) return incoming
      if (deepEquals(original, incoming.modified)) {
        return null
      }

      const modified = incoming.modified
      const keys = new Set([...Object.keys(original), ...Object.keys(modified)])
      const changes: Partial<T> = {}
      for (const key of keys) {
        if (
          Object.hasOwn(original, key) !== Object.hasOwn(modified, key) ||
          !deepEquals(original[key as keyof T], modified[key as keyof T])
        ) {
          changes[key as keyof T] = modified[key as keyof T]
        }
      }

      return {
        ...incoming,
        type: `update`,
        original,
        changes,
        metadata: incoming.metadata ?? existing.metadata,
        syncMetadata: { ...existing.syncMetadata, ...incoming.syncMetadata },
      }
    }

    default: {
      // Exhaustiveness check
      const _exhaustive: never = `${existing.type}-${incoming.type}` as never
      throw new Error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `Unhandled mutation combination: ${_exhaustive}`
          : codedMessage(165, { combination: _exhaustive }),
      )
    }
  }
}

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
 * await tx.when('settled')
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
 *   await tx.when('settled')
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
  config: TransactionConfig<T>,
): Transaction<T> {
  return defaultTransactionScope.createTransaction(config)
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
  return defaultTransactionScope.getActiveTransaction()
}

class Transaction<T extends object = Record<string, unknown>> {
  public id: string
  public state: TransactionState
  public mutationFn: MutationFn<T>
  public mutations: Array<PendingMutation<T>>
  /**
   * Every Collection that has tracked this transaction. Settlement recomputes
   * each of them, including one whose mutations merged away.
   */
  public readonly collections: Set<Collection<any, any, any, any, any>> =
    new Set()
  private captureMutations?: () => void
  /**
   * Deferred that settles when this transaction settles.
   *
   * Await `when('settled')` instead. This legacy promise resolves
   * when the transaction completes successfully and rejects if the transaction
   * fails or is rolled back.
   *
   * For non-empty commits, the mutation function is the normal settlement
   * boundary. This does not inherently prove that a backend has uploaded,
   * confirmed, or read back the write unless the mutation function waits for
   * that backend observation before returning. An adapter can also register
   * commit work during the mutation function; settlement waits for that work.
   *
   * @deprecated Use `when('settled')` instead. This alias will be removed in
   * the 1.0 RC.
   */
  public isPersisted: Deferred<Transaction<T>>
  public autoCommit: boolean
  public createdAt: Date
  public sequenceNumber: number
  public metadata: Record<string, unknown>
  public error?: {
    message: string
    error: Error
  }

  constructor(
    config: TransactionConfig<T>,
    scope: TransactionScope,
    sequenceNumber: number,
  ) {
    if (typeof config.mutationFn === `undefined`) {
      throw new MissingMutationFunctionError()
    }
    this.id = config.id ?? safeRandomUUID()
    this.mutationFn = config.mutationFn
    this.state = `pending`
    this.mutations = []
    this.isPersisted = createDeferred<Transaction<T>>()
    this.autoCommit = config.autoCommit ?? true
    this.createdAt = new Date()
    this.sequenceNumber = sequenceNumber
    this.metadata = config.metadata ?? {}
    transactionScopes.set(this, scope)
    transactionAmbientScopes.set(this, scope)
  }

  /**
   * Wait for this transaction to complete successfully or fail.
   *
   * The promise resolves with this transaction on success and rejects with
   * the original error on failure (or `undefined` for a rollback without an
   * error). For non-empty commits, this
   * boundary is the mutation function's completion; it does not inherently
   * prove backend acknowledgement or read-back unless the mutation function
   * or an adapter-registered commit work item waits for it.
   */
  when(_state: 'settled'): Promise<Transaction<T>> {
    return this.isPersisted.promise
  }

  setState(newState: TransactionState) {
    this.state = newState

    if (newState === `completed` || newState === `failed`) {
      getTransactionScope(this).removeTransaction(this)
    }
  }

  /**
   * Execute collection operations within this transaction
   * @param callback - Synchronous function containing collection operations to group together.
   * The transaction context is active only for the synchronous duration of this callback.
   * Async work should happen in `mutationFn`; collection operations after `await` boundaries
   * inside this callback will not be part of this transaction. For manual transactions, call
   * `mutate` multiple times before committing to add more synchronous operations to the same
   * transaction. If this callback throws, its mutations are removed before the
   * error reaches the caller; mutations from earlier successful calls remain.
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
   * await tx.when('settled')
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
   * // Add more synchronous mutations to the same transaction
   * tx.mutate(() => {
   *   collection.update("1", draft => { draft.text = "Updated item" })
   * })
   *
   * // Commit later when ready
   * await tx.commit()
   */
  mutate(callback: () => void): Transaction<T> {
    if (this.state !== `pending`) {
      throw new TransactionNotPendingMutateError()
    }

    const initialScope = getTransactionScope(this)
    const registeredScopes = new Set([
      initialScope,
      getTransactionAmbientScope(this),
    ])
    for (const scope of registeredScopes) {
      scope.registerTransaction(this)
    }

    let previousMutations: Array<PendingMutation<T>> | undefined
    const captureOuter = this.captureMutations
    this.captureMutations = () => {
      captureOuter?.()
      previousMutations ??= [...this.mutations]
    }
    let contextAlreadyCleared = false
    try {
      callback()
    } catch (error) {
      // Keep successful earlier callbacks when this one fails after changing
      // one or more Collections. The original mutation objects are immutable
      // snapshots; later same-key merges replace them rather than editing them.
      const before = previousMutations ?? this.mutations
      const touched = new Set(
        [...before, ...this.mutations].map((mutation) => mutation.collection),
      )
      if (previousMutations)
        this.mutations.splice(0, this.mutations.length, ...previousMutations)
      // Restoration publishes outside the failed callback's transaction
      // context. A subscriber's new write must not join this transaction.
      registeredScopes.add(getTransactionScope(this))
      for (const scope of registeredScopes) scope.clearTransactionContext(this)
      contextAlreadyCleared = true
      const restorationErrors: Array<unknown> = []
      for (const collection of touched) {
        try {
          collection._state.onTransactionStateChange()
        } catch (restorationError) {
          restorationErrors.push(restorationError)
        }
      }
      if (restorationErrors.length)
        throw new AggregateError(
          [error, ...restorationErrors],
          devBuild() && process.env.NODE_ENV !== `production`
            ? `Mutation callback and restoration failed`
            : codedMessage(174),
          { cause: error },
        )
      throw error
    } finally {
      this.captureMutations = captureOuter
      registeredScopes.add(getTransactionScope(this))
      for (const scope of registeredScopes) {
        scope.unregisterTransaction(this, contextAlreadyCleared)
      }
    }

    if (this.autoCommit) {
      this.commit().catch(() => {
        // Errors from autoCommit are handled via isPersisted.promise
        // This catch prevents unhandled promise rejections
      })
    }

    return this
  }

  /**
   * Apply new mutations to this transaction, intelligently merging with existing mutations
   *
   * When mutations operate on the same item (same globalKey), they are merged according to
   * the following rules:
   *
   * - **insert + update** → insert (merge changes, keep empty original)
   * - **insert + delete** → removed (mutations cancel each other out)
   * - **update + delete** → delete (delete dominates)
   * - **update + update** → update (union changes, keep first original)
   * - **delete + insert** → removed if restored, otherwise update
   * - **same type** → replace with latest
   *
   * This merging reduces over-the-wire churn and keeps the optimistic local view
   * aligned with user intent.
   *
   * @param mutations - Array of new mutations to apply
   */
  applyMutations(mutations: Array<PendingMutation<any>>): void {
    this.captureMutations?.()
    // Merge via a globalKey-keyed map rather than a findIndex scan per
    // mutation, which is O(n²) for bulk operations (e.g. inserting many rows
    // in one call). Map preserves insertion order, matching the previous
    // replace-in-place / remove / append semantics.
    const merged = new Map<string, PendingMutation<any>>()
    for (const mutation of this.mutations) {
      merged.set(mutation.globalKey, mutation)
    }

    for (const newMutation of mutations) {
      const existingMutation = merged.get(newMutation.globalKey)

      if (existingMutation) {
        const mergeResult = mergePendingMutations(existingMutation, newMutation)

        if (mergeResult === null) {
          // Remove the mutation (e.g., delete after insert cancels both)
          merged.delete(newMutation.globalKey)
        } else {
          // Replace with merged mutation
          merged.set(newMutation.globalKey, mergeResult)
        }
      } else {
        // Insert new mutation
        merged.set(newMutation.globalKey, newMutation)
      }
    }

    // Rebuild in place to preserve the array's identity for external holders
    this.mutations.length = 0
    for (const mutation of merged.values()) {
      this.mutations.push(mutation)
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
   *   await tx.when('settled')
   * } catch (error) {
   *   console.log('Transaction was rolled back:', error)
   *   // Transaction automatically rolled back on mutation function failure
   * }
   */
  rollback(config?: {
    isSecondaryRollback?: boolean
    error?: Error
  }): Transaction<T> {
    throwSettlementErrors(
      this.rollbackSettlingErrors(
        config?.isSecondaryRollback ?? false,
        config?.error,
      ),
    )
    return this
  }

  /**
   * Rolls back and returns the settlement errors, flat, instead of throwing
   * them, so a caller that settles several transactions reports one flat list.
   * @internal
   */
  rollbackSettlingErrors(
    isSecondaryRollback: boolean,
    error?: Error,
  ): Array<unknown> {
    if (this.state === `completed`) {
      throw new TransactionAlreadyCompletedRollbackError()
    }
    if (this.state === `failed`) return []
    // A settled transaction keeps the error it settled with.
    if (error) {
      this.error = { message: error.message, error }
    }

    this.setState(`failed`)

    // A failing subscriber cannot leave this transaction unsettled, so each
    // step runs and their errors are reported together.
    const errors: Array<unknown> = []
    // See if there's any other transactions w/ mutations on the same ids
    // and roll them back as well.
    if (!isSecondaryRollback) {
      const mutationIds = new Set(
        this.mutations.map((mutation) => mutation.globalKey),
      )
      errors.push(
        ...getTransactionScope(this).rollbackConflictingTransactions(
          this,
          mutationIds,
        ),
      )
    }

    // Reject the promise
    this.isPersisted.reject(this.error?.error)
    errors.push(...this.settleCollections())
    return errors
  }

  // Tell collection that something has changed with the transaction
  touchCollection(): void {
    throwSettlementErrors(this.settleCollections())
  }

  /**
   * Recomputes every Collection that tracked this transaction and returns
   * their errors. A failure in one Collection must not leave the others
   * showing this transaction's settled optimistic state. A settled
   * transaction then empties its set of tracking Collections. Its mutations
   * still name their Collection.
   * Not `private`: `TransactionWithMutations` omits a key, which drops
   * private members, and a Transaction with one is then not assignable.
   * @internal
   */
  settleCollections(): Array<unknown> {
    const collections = new Set(this.collections)
    for (const mutation of this.mutations) collections.add(mutation.collection)
    if (this.state === `completed` || this.state === `failed`)
      this.collections.clear()
    const errors: Array<unknown> = []
    for (const collection of collections) {
      try {
        collection._state.onTransactionStateChange()

        // Only call commitPendingTransactions if there are pending sync transactions
        if (collection._state.pendingSyncedTransactions.length > 0) {
          collection._state.commitPendingTransactions()
        }
      } catch (error) {
        errors.push(error)
      }
    }
    return errors
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
      // A Collection whose mutations merged away still tracks this transaction.
      try {
        this.touchCollection()
      } finally {
        this.isPersisted.resolve(this)
      }

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
      const commitWork = takeTransactionCommitWork(this)
      if (commitWork) await commitWork
    } catch (error) {
      if ((this.state as TransactionState) !== `persisting`) return this

      // Preserve the original error for rethrowing
      const originalError = normalizeError(error)

      // A mutationFn can accept local work and then fail. That work remains
      // accepted, so its storage effect must settle before this receipt does.
      try {
        await takeTransactionCommitWork(this)
      } catch {
        // The mutationFn error remains the transaction's reported cause.
      }

      // Update transaction with error information
      this.error = {
        message: originalError.message,
        error: originalError,
      }

      // Roll back. The mutation error stays first: settlement errors join it
      // in one flat aggregate rather than replacing it.
      const settlementErrors = this.rollbackSettlingErrors(false)
      if (settlementErrors.length)
        throw settlementFailure([originalError, ...settlementErrors])

      // Re-throw the original error to preserve identity and stack
      throw originalError
    }

    if ((this.state as TransactionState) !== `persisting`) return this

    this.setState(`completed`)
    // Publication errors cannot undo persistence or leave its receipt pending.
    // Keep normal publication queued before callers resume from the receipt.
    try {
      this.touchCollection()
    } finally {
      this.isPersisted.resolve(this)
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
