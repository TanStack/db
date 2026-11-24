import { durationFields, isTemporal } from '../utils'
import { getRuntimeReferenceIdentity } from '../query/runtime-reference-identity'
import { codedMessage, devBuild } from '../error-message'
import { isPlainObject } from './type-guards'
import type { DurationFields } from '../utils'
import type { CompareOptions } from '../query/builder/types'

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

  // If at least one of the values is an object, use stable IDs for comparison
  const aIsObject = typeof a === `object`
  const bIsObject = typeof b === `object`

  if (aIsObject || bIsObject) {
    if (aIsObject && bIsObject) {
      // Value classes order by their serialized value, before other objects,
      // so equal instances compare equal in sorts and tree indexes.
      const aJSON = serializedClassValue(a)
      const bJSON = serializedClassValue(b)
      if (aJSON !== undefined || bJSON !== undefined) {
        if (aJSON === undefined) return 1
        if (bJSON === undefined) return -1
        return aJSON < bJSON ? -1 : aJSON > bJSON ? 1 : 0
      }
      // Symbols and objects share the runtime's reference-identity sequence.
      const aId = getRuntimeReferenceIdentity(a)[2]
      const bId = getRuntimeReferenceIdentity(b)[2]
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
  return a == null || b == null
    ? ascComparator(a, b, opts)
    : ascComparator(b, a, opts)
}

export function indexObjectKind(value: any): string {
  if (isUint8Array(value)) return `Binary`
  if (isTemporal(value)) {
    const tag = value[Symbol.toStringTag]
    const fields = value as unknown as DurationFields
    return tag === `Temporal.Duration` &&
      (fields.years || fields.months || fields.weeks)
      ? `Temporal.Duration.calendar`
      : tag
  }
  if (Array.isArray(value)) return `Array`
  return `Object`
}

export function makeComparator(
  opts: CompareOptions,
  scope: `values` | `index` = `values`,
): (a: any, b: any) => number {
  const compare = opts.direction === `asc` ? ascComparator : descComparator
  if (scope !== `index`) return (a, b) => compare(a, b, opts)

  const direction = opts.direction === `asc` ? 1 : -1
  return (a, b) => {
    // An index needs one stable domain for each native comparison law. In
    // particular, Date order cannot be mixed with reference-object order.
    if (a != null && b != null) {
      if (a instanceof Date) a = a.getTime()
      if (b instanceof Date) b = b.getTime()
      const aType = typeof a
      const bType = typeof b
      if (aType !== bType) return (aType < bType ? -1 : 1) * direction
      if (aType === `object`) {
        const aKind = indexObjectKind(a)
        const bKind = indexObjectKind(b)
        if (aKind !== bKind) return (aKind < bKind ? -1 : 1) * direction
        // Binary content and unordered Temporal values use their exact keys
        // for stable storage order.
        if (
          aKind === `Binary` ||
          aKind === `Temporal.Duration.calendar` ||
          aKind === `Temporal.PlainMonthDay`
        ) {
          const left = normalizeValue(a)
          const right = normalizeValue(b)
          return (left < right ? -1 : left > right ? 1 : 0) * direction
        }
      }
    }
    return compare(a, b, opts)
  }
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

/** Include host Buffers when the current realm has a different Uint8Array. */
export function isUint8Array(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    (typeof Buffer !== `undefined` && value instanceof Buffer)
  )
}

/** Compare two Uint8Arrays for content equality. */
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

const NORMALIZED_KEY_PREFIX = `\u0000tanstack-db:`
export function normalizedKey(kind: string, value: string): string {
  return `${NORMALIZED_KEY_PREFIX}${kind}:${value}`
}

const binaryKeys = new WeakMap<Uint8Array, string>()

function normalizeBinary(value: Uint8Array): string {
  const cached = binaryKeys.get(value)
  if (cached) return cached
  let bytes: string
  if (value.byteLength <= 8192) {
    bytes = String.fromCharCode.apply(null, value as unknown as Array<number>)
  } else {
    const chunks: Array<string> = []
    for (let index = 0; index < value.byteLength; index += 8192) {
      chunks.push(
        String.fromCharCode.apply(
          null,
          value.subarray(index, index + 8192) as unknown as Array<number>,
        ),
      )
    }
    bytes = chunks.join(``)
  }
  const key = normalizedKey(`binary`, bytes)
  binaryKeys.set(value, key)
  return key
}

/**
 * The serialized value of a value class: an instance of a class with a
 * `toJSON()` method, such as a record ID or a decimal, that no other rule
 * covers. Built-in values (Dates, Temporal values, binary data, Maps and
 * Sets), including subclasses that define `toJSON()`, keep their own rules,
 * and plain records and arrays are not value classes. Record keys
 * in the serialized value are sorted, so key order does not change it.
 */
// Value classes must not change while a query or row holds them, so each is
// serialized once. A throwing toJSON() caches nothing and throws again.
const serializedClassValues = new WeakMap<object, string | undefined>()

export function serializedClassValue(value: object): string | undefined {
  const cached = serializedClassValues.get(value)
  if (cached !== undefined) return cached
  // Excluded objects keep their own rules, so their `toJSON` is never read: it
  // can be an accessor that throws.
  if (
    isPlainObject(value) ||
    Array.isArray(value) ||
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    isTemporal(value) ||
    typeof (value as { toJSON?: unknown }).toJSON !== `function`
  ) {
    return undefined
  }
  const serialized = JSON.stringify(value, (_key, field: unknown) =>
    isPlainObject(field)
      ? Object.fromEntries(
          Object.keys(field)
            .sort()
            .map((key) => [key, field[key]]),
        )
      : field,
  )
  serializedClassValues.set(value, serialized)
  return serialized
}

/**
 * Normalize a value for comparison and Map key usage
 * Converts values that can't be directly compared or used as Map keys
 * into comparable primitive representations
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

  if (value instanceof Date) {
    return value.getTime()
  }

  if (isTemporal(value)) {
    const tag = value[Symbol.toStringTag]
    if (tag === 'Temporal.Duration') {
      const fields = value as unknown as DurationFields
      return normalizedKey(
        tag,
        durationFields.map((field) => fields[field]).join(','),
      )
    }
    return normalizedKey(tag, value.toString())
  }

  // Normalize Uint8Arrays/Buffers to a string representation for Map key usage
  // This enables content-based equality for binary data like ULIDs
  if (isUint8Array(value)) {
    return normalizeBinary(value)
  }

  // A value class compares by its serialized value, in a namespace no plain
  // string or other normalized value occupies.
  const serialized = serializedClassValue(value)
  if (serialized !== undefined) {
    return normalizedKey(`toJSON`, serialized)
  }

  return value
}

/**
 * Compare values using the equality semantics used by Map keys.
 */
export function areSameValueZeroEqual(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
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

const VALUE_CLASS_ORDER: CompareOptions = {
  direction: `asc`,
  nulls: `first`,
  stringSort: `lexical`,
}

function arrayHoldsValueClass(
  array: ReadonlyArray<unknown>,
  seen?: Set<unknown>,
): boolean {
  for (const item of array) {
    if (typeof item !== `object` || item === null) continue
    if (!Array.isArray(item)) {
      if (serializedClassValue(item) !== undefined) return true
      continue
    }
    // Cycle tracking starts at the first nested array.
    seen ??= new Set([array])
    if (seen.has(item)) continue
    seen.add(item)
    if (arrayHoldsValueClass(item, seen)) return true
  }
  return false
}

function holdsValueClass(value: unknown): boolean {
  if (typeof value !== `object` || value === null) return false
  return Array.isArray(value)
    ? arrayHoldsValueClass(value)
    : serializedClassValue(value) !== undefined
}

/**
 * Order two values when at least one holds a value class. Query identity hashes
 * plain objects by shape, so this order must not read an object's reference:
 * inside an array, objects without a value class keep the native comparison,
 * and an array sorts after any value that is not an array.
 */
function compareHoldingValueClass(
  a: unknown,
  b: unknown,
  visiting?: Map<unknown, Set<unknown>>,
): number {
  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b)
  if (aIsArray && bIsArray) {
    // Only this pair coming up again inside its own comparison is a cycle. An
    // array that both operands share at different depths is compared in full.
    const active = visiting ?? new Map<unknown, Set<unknown>>()
    let partners = active.get(a)
    if (partners === undefined) active.set(a, (partners = new Set()))
    if (partners.has(b)) return 0
    partners.add(b)
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const left = a[index]
      const right = b[index]
      const result =
        left == null || right == null
          ? Math.sign(ascComparator(left, right, VALUE_CLASS_ORDER))
          : compareNonNullValues(left, right, active)
      if (result !== 0) return result
    }
    partners.delete(b)
    return Math.sign(a.length - b.length)
  }
  // The sort order already puts an array after a primitive or a value class;
  // after another object it would read references.
  if (aIsArray !== bIsArray) return aIsArray ? 1 : -1
  return Math.sign(ascComparator(a, b, VALUE_CLASS_ORDER))
}

function compareNonNullValues(
  a: unknown,
  b: unknown,
  visiting?: Map<unknown, Set<unknown>>,
): number {
  if (isTemporal(a) && isTemporal(b)) {
    return compareTemporalValues(a, b)
  }
  if (holdsValueClass(a) || holdsValueClass(b)) {
    return compareHoldingValueClass(a, b, visiting)
  }
  return (a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0
}

/**
 * Order two non-null values, returning -1, 0, or 1.
 *
 * Temporal types intentionally throw from `valueOf` to prevent silent
 * miscomparison via the native relational operators — delegate to
 * `compareTemporalValues` for them. A value class, alone or inside an array,
 * uses the sort order, which reads its serialized value: equal captures are
 * one query, so a range must not depend on `valueOf`. For everything else
 * (numbers, strings, Dates via `valueOf`, etc.) the native operators do the
 * right thing.
 *
 * Callers must handle null/undefined themselves — this helper assumes both
 * arguments are non-null.
 */
export function compareValues(a: unknown, b: unknown): number {
  return compareNonNullValues(a, b)
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
