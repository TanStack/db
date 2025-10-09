import { orderByWithFractionalIndex } from "@tanstack/db-ivm"
import { defaultComparator, makeComparator } from "../../utils/comparison.js"
import { PropRef, followRef } from "../ir.js"
import { ensureIndexForField } from "../../indexes/auto-index.js"
import { findIndexForField } from "../../utils/index-optimization.js"
import { compileExpression } from "./evaluators.js"
import { replaceAggregatesByRefs } from "./group-by.js"
import type { CompiledSingleRowExpression } from "./evaluators.js"
import type { OrderBy, OrderByClause, QueryIR, Select } from "../ir.js"
import type { NamespacedAndKeyedStream, NamespacedRow } from "../../types.js"
import type { IStreamBuilder, KeyValue } from "@tanstack/db-ivm"
import type { IndexInterface } from "../../indexes/base-index.js"
import type { Collection } from "../../collection/index.js"

export type OrderByOptimizationInfo = {
  orderBy: OrderBy
  offset: number
  limit: number
  comparator: (
    a: Record<string, unknown> | null | undefined,
    b: Record<string, unknown> | null | undefined
  ) => number
  valueExtractorForRawRow: (row: Record<string, unknown>) => any
  index: IndexInterface<string | number>
  dataNeeded?: () => number
}

/**
 * Processes the ORDER BY clause
 * Works with the new structure that has both namespaced row data and __select_results
 * Always uses fractional indexing and adds the index as __ordering_index to the result
 */
export function processOrderBy(
  rawQuery: QueryIR,
  pipeline: NamespacedAndKeyedStream,
  orderByClause: Array<OrderByClause>,
  selectClause: Select,
  collection: Collection,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  setMoveFn: (moveFn: (offset: number, limit: number) => void) => void,
  limit?: number,
  offset?: number
): IStreamBuilder<KeyValue<unknown, [NamespacedRow, string]>> {
  // Pre-compile all order by expressions
  const compiledOrderBy = orderByClause.map((clause) => {
    const clauseWithoutAggregates = replaceAggregatesByRefs(
      clause.expression,
      selectClause,
      `__select_results`
    )
    return {
      compiledExpression: compileExpression(clauseWithoutAggregates),
      compareOptions: clause.compareOptions,
    }
  })

  // Create a value extractor function for the orderBy operator
  const valueExtractor = (row: NamespacedRow & { __select_results?: any }) => {
    // The namespaced row contains:
    // 1. Table aliases as top-level properties (e.g., row["tableName"])
    // 2. SELECT results in __select_results (e.g., row.__select_results["aggregateAlias"])
    // The replaceAggregatesByRefs function has already transformed any aggregate expressions
    // that match SELECT aggregates to use the __select_results namespace.
    const orderByContext = row

    if (orderByClause.length > 1) {
      // For multiple orderBy columns, create a composite key
      return compiledOrderBy.map((compiled) =>
        compiled.compiledExpression(orderByContext)
      )
    } else if (orderByClause.length === 1) {
      // For a single orderBy column, use the value directly
      const compiled = compiledOrderBy[0]!
      return compiled.compiledExpression(orderByContext)
    }

    // Default case - no ordering
    return null
  }

  // Create a multi-property comparator that respects the order and direction of each property
  const compare = (a: unknown, b: unknown) => {
    // If we're comparing arrays (multiple properties), compare each property in order
    if (orderByClause.length > 1) {
      const arrayA = a as Array<unknown>
      const arrayB = b as Array<unknown>
      for (let i = 0; i < orderByClause.length; i++) {
        const clause = orderByClause[i]!
        const compareFn = makeComparator(clause.compareOptions)
        const result = compareFn(arrayA[i], arrayB[i])
        if (result !== 0) {
          return result
        }
      }
      return arrayA.length - arrayB.length
    }

    // Single property comparison
    if (orderByClause.length === 1) {
      const clause = orderByClause[0]!
      const compareFn = makeComparator(clause.compareOptions)
      return compareFn(a, b)
    }

    return defaultComparator(a, b)
  }

  let setSizeCallback: ((getSize: () => number) => void) | undefined

  let orderByOptimizationInfo: OrderByOptimizationInfo | undefined

  // Optimize the orderBy operator to lazily load elements
  // by using the range index of the collection.
  // Only for orderBy clause on a single column for now (no composite ordering)
  if (limit && orderByClause.length === 1) {
    const clause = orderByClause[0]!
    const orderByExpression = clause.expression

    if (orderByExpression.type === `ref`) {
      const followRefResult = followRef(
        rawQuery,
        orderByExpression,
        collection
      )!

      const followRefCollection = followRefResult.collection
      const fieldName = followRefResult.path[0]
      if (fieldName) {
        ensureIndexForField(
          fieldName,
          followRefResult.path,
          followRefCollection,
          clause.compareOptions,
          compare
        )
      }

      const valueExtractorForRawRow = compileExpression(
        new PropRef(followRefResult.path),
        true
      ) as CompiledSingleRowExpression

      const comparator = (
        a: Record<string, unknown> | null | undefined,
        b: Record<string, unknown> | null | undefined
      ) => {
        const extractedA = a ? valueExtractorForRawRow(a) : a
        const extractedB = b ? valueExtractorForRawRow(b) : b
        return compare(extractedA, extractedB)
      }

      const index: IndexInterface<string | number> | undefined =
        findIndexForField(
          followRefCollection.indexes,
          followRefResult.path,
          clause.compareOptions
        )

      if (index && index.supports(`gt`)) {
        // We found an index that we can use to lazily load ordered data
        orderByOptimizationInfo = {
          offset: offset ?? 0,
          limit,
          comparator,
          valueExtractorForRawRow,
          index,
          orderBy: orderByClause,
        }

        optimizableOrderByCollections[followRefCollection.id] =
          orderByOptimizationInfo

        setSizeCallback = (getSize: () => number) => {
          optimizableOrderByCollections[followRefCollection.id] = {
            ...optimizableOrderByCollections[followRefCollection.id]!,
            dataNeeded: () => {
              const size = getSize()
              return Math.max(0, orderByOptimizationInfo!.limit - size)
            },
          }
        }
      }
    }
  }

  // Use fractional indexing and return the tuple [value, index]
  return pipeline.pipe(
    orderByWithFractionalIndex(valueExtractor, {
      limit,
      offset,
      comparator: compare,
      setSizeCallback,
      setMoveFn: (moveFn: (offset: number, limit: number) => void) => {
        setMoveFn(
          // We wrap the move function such that we update the orderByOptimizationInfo
          // because that is used by the `dataNeeded` callback to determine if we need to load more data
          (newOffset, newLimit) => {
            moveFn(newOffset, newLimit)
            if (orderByOptimizationInfo) {
              orderByOptimizationInfo.offset = newOffset
              orderByOptimizationInfo.limit = newLimit
            }
          }
        )
      },
    })
    // orderByWithFractionalIndex returns [key, [value, index]] - we keep this format
  )
}
