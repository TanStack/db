import { LiteQueuer } from '@tanstack/pacer-lite/lite-queuer'
import type {
  MutationExecuteOptions,
  QueueStrategy,
  QueueStrategyOptions,
} from './types'
import type { Transaction } from '../transactions'

/**
 * Item stored in the queue, containing both the transaction-creating function
 * and any dependencies that must be resolved before execution
 */
interface QueueItem {
  fn: () => Transaction
  dependsOn?: Array<Transaction<any>>
}

/**
 * Creates a queue strategy that processes all mutations in order with proper serialization.
 *
 * Unlike other strategies that may drop executions, queue ensures every
 * mutation is processed sequentially. Each transaction commit completes before
 * the next one starts. Useful when data consistency is critical and
 * every operation must complete in order.
 *
 * This strategy also supports cross-queue dependencies via the `dependsOn` option,
 * allowing mutations to wait for transactions from other queues to complete before
 * executing their mutation function.
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
 *
 * @example
 * ```ts
 * // Cross-queue dependencies for nested collections
 * const createParent = createPacedMutations({
 *   onMutate: (item) => parentCollection.insert(item),
 *   mutationFn: async ({ transaction }) => {
 *     return await api.createParent(transaction.mutations[0].changes)
 *   },
 *   strategy: queueStrategy()
 * })
 *
 * const createChild = createPacedMutations({
 *   onMutate: (item) => childCollection.insert(item),
 *   mutationFn: async ({ transaction }) => {
 *     // Parent is guaranteed to be persisted at this point
 *     return await api.createChild(transaction.mutations[0].changes)
 *   },
 *   strategy: queueStrategy()
 * })
 *
 * // Child mutation waits for parent to be persisted
 * const parentTx = createParent({ id: 'temp-1', name: 'Parent' })
 * const childTx = createChild(
 *   { id: 'temp-2', parentId: 'temp-1' },
 *   { dependsOn: parentTx }
 * )
 * ```
 */
export function queueStrategy(options?: QueueStrategyOptions): QueueStrategy {
  // Manual promise chaining to ensure async serialization
  // LiteQueuer (unlike AsyncQueuer from @tanstack/pacer) lacks built-in async queue
  // primitives and concurrency control. We compensate by manually chaining promises
  // to ensure each transaction completes before the next one starts.
  let processingChain = Promise.resolve()

  const queuer = new LiteQueuer<QueueItem>(
    (item) => {
      // Chain each transaction to the previous one's completion
      processingChain = processingChain
        .then(async () => {
          // Wait for all dependencies to be persisted first
          if (item.dependsOn && item.dependsOn.length > 0) {
            await Promise.all(
              item.dependsOn.map((dep) =>
                // Use Promise.resolve to handle both resolved and pending promises
                // and catch any rejections to prevent blocking the queue
                dep.isPersisted.promise.catch(() => {
                  // If a dependency failed, we still proceed with this transaction
                  // The transaction can decide how to handle missing parent data
                }),
              ),
            )
          }

          const transaction = item.fn()
          // Wait for the transaction to be persisted before processing next item
          await transaction.isPersisted.promise
        })
        .catch(() => {
          // Errors are handled via transaction.isPersisted.promise and surfaced there.
          // This catch prevents unhandled promise rejections from breaking the chain,
          // ensuring subsequent transactions can still execute even if one fails.
        })
    },
    {
      wait: options?.wait ?? 0,
      maxSize: options?.maxSize,
      addItemsTo: options?.addItemsTo ?? `back`, // Default FIFO: add to back
      getItemsFrom: options?.getItemsFrom ?? `front`, // Default FIFO: get from front
      started: true, // Start processing immediately
    },
  )

  return {
    _type: `queue`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
      executeOptions?: MutationExecuteOptions,
    ) => {
      // Normalize dependsOn to always be an array (or undefined)
      const dependsOn = executeOptions?.dependsOn
        ? Array.isArray(executeOptions.dependsOn)
          ? executeOptions.dependsOn
          : [executeOptions.dependsOn]
        : undefined

      // Add the queue item with both the function and dependencies
      queuer.addItem({
        fn: fn as () => Transaction,
        dependsOn,
      })
    },
    cleanup: () => {
      queuer.stop()
      queuer.clear()
    },
  }
}
