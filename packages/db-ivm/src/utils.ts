/**
 * Simple assertion function for runtime checks.
 * Throws an error if the condition is false.
 */
export function assert(
  condition: unknown,
  message?: string,
): asserts condition {
  if (!condition) {
    throw new Error(message || `Assertion failed`)
  }
}

/**
 * A map that returns a default value for keys that are not present.
 */
export class DefaultMap<K, V> extends Map<K, V> {
  constructor(
    private defaultValue: () => V,
    entries?: Iterable<[K, V]>,
  ) {
    super(entries)
  }

  get(key: K): V {
    if (!this.has(key)) {
      // this.set(key, this.defaultValue())
      return this.defaultValue()
    }
    return super.get(key)!
  }

  /**
   * Update the value for a key using a function.
   */
  update(key: K, updater: (value: V) => V): V {
    const value = this.get(key)
    const newValue = updater(value)
    this.set(key, newValue)
    return newValue
  }
}

// JS engines have various limits on how many args can be passed to a function
// with a spread operator, so we need to split the operation into chunks
// 32767 is the max for Chrome 14, all others are higher
// TODO: investigate the performance of this and other approaches
const chunkSize = 30000
export function chunkedArrayPush(array: Array<unknown>, other: Array<unknown>) {
  if (other.length <= chunkSize) {
    array.push(...other)
  } else {
    for (let i = 0; i < other.length; i += chunkSize) {
      const chunk = other.slice(i, i + chunkSize)
      array.push(...chunk)
    }
  }
}

export function binarySearch<T>(
  array: Array<T>,
  value: T,
  comparator: (a: T, b: T) => number,
): number {
  let low = 0
  let high = array.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const comparison = comparator(array[mid]!, value)
    if (comparison < 0) {
      low = mid + 1
    } else if (comparison > 0) {
      high = mid
    } else {
      return mid
    }
  }
  return low
}

/**
 * Utility for generating unique IDs for objects and values.
 * Uses WeakMap for object reference tracking and consistent hashing for primitives.
 */
export class ObjectIdGenerator {
  private objectIds = new WeakMap<object, number>()
  private nextId = 0

  /**
   * Get a unique identifier for any value.
   * - Objects: Uses WeakMap for reference-based identity
   * - Primitives: Uses consistent string-based hashing
   */
  getId(value: any): number {
    // For primitives, use a simple hash of their string representation
    if (typeof value !== `object` || value === null) {
      const str = String(value)
      let hashValue = 0
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hashValue = (hashValue << 5) - hashValue + char
        hashValue = hashValue & hashValue // Convert to 32-bit integer
      }
      return hashValue
    }

    // For objects, use WeakMap to assign unique IDs
    if (!this.objectIds.has(value)) {
      this.objectIds.set(value, this.nextId++)
    }
    return this.objectIds.get(value)!
  }

  /**
   * Get a string representation of the ID for use in composite keys.
   */
  getStringId(value: any): string {
    if (value === null) return `null`
    if (value === undefined) return `undefined`
    if (typeof value !== `object`) return `str_${String(value)}`

    return `obj_${this.getId(value)}`
  }
}

/**
 * Global instance for cases where a shared object ID space is needed.
 */
export const globalObjectIdGenerator = new ObjectIdGenerator()

export function* concatIterable<T>(
  ...iterables: Array<Iterable<T>>
): Iterable<T> {
  for (const iterable of iterables) {
    yield* iterable
  }
}

export function* mapIterable<T, U>(
  it: Iterable<T>,
  fn: (t: T) => U,
): Iterable<U> {
  for (const t of it) {
    yield fn(t)
  }
}

export type HRange = [number, number] // half-open [start, end[ i.e. end is exclusive

/**
 * Computes the difference between two half-open ranges.
 * @param a - The first half-open range
 * @param b - The second half-open range
 * @returns The difference between the two ranges
 */
export function diffHalfOpen(a: HRange, b: HRange) {
  const [a1, a2] = a
  const [b1, b2] = b

  // A \ B can be up to two segments (left and right of the overlap)
  const onlyInA: Array<number> = [
    ...range(a1, Math.min(a2, b1)), // left side of A outside B
    ...range(Math.max(a1, b2), a2), // right side of A outside B
  ]

  // B \ A similarly
  const onlyInB: Array<number> = [
    ...range(b1, Math.min(b2, a1)),
    ...range(Math.max(b1, a2), b2),
  ]

  return { onlyInA, onlyInB }
}

function range(start: number, end: number): Array<number> {
  const out: Array<number> = []
  for (let i = start; i < end; i++) out.push(i)
  return out
}

/**
 * Compares two keys (string | number) in a consistent, deterministic way.
 * Handles mixed types by ordering strings before numbers.
 */
export function compareKeys(a: string | number, b: string | number): number {
  // Same type: compare directly
  if (typeof a === typeof b) {
    if (typeof a === `number` && typeof b === `number`) {
      const aIsNaN = Number.isNaN(a)
      const bIsNaN = Number.isNaN(b)
      if (aIsNaN || bIsNaN) {
        if (aIsNaN && bIsNaN) return 0
        return aIsNaN ? 1 : -1
      }
    }
    if (a < b) return -1
    if (a > b) return 1
    return 0
  }
  // Different types: strings come before numbers
  return typeof a === `string` ? -1 : 1
}

