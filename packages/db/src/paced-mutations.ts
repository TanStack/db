import { createTransaction } from "./transactions"
import type { MutationFn, Transaction } from "./types"
import type { Strategy } from "./strategies/types"

/**
 * Configuration for creating a paced mutations manager
 */
export interface PacedMutationsConfig<
  T extends object = Record<string, unknown>,
> {
  /**
   * Function to execute the mutation on the server
   */
  mutationFn: MutationFn<T>
  /**
   * Strategy for controlling mutation execution timing
   * Examples: debounceStrategy, queueStrategy, throttleStrategy
   */
  strategy: Strategy
  /**
   * Custom metadata to associate with transactions
   */
  metadata?: Record<string, unknown>
}

/**
 * Creates a paced mutations manager with pluggable timing strategies.
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
 * const { mutate, cleanup } = createPacedMutations({
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
 * const { mutate } = createPacedMutations({
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
export function createPacedMutations<
  T extends object = Record<string, unknown>,
>(
  config: PacedMutationsConfig<T>
): {
  mutate: (callback: () => void) => Transaction<T>
} {
  const { strategy, ...transactionConfig } = config

  // The currently active transaction (pending, not yet persisting)
  let activeTransaction: Transaction<T> | null = null

  // Commit callback that the strategy will call when it's time to persist
  const commitCallback = () => {
    if (!activeTransaction) {
      throw new Error(
        `Strategy callback called but no active transaction exists. This indicates a bug in the strategy implementation.`
      )
    }

    if (activeTransaction.state !== `pending`) {
      throw new Error(
        `Strategy callback called but active transaction is in state "${activeTransaction.state}". Expected "pending".`
      )
    }

    const txToCommit = activeTransaction

    // Clear active transaction reference before committing
    activeTransaction = null

    // Commit the transaction
    txToCommit.commit().catch(() => {
      // Errors are handled via transaction.isPersisted.promise
      // This catch prevents unhandled promise rejections
    })

    return txToCommit
  }

  /**
   * Executes a mutation callback. Creates a new transaction if none is active,
   * or adds to the existing active transaction. The strategy controls when
   * the transaction is actually committed.
   */
  function mutate(callback: () => void): Transaction<T> {
    // Create a new transaction if we don't have an active one
    if (!activeTransaction || activeTransaction.state !== `pending`) {
      activeTransaction = createTransaction<T>({
        ...transactionConfig,
        autoCommit: false,
      })
    }

    // Execute the mutation callback to add mutations to the active transaction
    activeTransaction.mutate(callback)

    // Save reference before calling strategy.execute
    const txToReturn = activeTransaction

    // For queue strategy, pass a function that commits the captured transaction
    // This prevents the error when commitCallback tries to access the cleared activeTransaction
    if (strategy._type === `queue`) {
      const capturedTx = activeTransaction
      activeTransaction = null // Clear so next mutation creates a new transaction
      strategy.execute(() => {
        capturedTx.commit().catch(() => {
          // Errors are handled via transaction.isPersisted.promise
        })
        return capturedTx
      })
    } else {
      // For debounce/throttle, use commitCallback which manages activeTransaction
      strategy.execute(commitCallback)
    }

    return txToReturn
  }

  return {
    mutate,
  }
}
