import { compareKeys } from '@tanstack/db-ivm'
import {
  createSingleRowRefProxy,
  toExpression,
} from '../query/builder/ref-proxy'
import {
  compileSingleRowExpression,
  toBooleanPredicate,
} from '../query/compiler/evaluators.js'
import {
  findIndexForField,
  optimizeExpressionWithIndexes,
} from '../utils/index-optimization.js'
import { ensureIndexForField } from '../indexes/auto-index.js'
import { ReverseIndex } from '../indexes/reverse-index.js'
import { buildCompareOptions } from '../query/compiler/order-by'
import { TotalOrder } from '../query/total-order.js'
import type {
  ChangeMessage,
  CollectionLike,
  CurrentStateAsChangesOptions,
  SubscribeChangesOptions,
} from '../types'
import type { CollectionImpl } from './index.js'
import type { IndexInterface } from '../indexes/base-index.js'
import type { SingleRowRefProxy } from '../query/builder/ref-proxy'
import type { BasicExpression, OrderBy } from '../query/ir.js'
import type { WithVirtualProps } from '../virtual-props.js'

type OrderedBucketIndex<TKey extends string | number> = {
  orderedBuckets: () => IterableIterator<readonly [unknown, ReadonlySet<TKey>]>
}

function getOrderedBuckets<TKey extends string | number>(
  index: IndexInterface<TKey>,
): IterableIterator<readonly [unknown, ReadonlySet<TKey>]> | undefined {
  if (index instanceof ReverseIndex && !index.supportsOrderedBucketIteration) {
    return
  }
  return (
    index as IndexInterface<TKey> & Partial<OrderedBucketIndex<TKey>>
  ).orderedBuckets?.()
}

/**
 * Returns the current state of the collection as an array of changes
 * @param collection - The collection to get changes from
 * @param options - Options including optional where filter, orderBy, and limit
 * @returns An array of changes
 * @example
 * // Get all items as changes
 * const allChanges = currentStateAsChanges(collection)
 *
 * // Get only items matching a condition
 * const activeChanges = currentStateAsChanges(collection, {
 *   where: (row) => row.status === 'active'
 * })
 *
 * // Get only items using a pre-compiled expression
 * const activeChanges = currentStateAsChanges(collection, {
 *   where: eq(row.status, 'active')
 * })
 *
 * // Get items ordered by name with limit
 * const topUsers = currentStateAsChanges(collection, {
 *   orderBy: [{ expression: row.name, compareOptions: { direction: 'asc' } }],
 *   limit: 10
 * })
 *
 * // Get active users ordered by score (highest score first)
 * const topActiveUsers = currentStateAsChanges(collection, {
 *   where: eq(row.status, 'active'),
 *   orderBy: [{ expression: row.score, compareOptions: { direction: 'desc' } }],
 * })
 */
export function currentStateAsChanges<
  T extends object,
  TKey extends string | number,
>(
  collection: CollectionLike<WithVirtualProps<T, TKey>, TKey>,
  options: CurrentStateAsChangesOptions = {},
): Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> | void {
  // Helper function to collect filtered results
  const collectFilteredResults = (
    filterFn?: (value: WithVirtualProps<T, TKey>) => boolean,
  ): Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> => {
    const result: Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> = []
    for (const [key, value] of collection.entries()) {
      // If no filter function is provided, include all items
      if (filterFn?.(value) ?? true) {
        result.push({
          type: `insert`,
          key,
          value,
        })
      }
    }
    return result
  }

  // Validate that limit without orderBy doesn't happen
  if (options.limit !== undefined && !options.orderBy) {
    throw new Error(`limit cannot be used without orderBy`)
  }

  // An empty ordered window has no source work. Return before compiling its
  // predicate or finding, creating, and traversing an order index.
  if (options.limit === 0) {
    return []
  }

  // First check if orderBy is present (optionally with limit)
  if (options.orderBy) {
    // Create where filter function if present
    const whereFilter = options.where
      ? createFilterFunctionFromExpression(options.where)
      : undefined

    // Get ordered keys using index optimization when possible
    const orderedKeys = getOrderedKeys(
      collection,
      options.orderBy,
      options.limit,
      whereFilter,
      options.optimizedOnly,
    )

    if (orderedKeys === undefined) {
      // `getOrderedKeys` returned undefined because we asked for `optimizedOnly` and there was no index to use
      return
    }

    // Convert keys to change messages
    const result: Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> = []
    for (const key of orderedKeys) {
      const value = collection.get(key)
      if (value !== undefined) {
        result.push({
          type: `insert`,
          key,
          value,
        })
      }
    }
    return result
  }

  // If no orderBy OR orderBy optimization failed, use where clause optimization
  if (!options.where) {
    // No filtering, return all items
    return collectFilteredResults()
  }

  // There's a where clause, let's see if we can use an index
  try {
    const expression: BasicExpression<boolean> = options.where

    // Try to optimize the query using indexes
    const optimizationResult = optimizeExpressionWithIndexes(
      expression,
      collection,
    )

    if (optimizationResult.canOptimize) {
      // Use index optimization. When the index lookup is inexact, the keys
      // are a superset of the true result (some conditions could not be
      // served by an index), so re-check each row against the full expression.
      const filterFn = optimizationResult.isExact
        ? undefined
        : createFilterFunctionFromExpression(expression)
      const result: Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> = []
      for (const key of optimizationResult.matchingKeys) {
        const value = collection.get(key)
        if (value !== undefined && (filterFn?.(value) ?? true)) {
          result.push({
            type: `insert`,
            key,
            value,
          })
        }
      }
      return result
    } else {
      if (options.optimizedOnly) {
        return
      }

      const filterFn = createFilterFunctionFromExpression(expression)
      return collectFilteredResults(filterFn)
    }
  } catch (error) {
    // If anything goes wrong with the where clause, fall back to full scan
    console.warn(
      `${collection.id ? `[${collection.id}] ` : ``}Error processing where clause, falling back to full scan:`,
      error,
    )

    const filterFn = createFilterFunctionFromExpression(options.where)

    if (options.optimizedOnly) {
      return
    }

    return collectFilteredResults(filterFn)
  }
}

