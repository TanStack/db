import { createSerialPacer } from './serial-pacer'
import { runWithCommitCompletion } from './commit-completion'
import type { ThrottleStrategy, ThrottleStrategyOptions } from './types'
import type { Transaction } from '../transactions'

/**
 * Creates a throttle strategy that ensures transactions are evenly spaced
 * over time.
 *
 * Provides smooth, controlled execution patterns ideal for UI updates like
 * sliders, progress bars, or scroll handlers where you want consistent
 * execution timing.
 *
 * @param options - Configuration for throttle behavior
 * @returns A throttle strategy instance
 *
 * @example
 * ```ts
 * // Throttle slider updates to every 200ms
 * const mutate = usePacedMutations({
 *   onMutate: (volume) => {
 *     settingsCollection.update('volume', draft => { draft.value = volume })
 *   },
 *   mutationFn: async ({ transaction }) => {
 *     await api.updateVolume(transaction.mutations)
 *   },
 *   strategy: throttleStrategy({ wait: 200 })
 * })
 * ```
 *
 * @example
 * ```ts
 * // Throttle with leading and trailing execution
 * const mutate = usePacedMutations({
 *   onMutate: (data) => {
 *     collection.update(id, draft => { Object.assign(draft, data) })
 *   },
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: throttleStrategy({
 *     wait: 500,
 *     leading: true,
 *     trailing: true
 *   })
 * })
 * ```
 */
export function throttleStrategy(
  options: ThrottleStrategyOptions,
): ThrottleStrategy {
  const leading =
    options.leading === true ||
    (options.leading === undefined && options.trailing !== true)
  const trailing = options.trailing !== false
  const serial = createSerialPacer(options.wait)
  let nextAllowedAt = Number.NEGATIVE_INFINITY
  let trailingTimeout: ReturnType<typeof setTimeout> | undefined
  let pendingCallback: (() => Promise<unknown>) | undefined

  // onAdmit can reenter execute and install a trailing timer.
  function hasTrailingTimer(): boolean {
    return trailingTimeout !== undefined
  }

  function discardNestedTrailing(): void {
    if (trailingTimeout !== undefined) clearTimeout(trailingTimeout)
    trailingTimeout = undefined
    pendingCallback = undefined
  }

  return {
    _type: `throttle`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
      onAdmit?: () => void,
      onCommit?: () => Promise<unknown> | undefined,
    ) => {
      const run = () => runWithCommitCompletion(fn, onCommit)
      const now = Date.now()
      if (leading && trailingTimeout === undefined && now >= nextAllowedAt) {
        // Reserve the edge before optimistic mutation can reenter execute.
        const previousAllowedAt = nextAllowedAt
        nextAllowedAt = now + options.wait
        try {
          onAdmit?.()
        } catch (error) {
          // Keep a nested admitted trailing call's window if it installed one.
          if (!hasTrailingTimer()) nextAllowedAt = previousAllowedAt
          throw error
        }
        discardNestedTrailing()
        serial.schedule(run)
        return
      }
      if (!trailing) return false
      onAdmit?.()
      // Once the pending transaction is eligible, later admitted calls merge
      // into it. Another timer would outlive that transaction after it drains.
      if (serial.hasPending()) {
        serial.schedule(run)
        return
      }
      pendingCallback = run
      if (trailingTimeout === undefined) {
        const delay = leading ? Math.max(0, nextAllowedAt - now) : options.wait
        trailingTimeout = setTimeout(() => {
          trailingTimeout = undefined
          nextAllowedAt = Date.now() + options.wait
          const callback = pendingCallback
          pendingCallback = undefined
          if (callback) serial.schedule(callback)
        }, delay)
      }
      return
    },
    cleanup: () => {
      // Pending work keeps its timer until the scheduled callback runs.
    },
  }
}
