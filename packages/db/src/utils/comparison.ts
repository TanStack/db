import { dateTimestamp, durationFields, isTemporal } from '../utils'
import { getRuntimeReferenceIdentity } from '../query/runtime-reference-identity'
import { codedMessage, devBuild } from '../error-message'
import type { CompareOptions } from '../query/builder/types'

export { dateTimestamp } from '../utils'

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

function hasUnorderableValue(
  value: unknown,
  timestamp: number | undefined,
): boolean {
  return Number.isNaN(value) || Number.isNaN(timestamp)
}

/**
 * Whether a value has no IEEE-754 natural order: `NaN`, or an invalid Date
 * (whose timestamp is `NaN`). The query engine follows PostgreSQL float
 * semantics for these values — they are all equal to one another and greater
 * than every other (non-null) value — so the comparator and the WHERE
 * evaluator treat them explicitly instead of letting `NaN` compare unequal to
 * everything (which has no consistent order and cannot be indexed or sorted).
 */
export function isUnorderable(value: unknown): boolean {
  return hasUnorderableValue(value, dateTimestamp(value))
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
  const aDateTime = dateTimestamp(a)
  const bDateTime = dateTimestamp(b)
  const aUnordered = hasUnorderableValue(a, aDateTime)
  const bUnordered = hasUnorderableValue(b, bDateTime)
  if (aUnordered && bUnordered) return 0
  if (aUnordered) return 1
  if (bUnordered) return -1

  // If both values are strings, apply the configured string collation.
  if (typeof a === `string` && typeof b === `string`) {
    if (opts.stringSort === `custom`) {
      return opts.compare(a, b)
    }
    if (opts.stringSort === `locale`) {
      return a.localeCompare(b, opts.locale, opts.localeOptions)
    }
    // For lexical sort we rely on direct comparison for primitive values
  }

  // Keep the string collation class separate from other value types. Native
  // relational comparison ties every nonnumeric string with every number,
  // although those same strings have a distinct order among themselves.
  if (typeof a === `string` && typeof b !== `string`) return -1
  if (typeof b === `string` && typeof a !== `string`) return 1

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
  if (aDateTime !== undefined && bDateTime !== undefined) {
    return aDateTime - bDateTime
  }

  // If both are Temporal objects, use compareTemporalValues for correct semantic ordering
  const aTemporal = isTemporal(a)
  const bTemporal = isTemporal(b)
  if (aTemporal && bTemporal) {
    return compareTemporalValues(a, b)
  }

  // Symbols have identity but no built-in order: relational comparison throws.
  // A stable runtime ID gives tree indexes a total order while preserving
  // equality only for the same symbol.
  const aIsSymbol = typeof a === `symbol`
  const bIsSymbol = typeof b === `symbol`
  if (aIsSymbol && bIsSymbol) {
    if (a === b) return 0
    return getRuntimeReferenceIdentity(a)[2] - getRuntimeReferenceIdentity(b)[2]
  }
  if (aIsSymbol) return 1
  if (bIsSymbol) return -1

  // Function values are references too; coercing them against numbers can
  // create the same non-transitive ties as unlike ordered object kinds.
  const aIsObject = typeof a === `object` || typeof a === `function`
  const bIsObject = typeof b === `object` || typeof b === `function`

  if (aIsObject || bIsObject) {
    // Compare unlike ordered kinds before assigning stable IDs to ordinary objects.
    if (aIsObject && bIsObject) {
      // Array, Date, and Temporal comparisons order values within their own
      // kinds above. Keep those kinds apart from ordinary objects: mixing a
      // calendar comparison with runtime object IDs creates order cycles.
      const aKind = Array.isArray(a)
        ? 0
        : aDateTime !== undefined
          ? 1
          : aTemporal
            ? 2
            : 3
      const bKind = Array.isArray(b)
        ? 0
        : bDateTime !== undefined
          ? 1
          : bTemporal
            ? 2
            : 3
      if (aKind !== bKind) return aKind - bKind
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

/**
 * Index storage needs a total order even for Temporal values that have no
 * public `orderBy` relation. Keep kinds in separate groups, and consistently
 * order every Duration and PlainMonthDay by its exact equality key. Public
 * comparisons still use `makeComparator` and retain their strict semantics.
 */
export function makeIndexComparator(
  opts: CompareOptions,
): (a: any, b: any) => number {
  const compare = makeComparator(opts)
  return (a, b) => {
    const aTemporal = isTemporal(a)
    const bTemporal = isTemporal(b)
    if (!aTemporal || !bTemporal) return compare(a, b)

    const aKind = a[Symbol.toStringTag]
    const bKind = b[Symbol.toStringTag]
    let order: number
    if (aKind !== bKind) {
      order = aKind < bKind ? -1 : 1
    } else if (
      aKind === `Temporal.Duration` ||
      aKind === `Temporal.PlainMonthDay`
    ) {
      const aKey = normalizeValue(a) as string
      const bKey = normalizeValue(b) as string
      order = aKey < bKey ? -1 : aKey > bKey ? 1 : 0
    } else {
      return compare(a, b)
    }
    return opts.direction === `desc` ? -order : order
  }
}

/** Identify a supported Temporal tag for index ordering. */
export function indexTemporalKind(value: unknown): string | undefined {
  return isTemporal(value) ? value[Symbol.toStringTag] : undefined
}

/**
 * Wraps a user comparator so an index crashes on a result that cannot order
 * its storage, instead of silently misplacing rows.
 */
export function makeCheckedComparator(
  compareFn: (a: any, b: any) => number,
): (a: any, b: any) => number {
  return (a, b) => {
    const result: unknown = compareFn(a, b)
    if (typeof result !== `number` || Number.isNaN(result))
      throw new TypeError(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `Index comparator must return a number, but returned ${String(result)}`
          : codedMessage(166, { result }),
      )
    return result
  }
}

/** Default comparator orders values in ascending order with nulls first and locale string comparison. */
export const defaultComparator = makeComparator({
  direction: `asc`,
  nulls: `first`,
  stringSort: `locale`,
})

/** Recognize ordinary Uint8Array values, including Buffers and foreign realms. */
export function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === `[object Uint8Array]`
  )
}

/** Compare two Uint8Arrays for content equality. */
function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = a.length
  if (length !== b.length) {
    return false
  }
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

const NORMALIZED_KEY_PREFIX = `\u0000tanstack-db:`

function normalizedKey(kind: string, value: string): string {
  return `${NORMALIZED_KEY_PREFIX}${kind}:${value}`
}

const canonicalTemporalZones = new Map<string, string>()

function canonicalTemporalZone(zoneId: string): string {
  const cached = canonicalTemporalZones.get(zoneId)
  if (cached !== undefined) return cached

  let canonical = zoneId
  try {
    canonical = new Intl.DateTimeFormat(`en-US`, {
      timeZone: zoneId,
    }).resolvedOptions().timeZone
  } catch {
    // Keep valid Temporal zones that this host's Intl does not recognize.
  }
  canonicalTemporalZones.set(zoneId, canonical)
  return canonical
}

function normalizeBinary(value: Uint8Array): string {
  let bytes = ``
  for (const byte of value) {
    bytes += String.fromCharCode(byte)
  }
  return normalizedKey(`binary`, bytes)
}

/**
 * Sentinel value representing undefined in normalized form.
 * This allows distinguishing between "start from beginning" (undefined parameter)
 * and "start from the key undefined" (actual undefined value in the tree).
 */
export const UNDEFINED_SENTINEL = Symbol(`undefined index value`)

/**
 * Normalize a value for comparison and Map key usage
 * Converts values that can't be directly compared or used as Map keys
 * into comparable primitive representations
 *
 * Note: This does NOT convert undefined to a sentinel. Use normalizeForBTree
 * for BTree index operations that need to distinguish undefined values.
 */
export function normalizeValue(value: any): any {
  if (typeof value === `string`) {
    return value.startsWith(NORMALIZED_KEY_PREFIX)
      ? normalizedKey(`string`, value)
      : value
  }

  if (typeof value !== `object` || value === null) {
    return value
  }

  const timestamp = dateTimestamp(value)
  if (timestamp !== undefined) return timestamp

  if (isTemporal(value)) {
    const kind = value[Symbol.toStringTag]
    if (kind === `Temporal.ZonedDateTime`) {
      const zoned = value as typeof value & {
        epochNanoseconds: bigint
        timeZoneId: string
        calendarId: string
      }
      // Equality retains the instant, calendar, and canonical zone. A fixed
      // +00:00 zone stays distinct from named UTC, while UTC aliases merge.
      return normalizedKey(
        `temporal`,
        JSON.stringify([
          kind,
          String(zoned.epochNanoseconds),
          canonicalTemporalZone(zoned.timeZoneId),
          zoned.calendarId,
        ]),
      )
    }
    if (
      kind === `Temporal.PlainMonthDay` ||
      kind === `Temporal.PlainYearMonth`
    ) {
      // Default display omits the reference ISO year/day that native equals()
      // compares. The calendar-inclusive display preserves those fields.
      const fullText = (
        value.toString as (options: { calendarName: `always` }) => string
      )({ calendarName: `always` })
      return normalizedKey(`temporal`, `${kind}:${fullText}`)
    }
    if (kind === `Temporal.Duration`) {
      // Duration's default display balances subsecond units. Equality under
      // the #1519 contract instead preserves all ten fields.
      const duration = value as typeof value &
        Record<(typeof durationFields)[number], number>
      const fields = durationFields.map((field) => duration[field])
      return normalizedKey(`temporal`, JSON.stringify([kind, ...fields]))
    }
    return normalizedKey(`temporal`, `${kind}:${value.toString()}`)
  }

  // Normalize Uint8Arrays/Buffers to a string representation for Map key usage
  // This enables content-based equality for binary data like ULIDs
  if (isUint8Array(value)) {
    return normalizeBinary(value)
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
  return normalizeValue(value)
}

/** Order raw values while keeping BTree's undefined position distinct from its traversal marker. */
export function indexOrderValue(value: any, exactKey: any): any {
  return value === undefined ? exactKey : value
}

/** Supply custom comparators the Temporal display key used before raw ordering. */
export function indexCustomComparatorValue(value: unknown): unknown {
  return isTemporal(value)
    ? normalizedKey(
        `temporal`,
        `${value[Symbol.toStringTag]}:${value.toString()}`,
      )
    : value
}

/**
 * Compare values using the equality semantics used by Map keys.
 */
export function areSameValueZeroEqual(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
}

/**
 * Converts the `UNDEFINED_SENTINEL` back to `undefined`.
 * Needed such that the sentinel is converted back to `undefined` before comparison.
 */
export function denormalizeUndefined(value: any): any {
  if (value === UNDEFINED_SENTINEL) {
    return undefined
  }
  return value
}

/**
 * Compare two Temporal values of the same type, returning -1, 0, or 1.
 *
 * The tags check type agreement. Types without a static `.compare` (e.g.
 * `PlainMonthDay`) throw instead of using text order.
 *
 * Callers must ensure both arguments are Temporal objects; mixed types throw.
 */
export function compareTemporalValues(a: unknown, b: unknown): number {
  const aTag = (a as Record<symbol, unknown>)[Symbol.toStringTag]
  const bTag = (b as Record<symbol, unknown>)[Symbol.toStringTag]
  if (aTag !== bTag) {
    throw new TypeError(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Cannot order Temporal values of different types: ${aTag} vs ${bTag}`
        : codedMessage(167, { aTag, bTag }),
    )
  }
  const compare = (
    a as { constructor: { compare?: (x: unknown, y: unknown) => number } }
  ).constructor.compare
  if (typeof compare !== `function`) {
    throw new TypeError(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `${aTag} has no defined ordering`
        : codedMessage(168, { aTag }),
    )
  }
  return compare(a, b)
}

/**
 * Order two non-null values, returning -1, 0, or 1.
 *
 * Temporal types intentionally throw from `valueOf` to prevent silent
 * miscomparison via the native relational operators — delegate to
 * `compareTemporalValues` for them. Ordinary native Dates compare by their
 * timestamps, including against numbers and across realms. Other values
 * retain the native relational comparison.
 *
 * Callers must handle null/undefined themselves — this helper assumes both
 * arguments are non-null.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (isTemporal(a) && isTemporal(b)) {
    return compareTemporalValues(a, b)
  }
  const comparableA = dateTimestamp(a) ?? a
  const comparableB = dateTimestamp(b) ?? b
  return (comparableA as any) < (comparableB as any)
    ? -1
    : (comparableA as any) > (comparableB as any)
      ? 1
      : 0
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
  // If both are Uint8Arrays, compare by content
  if (isUint8Array(a) && isUint8Array(b)) {
    return areUint8ArraysEqual(a, b)
  }

  // Different types or not Uint8Arrays
  return false
}
