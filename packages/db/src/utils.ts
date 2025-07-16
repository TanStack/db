/**
 * Generic utility functions
 */

/**
 * Deep equality function that compares two values recursively
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
 * ```
 */
export function deepEquals(a: any, b: any): boolean {
  return deepEqualsInternal(a, b, new Map())
}

/**
 * Internal implementation with cycle detection to prevent infinite recursion
 */
function deepEqualsInternal(
  a: any,
  b: any,
  visited: Map<object, object>
): boolean {
  // Handle strict equality (primitives, same reference)
  if (a === b) return true

  // Handle null/undefined
  if (a == null || b == null) return false

  // Handle different types
  if (typeof a !== typeof b) return false

  // Handle arrays
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false

    // Check for circular references
    if (visited.has(a)) {
      return visited.get(a) === b
    }
    visited.set(a, b)

    const result = a.every((item, index) =>
      deepEqualsInternal(item, b[index], visited)
    )
    visited.delete(a)
    return result
  }

  // Handle objects
  if (typeof a === `object`) {
    // Check for circular references
    if (visited.has(a)) {
      return visited.get(a) === b
    }
    visited.set(a, b)

    // Get all keys from both objects
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    // Check if they have the same number of keys
    if (keysA.length !== keysB.length) {
      visited.delete(a)
      return false
    }

    // Check if all keys exist in both objects and their values are equal
    const result = keysA.every(
      (key) => key in b && deepEqualsInternal(a[key], b[key], visited)
    )

    visited.delete(a)
    return result
  }

  // For primitives that aren't strictly equal
  return false
}
