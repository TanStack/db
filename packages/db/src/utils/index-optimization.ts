/**
 * # Index-Based Query Optimization
 *
 * This module provides utilities for optimizing query expressions by leveraging
 * available indexes to quickly find matching keys instead of scanning all data.
 *
 * This is different from the query structure optimizer in `query/optimizer.ts`
 * which rewrites query IR structure. This module focuses on using indexes during
 * query execution to speed up data filtering.
 *
 * ## Key Features:
 * - Uses indexes to find matching keys for WHERE conditions
 * - Supports AND/OR logic with set operations
 * - Handles range queries (eq, gt, gte, lt, lte)
 * - Optimizes IN array expressions
 */

import { DEFAULT_COMPARE_OPTIONS } from '../utils.js'
import { ReverseIndex } from '../indexes/reverse-index.js'
import { hasVirtualPropPath } from '../virtual-props.js'
import { makeComparator } from './comparison.js'
import type { CompareOptions } from '../query/builder/types.js'
import type { IndexInterface, IndexOperation } from '../indexes/base-index.js'
import type { BasicExpression } from '../query/ir.js'
import type { CollectionLike } from '../types.js'

/**
 * Result of index-based query optimization
 */
export interface OptimizationResult<TKey> {
  canOptimize: boolean
  matchingKeys: Set<TKey>
  /**
   * Whether `matchingKeys` is exactly the set of keys matching the expression.
   * When `false`, the keys are a superset of the true result (some conditions
   * could not be served by an index) and each row must be re-checked against
   * the full expression before being included in the result.
   */
  isExact: boolean
}

/**
 * Finds an index that matches a given field path
 */
export function findIndexForField<TKey extends string | number>(
  collection: CollectionLike<any, TKey>,
  fieldPath: Array<string>,
  compareOptions?: CompareOptions,
): IndexInterface<TKey> | undefined {
  if (hasVirtualPropPath(fieldPath)) {
    return undefined
  }
  const compareOpts = compareOptions ?? {
    ...DEFAULT_COMPARE_OPTIONS,
    ...collection.compareOptions,
  }

  for (const index of collection.indexes.values()) {
    if (
      index.matchesField(fieldPath) &&
      index.matchesCompareOptions(compareOpts)
    ) {
      if (!index.matchesDirection(compareOpts.direction)) {
        return new ReverseIndex(index)
      }
      return index
    }
  }
  return undefined
}

/**
 * Intersects multiple sets (AND logic)
 */
export function intersectSets<T>(sets: Array<Set<T>>): Set<T> {
  if (sets.length === 0) return new Set()
  if (sets.length === 1) return new Set(sets[0])

  let result = new Set(sets[0])
  for (let i = 1; i < sets.length; i++) {
    const newResult = new Set<T>()
    for (const item of result) {
      if (sets[i]!.has(item)) {
        newResult.add(item)
      }
    }
    result = newResult
  }
  return result
}

/**
 * Unions multiple sets (OR logic)
 */
export function unionSets<T>(sets: Array<Set<T>>): Set<T> {
  const result = new Set<T>()
  for (const set of sets) {
    for (const item of set) {
      result.add(item)
    }
  }
  return result
}

/**
 * Whether a value can be matched exactly by an index lookup, i.e. the index
 * result for it is not a superset that the caller must re-filter.
 *
 * The WHERE evaluator uses three-valued logic: a comparison against
 * `null`/`undefined` yields UNKNOWN, and `NaN` is never equal to itself. BTree
 * indexes, however, store and return rows with such values (nullish keys sort
 * as the smallest key; `NaN` keys are found via SameValueZero map equality), so
 * any result that could include them must be treated as inexact.
 */
function isExactComparisonValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === `number` && Number.isNaN(value)) return false
  return true
}

/**
 * Whether the collection orders strings using locale collation.
 *
 * Under `stringSort: 'locale'` a BTree string index orders values with
 * `localeCompare`, but the WHERE evaluator compares strings with JS relational
 * operators (code-point order). For range predicates these orders disagree
 * (e.g. `'ö' > 'z'` is true in JS but `'ö'` sorts before `'z'` under locale
 * `en`), so an index range lookup can omit matching rows. Such omissions cannot
 * be recovered by re-filtering, so locale-backed string range predicates must
 * not be index-optimized.
 */
