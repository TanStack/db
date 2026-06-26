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
import { Func } from '../query/ir.js'
import type { CompareOptions } from '../query/builder/types.js'
import type { IndexInterface, IndexOperation } from '../indexes/base-index.js'
import type { BasicExpression } from '../query/ir.js'
import type { CollectionLike } from '../types.js'

/**
 * Result of index-based query optimization
 *
 * When `residualPredicate` is set, the caller MUST evaluate it against each
 * value in `matchingKeys` and drop rows that fail. This supports partial
 * optimization of AND expressions where some branches are indexed and the
 * rest must be re-checked against the candidate set.
 *
 * When `residualPredicate` is `undefined`, `matchingKeys` is exact.
 */
export interface OptimizationResult<TKey> {
  canOptimize: boolean
  matchingKeys: Set<TKey>
  residualPredicate?: BasicExpression
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

  return { canOptimize: false, matchingKeys: new Set() }
}

/**
 * Checks if an expression can be optimized (possibly with a residual predicate)
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
 * Checks if an expression can be fully optimized — i.e. matched entirely by
 * index lookups with no residual predicate. AND children must satisfy this
 * recursively; partial AND optimization (which produces a residual) does not
 * count. This is the predicate the strict-OR contract uses to decide whether
 * an OR branch is safe to union by index alone.
 */
function canFullyOptimizeExpression<
  T extends object,
  TKey extends string | number,
>(expression: BasicExpression, collection: CollectionLike<T, TKey>): boolean {
  if (expression.type !== `func`) return false

  switch (expression.name) {
    case `eq`:
    case `gt`:
    case `gte`:
    case `lt`:
    case `lte`:
      return canOptimizeSimpleComparison(expression, collection)
    case `in`:
      return canOptimizeInArrayExpression(expression, collection)
    case `and`:
      return (
        expression.args.length >= 2 &&
        expression.args.every((arg) =>
          canFullyOptimizeExpression(arg, collection),
        )
      )
    case `or`:
      // OR is already strict; reuse the OR predicate, which itself recurses.
      return canOptimizeOrExpression(expression, collection)
    default:
      return false
  }
}

/**
 * Optimizes compound range queries on the same field
 * Example: WHERE age > 5 AND age < 10
 */
interface CompoundRangeQueryResult<TKey> {
  matchingKeys: Set<TKey>
  consumedArgs: Set<BasicExpression>
}

function optimizeCompoundRangeQuery<
  T extends object,
  TKey extends string | number,
