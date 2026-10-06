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
  let nextAllowedAt = Number.NEGATIVE_INFINITY
  let trailingTimeout: ReturnType<typeof setTimeout> | undefined
  let trailingDueAt: number | undefined
  let pendingCallback: (() => Transaction) | undefined

  const runTrailing = () => {
    trailingTimeout = undefined
    trailingDueAt = undefined
    nextAllowedAt = Date.now() + options.wait
    const callback = pendingCallback
    pendingCallback = undefined
    callback?.()
  }

  const scheduleTrailing = (dueAt: number) => {
    trailingDueAt = dueAt
    trailingTimeout = setTimeout(runTrailing, Math.max(0, dueAt - Date.now()))
  }

  return {
    _type: `throttle`,
    options,
    willDropCall: () =>
      !trailing &&
      !(
        leading &&
        trailingTimeout === undefined &&
        Date.now() >= nextAllowedAt
      ),
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
    ) => {
      const now = Date.now()
      if (leading && trailingTimeout === undefined && now >= nextAllowedAt) {
        nextAllowedAt = now + options.wait
        fn()
        return
      }
      if (!trailing) return false
      pendingCallback = fn as () => Transaction
      if (trailingTimeout === undefined) {
        const delay = leading ? Math.max(0, nextAllowedAt - now) : options.wait
        scheduleTrailing(now + delay)
      }
      return
    },
    onPersistenceStart: () => {
      // A held predecessor can make the real start later than its timer edge.
      // Keep later trailing work at least one wait after that real start.
      nextAllowedAt = Date.now() + options.wait
      if (
        trailingTimeout !== undefined &&
        trailingDueAt !== undefined &&
        trailingDueAt < nextAllowedAt
      ) {
        clearTimeout(trailingTimeout)
        scheduleTrailing(nextAllowedAt)
      }
    },
    cleanup: () => {
      // Pending work keeps its timer until the scheduled callback runs.
    },
  }
}
