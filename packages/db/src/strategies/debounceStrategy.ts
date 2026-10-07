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
  let leadingOwner: object | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const trailingRuns = new Map<
    object,
    { run: () => Promise<unknown>; isCanceled: () => boolean }
  >()

  return {
    _type: `debounce`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>,
      onAdmit?: () => Transaction<T> | void,
      onCommit?: () => Promise<unknown> | undefined,
    ) => {
      const run = () => runWithCommitCompletion(fn, onCommit)
      const leadingCall = leading && canLead
      const admitted = leadingCall || trailing
      // Reserve the edge before optimistic mutation can reenter execute.
      const wasLeadAvailable = canLead
      canLead = false
      let owner: object = fn
      let transaction: Transaction<T> | undefined
      try {
        if (admitted) {
          const admittedOwner = onAdmit?.()
          if (admittedOwner) {
            transaction = admittedOwner
            owner = admittedOwner
          }
        }
      } catch (error) {
        // A nested admitted call may have installed its own quiet timer.
        if (timeout === undefined) canLead = wasLeadAvailable
        throw error
      }
      // A replacement transaction after rollback cannot inherit a canceled
      // leading callback's eligibility. It needs its own quiet-edge schedule.
      const joinsPendingLeading =
        leadingPending && !leadingCall && owner === leadingOwner
      if (timeout !== undefined) clearTimeout(timeout)
      // A new call renews the quiet period, including after an earlier timer
      // became eligible while persistence was held.
      if (trailing)
        for (const pendingOwner of trailingRuns.keys())
          serial.cancel(pendingOwner)
      if (trailing && admitted && !leadingCall && !joinsPendingLeading) {
        trailingRuns.set(owner, {
          run,
          isCanceled: () => transaction?.state === `failed`,
        })
      }
      timeout = setTimeout(() => {
        timeout = undefined
        canLead = true
        for (const [pendingOwner, pending] of trailingRuns) {
          if (pending.isCanceled()) {
            trailingRuns.delete(pendingOwner)
            continue
          }
          serial.schedule(() => {
            trailingRuns.delete(pendingOwner)
            return pending.run()
          }, pendingOwner)
        }
      }, options.wait)
      if (leadingCall) {
        // A same-manager reentrant trailing call joins this leading transaction.
        // A different manager's trailing transaction keeps the shared edge.
        trailingRuns.delete(owner)
        leadingPending = true
        leadingOwner = owner
        serial.schedule(() => {
          leadingPending = false
          leadingOwner = undefined
          return run()
        }, owner)
      }
      if (!admitted) return false
      return
    },
    cleanup: () => {
      // Admitted work retains its timer and persistence obligation.
    },
  }
}
