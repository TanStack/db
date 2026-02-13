/**
 * Virtual Properties for TanStack DB
 *
 * Virtual properties are computed, read-only properties that provide metadata about rows
 * (sync status, source, selection state) without being part of the persisted data model.
 *
 * Virtual properties are prefixed with `$` to distinguish them from user data fields.
 * User schemas should not include `$`-prefixed fields as they are reserved.
 */

/**
 * Origin of the last confirmed change to a row, from the current client's perspective.
 *
 * - `'local'`: The change originated from this client (e.g., a mutation made here)
 * - `'remote'`: The change was received via sync from another client/server
 *
 * Note: This reflects the client's perspective, not the original creator.
 * User A creates order → $origin = 'local' on User A's client
 * Order syncs to server
 * User B receives order → $origin = 'remote' on User B's client
 */
export type VirtualOrigin = 'local' | 'remote'

/**
 * Virtual properties available on every row in TanStack DB collections.
 *
 * These properties are:
 * - Computed (not stored in the data model)
 * - Read-only (cannot be mutated directly)
 * - Available in queries (WHERE, ORDER BY, SELECT)
 * - Included when spreading rows (`...user`)
 *
 * @template TKey - The type of the row's key (string or number)
 *
 * @example
 * ```typescript
 * // Accessing virtual properties on a row
 * const user = collection.get('user-1')
 * if (user.$synced) {
 *   console.log('Confirmed by backend')
 * }
 * if (user.$origin === 'local') {
 *   console.log('Created/modified locally')
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Using virtual properties in queries
 * const confirmedOrders = createLiveQueryCollection({
 *   query: (q) => q
 *     .from({ order: orders })
 *     .where(({ order }) => eq(order.$synced, true))
 * })
 * ```
 */
export interface VirtualRowProps<
  TKey extends string | number = string | number,
> {
  /**
   * Whether this row reflects confirmed state from the backend.
   *
   * - `true`: Row is confirmed by the backend (no pending optimistic mutations)
   * - `false`: Row has pending optimistic mutations that haven't been confirmed
   *
   * For local-only collections (no sync), this is always `true`.
   * For live query collections, this is passed through from the source collection.
   */
  readonly $synced: boolean

  /**
   * Origin of the last confirmed change to this row, from the current client's perspective.
   *
   * - `'local'`: The change originated from this client
   * - `'remote'`: The change was received via sync
   *
   * For local-only collections, this is always `'local'`.
   * For live query collections, this is passed through from the source collection.
   */
  readonly $origin: VirtualOrigin

  /**
   * The row's key (primary identifier).
   *
   * This is the same value returned by `collection.config.getKey(row)`.
   * Useful when you need the key in projections or computations.
   */
  readonly $key: TKey

  /**
   * The ID of the source collection this row originated from.
   *
   * In joins, this can help identify which collection each row came from.
   * For live query collections, this is the ID of the upstream collection.
   */
  readonly $collectionId: string
}

/**
 * Virtual properties as ref types for use in query expressions.
 * These are the types used when accessing virtual properties in query callbacks.
 *
 * @internal
 */
export type VirtualRefProps<TKey extends string | number = string | number> = {
  readonly $synced: boolean
  readonly $origin: VirtualOrigin
  readonly $key: TKey
  readonly $collectionId: string
}

/**
 * Adds virtual properties to a row type.
 *
 * @template T - The base row type
 * @template TKey - The type of the row's key
 *
 * @example
 * ```typescript
 * type User = { id: string; name: string }
 * type UserWithVirtual = WithVirtualProps<User, string>
 * // { id: string; name: string; $synced: boolean; $origin: 'local' | 'remote'; $key: string; $collectionId: string }
 * ```
 */
export type WithVirtualProps<
  T extends object,
  TKey extends string | number = string | number,
> = T & VirtualRowProps<TKey>

/**
 * Extracts the base type from a type that may have virtual properties.
 * Useful when you need to work with the raw data without virtual properties.
 *
 * @template T - The type that may include virtual properties
 *
 * @example
 * ```typescript
 * type UserWithVirtual = { id: string; name: string; $synced: boolean; $origin: 'local' | 'remote' }
 * type User = WithoutVirtualProps<UserWithVirtual>
 * // { id: string; name: string }
 * ```
 */
export type WithoutVirtualProps<T> = Omit<
  T,
  '$synced' | '$origin' | '$key' | '$collectionId'
