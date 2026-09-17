import type { Collection } from './collection/index.js'
import type { CollectionStatus } from './types.js'

/**
 * Shared helpers for the first-party framework adapters (`@tanstack/react-db`,
 * `@tanstack/vue-db`, `@tanstack/svelte-db`, `@tanstack/solid-db`,
 * `@tanstack/angular-db`).
 *
 * These centralize small pieces of logic every adapter used to duplicate, so
 * they stay consistent across frameworks. They are intended for the official
 * adapters; treat them as unstable for external use.
 */

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

/** Whether a collection yields a single result (`findOne`) rather than an array. */
export function isSingleResultCollection(
  collection: Collection<any, any, any>,
): boolean {
  return (
    (collection.config as { singleResult?: boolean } | undefined)
      ?.singleResult === true
  )
}

/** The derived boolean status flags every adapter exposes for a query. */
export interface LiveQueryStatusFlags {
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

/**
 * Derive the boolean status flags from a collection status. Adapters represent
 * a disabled query separately (with `isReady: true`); this covers the real
 * `CollectionStatus` values.
 */
export function getLiveQueryStatusFlags(
  status: CollectionStatus,
): LiveQueryStatusFlags {
  return {
    isLoading: status === `loading`,
    isReady: status === `ready`,
    isIdle: status === `idle`,
    isError: status === `error`,
    isCleanedUp: status === `cleaned-up`,
  }
}
