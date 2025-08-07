import {
  createSingleRowRefProxy,
  toExpression,
} from "./query/builder/ref-proxy"
import { compileSingleRowExpression } from "./query/compiler/evaluators.js"
import { optimizeExpressionWithIndexes } from "./utils/index-optimization.js"
import type {
  ChangeMessage,
  CurrentStateAsChangesOptions,
  SubscribeChangesOptions,
} from "./types"
import type { Collection } from "./collection"
import type { SingleRowRefProxy } from "./query/builder/ref-proxy"
import type { BasicExpression } from "./query/ir.js"

/**
 * Interface for a collection-like object that provides the necessary methods
 * for the change events system to work
 */
export interface CollectionLike<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> extends Pick<Collection<T, TKey>, `get` | `has` | `entries` | `indexes`> {}

/**
 * Returns the current state of the collection as an array of changes
 * @param collection - The collection to get changes from
 * @param options - Options including optional where filter
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
 *   whereExpression: eq(row.status, 'active')
 * })
 */
export function currentStateAsChanges<
  T extends object,
  TKey extends string | number,
>(
  collection: CollectionLike<T, TKey>,
  options: CurrentStateAsChangesOptions<T> = {}
): Array<ChangeMessage<T>> {
  // Helper function to collect filtered results
  const collectFilteredResults = (
    filterFn?: (value: T) => boolean
  ): Array<ChangeMessage<T>> => {
    const result: Array<ChangeMessage<T>> = []
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

  if (!options.where && !options.whereExpression) {
    // No filtering, return all items
    return collectFilteredResults()
  }

  // There's a where clause, let's see if we can use an index
  try {
    let expression: BasicExpression<boolean>

    if (options.whereExpression) {
      // Use the pre-compiled expression directly
      expression = options.whereExpression
    } else if (options.where) {
      // Create the single-row refProxy for the callback
      const singleRowRefProxy = createSingleRowRefProxy<T>()

      // Execute the callback to get the expression
      const whereExpression = options.where(singleRowRefProxy)

      // Convert the result to a BasicExpression
      expression = toExpression(whereExpression)
    } else {
      // This should never happen due to the check above, but TypeScript needs it
      return []
    }

    // Try to optimize the query using indexes
    const optimizationResult = optimizeExpressionWithIndexes(
      expression,
      collection.indexes
    )

    if (optimizationResult.canOptimize) {
      // Use index optimization
      const result: Array<ChangeMessage<T>> = []
      for (const key of optimizationResult.matchingKeys) {
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
    } else {
      // No index found or complex expression, fall back to full scan with filter
      const filterFn = options.where
        ? createFilterFunction(options.where)
        : createFilterFunctionFromExpression(expression)

      return collectFilteredResults(filterFn)
    }
  } catch (error) {
    // If anything goes wrong with the where clause, fall back to full scan
    console.warn(
      `Error processing where clause, falling back to full scan:`,
      error
    )

    const filterFn = options.where
      ? createFilterFunction(options.where)
      : createFilterFunctionFromExpression(options.whereExpression!)

    return collectFilteredResults(filterFn)
  }
}

/**
 * Creates a filter function from a where callback
 * @param whereCallback - The callback function that defines the filter condition
 * @returns A function that takes an item and returns true if it matches the filter
 */
export function createFilterFunction<T extends object>(
  whereCallback: (row: SingleRowRefProxy<T>) => any
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
      return result
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
        return result
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
  expression: BasicExpression<boolean>
): (item: T) => boolean {
  return (item: T): boolean => {
    try {
      const evaluator = compileSingleRowExpression(expression)
      const result = evaluator(item as Record<string, unknown>)
      return Boolean(result)
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
export function createFilteredCallback<T extends object>(
  originalCallback: (changes: Array<ChangeMessage<T>>) => void,
  options: SubscribeChangesOptions<T>
): (changes: Array<ChangeMessage<T>>) => void {
  const filterFn = options.whereExpression
    ? createFilterFunctionFromExpression(options.whereExpression)
    : createFilterFunction(options.where!)

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
    }
  }
}
