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
  const trailingRuns = new Map<
    object,
    { run: () => Promise<unknown>; isCanceled: () => boolean }
  >()

  // onAdmit can reenter execute and install a trailing timer.
  function hasTrailingTimer(): boolean {
    return trailingTimeout !== undefined
  }

  function clearTrailingIfEmpty(): void {
    if (trailingRuns.size === 0) {
      if (trailingTimeout !== undefined) clearTimeout(trailingTimeout)
      trailingTimeout = undefined
    }
  }

  function discardCanceledTrailing(): void {
    for (const [owner, pending] of trailingRuns)
      if (pending.isCanceled()) trailingRuns.delete(owner)
    clearTrailingIfEmpty()
  }

  return {
    _type: `throttle`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
      onAdmit?: () => Transaction<T> | void,
      onCommit?: () => Promise<unknown> | undefined,
    ) => {
      const run = () => runWithCommitCompletion(fn, onCommit)
      const now = Date.now()
      if (leading && trailingTimeout === undefined && now >= nextAllowedAt) {
        // Reserve the edge before optimistic mutation can reenter execute.
        const previousAllowedAt = nextAllowedAt
        nextAllowedAt = now + options.wait
        let owner: object = fn
        try {
          owner = onAdmit?.() ?? fn
        } catch (error) {
          // Keep a nested admitted trailing call's window if it installed one.
          discardCanceledTrailing()
          if (!hasTrailingTimer()) nextAllowedAt = previousAllowedAt
          throw error
        }
        trailingRuns.delete(owner)
        clearTrailingIfEmpty()
        serial.schedule(run, owner)
        return
      }
      if (!trailing) return false
      const transaction = onAdmit?.()
      const owner = transaction ?? fn
      // Once the pending transaction is eligible, later admitted calls merge
      // into it. Another timer would outlive that transaction after it drains.
      if (serial.hasPending(owner)) {
        serial.schedule(run, owner)
        return
      }
      trailingRuns.set(owner, {
        run,
        isCanceled: () => transaction?.state === `failed`,
      })
      if (trailingTimeout === undefined) {
        const delay = leading ? Math.max(0, nextAllowedAt - now) : options.wait
        trailingTimeout = setTimeout(() => {
          trailingTimeout = undefined
          nextAllowedAt = Date.now() + options.wait
          for (const [pendingOwner, pending] of trailingRuns)
            if (!pending.isCanceled())
              serial.schedule(pending.run, pendingOwner)
          trailingRuns.clear()
        }, delay)
      }
      return
    },
    cleanup: () => {
      // Pending work keeps its timer until the scheduled callback runs.
    },
  }
}
