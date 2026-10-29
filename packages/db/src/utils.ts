/**
 * Generic utility functions
 */

import { InvalidKeyError, UndefinedKeyError } from './errors'
import type { CompareOptions } from './query/builder/types'

interface TypedArray {
  length: number
  [index: number]: number
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
  return deepEqualsInternal(a, b, undefined)
}

/** @internal Compare persisted public and durable value shapes before skipping a reload. */
export function equalPersistedSnapshotValues(a: unknown, b: unknown): boolean {
  return deepEqualsInternal(a, b, undefined, true, true)
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

/**
 * Internal implementation with cycle detection to prevent infinite recursion.
 * Internal callers can seed already-paired roots when comparing their children.
 *
 * `draft` selects the stricter equality used by change-tracking drafts: Map
 * and Set contents must match in order, RegExp match position must match, and
 * arrays compare as keyed objects (holes and extra enumerable keys count).
 * `persistedSnapshot` also distinguishes prototypes after serialization.
 */
export function deepEqualsInternal(
  a: any,
  b: any,
  // Created on the first container that descends into a child.
  visited: Map<object, object> | undefined,
  draft = false,
  persistedSnapshot = false,
): boolean {
  // Handle strict equality (primitives, same reference)
  if (a === b || Object.is(a, b)) return true

  // Handle null/undefined
  if (a == null || b == null) return false

  // Handle different types
  if (typeof a !== typeof b) return false

  // SQLite can turn an authored nested instance into an equal-keyed plain
  // record. A skipped persisted reload must not retain the old public shape.
  if (
    persistedSnapshot &&
    typeof a === `object` &&
    Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)
  ) {
    return false
  }

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

    // Check for circular references
    if (visited?.has(a)) {
      return visited.get(a) === b
    }
    visited ??= new Map()
    visited.set(a, b)

    // A draft compares entries in order; general equality looks keys up.
    const bEntries = draft && Array.from(b.entries())
    const result = Array.from(a.entries()).every(([key, val], index) =>
      bEntries
        ? Object.is(key, bEntries[index]![0]) &&
          deepEqualsInternal(
            val,
            bEntries[index]![1],
            visited,
            true,
            persistedSnapshot,
          )
        : b.has(key) &&
          deepEqualsInternal(
            val,
            b.get(key),
            visited,
            draft,
            persistedSnapshot,
          ),
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

    // Check for circular references
    if (visited?.has(a)) {
      return visited.get(a) === b
    }
    visited ??= new Map()
    visited.set(a, b)

    // Convert to arrays for comparison
    const aValues = Array.from(a)
    const bValues = Array.from(b)

    if (draft) {
      const result = aValues.every((val, index) =>
        deepEqualsInternal(
          val,
          bValues[index],
          visited,
          draft,
          persistedSnapshot,
        ),
      )
      visited.delete(a)
      return result
    }

    // Simple comparison for primitive values
    if (aValues.every((val) => typeof val !== `object`)) {
      visited.delete(a)
      return aValues.every((val) => b.has(val))
    }

    // Candidate comparisons share only the active ancestors. Each recursive
    // comparison removes its own pairs, so an edge's result is independent of
    // other assignments. Cache edges and reassign matches instead of retrying
    // permutations. Plain records can match distinct keyed classes, so a
    // greedy first match alone would reject some equal Sets.
    // Cache diagonal comparisons separately: aligned Sets need linear storage
    // and no candidate scan. Other rows cache only the pairs actually tried.
    // Zero is unknown, one is unequal, and two is equal.
    const diagonal = new Uint8Array(aValues.length)
    const edges: Array<Map<number, boolean> | undefined> = []
    const equalAt = (left: number, right: number): boolean => {
      if (left === right && diagonal[left] !== 0) return diagonal[left] === 2
      const row =
        left === right
          ? undefined
          : (edges[left] ??= new Map<number, boolean>())
      const cached = row?.get(right)
      if (cached !== undefined) return cached
      const equal = deepEqualsInternal(
        aValues[left],
        bValues[right],
        visited,
        draft,
        persistedSnapshot,
      )
      if (left === right) diagonal[left] = equal ? 2 : 1
      else row!.set(right, equal)
      return equal
    }
    const matchedRight = bValues.map(() => -1)
    const matchedLeft = aValues.map(() => -1)
    const matchValue = (index: number): boolean => {
      if (matchedRight[index] === -1 && equalAt(index, index)) {
        matchedRight[index] = index
        matchedLeft[index] = index
        return true
      }
      // An isolated final column cannot participate in any complete assignment.
      // Check it directly rather than rediscovering that through every path.
      if (index === aValues.length - 1) {
        const free = matchedRight.indexOf(-1)
        if (aValues.every((_, left) => !equalAt(left, free))) return false
      }
      // Find an augmenting path without using JavaScript call depth for the
      // number of members. Each right predecessor names the left that found it.
      const predecessors = new Int32Array(bValues.length).fill(-1)
      const stack = [{ left: index, next: 0 }]
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!
        if (frame.next === bValues.length) {
          stack.pop()
          continue
        }
        // After displacement, try the successor of the former assignment
        // first. Wrap once so every candidate remains eligible.
        const start =
          matchedLeft[frame.left] === -1
            ? frame.left
            : matchedLeft[frame.left]! + 1
        const right = (start + frame.next++) % bValues.length
        if (predecessors[right] !== -1 || !equalAt(frame.left, right)) continue
        predecessors[right] = frame.left
        if (matchedRight[right] !== -1) {
          stack.push({ left: matchedRight[right]!, next: 0 })
          continue
        }
        // Flip every edge back to the root, releasing each old assignment.
        let slot = right
        while (slot !== -1) {
          const owner = predecessors[slot]!
          const previous = matchedLeft[owner]!
          matchedRight[slot] = owner
          matchedLeft[owner] = slot
          slot = previous
        }
        return true
      }
      return false
    }
    const result = aValues.every((_, index) => matchValue(index))
    visited.delete(a)
    return result
  }
  // Symmetric check: if b is Set but a is not, they're not equal
  if (b instanceof Set) return false

  // Handle TypedArrays
  if (
    ArrayBuffer.isView(a) &&
    ArrayBuffer.isView(b) &&
    !(a instanceof DataView) &&
    !(b instanceof DataView)
  ) {
    const typedA = a as unknown as TypedArray
    const typedB = b as unknown as TypedArray
    // Elements compare like numbers: -0 equals 0, NaN equals NaN. Only a
    // draft treats a change of typed-array class as a change.
    if (
      (draft && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) ||
      typedA.length !== typedB.length
    )
      return false

    for (let i = 0; i < typedA.length; i++) {
      const x = typedA[i]!
      const y = typedB[i]!
      if (x !== y && !(x !== x && y !== y)) return false
    }

    return true
  }
  // Symmetric check: if b is TypedArray but a is not, they're not equal
  if (
    ArrayBuffer.isView(b) &&
    !(b instanceof DataView) &&
    !ArrayBuffer.isView(a)
  ) {
    return false
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
    // Check for circular references
    if (visited?.has(a)) {
      return visited.get(a) === b
    }
    visited ??= new Map()
    visited.set(a, b)

    const result = a.every((item, index) =>
      deepEqualsInternal(item, b[index], visited, draft, persistedSnapshot),
    )
    visited.delete(a)
    return result
  }
  // Handle objects
  if (typeof a === `object`) {
    // Instances of two different classes differ. A plain or null-prototype
    // object, from any realm, compares by keys with any class: a draft
    // snapshot and plain JSON both hold class instances as plain objects.
    const prototype = Object.getPrototypeOf(a)
    const prototypeB = Object.getPrototypeOf(b)
    const plain = isPlainPrototype(prototype)
    const plainB = isPlainPrototype(prototypeB)
    if (prototype !== prototypeB && !plain && !plainB) return false

    // Check for circular references
    if (visited?.has(a)) {
      return visited.get(a) === b
    }

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
        visited ??= new Map()
        visited.set(a, b)
        registered = true
      }
      if (
        !Object.prototype.propertyIsEnumerable.call(b, key) ||
        !deepEqualsInternal(value, b[key], visited, draft, persistedSnapshot)
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
