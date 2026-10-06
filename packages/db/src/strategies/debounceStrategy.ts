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
  const leading = options.leading ?? false
  const trailing = options.trailing ?? true
  const wait = options.wait
  let timeout: ReturnType<typeof setTimeout> | undefined
  let pendingCallback: (() => Transaction) | undefined

  return {
    _type: `debounce`,
    options,
    willDropCall: () => !trailing && !(leading && timeout === undefined),
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
    ) => {
      const runsLeading = leading && timeout === undefined
      pendingCallback = fn as () => Transaction
      if (timeout !== undefined) clearTimeout(timeout)
      timeout = setTimeout(() => {
        timeout = undefined
        const callback = pendingCallback
        pendingCallback = undefined
        if (trailing && !runsLeading) callback?.()
      }, wait)
      // A leading callback may synchronously call mutate again. Install this
      // call's timer first so the nested call can replace it.
      if (runsLeading) fn()
      if (!trailing && !runsLeading) return false
      return
    },
    cleanup: () => {
      // Keep pending work scheduled until its quiet-period callback runs.
    },
  }
}
