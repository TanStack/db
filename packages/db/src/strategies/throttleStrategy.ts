import { LiteThrottler } from '@tanstack/pacer-lite/lite-throttler'
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
  // Pacer-lite measures the first non-leading wait from epoch zero. Own this
  // trailing-only window so its first execution waits from the first call.
  const trailingOnly = options.leading !== true && options.trailing === true
  let trailingTimeout: ReturnType<typeof setTimeout> | undefined
  const throttler = trailingOnly
    ? undefined
    : new LiteThrottler((callback: () => Transaction) => callback(), {
        ...options,
      })

  return {
    _type: `throttle`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
    ) => {
      if (trailingOnly) {
        trailingTimeout ??= setTimeout(() => {
          trailingTimeout = undefined
          fn()
        }, options.wait)
      } else {
        throttler?.maybeExecute(fn as () => Transaction)
      }
    },
    cleanup: () => {
      if (trailingTimeout !== undefined) clearTimeout(trailingTimeout)
      throttler?.cancel()
    },
  }
}
