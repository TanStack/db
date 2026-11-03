/**
 * Generic utility functions
 */

import { InvalidKeyError, UndefinedKeyError } from './errors'
import type { CompareOptions } from './query/builder/types'

interface TypedArray {
  length: number
  [index: number]: number
  every: (predicate: (value: number, index: number) => boolean) => boolean
}

export const durationFields = [
  `years`,
  `months`,
  `weeks`,
  `days`,
  `hours`,
  `minutes`,
  `seconds`,
  `milliseconds`,
  `microseconds`,
  `nanoseconds`,
] as const
export type DurationFields = Record<(typeof durationFields)[number], number>

/**
 * Deep equality function that compares two values recursively
 * Handles primitives, objects, arrays, Date, RegExp, Map, Set, TypedArrays, and Temporal objects
 * Record prototypes are observable shape; different prototypes are unequal.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns True if the values are deeply equal, false otherwise
 *
 * @example
 * ```typescript
 * deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 }) // true (property order doesn't matter)
 * deepEquals([1, { x: 2 }], [1, { x: 2 }]) // true
 * deepEquals({ a: 1 }, { a: 2 }) // false
 * deepEquals(new Date('2023-01-01'), new Date('2023-01-01')) // true
 * deepEquals(new Map([['a', 1]]), new Map([['a', 1]])) // true
 * ```
 */
export function deepEquals(a: any, b: any): boolean {
  return deepEqualsInternal(a, b)
}

/**
 * @internal Whether a synced row changed observably: deep equality that
 * tells -0 from 0, as row values do (FID-1; maintainer decision 2026-10-29).
 */
export function sameRowValue(a: unknown, b: unknown): boolean {
  return deepEqualsInternal(a, b, ROW)
}

/**
 * @internal Whether an ordered Effect's update repeats its previous
 * publication: row-value equality, except that a class instance equals only
 * itself, since it can hold readable state outside its enumerable fields
 * (maintainer decision 2026-11-02).
 */
export function samePublishedValue(a: unknown, b: unknown): boolean {
  return deepEqualsInternal(a, b, ROW | PUBLICATION)
}

/** @internal Compare persisted public and durable value shapes before skipping a reload. */
export function equalPersistedSnapshotValues(a: unknown, b: unknown): boolean {
  return deepEqualsInternal(a, b, DRAFT | PERSISTED)
}

function isPlainPrototype(prototype: object | null): boolean {
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

function enumerableOwnKeys(value: object): Array<string | symbol> {
  const keys: Array<string | symbol> = Object.keys(value)
  for (const key of Object.getOwnPropertySymbols(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, key)) keys.push(key)
  }
  return keys
}

// The comparison modes of `deepEqualsInternal`, combined as bits.
/**
 * The stricter equality used by change-tracking drafts: Map and Set contents
 * must match in order, RegExp match position must match, and arrays compare
 * as keyed objects (holes and extra enumerable keys count).
 */
export const DRAFT = 1
/** Persisted snapshots also distinguish prototypes after serialization. */
const PERSISTED = 2
/** Row change detection tells -0 from 0; general equality does not. */
export const ROW = 4
/** An ordered Effect's publication also compares a class instance by identity. */
const PUBLICATION = 8

/**
 * Internal implementation with cycle detection to prevent infinite recursion.
 * Internal callers can seed already-paired roots when comparing their children.
 *
 * `mode` combines the bits above; one recursive call forwards all of them.
 */
