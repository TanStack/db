/**
 * Ascending comparator function for ordering values
 * Handles null/undefined as smallest values
 */
export const ascComparator = (a: unknown, b: unknown): number => {
  // Handle null/undefined cases first (treat them as smaller than any other value)
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Descending comparator function for ordering values
 * Handles null/undefined as largest values (opposite of ascending)
 */
export const descComparator = (a: unknown, b: unknown): number => {
  return -ascComparator(a, b)
}
