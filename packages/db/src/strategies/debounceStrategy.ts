import { createSerialPacer } from './serial-pacer'
import { runWithCommitCompletion } from './commit-completion'
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
  let leadingPending = false
  let timeout: ReturnType<typeof setTimeout> | undefined

  return {
    _type: `debounce`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
      onAdmit?: () => void,
      onCommit?: () => Promise<unknown> | undefined,
    ) => {
      const run = () => runWithCommitCompletion(fn, onCommit)
      const leadingCall = leading && canLead
      const admitted = leadingCall || trailing
      const joinsPendingLeading = leadingPending && !leadingCall
      // Reserve the edge before optimistic mutation can reenter execute.
      const wasLeadAvailable = canLead
      canLead = false
      try {
        if (admitted) onAdmit?.()
      } catch (error) {
        // A nested admitted call may have installed its own quiet timer.
        if (timeout === undefined) canLead = wasLeadAvailable
        throw error
      }
      if (timeout !== undefined) clearTimeout(timeout)
      // A new call renews the quiet period, including after an earlier timer
      // became eligible while persistence was held.
      if (trailing && !leadingPending) serial.cancel()
      timeout = setTimeout(() => {
        timeout = undefined
        canLead = true
        if (trailing && !leadingCall && !joinsPendingLeading)
          serial.schedule(run)
      }, options.wait)
      if (leadingCall) {
        leadingPending = true
        serial.schedule(() => {
          leadingPending = false
          return run()
        })
      }
      if (!admitted) return false
      return
    },
    cleanup: () => {
      // Admitted work retains its timer and persistence obligation.
    },
  }
}
