import type { Collection } from "@tanstack/db"

/**
 * Wait for a condition to be true with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number
    interval?: number
    message?: string
  } = {}
): Promise<void> {
  const {
    timeout = 5000,
    interval = 50,
    message = `Condition not met`,
  } = options

  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await sleep(interval)
  }

  throw new Error(`${message} (timeout after ${timeout}ms)`)
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get all loaded item IDs from a collection
 */
export function getLoadedIds<T extends { id: string }>(
  collection: Collection<T>
): Array<string> {
  return Array.from(collection.state.values()).map((item) => item.id)
}

/**
 * Get count of loaded items in a collection
 */
export function getLoadedCount<T extends object>(
  collection: Collection<T>
): number {
  return collection.size
}

/**
 * Check if a collection has loaded specific IDs
 */
export function hasLoadedIds<T extends { id: string }>(
  collection: Collection<T>,
  ids: Array<string>
): boolean {
  const loadedIds = getLoadedIds(collection)
  return ids.every((id) => loadedIds.includes(id))
}

/**
 * Check if a collection has ONLY loaded specific IDs (no extras)
 */
export function hasOnlyLoadedIds<T extends { id: string }>(
  collection: Collection<T>,
  ids: Array<string>
): boolean {
  const loadedIds = getLoadedIds(collection)
  const idsSet = new Set(ids)

  // Check that all loaded IDs are in expected IDs
  if (!loadedIds.every((id) => idsSet.has(id))) {
    return false
  }

  // Check that all expected IDs are loaded
  if (!ids.every((id) => loadedIds.includes(id))) {
    return false
  }

  return true
}

/**
 * Wait for a collection to reach a specific size
 */
export async function waitForCollectionSize<T extends object>(
  collection: Collection<T>,
  expectedSize: number,
  timeout = 5000
): Promise<void> {
  await waitFor(() => collection.size === expectedSize, {
    timeout,
    message: `Collection size did not reach ${expectedSize} (current: ${collection.size})`,
  })
}

/**
 * Wait for collection to finish loading (status === 'ready')
 */
export async function waitForCollectionReady<T extends object>(
  collection: Collection<T>,
  timeout = 5000
): Promise<void> {
  await waitFor(() => collection.status === `ready`, {
    timeout,
    message: `Collection did not reach 'ready' status (current: ${collection.status})`,
  })
}

/**
 * Wait for a query to have data after preload.
 * This is necessary for on-demand collections where Electric streams
 * snapshot data asynchronously after loadSubset is triggered.
 */
export async function waitForQueryData<T extends object>(
  query: Collection<T>,
  options: {
    minSize?: number
    timeout?: number
  } = {}
): Promise<void> {
  const { minSize = 1, timeout = 2000 } = options

  await waitFor(() => query.size >= minSize, {
    timeout,
    interval: 10,
    message: `Query did not load data (expected >= ${minSize}, got ${query.size})`,
  })
}

/**
 * Create a deduplication counter for testing
 */
export function createDeduplicationCounter() {
  let actualLoads = 0
  let deduplicatedLoads = 0

  return {
    onLoad: () => {
      actualLoads++
    },
    onDeduplicate: () => {
      deduplicatedLoads++
    },
    getActualLoads: () => actualLoads,
    getDeduplicatedLoads: () => deduplicatedLoads,
    getTotalAttempts: () => actualLoads + deduplicatedLoads,
    reset: () => {
      actualLoads = 0
      deduplicatedLoads = 0
    },
  }
}

/**
 * Sort array of objects by a field
 */
export function sortBy<T, K extends keyof T>(
  array: Array<T>,
  field: K,
  direction: `asc` | `desc` = `asc`
): Array<T> {
  return [...array].sort((a, b) => {
    const aVal = a[field]
    const bVal = b[field]

    if (aVal < bVal) return direction === `asc` ? -1 : 1
    if (aVal > bVal) return direction === `asc` ? 1 : -1
    return 0
  })
}

/**
 * Filter array by predicate function
 */
export function filterBy<T>(
  array: Array<T>,
  predicate: (item: T) => boolean
): Array<T> {
  return array.filter(predicate)
}

/**
 * Paginate array
 */
export function paginate<T>(
  array: Array<T>,
  options: { limit?: number; offset?: number } = {}
): Array<T> {
  const { limit, offset = 0 } = options

  let result = array.slice(offset)

  if (limit !== undefined) {
    result = result.slice(0, limit)
  }

  return result
}