>

/**
 * Checks if a value has virtual properties attached.
 *
 * @param value - The value to check
 * @returns true if the value has virtual properties
 *
 * @example
 * ```typescript
 * if (hasVirtualProps(row)) {
 *   console.log('Synced:', row.$synced)
 * }
 * ```
 */
export function hasVirtualProps(
  value: unknown,
): value is VirtualRowProps<string | number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$synced' in value &&
    '$origin' in value
  )
}

/**
 * Creates virtual properties for a row in a source collection.
 *
 * This is the internal function used by collections to add virtual properties
 * to rows when emitting change messages.
 *
 * @param key - The row's key
 * @param collectionId - The collection's ID
 * @param isSynced - Whether the row is synced (not optimistic)
 * @param origin - Whether the change was local or remote
 * @returns Virtual properties object to merge with the row
 *
 * @internal
 */
export function createVirtualProps<TKey extends string | number>(
  key: TKey,
  collectionId: string,
  isSynced: boolean,
  origin: VirtualOrigin,
): VirtualRowProps<TKey> {
  return {
    $synced: isSynced,
    $origin: origin,
    $key: key,
    $collectionId: collectionId,
  }
}

/**
 * Enriches a row with virtual properties using the "add-if-missing" pattern.
 *
 * If the row already has virtual properties (from an upstream collection),
 * they are preserved. If not, new virtual properties are computed and added.
 *
 * This is the key function that enables pass-through semantics for nested
 * live query collections.
 *
 * @param row - The row to enrich
 * @param key - The row's key
 * @param collectionId - The collection's ID
 * @param computeSynced - Function to compute $synced if missing
 * @param computeOrigin - Function to compute $origin if missing
 * @returns The row with virtual properties (possibly the same object if already present)
 *
 * @internal
 */
export function enrichRowWithVirtualProps<
  T extends object,
  TKey extends string | number,
>(
  row: T,
  key: TKey,
  collectionId: string,
  computeSynced: () => boolean,
  computeOrigin: () => VirtualOrigin,
): WithVirtualProps<T, TKey> {
  // Use nullish coalescing to preserve existing virtual properties (pass-through)
  // This is the "add-if-missing" pattern described in the RFC
  const existingRow = row as Partial<VirtualRowProps<TKey>>

  return {
    ...row,
    $synced: existingRow.$synced ?? computeSynced(),
    $origin: existingRow.$origin ?? computeOrigin(),
    $key: existingRow.$key ?? key,
    $collectionId: existingRow.$collectionId ?? collectionId,
  } as WithVirtualProps<T, TKey>
}

/**
 * Computes aggregate virtual properties for a group of rows.
 *
 * For aggregates:
 * - `$synced`: true if ALL rows in the group are synced; false if ANY row is optimistic
 * - `$origin`: 'local' if ANY row in the group is local; otherwise 'remote'
 *
 * @param rows - The rows in the group
 * @param groupKey - The group key
 * @param collectionId - The collection ID
 * @returns Virtual properties for the aggregate row
 *
 * @internal
 */
export function computeAggregateVirtualProps<TKey extends string | number>(
  rows: Array<Partial<VirtualRowProps<string | number>>>,
  groupKey: TKey,
  collectionId: string,
): VirtualRowProps<TKey> {
  // $synced = true only if ALL rows are synced (false if ANY is optimistic)
  const allSynced = rows.every((row) => row.$synced ?? true)

  // $origin = 'local' if ANY row is local (consistent with "local influence" semantics)
  const hasLocal = rows.some((row) => row.$origin === 'local')

  return {
    $synced: allSynced,
    $origin: hasLocal ? 'local' : 'remote',
    $key: groupKey,
    $collectionId: collectionId,
  }
}

/**
 * List of virtual property names for iteration and checking.
 * @internal
 */
export const VIRTUAL_PROP_NAMES = [
  '$synced',
  '$origin',
  '$key',
  '$collectionId',
] as const

/**
 * Checks if a property name is a virtual property.
 * @internal
 */
export function isVirtualPropName(name: string): boolean {
  return VIRTUAL_PROP_NAMES.includes(name as any)
}

/**
 * Checks whether a property path references a virtual property.
 * @internal
 */
export function hasVirtualPropPath(path: Array<string>): boolean {
  return path.some((segment) => isVirtualPropName(segment))
}
