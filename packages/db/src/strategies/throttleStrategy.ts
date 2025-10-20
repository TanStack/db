import { Throttler } from "@tanstack/pacer/throttler"
import type { ThrottleStrategy, ThrottleStrategyOptions } from "./types"
import type { Transaction } from "../transactions"

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
 * const mutate = useSerializedTransaction({
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
 * const mutate = useSerializedTransaction({
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
  options: ThrottleStrategyOptions
): ThrottleStrategy {
  const throttler = new Throttler(
    (callback: () => Transaction) => callback(),
    options
  )

  return {
    _type: `throttle`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>
    ) => {
      throttler.maybeExecute(fn as () => Transaction)
    },
    cleanup: () => {
      throttler.cancel()
    },
  }
}
