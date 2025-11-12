import { expect } from "vitest"
import { getLoadedIds } from "./helpers"
import type { Collection } from "@tanstack/db"

/**
 * Assert that a collection has loaded exactly the expected items (no more, no less)
 */
export function assertLoadedExactly<T extends { id: string }>(
  collection: Collection<T>,
  expectedIds: Array<string>,
  message?: string
) {
  const loadedIds = getLoadedIds(collection)
  const loadedSet = new Set(loadedIds)
  const expectedSet = new Set(expectedIds)

  // Check for extra items
  const extraIds = loadedIds.filter((id) => !expectedSet.has(id))
  if (extraIds.length > 0) {
    throw new Error(
      message ??
        `Collection has extra items: ${extraIds.join(`, `)} (expected only: ${expectedIds.join(`, `)})`
    )
  }

  // Check for missing items
  const missingIds = expectedIds.filter((id) => !loadedSet.has(id))
  if (missingIds.length > 0) {
    throw new Error(
      message ??
        `Collection is missing items: ${missingIds.join(`, `)} (loaded: ${loadedIds.join(`, `)})`
    )
  }
}

/**
 * Assert that a collection has loaded at least the expected items (may have more)
 */
export function assertLoadedAtLeast<T extends { id: string }>(
  collection: Collection<T>,
  expectedIds: Array<string>,
  message?: string
) {
  const loadedIds = getLoadedIds(collection)
  const loadedSet = new Set(loadedIds)

  const missingIds = expectedIds.filter((id) => !loadedSet.has(id))
  if (missingIds.length > 0) {
    throw new Error(
      message ??
        `Collection is missing items: ${missingIds.join(`, `)} (loaded: ${loadedIds.join(`, `)})`
    )
  }
}

/**
 * Assert that a collection has NOT loaded any of the specified items
 */
export function assertNotLoaded<T extends { id: string }>(
  collection: Collection<T>,
  forbiddenIds: Array<string>,
  message?: string
) {
  const loadedIds = getLoadedIds(collection)
  const loadedSet = new Set(loadedIds)

  const foundIds = forbiddenIds.filter((id) => loadedSet.has(id))
  if (foundIds.length > 0) {
    throw new Error(
      message ?? `Collection should not have loaded: ${foundIds.join(`, `)}`
    )
  }
}

/**
 * Assert that a collection's size matches expected
 */
export function assertCollectionSize<T extends object>(
  collection: Collection<T>,
  expectedSize: number,
  message?: string
) {
  expect(collection.size, message).toBe(expectedSize)
}

/**
 * Assert that all items in a collection match a predicate
 */
export function assertAllItemsMatch<T extends object>(
  collection: Collection<T>,
  predicate: (item: T) => boolean,
  message?: string
) {
  const items = Array.from(collection.state.values())
  const failingItems = items.filter((item) => !predicate(item))

  if (failingItems.length > 0) {
    throw new Error(
      message ??
        `${failingItems.length} item(s) did not match predicate: ${JSON.stringify(failingItems[0])}`
    )
  }
}

/**
 * Assert that items are sorted correctly
 */
export function assertSorted<T, K extends keyof T>(
  items: Array<T>,
  field: K,
  direction: `asc` | `desc` = `asc`,
  message?: string
) {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]![field]
    const curr = items[i]![field]

    if (direction === `asc`) {
      if (prev > curr) {
        throw new Error(
          message ??
            `Items not sorted ascending by ${String(field)}: ${prev} > ${curr} at index ${i}`
        )
      }
    } else {
      if (prev < curr) {
        throw new Error(
          message ??
            `Items not sorted descending by ${String(field)}: ${prev} < ${curr} at index ${i}`
        )
      }
    }
  }
}

/**
 * Assert that predicate pushdown occurred (no over-fetching)
 * This checks that the collection didn't load more data than necessary
 */
export function assertNoPushdownViolation<T extends { id: string }>(
  collection: Collection<T>,
  expectedMaxIds: Array<string>,
  message?: string
) {
  const loadedIds = getLoadedIds(collection)
  const expectedSet = new Set(expectedMaxIds)

  // Check if any loaded IDs are not in expected set
  const extraIds = loadedIds.filter((id) => !expectedSet.has(id))

  if (extraIds.length > 0) {
    throw new Error(
      message ??
        `Predicate pushdown violation: Collection loaded ${extraIds.length} extra item(s) that don't match the predicate`
    )
  }
}

/**
 * Assert that deduplication occurred
 */
export function assertDeduplicationOccurred(
  actualLoads: number,
  deduplicatedLoads: number,
  expectedActualLoads: number,
  message?: string
) {
  expect(actualLoads, message ?? `Actual loads`).toBe(expectedActualLoads)
  expect(deduplicatedLoads, message ?? `Deduplicated loads`).toBeGreaterThan(0)
}

/**
 * Assert that NO deduplication occurred (all requests were unique)
 */
export function assertNoDeduplication(
  actualLoads: number,
  deduplicatedLoads: number,
  message?: string
) {
  expect(deduplicatedLoads, message ?? `Deduplicated loads`).toBe(0)
  expect(actualLoads, message ?? `Actual loads`).toBeGreaterThan(0)
}