/**
 * Creates a filter function from a where callback
 * @param whereCallback - The callback function that defines the filter condition
 * @returns A function that takes an item and returns true if it matches the filter
 */
export function createFilterFunction<T extends object>(
  whereCallback: (row: SingleRowRefProxy<T>) => any,
): (item: T) => boolean {
  return (item: T): boolean => {
    try {
      // First try the RefProxy approach for query builder functions
      const singleRowRefProxy = createSingleRowRefProxy<T>()
      const whereExpression = whereCallback(singleRowRefProxy)
      const expression = toExpression(whereExpression)
      const evaluator = compileSingleRowExpression(expression)
      const result = evaluator(item as Record<string, unknown>)
      // WHERE clauses should always evaluate to boolean predicates (Kevin's feedback)
      return toBooleanPredicate(result)
    } catch {
      // If RefProxy approach fails (e.g., arithmetic operations), fall back to direct evaluation
      try {
        // Create a simple proxy that returns actual values for arithmetic operations
        const simpleProxy = new Proxy(item as any, {
          get(target, prop) {
            return target[prop]
          },
        }) as SingleRowRefProxy<T>

        const result = whereCallback(simpleProxy)
        return toBooleanPredicate(result)
      } catch {
        // If both approaches fail, exclude the item
        return false
      }
    }
  }
}

/**
 * Creates a filter function from a pre-compiled expression
 * @param expression - The pre-compiled expression to evaluate
 * @returns A function that takes an item and returns true if it matches the filter
 */
export function createFilterFunctionFromExpression<T extends object>(
  expression: BasicExpression<boolean>,
): (item: T) => boolean {
  // Compile expression once when filter function is created, not on every invocation
  const evaluator = compileSingleRowExpression(expression)

  return (item: T): boolean => {
    try {
      const result = evaluator(item as Record<string, unknown>)
      return toBooleanPredicate(result)
    } catch {
      // If evaluation fails, exclude the item
      return false
    }
  }
}

/**
 * Creates a filtered callback that only calls the original callback with changes that match the where clause
 * @param originalCallback - The original callback to filter
 * @param options - The subscription options containing the where clause
 * @returns A filtered callback function
 */
export function createFilteredCallback<
  T extends object,
  TKey extends string | number = string | number,
