import {
  groupedOrderByWithFractionalIndex,
  orderByWithFractionalIndex,
} from '@tanstack/db-ivm'
import { defaultComparator, makeComparator } from '../../utils/comparison.js'
import { PropRef, collectCollectionSources, followRef } from '../ir.js'
import { ensureIndexForField } from '../../indexes/auto-index.js'
import { findIndexForField } from '../../utils/index-optimization.js'
import { resolveCompareOptions, resolveOrderBy } from '../total-order.js'
import { compileExpression } from './evaluators.js'
import { replaceAggregatesByRefs } from './group-by.js'
import type { CompareOptions } from '../builder/types.js'
import type { WindowOptions } from './types.js'
import type { CompiledSingleRowExpression } from './evaluators.js'
import type { OrderBy, OrderByClause, QueryIR, Select } from '../ir.js'
import type {
  CollectionLike,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from '../../types.js'
import type { IStreamBuilder, KeyValue } from '@tanstack/db-ivm'
import type { IndexInterface } from '../../indexes/base-index.js'
import type { Collection } from '../../collection/index.js'

export type OrderByOptimizationInfo = {
  sourceId: string
  alias: string
  orderBy: OrderBy
  offset: number
  limit: number
  comparator: (
    a: Record<string, unknown> | null | undefined,
    b: Record<string, unknown> | null | undefined,
  ) => number
  /** Extracts all orderBy column values from a raw row (array for multi-column) */
  valueExtractorForRawRow: (row: Record<string, unknown>) => unknown
  /** Index on the first orderBy column - used for lazy loading */
  index?: IndexInterface<string | number>
  dataNeeded?: () => number
}

/**
 * Processes the ORDER BY clause
 * Works with the new structure that has both namespaced row data and $selected
 * Always uses fractional indexing and adds the index as __ordering_index to the result
 */
export function processOrderBy(
  rawQuery: QueryIR,
  pipeline: NamespacedAndKeyedStream,
  orderByClause: Array<OrderByClause>,
  selectClause: Select,
  collection: Collection,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  setWindowFn: (windowFn: (options: WindowOptions) => void) => void,
  limit?: number,
  offset?: number,
  groupKeyFn?: (key: unknown, value: unknown) => unknown,
): IStreamBuilder<KeyValue<unknown, [NamespacedRow, string]>> {
  // Pre-compile all order by expressions
  const compiledOrderBy = orderByClause.map((clause) => {
    const clauseWithoutAggregates = replaceAggregatesByRefs(
      clause.expression,
      selectClause,
      `$selected`,
    )

    return {
      compiledExpression: compileExpression(clauseWithoutAggregates),
      compareOptions: buildCompareOptions(clause, collection),
    }
  })
  // Create a value extractor function for the orderBy operator
  const valueExtractor = (row: NamespacedRow & { $selected?: any }) => {
    // The namespaced row contains:
    // 1. Table aliases as top-level properties (e.g., row["tableName"])
    // 2. SELECT results in $selected (e.g., row.$selected["aggregateAlias"])
    // The replaceAggregatesByRefs function has already transformed:
    // - Aggregate expressions that match SELECT aggregates to use the $selected namespace
    // - $selected ref expressions are passed through unchanged (already using the correct namespace)
    const orderByContext = row

    if (orderByClause.length > 1) {
      // For multiple orderBy columns, create a composite key
      return compiledOrderBy.map((compiled) =>
        compiled.compiledExpression(orderByContext),
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
        const clause = compiledOrderBy[i]!
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
      const clause = compiledOrderBy[0]!
      const compareFn = makeComparator(clause.compareOptions)
      return compareFn(a, b)
    }

    return defaultComparator(a, b)
  }

  let setSizeCallback: ((getSize: () => number) => void) | undefined

  let orderByOptimizationInfo: OrderByOptimizationInfo | undefined

  // When there's a limit, we create orderByOptimizationInfo to pass orderBy/limit
  // to loadSubset so the sync layer can optimize the query.
  // We try to use an index on the FIRST orderBy column for lazy loading,
  // even for multi-column orderBy (using wider bounds on first column).
  // Skip this optimization when using grouped ordering (includes with limit),
  // because the limit is per-group, not global — the child collection needs all data loaded.
  if (
    limit !== undefined &&
    !groupKeyFn &&
    rawQuery.from.type !== `unionFrom` &&
    rawQuery.from.type !== `unionAll`
  ) {
    let index: IndexInterface<string | number> | undefined
    let followRefCollection: Collection | undefined
    let orderByAlias: string = rawQuery.from.alias
    let orderBySourceId: string | undefined

    // Try to create/find an index on the FIRST orderBy column for lazy loading
    const firstClause = orderByClause[0]!
    const firstOrderByExpression = firstClause.expression

    if (firstOrderByExpression.type === `ref`) {
      const followRefResult = followRef(
        rawQuery,
        firstOrderByExpression,
        collection,
      )

      if (followRefResult) {
        followRefCollection = followRefResult.collection
        orderBySourceId = followRefResult.sourceId
        const fieldName = followRefResult.path[0]
        // The query's first source defines implicit string collation for the
        // whole order. Build the source index with that same resolved term so
        // provider admission cannot disagree with emitted query order.
        const compareOpts = buildCompareOptions(firstClause, collection)

        if (fieldName) {
          // Use a single-column comparator for the index, not the
          // multi-column `compare` function. The multi-column comparator
          // expects array values [col1, col2, ...] but the index stores
          // individual field values. Passing `compare` here causes the
          // BTree to treat all single values as equal (since number[0]
          // === undefined for both sides of the comparison).
          const firstColumnCompareFn = makeComparator(compareOpts)
          ensureIndexForField(
            fieldName,
            followRefResult.path,
            followRefCollection,
            compareOpts,
            firstColumnCompareFn,
          )
        }

        index = findIndexForField(
          followRefCollection,
          followRefResult.path,
          compareOpts,
        )

        // Only use the index if it supports range queries
        if (!index?.supports(`gt`)) {
          index = undefined
        }

        if (!index) {
          const collectionId = followRefCollection.id
          const fieldPath = followRefResult.path.join(`.`)
          console.warn(
            `[TanStack DB]${collectionId ? ` [${collectionId}]` : ``} orderBy with limit requires an index on "${fieldPath}" for efficient lazy loading. ` +
              `Falling back to loading all data. ` +
              `Consider creating an index on the collection with collection.createIndex((row) => row.${fieldPath}) ` +
              `or enable auto-indexing with autoIndex: 'eager' and a defaultIndexType.`,
          )
        }

        orderByAlias =
          firstOrderByExpression.path.length > 1
            ? String(firstOrderByExpression.path[0])
            : rawQuery.from.alias
        orderBySourceId ??= collectCollectionSources(rawQuery).find(
          (source) =>
            source.alias === orderByAlias &&
            source.collection === followRefCollection,
        )?.sourceId
      }
    }

    if (orderBySourceId) {
      // A provider sees rows from one lexical source. Push only the leading
      // order terms owned by that source; a later term from an independent
      // join cannot be evaluated against this adapter's row shape. Stop at
      // the first foreign or computed term because terms after it are not a
      // valid prefix of the query order either.
      const sourceTerms: Array<{
        resolved: OrderByClause
        extractor: CompiledSingleRowExpression
        compare: (left: unknown, right: unknown) => number
      }> = []
      const resolvedOrderBy = resolveOrderBy(
        orderByClause,
        collection.compareOptions,
      )
      for (let termIndex = 0; termIndex < orderByClause.length; termIndex++) {
        const clause = orderByClause[termIndex]!
        if (clause.expression.type !== `ref`) break
        const followed = followRef(rawQuery, clause.expression, collection)
        if (!followed || followed.sourceId !== orderBySourceId) break
        const resolved = resolvedOrderBy[termIndex]!
        sourceTerms.push({
          resolved,
          extractor: compileExpression(
            new PropRef(followed.path),
            true,
          ) as CompiledSingleRowExpression,
          compare: makeComparator(resolved.compareOptions),
        })
      }
      const sourceOrderBy = sourceTerms.map(({ resolved }) => resolved)
      const sourceExtractors = sourceTerms.map(({ extractor }) => extractor)

      const compareSourceRows = (
        a: Record<string, unknown> | null | undefined,
        b: Record<string, unknown> | null | undefined,
      ) => {
        for (const { extractor, compare: compareTerm } of sourceTerms) {
          const result = compareTerm(
            a ? extractor(a) : a,
            b ? extractor(b) : b,
          )
          if (result !== 0) return result
        }
        return 0
      }

      // Create a value extractor for raw rows that extracts ALL orderBy column values
      // This is used for tracking sent values and building composite cursors
      const rawRowValueExtractor = (row: Record<string, unknown>): unknown => {
        if (sourceExtractors.length === 1) {
          // Single column: return single value
          return sourceExtractors[0]!(row)
        }
        return sourceExtractors.map((extractor) => extractor(row))
      }

      orderByOptimizationInfo = {
        sourceId: orderBySourceId,
        alias: orderByAlias,
        offset: offset ?? 0,
        limit,
        comparator: compareSourceRows,
        valueExtractorForRawRow: rawRowValueExtractor,
        index,
        orderBy: sourceOrderBy,
      }

      // Ordered loading is owned by one lexical source. A collection can occur
      // more than once in a query tree, so collection ID and alias are not
      // sufficient identities here.
      optimizableOrderByCollections[orderBySourceId] = orderByOptimizationInfo

      // Set up lazy loading callback to track how much more data is needed
      // This is used by loadMoreIfNeeded to determine if more data should be loaded
      // Only enable when an index exists — without an index, lazy loading can't work
      // and all data is loaded eagerly via requestSnapshot instead.
      if (index) {
        setSizeCallback = (getSize: () => number) => {
          optimizableOrderByCollections[orderBySourceId]![`dataNeeded`] =
            () => {
              const size = getSize()
              return Math.max(0, orderByOptimizationInfo!.limit - size)
            }
        }
      }
    }
  }

  // Use grouped ordering when a groupKeyFn is provided (includes with limit/offset),
  // otherwise use the standard global ordering operator.
  if (groupKeyFn) {
    return pipeline.pipe(
      groupedOrderByWithFractionalIndex(valueExtractor, {
        limit,
        offset,
        comparator: compare,
        setSizeCallback,
        groupKeyFn,
        setWindowFn: (
          windowFn: (options: { offset?: number; limit?: number }) => void,
        ) => {
          setWindowFn((options) => {
            windowFn(options)
            if (orderByOptimizationInfo) {
              orderByOptimizationInfo.offset =
                options.offset ?? orderByOptimizationInfo.offset
              orderByOptimizationInfo.limit =
                options.limit ?? orderByOptimizationInfo.limit
            }
          })
        },
      }),
    )
  }

  // Use fractional indexing and return the tuple [value, index]
  return pipeline.pipe(
    orderByWithFractionalIndex(valueExtractor, {
      limit,
      offset,
      comparator: compare,
      setSizeCallback,
      setWindowFn: (
        windowFn: (options: { offset?: number; limit?: number }) => void,
      ) => {
        setWindowFn(
          // We wrap the move function such that we update the orderByOptimizationInfo
          // because that is used by the `dataNeeded` callback to determine if we need to load more data
          (options) => {
            windowFn(options)
            if (orderByOptimizationInfo) {
              orderByOptimizationInfo.offset =
                options.offset ?? orderByOptimizationInfo.offset
              orderByOptimizationInfo.limit =
                options.limit ?? orderByOptimizationInfo.limit
            }
          },
        )
      },
    }),
    // orderByWithFractionalIndex returns [key, [value, index]] - we keep this format
  )
}

/**
 * Builds a comparison configuration object that uses the values provided in the orderBy clause.
 * If no string sort configuration is provided it defaults to the collection's string sort configuration.
 * Multi-source FROM queries pass their first source collection here as the
 * documented default. Use explicit orderBy compare options when branches need
 * different string collation behavior.
 */
export function buildCompareOptions(
  clause: OrderByClause,
  collection: CollectionLike<any, any>,
): CompareOptions {
  return resolveCompareOptions(clause, collection.compareOptions)
}