function usesLocaleStringSort(collection: CollectionLike<any, any>): boolean {
  const opts = { ...DEFAULT_COMPARE_OPTIONS, ...collection.compareOptions }
  return opts.stringSort === `locale`
}

/**
 * Whether a range predicate on this operand would use an index ordering that
 * differs from the WHERE evaluator's relational operators, so an index range
 * lookup could omit genuine matches that re-filtering cannot recover.
 *
 * The evaluator compares with JS relational operators. That order matches the
 * index comparator only for numbers, booleans, bigints, lexically-sorted
 * strings and valid Dates. It diverges for locale-sorted strings (localeCompare
 * vs code-point order) and for arrays, plain objects, Temporal values, typed
 * arrays and invalid Dates (recursive/identity ordering vs string coercion).
 *
 * Note: `null`/`undefined`/`NaN` operands are not handled here — those are
 * superset cases handled by re-filtering ({@link isExactComparisonValue}).
 */
function isRangeOrderingDivergent(
  value: unknown,
  collection: CollectionLike<any, any>,
): boolean {
  switch (typeof value) {
    case `number`:
    case `bigint`:
    case `boolean`:
      return false
    case `string`:
      return usesLocaleStringSort(collection)
    case `object`: {
      if (value === null) return false
      // Only valid Date instances order consistently with the evaluator
      return !(value instanceof Date) || Number.isNaN(value.getTime())
    }
    default:
      return false
  }
}

/**
 * Whether a range predicate (gt/gte/lt/lte) on this operand can be safely
 * served by the given index: the operand's domain must order the same way the
 * index does, and the index itself must support trustworthy range traversal
 * (no custom comparator, no stored unorderable value).
 */
function canRangeOptimize(
  value: unknown,
  index: IndexInterface<any>,
  collection: CollectionLike<any, any>,
): boolean {
  return (
    !isRangeOrderingDivergent(value, collection) &&
    index.supportsRangeOptimization
  )
}

/**
 * Optimizes a query expression using available indexes to find matching keys
 */
export function optimizeExpressionWithIndexes<
  T extends object,
  TKey extends string | number,
>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): OptimizationResult<TKey> {
  return optimizeQueryRecursive(expression, collection)
}

/**
 * Recursively optimizes query expressions
 */
function optimizeQueryRecursive<T extends object, TKey extends string | number>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): OptimizationResult<TKey> {
  if (expression.type === `func`) {
    switch (expression.name) {
      case `eq`:
      case `gt`:
      case `gte`:
      case `lt`:
      case `lte`:
        return optimizeSimpleComparison(expression, collection)

      case `and`:
        return optimizeAndExpression(expression, collection)

      case `or`:
        return optimizeOrExpression(expression, collection)

      case `in`:
        return optimizeInArrayExpression(expression, collection)
    }
  }

  return { canOptimize: false, matchingKeys: new Set(), isExact: false }
}

/**
 * Checks if an expression can be optimized
 */
export function canOptimizeExpression<
  T extends object,
  TKey extends string | number,
>(expression: BasicExpression, collection: CollectionLike<T, TKey>): boolean {
  if (expression.type === `func`) {
    switch (expression.name) {
      case `eq`:
      case `gt`:
      case `gte`:
      case `lt`:
      case `lte`:
        return canOptimizeSimpleComparison(expression, collection)

      case `and`:
        return canOptimizeAndExpression(expression, collection)

      case `or`:
        return canOptimizeOrExpression(expression, collection)

      case `in`:
        return canOptimizeInArrayExpression(expression, collection)
    }
  }

  return false
}

/**
 * Result of compound range optimization, including which AND arguments
 * were covered by the range query so the caller can process the rest.
 */
interface CompoundRangeResult<TKey> extends OptimizationResult<TKey> {
  coveredArgIndices: Set<number>
}

