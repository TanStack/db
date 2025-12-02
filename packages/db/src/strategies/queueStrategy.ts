import { AsyncQueuer } from "@tanstack/pacer/async-queuer"
import type { QueueStrategy, QueueStrategyOptions } from "./types"
import type { Transaction } from "../transactions"

/**
 * Creates a queue strategy that processes all mutations in order with proper serialization.
 *
 * Unlike other strategies that may drop executions, queue ensures every
 * mutation is processed sequentially. Each transaction commit completes before
 * the next one starts. Useful when data consistency is critical and
 * every operation must complete in order.
 *
 * @param options - Configuration for queue behavior (FIFO/LIFO, timing, size limits)
 * @returns A queue strategy instance
 *
 * @example
 * ```ts
 * // FIFO queue - process in order received
 * const mutate = usePacedMutations({
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
 *
 * @example
 * ```ts
 * // LIFO queue - process most recent first
 * const mutate = usePacedMutations({
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: queueStrategy({
 *     wait: 200,
 *     addItemsTo: 'back',
 *     getItemsFrom: 'back'
 *   })
 * })
 * ```
 */
export function queueStrategy(options?: QueueStrategyOptions): QueueStrategy {
  const queuer = new AsyncQueuer<() => Transaction>(
    async (fn) => {
      const transaction = fn()
      // Wait for the transaction to be persisted before processing next item
      // Note: fn() already calls commit(), we just wait for it to complete
      await transaction.isPersisted.promise
    },
    {
      concurrency: 1, // Process one at a time to ensure serialization
      wait: options?.wait,
      maxSize: options?.maxSize,
      addItemsTo: options?.addItemsTo ?? `back`, // Default FIFO: add to back
      getItemsFrom: options?.getItemsFrom ?? `front`, // Default FIFO: get from front
      started: true, // Start processing immediately
    }
  )

  return {
    _type: `queue`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>
    ) => {
      // Add the transaction-creating function to the queue
      queuer.addItem(fn as () => Transaction)
    },
    cleanup: () => {
      queuer.stop()
      queuer.clear()
    },
  }
}
