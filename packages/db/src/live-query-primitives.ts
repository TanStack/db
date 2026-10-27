import type { Collection } from './collection/index.js'
import type { CollectionStatus, HealthNode } from './types.js'

// Collection guards and status flags. Core modules import them from here, and
// the adapter layer (`live-query-adapter.ts`) re-exports them.

/**
 * Structural check for a live-query/`Collection` instance.
 *
 * Uses duck typing rather than `instanceof CollectionImpl` on purpose: adapters
 * and core can resolve to different copies of `@tanstack/db` (dual-package /
 * multi-realm), where `instanceof` gives false negatives. The three methods
 * below uniquely identify a Collection.
 */
export function isCollection(
  value: unknown,
): value is Collection<any, any, any> {
  return (
    typeof value === `object` &&
    value !== null &&
    typeof (value as any).subscribeChanges === `function` &&
    typeof (value as any).startSyncImmediate === `function` &&
    typeof (value as any).id === `string`
  )
}

/**
 * The Collection an adapter hands users as `collection`. A pooled live query
 * stands in for its live-query Collection and builds it only when touched.
 */
export function getPublicCollection<
  T extends Collection<any, any, any> | null | undefined,
>(collection: T): T {
  return (
    (collection as { publicCollection?: T } | null | undefined)
      ?.publicCollection ?? collection
  )
}

/** Whether a collection yields a single result (`findOne`) rather than an array. */
export function isSingleResultCollection(
  collection: Collection<any, any, any>,
): boolean {
  return (
    (collection.config as { singleResult?: boolean } | undefined)
      ?.singleResult === true
  )
}

/**
 * The derived flags and health every adapter exposes for a query, besides
 * `status`, which each adapter reports as its own field.
 */
export interface LiveQueryStatusFlags {
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  /** The first load failed: there is nothing to show. `status` is `error`. */
  isLoadingError: boolean
  /** Local storage or an invariant broke. `status` is `crashed`. */
  isCrashed: boolean
  isCleanedUp: boolean
  /**
   * The data is shown, and something keeps it from staying current: a sync
   * problem or failed request somewhere in `health`. Set only while `status` is
   * `ready`; a disabled query is never in a sync error.
   */
  isSyncError: boolean
  /**
   * The health tree for the query and every Collection it depends on, or
   * `undefined` for a disabled query.
   */
  health: HealthNode | undefined
}

/**
 * Derive the status flags from a collection status and its health tree. This is
 * the one place the `isSyncError` rule is written. Adapters represent a disabled
 * query separately (with `isReady: true`); this covers the real
 * `CollectionStatus` values.
 */
export function getLiveQueryStatusFlags(
  status: CollectionStatus,
  health?: HealthNode,
): LiveQueryStatusFlags {
  return {
    isLoading: status === `loading`,
    isReady: status === `ready`,
    isIdle: status === `idle`,
    isLoadingError: status === `error`,
    isCrashed: status === `crashed`,
    isCleanedUp: status === `cleaned-up`,
    isSyncError: status === `ready` && health?.hasErrors === true,
    health,
  }
}