/**
 * Optimizes compound range queries on the same field
 * Example: WHERE age > 5 AND age < 10
 */
function optimizeCompoundRangeQuery<
  T extends object,
  TKey extends string | number,
>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): CompoundRangeResult<TKey> {
  if (expression.type !== `func` || expression.args.length < 2) {
    return {
      canOptimize: false,
      matchingKeys: new Set(),
      isExact: false,
      coveredArgIndices: new Set(),
    }
  }

  // Group range operations by field
  const fieldOperations = new Map<
    string,
    Array<{
      operation: `gt` | `gte` | `lt` | `lte`
      value: any
      argIndex: number
    }>
  >()

  // Collect all range operations from AND arguments
  for (const [argIndex, arg] of expression.args.entries()) {
    if (arg.type === `func` && [`gt`, `gte`, `lt`, `lte`].includes(arg.name)) {
      const rangeOp = arg as any
      if (rangeOp.args.length === 2) {
        const leftArg = rangeOp.args[0]!
        const rightArg = rangeOp.args[1]!

        // Check both directions: field op value AND value op field
        let fieldArg: BasicExpression | null = null
        let valueArg: BasicExpression | null = null
        let operation = rangeOp.name as `gt` | `gte` | `lt` | `lte`

        if (leftArg.type === `ref` && rightArg.type === `val`) {
          // field op value
          fieldArg = leftArg
          valueArg = rightArg
        } else if (leftArg.type === `val` && rightArg.type === `ref`) {
          // value op field - need to flip the operation
          fieldArg = rightArg
          valueArg = leftArg

          // Flip the operation for reverse comparison
          switch (operation) {
            case `gt`:
              operation = `lt`
              break
            case `gte`:
              operation = `lte`
              break
            case `lt`:
              operation = `gt`
              break
            case `lte`:
              operation = `gte`
              break
          }
        }

        if (fieldArg && valueArg) {
          const fieldPath = (fieldArg as any).path
          const fieldKey = fieldPath.join(`.`)
          const value = (valueArg as any).value

          if (!fieldOperations.has(fieldKey)) {
            fieldOperations.set(fieldKey, [])
          }
          fieldOperations.get(fieldKey)!.push({ operation, value, argIndex })
        }
      }
    }
  }

  // Check if we have multiple operations on the same field
  for (const [fieldKey, operations] of fieldOperations) {
    if (operations.length >= 2) {
      const fieldPath = fieldKey.split(`.`)
      const index = findIndexForField(collection, fieldPath)

      // Only collapse this field into a range query when every bound's domain
      // orders the same way the index does and the index supports trustworthy
      // range traversal. Otherwise the index may omit matching rows that
      // re-filtering cannot recover, so leave the field for a full scan.
      if (
        index &&
        operations.some((op) => !canRangeOptimize(op.value, index, collection))
      ) {
        continue
      }

      if (index && index.supports(`gt`) && index.supports(`lt`)) {
        // Compare values with the same semantics the index uses (dates,
        // locale strings, ...), in ascending order since bounds are about
        // value order regardless of the index direction
        const compare = makeComparator({
          ...DEFAULT_COMPARE_OPTIONS,
          ...collection.compareOptions,
          direction: `asc`,
        })

        // Build range query options, keeping the strictest bound on each
        // side: a larger lower bound (or smaller upper bound) wins, and at
        // equal values the exclusive operation wins over the inclusive one.
        // `hasFromBound`/`hasToBound` track whether a bound was selected,
        // separately from the bound value (which may legitimately be falsy).
        let from: any = undefined
        let to: any = undefined
        let hasFromBound = false
        let hasToBound = false
        let fromInclusive = true
        let toInclusive = true
        // A comparison against null/undefined/NaN is never true, but in an
        // index nullish values sort as the smallest key (and NaN is retained),
        // so a range query cannot represent such a bound. Track it and force a
        // re-filter instead of claiming the result is exact.
        let hasNonComparableBound = false

        for (const { operation, value } of operations) {
          if (!isExactComparisonValue(value)) {
            hasNonComparableBound = true
            continue
          }
          switch (operation) {
            case `gt`:
            case `gte`: {
              const cmp = hasFromBound ? compare(value, from) : 1
              if (cmp > 0) {
                from = value
                hasFromBound = true
                fromInclusive = operation === `gte`
              } else if (cmp === 0 && operation === `gt`) {
                fromInclusive = false
              }
              break
            }
            case `lt`:
            case `lte`: {
              const cmp = hasToBound ? compare(value, to) : -1
              if (cmp < 0) {
                to = value
                hasToBound = true
                toInclusive = operation === `lte`
              } else if (cmp === 0 && operation === `lt`) {
                toInclusive = false
              }
              break
            }
          }
        }

        // Only pass the bounds that were selected: rangeQuery distinguishes
        // an absent bound (open-ended) from an explicitly provided one
        const rangeOptions: Record<string, any> = {}
        if (hasFromBound) {
          rangeOptions.from = from
          rangeOptions.fromInclusive = fromInclusive
        }
        if (hasToBound) {
          rangeOptions.to = to
          rangeOptions.toInclusive = toInclusive
        }
        const matchingKeys = (index as any).rangeQuery(rangeOptions)

        return {
          canOptimize: true,
          matchingKeys,
          // The range result is exact only when it cannot include rows with a
          // nullish indexed value (which a comparison would reject but the
          // index returns, as they sort as the smallest key). That requires a
          // non-nullish lower bound to exclude them: without `hasFromBound`
          // the range is open at the bottom and captures those rows, and a
          // non-comparable bound value (`hasNonComparableBound`) can never
          // bound them out.
          isExact: hasFromBound && !hasNonComparableBound,
          coveredArgIndices: new Set(operations.map((op) => op.argIndex)),
        }
      }
    }
  }

  return {
    canOptimize: false,
    matchingKeys: new Set(),
    isExact: false,
    coveredArgIndices: new Set(),
  }
}

