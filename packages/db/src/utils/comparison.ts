import { isTemporal } from '../utils'
import type { CompareOptions } from '../query/builder/types'
import type { TemporalLike } from '../utils'

// WeakMap to store stable IDs for objects
const objectIds = new WeakMap<object, number>()
let nextObjectId = 1

/**
 * Get or create a stable ID for an object
 */
function getObjectId(obj: object): number {
  if (objectIds.has(obj)) {
    return objectIds.get(obj)!
  }
  const id = nextObjectId++
  objectIds.set(obj, id)
  return id
}

/**
 * Whether a value has no IEEE-754 natural order: `NaN`, or an invalid Date
 * (whose timestamp is `NaN`). The query engine follows PostgreSQL float
 * semantics for these values — they are all equal to one another and greater
 * than every other (non-null) value — so the comparator and the WHERE
 * evaluator treat them explicitly instead of letting `NaN` compare unequal to
 * everything (which has no consistent order and cannot be indexed or sorted).
 */
export function isUnorderable(value: any): boolean {
  return (
    (typeof value === `number` && Number.isNaN(value)) ||
    (value instanceof Date && Number.isNaN(value.getTime()))
  )
}

/**
 * Universal comparison function for all data types
 * Handles null/undefined, strings, arrays, dates, objects, and primitives
 * Always sorts null/undefined values first
 */
export const ascComparator = (a: any, b: any, opts: CompareOptions): number => {
  const { nulls } = opts

  // Handle null/undefined
  if (a == null && b == null) return 0
  if (a == null) return nulls === `first` ? -1 : 1
  if (b == null) return nulls === `first` ? 1 : -1

  // Handle NaN / invalid Dates. Following PostgreSQL float semantics, they are
  // all equal and sort greater than every other non-null value. This keeps the
  // order total (NaN would otherwise compare equal to everything), so such
  // values can be sorted and stored in tree-based indexes.
  const aUnordered = isUnorderable(a)
  const bUnordered = isUnorderable(b)
  if (aUnordered && bUnordered) return 0
  if (aUnordered) return 1
  if (bUnordered) return -1

  // if a and b are both strings, compare them based on locale
  if (typeof a === `string` && typeof b === `string`) {
    if (opts.stringSort === `locale`) {
      return a.localeCompare(b, opts.locale, opts.localeOptions)
    }
    // For lexical sort we rely on direct comparison for primitive values
  }

  // if a and b are both arrays, compare them element by element
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const result = ascComparator(a[i], b[i], opts)
      if (result !== 0) {
        return result
      }
    }
    // All elements are equal up to the minimum length
    return a.length - b.length
  }

  // If both are dates, compare them
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime()
  }

  // If both are Temporal objects, use compareTemporalValues for correct semantic ordering
  if (isTemporal(a) && isTemporal(b)) {
    return compareTemporalValues(a, b)
  }

  // If at least one of the values is an object, use stable IDs for comparison
  const aIsObject = typeof a === `object`
  const bIsObject = typeof b === `object`

  if (aIsObject || bIsObject) {
    // If both are objects, compare their stable IDs
    if (aIsObject && bIsObject) {
      const aId = getObjectId(a)
      const bId = getObjectId(b)
      return aId - bId
    }

    // If only one is an object, objects come after primitives
    if (aIsObject) return 1
    if (bIsObject) return -1
  }

  // For primitive values, use direct comparison
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Descending comparator function for ordering values
 * Handles null/undefined as largest values (opposite of ascending)
 */
export const descComparator = (
  a: unknown,
  b: unknown,
  opts: CompareOptions,
): number => {
  return ascComparator(b, a, {
    ...opts,
    nulls: opts.nulls === `first` ? `last` : `first`,
  })
}

export function makeComparator(
  opts: CompareOptions,
): (a: any, b: any) => number {
  return (a, b) => {
    if (opts.direction === `asc`) {
      return ascComparator(a, b, opts)
    } else {
      return descComparator(a, b, opts)
    }
  }
}

