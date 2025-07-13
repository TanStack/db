/**
 * Universal comparison function for all data types
 * Handles null/undefined, strings, arrays, dates, objects, and primitives
 * Always sorts null/undefined values first
 */
export const ascComparator = (a: any, b: any): number => {
  // Handle null/undefined
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  // if a and b are both strings, compare them based on locale
  if (typeof a === `string` && typeof b === `string`) {
    return a.localeCompare(b)
  }

  // if a and b are both arrays, compare them element by element
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const result = ascComparator(a[i], b[i])
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

  // If at least one of the values is an object, convert to strings
  const bothObjects = typeof a === `object` && typeof b === `object`
  const notNull = a !== null && b !== null
  if (bothObjects && notNull) {
    return a.toString().localeCompare(b.toString())
  }

  if (a < b) return -1
  if (a > b) return 1
  return 0
}
