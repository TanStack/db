import type { Transaction } from '../transactions'
import type {
  DependencyQueueStrategy,
  DependencyQueueStrategyOptions,
} from './types'

interface QueuedItem<T extends object = Record<string, unknown>> {
  tx: Transaction<T>
  keys: Set<string>
  resolve: () => void
}

/**
 * Creates a dependency-aware queue strategy that:
 * - Runs independent mutations in parallel
 * - Serializes mutations that share dependencies (same globalKey)
 * - Supports custom dependency declarations for semantic relationships
 *
 * This solves the problem where a global queue forces everything to run sequentially,
 * even when mutations affect completely unrelated records.
 *
 * @example
 * ```ts
 * // Basic usage - automatically parallelizes based on globalKey
 * const mutate = usePacedMutations({
 *   onMutate: (variables) => {
 *     itemsCollection.update(variables.id, draft => {
 *       draft.title = variables.title
 *     })
 *   },
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: dependencyQueueStrategy()
 * })
 *
 * // These run in parallel (different items):
 * mutate({ id: 'item-1', title: 'New title 1' })
 * mutate({ id: 'item-2', title: 'New title 2' })
 *
 * // This waits for the above (touches both items):
 * mutate({ id: 'item-1', reorderWith: 'item-2' })
 * ```
 *
 * @example
 * ```ts
 * // With custom dependencies for semantic relationships
 * const mutate = usePacedMutations({
 *   onMutate: (variables) => {
 *     listsCollection.update(variables.listId, draft => {
 *       draft.title = variables.title
 *     })
 *   },
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: dependencyQueueStrategy({
 *     getDependencies: (tx) => {
 *       // List mutations should wait for any item mutations in that list
 *       const listIds = tx.mutations
 *         .filter(m => m.collection.id === 'lists')
 *         .map(m => `list-items:${m.key}`)
 *       return listIds
 *     }
 *   })
 * })
 * ```
 */
export function dependencyQueueStrategy(
  options?: DependencyQueueStrategyOptions,
): DependencyQueueStrategy {
  // Map from key -> Set of transactions currently using that key
  const inFlightByKey = new Map<string, Set<Transaction>>()

  // Pending items waiting for dependencies to clear
  const pendingQueue: Array<QueuedItem> = []

  // Timer for optional wait
  let waitTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Get all dependency keys for a transaction
   */
  function getDependencyKeys<T extends object>(tx: Transaction<T>): Set<string> {
    const keys = new Set<string>()

    // Add all globalKeys from mutations
    for (const mutation of tx.mutations) {
      keys.add(mutation.globalKey)
    }

    // Add custom dependencies if provided
    if (options?.getDependencies) {
      // Cast to base Transaction type for the callback
      const customDeps = options.getDependencies(tx as unknown as Transaction)
      for (const dep of customDeps) {
        keys.add(dep)
      }
    }

    return keys
  }

  /**
   * Check if any of the given keys are currently in-flight
   */
  function hasInFlightDependencies(keys: Set<string>): boolean {
    for (const key of keys) {
      if (inFlightByKey.has(key) && inFlightByKey.get(key)!.size > 0) {
        return true
      }
    }
    return false
  }

  /**
   * Mark keys as in-flight for a transaction
   */
  function markInFlight<T extends object>(tx: Transaction<T>, keys: Set<string>): void {
    for (const key of keys) {
      if (!inFlightByKey.has(key)) {
        inFlightByKey.set(key, new Set())
      }
      inFlightByKey.get(key)!.add(tx as Transaction)
    }
  }

  /**
   * Remove transaction from in-flight tracking and process pending items
   */
  function markCompleted<T extends object>(tx: Transaction<T>, keys: Set<string>): void {
    for (const key of keys) {
      const inFlight = inFlightByKey.get(key)
      if (inFlight) {
        inFlight.delete(tx as Transaction)
        if (inFlight.size === 0) {
          inFlightByKey.delete(key)
        }
      }
    }

    // Try to process pending items that may now be unblocked
    processQueue()
  }

  /**
   * Process the pending queue, starting any items whose dependencies are clear
   */
  function processQueue(): void {
    // Process in order, but allow multiple items to start if they're independent
    let i = 0
    while (i < pendingQueue.length) {
      const item = pendingQueue[i]!

      if (!hasInFlightDependencies(item.keys)) {
        // Remove from queue
        pendingQueue.splice(i, 1)

        // Mark as in-flight
        markInFlight(item.tx, item.keys)

        // Start the commit
        startCommit(item.tx, item.keys)

        // Don't increment i since we removed an item
      } else {
        i++
      }
    }
  }

  /**
   * Start committing a transaction and handle completion
   */
  function startCommit<T extends object>(tx: Transaction<T>, keys: Set<string>): void {
    tx.commit()
      .catch(() => {
        // Errors are handled via transaction.isPersisted.promise
      })
      .finally(() => {
        markCompleted(tx, keys)
      })
  }

  /**
   * Add a transaction to the queue
   */
  function enqueue<T extends object>(tx: Transaction<T>): void {
    const keys = getDependencyKeys(tx)

    if (!hasInFlightDependencies(keys)) {
      // No dependencies blocking - start immediately
      markInFlight(tx, keys)
      startCommit(tx, keys)
    } else {
      // Add to pending queue
      pendingQueue.push({
        tx: tx as Transaction,
        keys,
        resolve: () => {},
      })
    }
  }

  /**
   * Handle optional wait time
   */
  function scheduleEnqueue<T extends object>(tx: Transaction<T>): void {
    if (options?.wait && options.wait > 0) {
      // Clear any existing timer
      if (waitTimer) {
        clearTimeout(waitTimer)
      }
      waitTimer = setTimeout(() => {
        enqueue(tx)
        waitTimer = null
      }, options.wait)
    } else {
      enqueue(tx)
    }
  }

  return {
    _type: `dependencyQueue`,
    options,

    executeWithTx: <T extends object>(tx: Transaction<T>) => {
      scheduleEnqueue(tx)
    },

    // Fallback for standard execute API - immediately calls fn and extracts tx
    execute: <T extends object>(fn: () => Transaction<T>) => {
      const tx = fn()
      // Note: The fn() may have already started committing in some cases
      // This is a compatibility mode - prefer executeWithTx for proper behavior
      scheduleEnqueue(tx)
    },

    cleanup: () => {
      if (waitTimer) {
        clearTimeout(waitTimer)
        waitTimer = null
      }
      pendingQueue.length = 0
      inFlightByKey.clear()
    },
  }
}
