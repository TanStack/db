import { createTransaction } from "./transactions"
import type { Transaction, TransactionConfig } from "./types"
import type { Strategy } from "./strategies/types"

/**
 * Configuration for creating a serialized mutations manager
 */
export interface SerializedMutationsConfig<
  T extends object = Record<string, unknown>,
> extends Omit<TransactionConfig<T>, `autoCommit`> {
  /**
   * Strategy for controlling mutation execution timing
   * Examples: debounceStrategy, queueStrategy, throttleStrategy, batchStrategy
   */
  strategy: Strategy
}

/**
 * Creates a serialized mutations manager with pluggable timing strategies.
 *
 * This function provides a way to control when and how optimistic mutations
 * are persisted to the backend, using strategies like debouncing, queuing,
 * or throttling. Each call to `mutate` creates mutations that are auto-merged
 * and persisted according to the strategy.
 *
 * The returned `mutate` function returns a Transaction object that can be
 * awaited to know when persistence completes or to handle errors.
 *
 * @param config - Configuration including mutationFn and strategy
 * @returns Object with mutate function and cleanup
 *
 * @example
 * ```ts
 * // Debounced mutations for auto-save
 * const { mutate, cleanup } = createSerializedMutations({
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: debounceStrategy({ wait: 500 })
 * })
 *
 * // Each mutate call returns a transaction
 * const tx = mutate(() => {
 *   collection.update(id, draft => { draft.value = newValue })
 * })
 *
 * // Await persistence or handle errors
 * await tx.isPersisted.promise
 *
 * // Cleanup when done
 * cleanup()
 * ```
 *
 * @example
 * ```ts
 * // Queue strategy for sequential processing
 * const { mutate } = createSerializedMutations({
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: queueStrategy({
 *     wait: 200,
 *     addItemsTo: 'back',
 *     getItemsFrom: 'front'
 *   })
 * })
 * ```
 */
export function createSerializedMutations<
  T extends object = Record<string, unknown>,
>(
  config: SerializedMutationsConfig<T>
): {
  mutate: (callback: () => void) => Transaction<T>
  cleanup: () => void
} {
  const { strategy, ...transactionConfig } = config

  // Track pending transactions that haven't been committed yet
  const pendingTransactions = new Set<Transaction<T>>()
  // Track the currently executing transaction (being committed)
  let executingTransaction: Transaction<T> | null = null

  /**
   * Executes a mutation callback and returns the transaction.
   * The strategy controls when the transaction is actually committed.
   */
  function mutate(callback: () => void): Transaction<T> {
    // Rollback all pending transactions from previous mutate() calls
    // This handles cases where the strategy dropped the callback (e.g. trailing: false)
    // and the previous transaction never got committed
    for (const pendingTx of pendingTransactions) {
      pendingTx.rollback()
    }
    pendingTransactions.clear()

    // Create transaction with autoCommit disabled
    // The strategy will control when commit() is called
    const transaction = createTransaction<T>({
      ...transactionConfig,
      autoCommit: false,
    })

    // Execute the mutation callback to populate the transaction
    transaction.mutate(callback)

    // Add to pending set
    pendingTransactions.add(transaction)

    // Use the strategy to control when to commit
    strategy.execute(() => {
      // Remove from pending and mark as executing
      // Note: There should only be one pending transaction at this point
      // since we clear all previous ones at the start of each mutate() call
      pendingTransactions.delete(transaction)
      executingTransaction = transaction

      // Commit the transaction according to the strategy's timing
      transaction
        .commit()
        .then(() => {
          if (executingTransaction === transaction) {
            executingTransaction = null
          }
        })
        .catch(() => {
          // Errors are handled via transaction.isPersisted.promise
          // This catch prevents unhandled promise rejections
          if (executingTransaction === transaction) {
            executingTransaction = null
          }
        })

      return transaction
    })

    return transaction
  }

  /**
   * Cleanup strategy resources and rollback any pending transactions
   * Should be called when the serialized mutations manager is no longer needed
   */
  function cleanup() {
    // Cancel the strategy timer/queue
    strategy.cleanup()

    // Rollback all pending transactions
    for (const tx of pendingTransactions) {
      tx.rollback()
    }
    pendingTransactions.clear()

    // Rollback executing transaction if any, but only if it's not already completed
    if (executingTransaction) {
      // Check if transaction is still in a state that can be rolled back
      // Avoid throwing if the transaction just finished committing
      if (
        executingTransaction.state === `pending` ||
        executingTransaction.state === `persisting`
      ) {
        executingTransaction.rollback()
      }
      executingTransaction = null
    }
  }

  return {
    mutate,
    cleanup,
  }
}