/**
 * Optimizes simple comparison expressions (eq, gt, gte, lt, lte)
 */
function optimizeSimpleComparison<
  T extends object,
  TKey extends string | number,
>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): OptimizationResult<TKey> {
  if (expression.type !== `func` || expression.args.length !== 2) {
    return { canOptimize: false, matchingKeys: new Set(), isExact: false }
  }

  const leftArg = expression.args[0]!
  const rightArg = expression.args[1]!

  // Check both directions: field op value AND value op field
  let fieldArg: BasicExpression | null = null
  let valueArg: BasicExpression | null = null
  let operation = expression.name as `eq` | `gt` | `gte` | `lt` | `lte`

  if (leftArg.type === `ref` && rightArg.type === `val`) {
    // field op value
    fieldArg = leftArg
    valueArg = rightArg
  } else if (leftArg.type === `val` && rightArg.type === `ref`) {
    // value op field - need to flip the operation
    fieldArg = rightArg
    valueArg = leftArg

    // Flip the operation for reverse comparison
    switch (operation) {
      case `gt`:
        operation = `lt`
        break
      case `gte`:
        operation = `lte`
        break
      case `lt`:
        operation = `gt`
        break
      case `lte`:
        operation = `gte`
        break
      // eq stays the same
    }
  }

  if (fieldArg && valueArg) {
    const fieldPath = (fieldArg as any).path
    const index = findIndexForField(collection, fieldPath)

    if (index) {
      const queryValue = (valueArg as any).value

      // Map operation to IndexOperation enum
      const indexOperation = operation as IndexOperation

      // Check if the index supports this operation
      if (!index.supports(indexOperation)) {
        return { canOptimize: false, matchingKeys: new Set(), isExact: false }
      }

      // A range op can only use the index when the operand's domain orders the
      // same way the index does and the index supports trustworthy traversal.
      // Otherwise the index may omit matching rows, which re-filtering cannot
      // recover, so fall back to a full scan.
      if (
        (operation === `gt` ||
          operation === `gte` ||
          operation === `lt` ||
          operation === `lte`) &&
        !canRangeOptimize(queryValue, index, collection)
      ) {
        return { canOptimize: false, matchingKeys: new Set(), isExact: false }
      }

      const matchingKeys = index.lookup(indexOperation, queryValue)

      // A comparison against a nullish or NaN value is never true, but BTree
      // indexes store and return rows with such values (nullish keys sort as
      // the smallest key; NaN keys match via SameValueZero map equality).
      // Determine whether the index result is exact or a superset that the
      // caller must re-filter:
      // - eq/gt/gte: such a query value matches nothing while the index still
      //   returns those rows -> inexact. A non-nullish lower bound (gt/gte)
      //   excludes the bottom-sorted nullish rows, so those stay exact.
      // - lt/lte: the open lower bound always includes nullish-keyed rows,
      //   so the result is conservatively inexact.
      const isExact =
        operation === `lt` || operation === `lte`
          ? false
          : isExactComparisonValue(queryValue)

      return { canOptimize: true, matchingKeys, isExact }
    }
  }

  return { canOptimize: false, matchingKeys: new Set(), isExact: false }
}