export function deepEqualsInternal(
  a: any,
  b: any,
  mode = 0,
  // Created on the first container that descends into a child.
  visited?: Map<object, object>,
): boolean {
  const draft = mode & DRAFT
  // Handle strict equality (primitives, same reference); a row value tells
  // -0 from 0.
  if ((!(mode & ROW) && a === b) || Object.is(a, b)) return true

  // Handle null/undefined
  if (a == null || b == null) return false

  // Handle different types
  if (typeof a !== typeof b) return false

  // SQLite can turn an authored nested instance into an equal-keyed plain
  // record. A skipped persisted reload must not retain the old public shape.
  if (
    mode & PERSISTED &&
    typeof a === `object` &&
    Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)
  ) {
    return false
  }

  // A container already paired in this comparison closes a cycle: it equals
  // only its partner.
  if (visited?.has(a)) return visited.get(a) === b

  // Handle Date objects
  if (a instanceof Date) {
    if (!(b instanceof Date)) return false
    return Object.is(a.getTime(), b.getTime())
  }
  // Symmetric check: if b is Date but a is not, they're not equal
  if (b instanceof Date) return false

  // Handle RegExp objects
  if (a instanceof RegExp) {
    if (!(b instanceof RegExp)) return false
    return (
      a.source === b.source &&
      a.flags === b.flags &&
      (!draft || a.lastIndex === b.lastIndex)
    )
  }
  // Symmetric check: if b is RegExp but a is not, they're not equal
  if (b instanceof RegExp) return false

  // Handle Map objects - only if both are Maps
  if (a instanceof Map) {
    if (!(b instanceof Map)) return false
    if (a.size !== b.size) return false
    ;(visited ??= new Map()).set(a, b)

    // A draft compares entries in order; general equality looks keys up.
    const bEntries = draft && Array.from(b.entries())
    const result = Array.from(a.entries()).every(([key, val], index) =>
      bEntries
        ? Object.is(key, bEntries[index]![0]) &&
          deepEqualsInternal(val, bEntries[index]![1], mode, visited)
        : b.has(key) && deepEqualsInternal(val, b.get(key), mode, visited),
    )

    visited.delete(a)
    return result
  }
  // Symmetric check: if b is Map but a is not, they're not equal
  if (b instanceof Map) return false

  // Handle Set objects - only if both are Sets
  if (a instanceof Set) {
    if (!(b instanceof Set)) return false
    if (a.size !== b.size) return false
    ;(visited ??= new Map()).set(a, b)

    // Convert to arrays for comparison
    const aValues = Array.from(a)
    const bValues = Array.from(b)

    if (draft) {
      // A draft compares contents in order, as it compares arrays.
      const result = deepEqualsInternal(aValues, bValues, mode, visited)
      visited.delete(a)
      return result
    }

    // Simple comparison for primitive values
    if (aValues.every((val) => typeof val !== `object`)) {
      visited.delete(a)
      return aValues.every((val) => b.has(val))
    }

    // Object-valued Sets are unordered. Match each value once, carrying a
    // branch-local cycle map so a failed candidate cannot poison the next.
    const matchValues = (
      index: number,
      remaining: ReadonlyArray<number>,
      branchVisited: Map<object, object>,
    ): boolean => {
      if (index === aValues.length) return true
      const value = aValues[index]
      for (const [remainingIndex, candidateIndex] of remaining.entries()) {
        const candidateVisited = new Map(branchVisited)
        if (
          deepEqualsInternal(
            value,
            bValues[candidateIndex],
            mode,
            candidateVisited,
          ) &&
          matchValues(
            index + 1,
            remaining.filter((_, otherIndex) => otherIndex !== remainingIndex),
            candidateVisited,
          )
        ) {
          return true
        }
      }
      return false
    }
    const result = matchValues(
      0,
      bValues.map((_, index) => index),
      visited,
    )
    visited.delete(a)
    return result
  }
  // Symmetric check: if b is Set but a is not, they're not equal
  if (b instanceof Set) return false

  // Handle TypedArrays. A typed array is its own value class: it equals only
  // another typed array, in both directions.
  const typed = ArrayBuffer.isView(a) && !(a instanceof DataView)
  if (typed !== (ArrayBuffer.isView(b) && !(b instanceof DataView))) {
    return false
  }
  if (typed) {
    const typedA = a as unknown as TypedArray
    const typedB = b as unknown as TypedArray
    // Elements compare as the numbers they are: NaN equals NaN, and -0
    // equals 0 except as a row value. Only a draft treats a change of
    // typed-array class as a change.
    return (
      (!draft || Object.getPrototypeOf(a) === Object.getPrototypeOf(b)) &&
      typedA.length === typedB.length &&
      typedA.every((x, i) => deepEqualsInternal(x, typedB[i], mode))
    )
  }

  // Handle Temporal objects
  // Check if both are Temporal objects of the same type
  if (isTemporal(a) && isTemporal(b)) {
    const aTag = a[Symbol.toStringTag]
    const bTag = b[Symbol.toStringTag]

    // If they're different Temporal types, they're not equal
    if (aTag !== bTag) return false

    // Duration identity preserves its fields, even when toString normalizes
    // different units to the same elapsed time.
    if (aTag === `Temporal.Duration`) {
      const durationA = a as unknown as DurationFields
      const durationB = b as unknown as DurationFields
      return durationFields.every(
        (field) => durationA[field] === durationB[field],
      )
    }

    // Use Temporal's built-in equals method if available
    if (typeof a.equals === `function`) {
      return a.equals(b)
    }

    // Fallback to toString comparison for other types
    return a.toString() === b.toString()
  }
  // Symmetric check: if b is Temporal but a is not, they're not equal
  if (isTemporal(b)) return false

  // Handle arrays
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && a.length !== b.length) return false
  if (Array.isArray(a) && !draft) {
    ;(visited ??= new Map()).set(a, b)

    const result = a.every((item, index) =>
      deepEqualsInternal(item, b[index], mode, visited),
    )
    visited.delete(a)
    return result
  }
  // Handle objects
  if (typeof a === `object`) {
    // Public record shape includes its prototype. Only draft reconstruction
    // bridges class instances and plain records (JSON snapshots erase classes).
    const prototype = Object.getPrototypeOf(a)
    const prototypeB = Object.getPrototypeOf(b)
    const plain = isPlainPrototype(prototype)
    const plainB = isPlainPrototype(prototypeB)
    if (prototype !== prototypeB && (!draft || (!plain && !plainB)))
      return false
    if (mode & PUBLICATION && !(plain && plainB)) return false

    // Compare enumerable symbol keys as well as string keys. Query results may
    // use user-owned symbols, and a symbol-only update is still a value change.
    const keysA = enumerableOwnKeys(a)
    const keysB = enumerableOwnKeys(b)

    // Check if they have the same number of keys
    if (keysA.length !== keysB.length) return false

    // A class instance without enumerable keys (a File, an object with
    // private fields) keeps its state elsewhere, so it equals only itself.
    // A draft copies a URL by its href, so URLs compare by href.
    if (keysA.length === 0 && !Array.isArray(a) && !(plain && plainB)) {
      return a instanceof URL && a.href === b.href
    }

    // Check if all keys exist in both objects and their values are equal.
    // Register for cycles only before descending, so a flat object
    // allocates no cycle map.
    let registered = false
    let result = true
    for (const key of keysA) {
      const value = a[key]
      if (!registered && value !== null && typeof value === `object`) {
        ;(visited ??= new Map()).set(a, b)
        registered = true
      }
      if (
        !Object.prototype.propertyIsEnumerable.call(b, key) ||
        !deepEqualsInternal(value, b[key], mode, visited)
      ) {
        result = false
        break
      }
    }
    if (registered) visited!.delete(a)
    return result
  }

  // For primitives that aren't strictly equal
  return false
}