type CanonicalValue =
  | readonly [`undefined`]
  | readonly [`null`]
  | readonly [`boolean`, boolean]
  | readonly [`number`, number | `NaN` | `Infinity` | `-Infinity`]
  | readonly [`bigint`, string]
  | readonly [`string`, string]
  | readonly [`date`, number | `Invalid`]
  | readonly [`regexp`, string, string]
  | readonly [`bytes`, Array<number>]
  | readonly [`array`, Array<CanonicalValue>]
  | readonly [`map`, Array<readonly [CanonicalValue, CanonicalValue]>]
  | readonly [`set`, Array<CanonicalValue>]
  | readonly [`object`, Array<readonly [string, CanonicalValue]>]

/**
 * Serializes a supported query value into one canonical key.
 *
 * JSON's native encoding is not suitable for relation keys: it merges BigInt
 * with strings when a replacer is used, merges NaN with null, drops undefined,
 * and depends on object insertion order. Ordinary JSON values keep their
 * established wire form. Values that need richer types use a reserved prefix
 * plus a structural, type-tagged encoding.
 */
export function serializeValue(value: unknown): string {
  if (isJsonSafeStructuralValue(value, new Set())) {
    return JSON.stringify(toStableJsonValue(value))
  }

  return `~${JSON.stringify(toCanonicalValue(value, new Set()))}`
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | Array<JsonValue>
  | { [key: string]: JsonValue }

function isJsonSafeStructuralValue(
  value: unknown,
  ancestors: Set<object>,
): boolean {
  if (value === null) return true

  switch (typeof value) {
    case `boolean`:
    case `string`:
      return true
    case `number`:
      return Number.isFinite(value)
    case `undefined`:
    case `bigint`:
    case `symbol`:
    case `function`:
      return false
  }

  return withAcyclicValue(value, ancestors, () => {
    if (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof Uint8Array ||
      value instanceof Map ||
      value instanceof Set
    ) {
      return false
    }

    return Array.isArray(value)
      ? value.every((item) => isJsonSafeStructuralValue(item, ancestors))
      : Object.keys(value).every((key) =>
          isJsonSafeStructuralValue(
            (value as Record<string, unknown>)[key],
            ancestors,
          ),
        )
  })
}

function toStableJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === `boolean` ||
    typeof value === `number` ||
    typeof value === `string`
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(toStableJsonValue)
  }

  return Object.fromEntries(
    Object.keys(value as object)
      .sort()
      .map((key) => [
        key,
        toStableJsonValue((value as Record<string, unknown>)[key]),
      ]),
  )
}

function toCanonicalValue(
  value: unknown,
  ancestors: Set<object>,
): CanonicalValue {
  if (value === undefined) return [`undefined`]
  if (value === null) return [`null`]

  switch (typeof value) {
    case `boolean`:
      return [`boolean`, value]
    case `number`:
      if (Number.isNaN(value)) return [`number`, `NaN`]
      if (value === Infinity) return [`number`, `Infinity`]
      if (value === -Infinity) return [`number`, `-Infinity`]
      return [`number`, value === 0 ? 0 : value]
    case `bigint`:
      return [`bigint`, value.toString()]
    case `string`:
      return [`string`, value]
    case `symbol`:
    case `function`:
      throw new TypeError(
        `Cannot serialize ${typeof value} as a structural relation key`,
      )
  }

  return withAcyclicValue(value, ancestors, () => {
    if (value instanceof Date) {
      const timestamp = value.getTime()
      return Number.isNaN(timestamp)
        ? ([`date`, `Invalid`] as const)
        : ([`date`, timestamp] as const)
    }

    if (value instanceof RegExp) {
      return [`regexp`, value.source, value.flags]
    }

    if (value instanceof Uint8Array) {
      return [`bytes`, Array.from(value)]
    }

    if (Array.isArray(value)) {
      return [`array`, value.map((item) => toCanonicalValue(item, ancestors))]
    }

    if (value instanceof Map) {
      const entries = [...value.entries()].map(
        ([key, entryValue]) =>
          [
            toCanonicalValue(key, ancestors),
            toCanonicalValue(entryValue, ancestors),
          ] as const,
      )
      entries.sort((left, right) =>
        compareSerializedValues(JSON.stringify(left), JSON.stringify(right)),
      )
      return [`map`, entries]
    }

    if (value instanceof Set) {
      const entries = [...value].map((entry) =>
        toCanonicalValue(entry, ancestors),
      )
      entries.sort((left, right) =>
        compareSerializedValues(JSON.stringify(left), JSON.stringify(right)),
      )
      return [`set`, entries]
    }

    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          [
            key,
            toCanonicalValue(
              (value as Record<string, unknown>)[key],
              ancestors,
            ),
          ] as const,
      )
    return [`object`, entries]
  })
}

function compareSerializedValues(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function withAcyclicValue<T>(
  value: object,
  ancestors: Set<object>,
  encode: () => T,
): T {
  if (ancestors.has(value)) {
    throw new TypeError(`Cannot serialize a cyclic structural relation key`)
  }

  ancestors.add(value)
  try {
    return encode()
  } finally {
    ancestors.delete(value)
  }
}