/** Default comparator orders values in ascending order with nulls first and locale string comparison. */
export const defaultComparator = makeComparator({
  direction: `asc`,
  nulls: `first`,
  stringSort: `locale`,
})

/**
 * Compare two Uint8Arrays for content equality
 */
function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

/**
 * Sentinel value representing undefined in normalized form.
 * This allows distinguishing between "start from beginning" (undefined parameter)
 * and "start from the key undefined" (actual undefined value in the tree).
 */
const NORMALIZED_KEY_PREFIX = `\u0000tanstack-db:`

function normalizedKey(kind: string, value: string): string {
  return `${NORMALIZED_KEY_PREFIX}${kind}:${value}`
}

export const UNDEFINED_SENTINEL = normalizedKey(`undefined`, ``)
const UNORDERABLE_BTREE_SENTINEL = Object.freeze({
  kind: `tanstack-db-unorderable`,
})

/** Clone a Temporal equality value without trusting mutable brand lookalikes. */
export function snapshotTemporalEqualityValue(
  value: TemporalLike,
): TemporalLike {
  const prototype = Object.getPrototypeOf(value)
  const constructorDescriptor =
    prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, `constructor`)
  const constructor = constructorDescriptor?.value
  const fromDescriptor =
    typeof constructor === `function`
      ? Object.getOwnPropertyDescriptor(constructor, `from`)
      : undefined
  const toStringDescriptor =
    prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, `toString`)
  if (
    typeof constructor !== `function` ||
    typeof fromDescriptor?.value !== `function` ||
    typeof toStringDescriptor?.value !== `function`
  ) {
    throw new TypeError(
      `Cannot snapshot ${value[Symbol.toStringTag]} equality value`,
    )
  }

  const serialized = Reflect.apply(toStringDescriptor.value, value, [])
  const snapshot = Reflect.apply(fromDescriptor.value, constructor, [
    serialized,
  ])
  if (
    snapshot === value ||
    !isTemporal(snapshot) ||
    snapshot[Symbol.toStringTag] !== value[Symbol.toStringTag]
  ) {
    throw new TypeError(
      `Cannot snapshot ${value[Symbol.toStringTag]} equality value`,
    )
  }
  return snapshot
}

/**
 * Normalize a value for comparison and Map key usage
 * Converts values that can't be directly compared or used as Map keys
 * into comparable primitive representations
 *
 * Note: This does NOT convert undefined to a sentinel. Use normalizeForBTree
 * for BTree index operations that need to distinguish undefined values.
 */
