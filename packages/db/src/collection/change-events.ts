import {
  compileSingleRowExpression,
  toBooleanPredicate,
} from '../query/compiler/evaluators.js'
import {
  findIndexForField,
  optimizeExpressionWithIndexes,
} from '../utils/index-optimization.js'
import { ensureIndexForField } from '../indexes/auto-index.js'
import { getPropRefPropertyPath } from '../query/ir.js'
import { isVirtualPropName } from '../virtual-props.js'
import { makeComparator } from '../utils/comparison.js'
import { buildCompareOptions } from '../query/compiler/order-by'
import type {
  ChangeMessage,
  CollectionLike,
  CurrentStateAsChangesOptions,
  SubscribeChangesOptions,
} from '../types'
import type { CollectionImpl } from './index.js'
import type { BasicExpression, OrderBy } from '../query/ir.js'
import type { WithVirtualProps } from '../virtual-props.js'

/**
 * Yields visible entries, enriched with virtual properties, whose stored row
 * passes `prefilter`.
 */
export type StoredRowScan<T extends object, TKey extends string | number> = (
  prefilter: (row: object) => boolean,
) => Iterable<[TKey, WithVirtualProps<T, TKey>]>

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
  scanStoredRows?: StoredRowScan<T, TKey>,
): Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> | void {
  // Helper function to collect filtered results
  const collectFilteredResults = (
    filterFn?: (value: WithVirtualProps<T, TKey>) => boolean,
  ): Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> => {
    const result: Array<ChangeMessage<WithVirtualProps<T, TKey>, TKey>> = []
    // Reject rows by one stored field before copying them to add virtual
    // properties. Survivors still pass through the full predicate.
    const prefilter =
      filterFn && options.where && scanStoredRows
        ? compileEqualityPrefilter(options.where, { storedRows: true })
        : undefined
    if (filterFn && scanStoredRows && prefilter) {
      for (const [key, value] of scanStoredRows(prefilter)) {
        if (filterFn(value)) result.push({ type: `insert`, key, value })
      }
      return result
    }
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
 * Compiles a cheap necessary condition for `expression` to be TRUE, or returns
 * undefined when the expression has none.
 *
 * A top-level conjunct `eq(field, literal)` with a string or boolean literal is
 * TRUE only when the field holds the identical string or boolean: equality
 * normalization never maps another type onto a plain string or boolean. A
 * row that fails the returned test therefore fails the whole expression.
 *
 * With `storedRows`, the test reads a stored row instead of its enriched copy.
 * The copy reads a non-virtual field either from the stored row or as
 * `undefined`, so the test remains a necessary condition. Conjuncts on virtual
 * fields are skipped because stored rows need not carry them.
 */
export function compileEqualityPrefilter(
  expression: BasicExpression<boolean>,
  { storedRows = false }: { storedRows?: boolean } = {},
): ((row: object) => boolean) | undefined {
  const conjuncts: Array<BasicExpression> = []
  const collect = (node: BasicExpression) => {
    if (node.type === `func` && node.name === `and`) node.args.forEach(collect)
    else conjuncts.push(node)
  }
  collect(expression)

  // A string literal usually rejects more rows than a boolean one.
  let best: { path: Array<string>; expected: string | boolean } | undefined
  for (const conjunct of conjuncts) {
    if (conjunct.type !== `func` || conjunct.name !== `eq`) continue
    const [left, right] = conjunct.args
    const ref =
      left?.type === `ref` ? left : right?.type === `ref` ? right : undefined
    const literal =
      left?.type === `val` ? left : right?.type === `val` ? right : undefined
    if (!ref || !literal) continue
    const expected: unknown = literal.value
    if (typeof expected !== `string` && typeof expected !== `boolean`) continue

    const path = getPropRefPropertyPath(ref)
    if (storedRows && (path.length === 0 || isVirtualPropName(path[0]!))) {
      continue
    }
    if (best === undefined || typeof best.expected === `boolean`) {
      best = { path, expected }
    }
    if (typeof expected === `string`) break
  }
  if (best === undefined) return undefined

  const { path, expected } = best
  const root = path[0]!
  return (row) => {
    // Enrichment copies only enumerable own root properties, so a stored row
    // can reject only through a field its enriched copy also reads.
    if (storedRows && !Object.prototype.propertyIsEnumerable.call(row, root)) {
      return true
    }
    try {
      let value: unknown = row
      for (const segment of path) {
        // Walk exactly as the single-row evaluator does.
        if (value === null || value === undefined) return false
        value = (value as Record<string, unknown>)[segment]
      }
      return value === expected
    } catch {
      // A throwing read leaves the decision to the full predicate.
      return true
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

      if (index && index.supports(`gt`)) {
        // Use index optimization
        const filterFn = (key: TKey): boolean => {
          const value = collection.get(key)
          if (value === undefined) {
            return false
          }
          return whereFilter?.(value) ?? true
        }

        // Take the keys that match the filter and limit
        // if no limit is provided `index.keyCount` is used,
        // i.e. we will take all keys that match the filter
        return index.takeFromStart(limit ?? index.keyCount, filterFn)
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

  const clauses = orderBy.map((clause) => ({
    expression: clause.expression,
    compare: makeComparator(buildCompareOptions(clause, collection)),
  }))
  const compare = (a: { key: TKey; value: T }, b: { key: TKey; value: T }) => {
    for (const clause of clauses) {
      // Extract values for comparison
      const aValue = extractValueFromItem(a.value, clause.expression)
      const bValue = extractValueFromItem(b.value, clause.expression)

      const result = clause.compare(aValue, bValue)
      if (result !== 0) {
        return result
      }
    }
    return 0
  }

  allItems.sort(compare)
  const sortedKeys = allItems.map((item) => item.key)

  // Apply limit if provided
  if (limit !== undefined) {
    return sortedKeys.slice(0, limit)
  }

  // if no limit is provided, we will return all keys
  return sortedKeys
}

/**
 * Helper function to extract a value from an item based on an expression
 */
function extractValueFromItem(item: any, expression: BasicExpression): any {
  if (expression.type === `ref`) {
    const propRef = expression
    let value = item
    for (const pathPart of propRef.path) {
      value = value?.[pathPart]
    }
    return value
  } else if (expression.type === `val`) {
    return expression.value
  } else {
    // It must be a function
    const evaluator = compileSingleRowExpression(expression)
    return evaluator(item as Record<string, unknown>)
  }
}
