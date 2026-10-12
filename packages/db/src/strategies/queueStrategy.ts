import { LiteQueuer } from '@tanstack/pacer-lite/lite-queuer'
import { QueueDisposedError } from '../errors'
import { runWithCommitCompletion } from './commit-completion'
import type { QueueStrategy, QueueStrategyOptions } from './types'
import type { Transaction } from '../transactions'

/**
 * Creates a queue strategy that processes admitted mutations in order with proper serialization.
 *
 * Unlike other strategies that may drop executions, queue ensures every
 * admitted mutation is attempted sequentially. Each transaction commit completes before
 * the next one starts. Useful when data consistency is critical and
 * every admitted operation must be attempted in order. When a bounded queue is
 * full, the returned transaction fails and its optimistic mutation rolls back.
 * Cleanup stops new admission. The existing timer drains admitted waiting work
 * at its configured pace behind earlier writes. Cleanup does not wait for settlement.
 *
 * **Error handling behavior:**
 * - If a mutation fails, it is NOT automatically retried - the transaction transitions to "failed" state
 * - Failed mutations surface their error via `transaction.when('settled')` (which will reject)
 * - Subsequent mutations continue processing - a single failure does not block the queue
 * - Each mutation is independent; there is no all-or-nothing transaction semantics
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
  // Manual promise chaining to ensure async serialization
  // LiteQueuer (unlike AsyncQueuer from @tanstack/pacer) lacks built-in async queue
  // primitives and concurrency control. We compensate by manually chaining promises
  // to ensure each transaction completes before the next one starts.
  let processingChain = Promise.resolve()
  let disposed = false

  const queuer = new LiteQueuer<{
    run: () => Transaction
    onCommit?: () => Promise<unknown> | undefined
  }>(
    ({ run, onCommit }) => {
      // Chain each transaction to the previous one's completion
      processingChain = processingChain
        .then(async () => {
          // A rolled-back receipt can settle before its backend handler returns.
          await runWithCommitCompletion(run, onCommit)
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
      _onAdmit?: () => void,
      onCommit?: () => Promise<unknown> | undefined,
    ) => {
      if (disposed) throw new QueueDisposedError()
      return queuer.addItem({ run: fn as () => Transaction, onCommit })
    },
    cleanup: () => {
      disposed = true
      if (queuer.isEmpty) queuer.stop()
    },
  }
}