export function normalizeValue(value: any): any {
  // Internal normalized keys occupy a reserved string domain. Escape user
  // strings in that domain so a literal cannot equal a binary or Temporal key.
  if (typeof value === `string`) {
    return value.startsWith(NORMALIZED_KEY_PREFIX)
      ? normalizedKey(`string`, value)
      : value
  }

  if (typeof value !== `object` || value === null) {
    return value
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  if (isTemporal(value)) {
    return normalizedKey(
      `temporal`,
      `${value[Symbol.toStringTag]}:${value.toString()}`,
    )
  }

  // Normalize Uint8Arrays/Buffers to a string representation for Map key usage
  // This enables content-based equality for binary data like ULIDs
  const isUint8Array =
    (typeof Buffer !== `undefined` && value instanceof Buffer) ||
    value instanceof Uint8Array

  if (isUint8Array) {
    // Convert to a string representation that can be used as a Map key.
    // Equality compares every binary value by content, so index keys must not
    // switch to reference identity at an arbitrary byte length.
    return normalizedKey(`binary`, Array.from(value).join(`,`))
  }

  return value
}

/**
 * Normalize a value for BTree index usage.
 * Extends normalizeValue to also convert undefined to a sentinel value.
 * This is needed because the BTree does not properly support `undefined` as a key
 * (it interprets undefined as "start from beginning" in nextHigherPair/nextLowerPair).
 */
export function normalizeForBTree(value: any): any {
  if (value === undefined) {
    return UNDEFINED_SENTINEL
  }
  const normalized = normalizeValue(value)
  return Number.isNaN(normalized) ? UNORDERABLE_BTREE_SENTINEL : normalized
}

/**
 * Compare values using the equality semantics used by Map keys.
 */
export function areSameValueZeroEqual(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
}

/** Converts BTree sentinels back to values understood by the comparator. */
export function denormalizeUndefined(value: any): any {
  if (value === UNORDERABLE_BTREE_SENTINEL) {
    return Number.NaN
  }
  if (value === UNDEFINED_SENTINEL) {
    return undefined
  }
  return value
}

// Cached map from Symbol.toStringTag → static compare function (null = none defined).
// Populated lazily on first encounter of each Temporal type so we never access
// `.constructor` more than once per type, and dispatch is keyed on the already-
// computed brand tag rather than on the constructor itself.
const temporalCompareByTag = new Map<
  string,
  ((a: unknown, b: unknown) => number) | null
>()

/**
 * Compare two Temporal values of the same type, returning -1, 0, or 1.
 *
 * Dispatch is keyed on `Symbol.toStringTag` (the brand already checked by
 * `isTemporal`) rather than `a.constructor`, making it robust across realms
 * and resistant to a shadowed `constructor` property. Types without a static
 * `.compare` (e.g. `PlainMonthDay`) throw rather than fall back to string
 * comparison, matching Temporal's design intent.
 *
 * Callers must ensure both arguments are Temporal objects; mixed types throw.
 */
export function compareTemporalValues(a: unknown, b: unknown): number {
  const aTag = (a as Record<symbol, unknown>)[Symbol.toStringTag] as string
  const bTag = (b as Record<symbol, unknown>)[Symbol.toStringTag] as string
  if (aTag !== bTag) {
    throw new TypeError(
      `Cannot order Temporal values of different types: ${aTag} vs ${bTag}`,
    )
  }
  let compare = temporalCompareByTag.get(aTag)
  if (compare === undefined) {
    const fn = (
      (a as { constructor: unknown }).constructor as {
        compare?: (x: unknown, y: unknown) => number
      }
    ).compare
    compare = typeof fn === `function` ? fn : null
    temporalCompareByTag.set(aTag, compare)
  }
  if (compare === null) {
    throw new TypeError(`${aTag} has no defined ordering`)
  }
  return compare(a, b)
}

/**
 * Order two non-null values, returning -1, 0, or 1.
 *
 * Temporal types intentionally throw from `valueOf` to prevent silent
 * miscomparison via the native relational operators — delegate to
 * `compareTemporalValues` for them. For everything else (numbers, strings,
 * Dates via `valueOf`, etc.) the native operators do the right thing.
 *
 * Callers must handle null/undefined themselves — this helper assumes both
 * arguments are non-null.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (isTemporal(a) && isTemporal(b)) {
    return compareTemporalValues(a, b)
  }
  return (a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0
}

/**
 * Compare two values for equality, with special handling for Uint8Arrays and Buffers
 */
export function areValuesEqual(a: any, b: any): boolean {
  // Fast path for reference equality
  if (a === b) {
    return true
  }

  // Check for Uint8Array/Buffer comparison
  const aIsUint8Array =
    (typeof Buffer !== `undefined` && a instanceof Buffer) ||
    a instanceof Uint8Array
  const bIsUint8Array =
    (typeof Buffer !== `undefined` && b instanceof Buffer) ||
    b instanceof Uint8Array

  // If both are Uint8Arrays, compare by content
  if (aIsUint8Array && bIsUint8Array) {
    return areUint8ArraysEqual(a, b)
  }

  // Different types or not Uint8Arrays
  return false
}