/**
 * Checks if a simple comparison can be optimized
 */
function canOptimizeSimpleComparison<
  T extends object,
  TKey extends string | number,
>(expression: BasicExpression, collection: CollectionLike<T, TKey>): boolean {
  if (expression.type !== `func` || expression.args.length !== 2) {
    return false
  }

  const leftArg = expression.args[0]!
  const rightArg = expression.args[1]!

  // Check both directions: field op value AND value op field
  let fieldPath: Array<string> | null = null

  if (leftArg.type === `ref` && rightArg.type === `val`) {
    fieldPath = (leftArg as any).path
  } else if (leftArg.type === `val` && rightArg.type === `ref`) {
    fieldPath = (rightArg as any).path
  }

  if (fieldPath) {
    const index = findIndexForField(collection, fieldPath)
    return index !== undefined
  }

  return false
}

/**
 * Optimizes AND expressions
 */
function optimizeAndExpression<T extends object, TKey extends string | number>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): OptimizationResult<TKey> {
  if (expression.type !== `func` || expression.args.length < 2) {
    return { canOptimize: false, matchingKeys: new Set(), isExact: false }
  }

  // First, try to optimize compound range queries on the same field
  // (e.g. age > 5 AND age < 10 becomes a single range query)
  const compoundRangeResult = optimizeCompoundRangeQuery(expression, collection)
  const coveredArgIndices = compoundRangeResult.canOptimize
    ? compoundRangeResult.coveredArgIndices
    : new Set<number>()

  const results: Array<OptimizationResult<TKey>> = []
  if (compoundRangeResult.canOptimize) {
    results.push(compoundRangeResult)
  }

  // Try to optimize the remaining conjuncts, keep the optimizable ones.
  // Conjuncts that cannot use an index make the result inexact: the
  // intersection is then a superset of the true result and must be
  // re-filtered against the full expression by the caller. The compound
  // range result may itself be inexact (e.g. a null/undefined bound).
  let allConjunctsExact = !compoundRangeResult.canOptimize
    ? true
    : compoundRangeResult.isExact
  for (const [argIndex, arg] of expression.args.entries()) {
    if (coveredArgIndices.has(argIndex)) {
      continue
    }
    const result = optimizeQueryRecursive(arg, collection)
    if (result.canOptimize) {
      results.push(result)
      if (!result.isExact) {
        allConjunctsExact = false
      }
    } else {
      allConjunctsExact = false
    }
  }

  if (results.length > 0) {
    // Use intersectSets utility for AND logic
    const allMatchingSets = results.map((r) => r.matchingKeys)
    const intersectedKeys = intersectSets(allMatchingSets)
    return {
      canOptimize: true,
      matchingKeys: intersectedKeys,
      isExact: allConjunctsExact,
    }
  }

  return { canOptimize: false, matchingKeys: new Set(), isExact: false }
}

/**
 * Checks if an AND expression can be optimized
 */
function canOptimizeAndExpression<
  T extends object,
  TKey extends string | number,
>(expression: BasicExpression, collection: CollectionLike<T, TKey>): boolean {
  if (expression.type !== `func` || expression.args.length < 2) {
    return false
  }

  // If any argument can be optimized, we can gain some speedup
  return expression.args.some((arg) => canOptimizeExpression(arg, collection))
}

