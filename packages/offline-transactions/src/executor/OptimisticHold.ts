import { createTransaction } from '@tanstack/db'
import type { Collection, PendingMutation, Transaction } from '@tanstack/db'

/**
 * A standalone, never-committed transaction whose only job is to keep an
 * optimistic overlay painted on the affected collections for a bounded window.
 *
 * This is the same primitive `restoreOptimisticState` uses to re-show pending
 * writes after a reload. It is factored out here so the post-commit
 * confirmation window (see `OfflineConfig.confirmWrite`) can reuse it without
 * duplicating the `_state` bookkeeping.
 */
export interface OptimisticHold {
  /** The underlying hold transaction. Never auto-commits. */
  transaction: Transaction
  /** Tear the hold down. Idempotent. */
  release: () => void
}

/**
 * Create an optimistic hold for `mutations` and register it on every touched
 * collection synchronously (before returning), so the overlay is painted with
 * no gap. The returned `release` removes it again.
 *
 * Mirrors the lifecycle the offline executor already drives for restoration
 * transactions: `setState("completed")` + delete + `recomputeOptimisticState`
 * on a normal release, or `rollback()` to discard.
 */
export function createOptimisticHold(
  mutations: Array<PendingMutation>,
  options: { id?: string } = {},
): OptimisticHold {
  // `autoCommit: false` + an inert mutationFn means it never POSTs or settles on
  // its own — the caller drives its lifecycle by hand via `release`.
  const transaction = createTransaction({
    ...(options.id === undefined ? {} : { id: options.id }),
    autoCommit: false,
    mutationFn: async () => {},
  })

  // It never commits, so `isPersisted` never resolves through the normal flow;
  // swallow so a stray rejection on teardown can't surface as an unhandled
  // rejection. Mirrors `restoreOptimisticState`.
  transaction.isPersisted.promise.catch(() => {
    // Intentionally ignored - holds are torn down via `release`, not commit.
  })

  // Register with each affected collection's state manager. Dedup by collection
  // reference (the same collection can be touched by several mutations).
  const touchedCollections = new Set<Collection<any, any, any, any, any>>()
  let released = false
  const release = (): void => {
    if (released) {
      return
    }
    released = true

    const errors: Array<unknown> = []
    try {
      // A hold is synthetic: completing it only removes it from TanStack DB's
      // module-global registry. It must never rollback and cascade into real
      // user transactions that happen to touch the same keys.
      transaction.setState(`completed`)
    } catch (error) {
      errors.push(error)
    }

    // Delete every registration before recomputing. If one collection throws,
    // later collections are still cleaned up and cannot retain a leaked hold.
    for (const collection of touchedCollections) {
      try {
        collection._state.transactions.delete(transaction.id)
      } catch (error) {
        errors.push(error)
      }
    }
    for (const collection of touchedCollections) {
      try {
        collection._state.recomputeOptimisticState(false)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      throw errors[0]
    }
  }

  try {
    transaction.applyMutations(mutations)

    for (const mutation of mutations) {
      // Defensive check for corrupted deserialized data
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mutation.collection) {
        continue
      }
      if (touchedCollections.has(mutation.collection)) {
        continue
      }
      // Track before registration so a throwing set/recompute is unwound too.
      touchedCollections.add(mutation.collection)
      mutation.collection._state.transactions.set(transaction.id, transaction)
      // `recomputeOptimisticState(true)` forces the recompute through even when
      // a sync commit is in flight (the "triggered by user action" path), so the
      // overlay always applies.
      mutation.collection._state.recomputeOptimisticState(true)
    }
  } catch (error) {
    // Failure-atomic creation: remove any registrations installed before the
    // throw and complete the synthetic transaction so no global state leaks.
    try {
      release()
    } catch {
      // Preserve the original registration error after best-effort cleanup.
    }
    throw error
  }

  return { transaction, release }
}
