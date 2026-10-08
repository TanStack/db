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
 * Collection attribution for a row's current value.
 *
 * - `'local'`: An optimistic row, or a source write attributed through a
 *   same-key local mutation
 * - `'remote'`: A source write without that local attribution
 *
 * Synced Collections infer attribution from key and timing, without a source
 * client ID. With one persisting local mutation and no truncate, the first queued
 * same-key source transaction published at successful mutation settlement
 * consumes local attribution. Its surviving row is `'local'`; later source
 * transactions are `'remote'`. A failed mutation gives those queued
 * writes no local attribution. A truncate can publish while a mutation remains
 * active, leaving its same-key row `'local'` even if the mutation later fails.
 * A source write on a still-pending manual mutation's key applies immediately
 * and can keep `'local'` attribution if that mutation rolls back.
 * When two same-key mutations both persist before a source transaction is
 * queued, with no truncate, a successful one retains one local attribution
 * for the key even if its sibling fails; two failures retain none. A later
 * same-key transaction in a truncate drain is
 * `'remote'` after the truncate transaction consumes that attribution.
 * An independent peer write can be labeled `'local'`, and a later confirmation
 * from this client can be labeled `'remote'`. Local-only Collections always use
 * `'local'`.
 */
export type VirtualOrigin = 'local' | 'remote'

/**
 * Virtual properties recognized on TanStack DB rows. The new
 * `$hasPendingWrites` field is optional here so legacy four-field rows accepted
 * by `hasVirtualProps` remain assignable. Rows returned by collections use
 * `WithVirtualProps`, which requires it.
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
 * if (!user.$hasPendingWrites) {
 *   console.log('No pending local optimistic writes for this row')
 * }
 * if (user.$origin === 'local') {
 *   console.log('Row has local attribution')
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Using virtual properties in queries
 * const ordersWithoutLocalWrites = createLiveQueryCollection({
 *   query: (q) => q
 *     .from({ order: orders })
 *     .where(({ order }) => eq(order.$hasPendingWrites, false))
 * })
 * ```
 */
export interface VirtualRowProps<
  TKey extends string | number = string | number,
> {
  /**
   * Whether this row currently has pending local optimistic writes.
   *
   * This describes the row's local optimistic state, not backend upload or
   * acknowledgement. It is always `false` for local-only collections. It is
   * optional only for compatibility with legacy rows; collection-published
   * rows always provide it.
   */
  readonly $hasPendingWrites?: boolean

  /**
   * Whether this row currently has no pending local optimistic writes.
   *
   * - `true`: No pending local optimistic mutation currently affects this row
   * - `false`: One or more pending local optimistic mutations currently affect this row
   *
   * This is local mutation status. It does not prove that a backend has uploaded,
   * confirmed, or read back the row. If you need backend-confirmed status, keep
   * your mutation function pending until that backend observation has happened,
   * or expose adapter-specific status.
   *
   * For local-only collections (no sync), this is always `true`.
   * For live query collections, this is passed through from the source collection.
   *
   * @deprecated Use `!row.$hasPendingWrites` instead. This alias will be
   * removed in the 1.0 RC.
   */
  readonly $synced: boolean

  /**
   * Collection attribution for this row's current value.
   *
   * - `'local'`: An optimistic row or a source write attributed through a
   *   same-key local mutation
   * - `'remote'`: A source write without that local attribution
   *
   * Synced Collections infer attribution from key and timing, not a source
   * client ID. With one persisting local mutation and no truncate, the first queued
   * same-key source transaction published at successful mutation settlement
   * consumes local attribution. Its surviving row is `'local'`; later source
   * transactions are `'remote'`. A failed mutation gives those queued
   * writes no local attribution. A truncate can publish while a mutation remains
   * active, leaving its same-key row `'local'` even if the mutation later fails.
   * A source write on a still-pending manual mutation's key applies immediately
   * and can keep `'local'` attribution if that mutation rolls back.
   * When two same-key mutations both persist before a source transaction is
   * queued, with no truncate, a successful one retains one local attribution
   * for the key even if its sibling fails; two failures retain none. A later
   * same-key transaction in a truncate drain is
   * `'remote'` after the truncate transaction consumes that attribution.
   * A peer write can be labeled `'local'`, and a later local confirmation can be
   * labeled `'remote'`.
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

/** Virtual properties guaranteed on rows published by this version. @internal */
export interface PublishedVirtualRowProps<
  TKey extends string | number = string | number,
> extends VirtualRowProps<TKey> {
  readonly $hasPendingWrites: boolean
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
 * // { id: string; name: string; $hasPendingWrites: boolean; $synced: boolean; $origin: 'local' | 'remote'; $key: string; $collectionId: string }
 * // $synced is deprecated; use !$hasPendingWrites instead.
 * ```
 */
export type WithVirtualProps<
  T extends object,
  TKey extends string | number = string | number,
> = T & PublishedVirtualRowProps<TKey>

/**
 * Extracts the base type from a type that may have virtual properties.
 * Useful when you need to work with the raw data without virtual properties.
 *
 * @template T - The type that may include virtual properties
 *
 * @example
 * ```typescript
 * type UserWithVirtual = { id: string; name: string; $hasPendingWrites: boolean; $origin: 'local' | 'remote' }
 * type User = WithoutVirtualProps<UserWithVirtual>
 * // { id: string; name: string }
 * ```
 */
export type WithoutVirtualProps<T> = T extends unknown
  ? Omit<T, keyof VirtualRowProps>
  : never

/**
 * Checks if a value has virtual properties attached. Legacy rows with the
 * original four properties still match; only rows published by this version
 * are guaranteed to carry `$hasPendingWrites`.
 *
 * @param value - The value to check
 * @returns true if the value has virtual properties
 *
 * @example
 * ```typescript
 * if (hasVirtualProps(row) && row.$hasPendingWrites !== undefined) {
 *   console.log('Pending local writes:', row.$hasPendingWrites)
 * }
 * ```
 */
export function hasVirtualProps(
  value: unknown,
): value is VirtualRowProps<string | number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['$synced', '$origin', '$key', '$collectionId'].every(
      (name) => name in value,
    )
  )
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
  const synced = existingRow.$synced ?? computeSynced()

  return {
    ...row,
    $hasPendingWrites: !synced,
    $synced: synced,
    $origin: existingRow.$origin ?? computeOrigin(),
    $key: existingRow.$key ?? key,
    $collectionId: existingRow.$collectionId ?? collectionId,
  } as WithVirtualProps<T, TKey>
}

/**
 * List of virtual property names for iteration and checking.
 * @internal
 */
export const VIRTUAL_PROP_NAMES = [
  '$hasPendingWrites',
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
