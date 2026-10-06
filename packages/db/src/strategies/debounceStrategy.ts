import { createSerialPacer } from './serial-pacer'
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
  const serial = createSerialPacer(0)
  let canLead = true
  let timeout: ReturnType<typeof setTimeout> | undefined

  return {
    _type: `debounce`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
      onAdmit?: () => void,
      onCommit?: () => Promise<unknown> | undefined,
    ) => {
      const leadingCall = leading && canLead
      const admitted = leadingCall || trailing
      // Reserve the edge before optimistic mutation can reenter execute.
      canLead = false
      if (admitted) onAdmit?.()
      if (timeout !== undefined) clearTimeout(timeout)
      // A new call renews the quiet period, including after an earlier timer
      // became eligible while persistence was held.
      if (trailing) serial.cancel()
      timeout = setTimeout(() => {
        timeout = undefined
        canLead = true
        if (trailing && !leadingCall)
          serial.schedule(() => {
            const transaction = fn()
            return onCommit?.() ?? transaction.isPersisted.promise
          })
      }, options.wait)
      if (leadingCall)
        serial.schedule(() => {
          const transaction = fn()
          return onCommit?.() ?? transaction.isPersisted.promise
        })
      if (!admitted) return false
      return
    },
    cleanup: () => {
      // Admitted work retains its timer and persistence obligation.
    },
  }
}
