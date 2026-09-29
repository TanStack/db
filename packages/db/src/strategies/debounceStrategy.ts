import { LiteDebouncer } from '@tanstack/pacer-lite/lite-debouncer'
import type { DebounceStrategy, DebounceStrategyOptions } from './types'
import type { Transaction } from '../transactions'

/**
 * Creates a debounce strategy that delays transaction execution until after
 * a period of inactivity.
 *
 * Ideal for scenarios like search inputs or auto-save fields where you want
 * to wait for the user to stop typing before persisting changes.
 *
 * @param options - Configuration for the debounce behavior
 * @returns A debounce strategy instance
 *
 * @example
 * ```ts
 * const mutate = usePacedMutations({
 *   onMutate: (value) => {
 *     collection.update(id, draft => { draft.value = value })
 *   },
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: debounceStrategy({ wait: 500 })
 * })
 * ```
 */
export function debounceStrategy(
  options: DebounceStrategyOptions,
): DebounceStrategy {
  const trailing = options.trailing ?? true
  const debouncer = new LiteDebouncer(
    (callback: () => Transaction) => callback(),
    {
      ...options,
      leading: options.leading ?? false,
      trailing,
    },
  )

  return {
    _type: `debounce`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
    ) => {
      const execution = { happened: false }
      debouncer.maybeExecute(() => {
        execution.happened = true
        return (fn as () => Transaction)()
      })
      if (!trailing && !execution.happened) return false
      return
    },
    cleanup: () => {
      // Keep pending work scheduled until its quiet-period callback runs.
    },
  }
}