const temporalTypes = new Set([
  `Temporal.Duration`,
  `Temporal.Instant`,
  `Temporal.PlainDate`,
  `Temporal.PlainDateTime`,
  `Temporal.PlainMonthDay`,
  `Temporal.PlainTime`,
  `Temporal.PlainYearMonth`,
  `Temporal.ZonedDateTime`,
])

export interface TemporalLike {
  [Symbol.toStringTag]: string
  toString: () => string
  equals?: (other: unknown) => boolean
}

/** Checks if the value is a Temporal object by checking for the Temporal brand */
export function isTemporal(a: unknown): a is TemporalLike {
  if (a == null || typeof a !== `object`) return false
  const tag = (a as Record<symbol, unknown>)[Symbol.toStringTag]
  return typeof tag === `string` && temporalTypes.has(tag)
}

export const DEFAULT_COMPARE_OPTIONS: Exclude<
  CompareOptions,
  { stringSort: `custom` }
> = {
  direction: `asc`,
  nulls: `first`,
  stringSort: `locale`,
}

/** Throws unless a key has the Collection key type: a string or a number. */
export function assertCollectionKey(key: unknown, item: unknown): void {
  if (typeof key !== `string` && typeof key !== `number`) {
    throw key === undefined
      ? new UndefinedKeyError(item)
      : new InvalidKeyError(key, item)
  }
}