>(
  expression: BasicExpression,
  collection: CollectionLike<T, TKey>,
): CompoundRangeQueryResult<TKey> | undefined {
  if (expression.type !== `func` || expression.args.length < 2) {
    return undefined
  }

  // Group range operations by field, tracking which arg produced each entry so
  // we can report back exactly which branches the compound range consumed.
  const fieldOperations = new Map<
    string,
    Array<{
      operation: `gt` | `gte` | `lt` | `lte`
      value: any
      arg: BasicExpression
    }>
  >()

  // Collect all range operations from AND arguments
  for (const arg of expression.args) {
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
          fieldOperations.get(fieldKey)!.push({ operation, value, arg })
        }
      }
    }
  }

  // Check if we have multiple operations on the same field
  for (const [fieldKey, operations] of fieldOperations) {
    if (operations.length >= 2) {
      const fieldPath = fieldKey.split(`.`)
      const index = findIndexForField(collection, fieldPath)

      if (index && index.supports(`gt`) && index.supports(`lt`)) {
        // Build range query options
        let from: any = undefined
        let to: any = undefined
        let fromInclusive = true
        let toInclusive = true

        for (const { operation, value } of operations) {
          switch (operation) {
            case `gt`:
              if (from === undefined || value > from) {
                from = value
                fromInclusive = false
              }
              break
            case `gte`:
              if (from === undefined || value > from) {
                from = value
                fromInclusive = true
              }
              break
            case `lt`:
              if (to === undefined || value < to) {
                to = value
                toInclusive = false
              }
              break
            case `lte`:
              if (to === undefined || value < to) {
                to = value
                toInclusive = true
              }
              break
          }
        }

        const matchingKeys = (index as any).rangeQuery({
          from,
          to,
          fromInclusive,
          toInclusive,
        })

        const consumedArgs = new Set<BasicExpression>(
          operations.map((op) => op.arg),
        )
        return { matchingKeys, consumedArgs }
      }
    }
  }

  return undefined
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
    return { canOptimize: false, matchingKeys: new Set() }
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
        return { canOptimize: false, matchingKeys: new Set() }
      }

      const matchingKeys = index.lookup(indexOperation, queryValue)
      return { canOptimize: true, matchingKeys }
    }
  }

  return { canOptimize: false, matchingKeys: new Set() }
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
    return { canOptimize: false, matchingKeys: new Set() }
  }

  // Compound range queries fuse multiple range ops on the same field into a
  // single index lookup. When present, treat the fused result as one optimized
  // branch and run the normal partition over the remaining args, so any
  // non-range siblings (indexed or not) still participate in the residual.
  const compoundRangeResult = optimizeCompoundRangeQuery(expression, collection)

  const optimizedResults: Array<OptimizationResult<TKey>> = []
  const residualBranches: Array<BasicExpression> = []

  if (compoundRangeResult) {
    optimizedResults.push({
      canOptimize: true,
      matchingKeys: compoundRangeResult.matchingKeys,
    })
  }

  // Partition branches into ones we can use indexes for, and ones that need to
  // be re-evaluated as a residual predicate on the resulting candidate set.
  for (const arg of expression.args) {
    if (compoundRangeResult?.consumedArgs.has(arg)) continue
    const result = optimizeQueryRecursive(arg, collection)
    if (result.canOptimize) {
      optimizedResults.push(result)
      // A partially-optimized child carries its own residual; fold it in.
      if (result.residualPredicate) {
        residualBranches.push(result.residualPredicate)
      }
    } else {
      residualBranches.push(arg)
    }
  }

  if (optimizedResults.length === 0) {
    return { canOptimize: false, matchingKeys: new Set() }
  }

  const allMatchingSets = optimizedResults.map((r) => r.matchingKeys)
  const intersectedKeys = intersectSets(allMatchingSets)
  const residualPredicate =
    residualBranches.length === 0
      ? undefined
      : residualBranches.length === 1
        ? residualBranches[0]
        : new Func(`and`, residualBranches)

  return { canOptimize: true, matchingKeys: intersectedKeys, residualPredicate }
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
    return { canOptimize: false, matchingKeys: new Set() }
  }

  // Strict-OR: every branch must be fully optimizable (no residual). A residual
  // on any branch would mean some rows match only via re-evaluation against a
  // candidate set, and candidates from OR siblings don't include those. Check
  // up front using the cheap predicate so we don't run wasted index lookups on
  // earlier branches before discovering a later one cannot be optimized.
  if (
    !expression.args.every((arg) =>
      canFullyOptimizeExpression(arg, collection),
    )
  ) {
    return { canOptimize: false, matchingKeys: new Set() }
  }

  const results: Array<OptimizationResult<TKey>> = []
  for (const arg of expression.args) {
    const result = optimizeQueryRecursive(arg, collection)
    // Defensive: canFullyOptimizeExpression guarantees both invariants above,
    // but assert here so any future divergence between the two paths surfaces
    // as a soft fallback rather than an unsound union.
    if (!result.canOptimize || result.residualPredicate !== undefined) {
      return { canOptimize: false, matchingKeys: new Set() }
    }
    results.push(result)
  }

  const allMatchingSets = results.map((r) => r.matchingKeys)
  const unionedKeys = unionSets(allMatchingSets)
  return { canOptimize: true, matchingKeys: unionedKeys }
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

  // Strict OR: every branch must be FULLY optimizable (no residual). Using
  // canOptimizeExpression here would let partial-AND children slip through,
  // disagreeing with optimizeOrExpression's runtime contract.
  return expression.args.every((arg) =>
    canFullyOptimizeExpression(arg, collection),
  )
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
    return { canOptimize: false, matchingKeys: new Set() }
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

    if (index) {
      // Check if the index supports IN operation
      if (index.supports(`in`)) {
        const matchingKeys = index.lookup(`in`, values)
        return { canOptimize: true, matchingKeys }
      } else if (index.supports(`eq`)) {
        // Fallback to multiple equality lookups
        const matchingKeys = new Set<TKey>()
        for (const value of values) {
          const keysForValue = index.lookup(`eq`, value)
          for (const key of keysForValue) {
            matchingKeys.add(key)
          }
        }
        return { canOptimize: true, matchingKeys }
      }
    }
  }

  return { canOptimize: false, matchingKeys: new Set() }
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