>(
  originalCallback: (changes: Array<ChangeMessage<T>>) => void,
  options: SubscribeChangesOptions<T, TKey>,
): (changes: Array<ChangeMessage<T>>) => boolean {
  const filterFn = createFilterFunctionFromExpression(options.whereExpression!)

  return (changes: Array<ChangeMessage<T>>) => {
    const filteredChanges: Array<ChangeMessage<T>> = []

    for (const change of changes) {
      if (change.type === `insert`) {
        // For inserts, check if the new value matches the filter
        if (filterFn(change.value)) {
          filteredChanges.push(change)
        }
      } else if (change.type === `update`) {
        // For updates, we need to check both old and new values
        const newValueMatches = filterFn(change.value)
        const oldValueMatches = change.previousValue
          ? filterFn(change.previousValue)
          : false

        if (newValueMatches && oldValueMatches) {
          // Both old and new match: emit update
          filteredChanges.push(change)
        } else if (newValueMatches && !oldValueMatches) {
          // New matches but old didn't: emit insert
          filteredChanges.push({
            ...change,
            type: `insert`,
          })
        } else if (!newValueMatches && oldValueMatches) {
          // Old matched but new doesn't: emit delete
          filteredChanges.push({
            ...change,
            type: `delete`,
            value: change.previousValue!, // Use the previous value for the delete
          })
        }
        // If neither matches, don't emit anything
      } else {
        // For deletes, include if the previous value would have matched
        // (so subscribers know something they were tracking was deleted)
        if (filterFn(change.value)) {
          filteredChanges.push(change)
        }
      }
    }

    // Always call the original callback if we have filtered changes OR
    // if the original changes array was empty (which indicates a ready signal)
    if (filteredChanges.length > 0 || changes.length === 0) {
      originalCallback(filteredChanges)
      return true
    }
    return false
  }
}

/**
 * Gets ordered keys from a collection using index optimization when possible
 * @param collection - The collection to get keys from
 * @param orderBy - The order by clause
 * @param limit - Optional limit on number of keys to return
 * @param whereFilter - Optional filter function to apply while traversing
 * @returns Array of keys in sorted order
 */
function getOrderedKeys<T extends object, TKey extends string | number>(
  collection: CollectionLike<T, TKey>,
  orderBy: OrderBy,
  limit?: number,
  whereFilter?: (item: T) => boolean,
  optimizedOnly?: boolean,
): Array<TKey> | undefined {
  // For single-column orderBy on a ref expression, try index optimization
  if (orderBy.length === 1) {
    const clause = orderBy[0]!
    const orderByExpression = clause.expression

    if (orderByExpression.type === `ref`) {
      const propRef = orderByExpression
      const fieldPath = propRef.path
      const compareOpts = buildCompareOptions(clause, collection)

      // Ensure index exists for this field
      ensureIndexForField(
        fieldPath[0]!,
        fieldPath,
        collection as CollectionImpl<T, TKey>,
        compareOpts,
      )

      // Find the index
      const index = findIndexForField(collection, fieldPath, compareOpts)

      if (index && index.supports(`gt`) && index.supportsRangeOptimization) {
        // Use index optimization
        const filterFn = (key: TKey): boolean => {
          const value = collection.get(key)
          if (value === undefined) {
            return false
          }
          return whereFilter?.(value) ?? true
        }

        const orderedBuckets = getOrderedBuckets(index)

        // Public custom indexes predate lazy bucket iteration. Preserve their
        // semantics with the full TotalOrder refinement instead of assuming
        // their materialized entries expose complete comparator tie classes.
        if (!orderedBuckets) {
          const totalOrder = new TotalOrder(orderBy, collection)
          const indexedEntries = index
            .takeFromStart(index.keyCount, filterFn)
            .flatMap((key) => {
              const value = collection.get(key)
              return value === undefined ? [] : [{ key, value }]
            })
          indexedEntries.sort((left, right) =>
            totalOrder.compareEntries(
              [left.key, left.value],
              [right.key, right.value],
            ),
          )
          return indexedEntries
            .slice(0, limit ?? indexedEntries.length)
            .map(({ key }) => key)
        }

        // Value order comes from the matching index or its reverse view. The
        // public-key suffix remains ascending in both directions. Stop after
        // the first complete bucket that proves the requested prefix because
        // filtering can otherwise select the wrong key from a boundary tie.
        const keys: Array<TKey> = []
        for (const [, bucket] of orderedBuckets) {
          const matchingKeys = [...bucket].sort(compareKeys).filter(filterFn)
          const remaining =
            limit === undefined ? undefined : limit - keys.length
          keys.push(
            ...(remaining === undefined
              ? matchingKeys
              : matchingKeys.slice(0, remaining)),
          )
          if (limit !== undefined && keys.length === limit) break
        }
        return keys
      }
    }
  }

  if (optimizedOnly) {
    return
  }

  // Fallback: collect all items and sort in memory
  const allItems: Array<{ key: TKey; value: T }> = []
  for (const [key, value] of collection.entries()) {
    if (whereFilter?.(value) ?? true) {
      allItems.push({ key, value })
    }
  }

  const totalOrder = new TotalOrder(orderBy, collection)
  allItems.sort((left, right) =>
    totalOrder.compareEntries([left.key, left.value], [right.key, right.value]),
  )
  const sortedKeys = allItems.map((item) => item.key)

  // Apply limit if provided
  if (limit !== undefined) {
    return sortedKeys.slice(0, limit)
  }

  // if no limit is provided, we will return all keys
  return sortedKeys
}