/**
 * Optimizes OR expressions
 */
function optimizeOrExpression<T extends object, TKey extends string | number>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): OptimizationResult<TKey> {
  if (expression.type !== `func` || expression.args.length < 2) {
    return { canOptimize: false, matchingKeys: new Set(), isExact: false }
  }

  const results: Array<OptimizationResult<TKey>> = []

  // Every disjunct must be optimizable: rows matched only by a disjunct
  // that cannot use an index would be missing from the union, and no
  // post-filtering can recover them. In that case fall back to a full scan.
  for (const arg of expression.args) {
    const result = optimizeQueryRecursive(arg, collection)
    if (!result.canOptimize) {
      return { canOptimize: false, matchingKeys: new Set(), isExact: false }
    }
    results.push(result)
  }

  // Use unionSets utility for OR logic
  const allMatchingSets = results.map((r) => r.matchingKeys)
  const unionedKeys = unionSets(allMatchingSets)
  return {
    canOptimize: true,
    matchingKeys: unionedKeys,
    // An inexact (superset) disjunct makes the union a superset as well
    isExact: results.every((r) => r.isExact),
  }
}

/**
 * Checks if an OR expression can be optimized
 */
function canOptimizeOrExpression<
  T extends object,
  TKey extends string | number,
>(expression: BasicExpression, collection: CollectionLike<T, TKey>): boolean {
  if (expression.type !== `func` || expression.args.length < 2) {
    return false
  }

  // Every disjunct must be optimizable, otherwise the union would miss
  // rows matched only by the non-optimizable disjuncts
  return expression.args.every((arg) => canOptimizeExpression(arg, collection))
}

/**
 * Optimizes IN array expressions
 */
function optimizeInArrayExpression<
  T extends object,
  TKey extends string | number,
>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): OptimizationResult<TKey> {
  if (expression.type !== `func` || expression.args.length !== 2) {
    return { canOptimize: false, matchingKeys: new Set(), isExact: false }
  }

  const fieldArg = expression.args[0]!
  const arrayArg = expression.args[1]!

  if (
    fieldArg.type === `ref` &&
    arrayArg.type === `val` &&
    Array.isArray((arrayArg as any).value)
  ) {
    const fieldPath = (fieldArg as any).path
    const values = (arrayArg as any).value
    const index = findIndexForField(collection, fieldPath)

    // A nullish or NaN member can never be matched by `IN` (a comparison
    // against null/undefined/NaN is never true), but the index would still
    // return rows with such an indexed value. When the list contains one of
    // those the result is a superset that the caller must re-filter.
    const isExact = values.every((value: any) => isExactComparisonValue(value))

    if (index) {
      // Check if the index supports IN operation
      if (index.supports(`in`)) {
        const matchingKeys = index.lookup(`in`, values)
        return { canOptimize: true, matchingKeys, isExact }
      } else if (index.supports(`eq`)) {
        // Fallback to multiple equality lookups
        const matchingKeys = new Set<TKey>()
        for (const value of values) {
          const keysForValue = index.lookup(`eq`, value)
          for (const key of keysForValue) {
            matchingKeys.add(key)
          }
        }
        return { canOptimize: true, matchingKeys, isExact }
      }
    }
  }

  return { canOptimize: false, matchingKeys: new Set(), isExact: false }
}

/**
 * Checks if an IN array expression can be optimized
 */
function canOptimizeInArrayExpression<
  T extends object,
  TKey extends string | number,
>(expression: BasicExpression, collection: CollectionLike<T, TKey>): boolean {
  if (expression.type !== `func` || expression.args.length !== 2) {
    return false
  }

  const fieldArg = expression.args[0]!
  const arrayArg = expression.args[1]!

  if (
    fieldArg.type === `ref` &&
    arrayArg.type === `val` &&
    Array.isArray((arrayArg as any).value)
  ) {
    const fieldPath = (fieldArg as any).path
    const index = findIndexForField(collection, fieldPath)
    return index !== undefined
  }

  return false
}
