import {
  groupedOrderByWithFractionalIndex,
  orderByWithFractionalIndex,
} from '@tanstack/db-ivm'
import { defaultComparator, makeComparator } from '../../utils/comparison.js'
import {
  PropRef,
  collectCollectionSources,
  followRef,
  getWhereExpression,
  isResidualWhere,
} from '../ir.js'
import { ensureIndexForField } from '../../indexes/auto-index.js'
import {
  findIndexForField,
  supportsOrderedIndexStructure,
  supportsOrderedRange,
} from '../../utils/index-optimization.js'
import { hasVirtualPropPath } from '../../virtual-props.js'
import { devBuild } from '../../error-message.js'
import { compileExpression } from './evaluators.js'
import { getSourceAliasesFromExpression } from './expressions.js'
import type { CompareOptions } from '../builder/types.js'
import type { WindowOptions } from './types.js'
import type { Grouping } from './grouping.js'
import type { CompiledSingleRowExpression } from './evaluators.js'
import type { OrderBy, OrderByClause, QueryIR, Select } from '../ir.js'
import type {
  CollectionLike,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from '../../types.js'
import type {
  IStreamBuilder,
  KeyValue,
  SetSizeCallback,
} from '@tanstack/db-ivm'
import type { IndexReader } from '../../indexes/base-index.js'
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
  /** Extracts the leading provider order value from a raw row. */
  valueExtractorForRawRow: (row: Record<string, unknown>) => unknown
  /** Index on the first orderBy column - used for lazy loading */
  index?: IndexReader<string | number>
  /**
   * Rows the window still needs. Given the loader's settled boundary, a window
   * row after it does not count: the graph may lack an earlier eligible row.
   */
  dataNeeded?: (boundary?: Record<string, unknown>) => number
  /** Reads the source loader's synchronous request guard, when installed. */
  isRequesting?: () => boolean
  /**
   * Whether a provider-ordered finite prefix is insufficient for the local
   * plan, including when a custom local collation defines another order.
   */
  requiresFullSource: boolean
  /** Whether the ordered source's installed rows are the whole source. */
  sourceHoldsAllRows: boolean
  /** Source whose lazy demand must settle before a joined-filter page. */
  joinedFilterSourceId?: string
}

function warnOrderIndexFallback(
  collection: Collection,
  path: Array<string>,
  options: CompareOptions,
  index?: IndexReader<string | number>,
): void {
  if (devBuild() && process.env.NODE_ENV !== `production`) {
    const field = path.join(`.`)
    const prefix = `[TanStack DB]${collection.id ? ` [${collection.id}]` : ``} orderBy with limit`
    if (options.stringSort === `custom`) {
      console.warn(
        `${prefix} uses a custom string comparator on "${field}". On-demand sources require a filtered full source request for local sorting. An index with the same compare function reference can sort installed rows, but cannot make provider pagination safe.`,
      )
      return
    }
    if (hasVirtualPropPath(path)) {
      console.warn(
        `${prefix} orders virtual field "${field}"; Collection indexes cannot cover virtual fields, so creating one will not enable ordered lazy loading.`,
      )
      return
    }
    if (index) return

    const fieldIndexes = [...collection.indexes.values()].filter((candidate) =>
      candidate.matchesField(path),
    )
    let detail: string
    if (fieldIndexes.length === 0) {
      detail = `requires an index on "${field}" for efficient lazy loading. Consider collection.createIndex((row) => row.${field}) or autoIndex: 'eager' with a defaultIndexType.`
    } else if (
      fieldIndexes.every(
        (candidate) => !candidate.matchesCompareOptions(options),
      )
    ) {
      detail = `found an index on "${field}", but none uses the query's compareOptions (nulls: "${options.nulls}", stringSort: "${options.stringSort ?? `locale`}"${options.stringSort === `locale` ? `, including the same locale and localeOptions` : ``}). After importing BasicIndex from '@tanstack/db', use collection.createIndex((row) => row.${field}, { indexType: BasicIndex, options: { compareOptions: { direction: "asc", nulls: "${options.nulls}", stringSort: "${options.stringSort ?? `locale`}" } } }). Match the query's nulls and string collation, including any locale and localeOptions. The index direction may differ.`
    } else {
      detail = `found an index on "${field}" with matching compareOptions, but none supports ordered lazy loading. Use an index with ordered range reads, one comparable value domain, and no custom comparator.`
    }
    console.warn(
      `${prefix} ${detail} Local reads may scan or sort installed rows; an underfilled on-demand window may require a full-source request.`,
    )
  }
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
  // The query's grouping compiler, if it has one, rewrites aggregates.
  grouping: Grouping | undefined,
  collection: Collection,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  setWindowFn: (windowFn: (options: WindowOptions) => void) => void,
  limit?: number,
  offset?: number,
  groupKeyFn?: (key: unknown, value: unknown) => unknown,
): IStreamBuilder<KeyValue<unknown, [NamespacedRow, string]>> {
  const compiledOrderBy = orderByClause.map((clause) => {
    // Aggregate references read the SELECT result under $selected. A query
    // without the grouping compiler has no aggregates.
    const clauseWithoutAggregates = grouping
      ? grouping.replaceAggregatesByRefs(
          clause.expression,
          selectClause,
          `$selected`,
        )
      : clause.expression

    return {
      compiledExpression: compileExpression(clauseWithoutAggregates),
      compareOptions: buildCompareOptions(clause, collection),
    }
  })
  // The row holds source aliases and any projected aggregate under $selected.
  const valueExtractor = (row: NamespacedRow & { $selected?: any }) => {
    if (orderByClause.length > 1) {
      return compiledOrderBy.map((compiled) => compiled.compiledExpression(row))
    }
    return orderByClause.length === 1
      ? compiledOrderBy[0]!.compiledExpression(row)
      : null
  }

  // Compare order terms in declaration order, stopping at the first difference.
  const compare = (a: unknown, b: unknown) => {
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

    if (orderByClause.length === 1) {
      const clause = compiledOrderBy[0]!
      const compareFn = makeComparator(clause.compareOptions)
      return compareFn(a, b)
    }

    return defaultComparator(a, b)
  }

  let setSizeCallback: SetSizeCallback | undefined

  let orderByOptimizationInfo: OrderByOptimizationInfo | undefined

  // When there's a limit, create orderByOptimizationInfo for top-K source
  // loading. Unbounded queries use subscription hints instead. A plan whose
  // local semantics cannot be established from a provider prefix records
  // requiresFullSource and issues one filtered full-source acquisition.
  // We try to use an index on the FIRST orderBy column for lazy loading,
  // even for multi-column orderBy (using wider bounds on first column).
  // Skip this optimization when using grouped ordering (includes with limit),
  // because the limit is per-group, not global — the child collection needs all data loaded.
  if (
    limit !== undefined &&
    orderByClause.length > 0 &&
    !groupKeyFn &&
    rawQuery.from.type !== `unionFrom` &&
    rawQuery.from.type !== `unionAll`
  ) {
    let index: IndexReader<string | number> | undefined
    let followRefCollection: Collection | undefined
    let orderByAlias: string = rawQuery.from.alias
    let orderBySourceId: string | undefined

    // Try to create/find an index on the FIRST orderBy column for lazy loading
    const firstClause = orderByClause[0]!
    const firstOrderByExpression = firstClause.expression

    const followRefResult =
      firstOrderByExpression.type === `ref`
        ? followRef(rawQuery, firstOrderByExpression, collection)
        : undefined
    if (firstOrderByExpression.type === `ref` && followRefResult) {
      followRefCollection = followRefResult.collection
      orderBySourceId = followRefResult.sourceId
      const fieldName = followRefResult.path[0]
      // The query's first source defines implicit string collation for the
      // whole order. Build the source index with that same resolved term so
      // provider admission cannot disagree with emitted query order.
      const compareOpts = buildCompareOptions(firstClause, collection)

      if (fieldName) {
        ensureIndexForField(
          fieldName,
          followRefResult.path,
          followRefCollection,
          compareOpts,
          supportsOrderedIndexStructure,
        )
      }

      index = findIndexForField(
        followRefCollection,
        followRefResult.path,
        compareOpts,
        supportsOrderedRange,
      )

      warnOrderIndexFallback(
        followRefCollection,
        followRefResult.path,
        compareOpts,
        index,
      )

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

    if (orderBySourceId && followRefResult) {
      const sourceOrderBy = resolveOrderBy(
        orderByClause,
        collection.compareOptions,
      )
      const sourceOrderIsDirect = orderByClause.every(({ expression }) => {
        if (expression.type !== `ref`) return false
        return (
          followRef(rawQuery, expression, collection)?.sourceId ===
          orderBySourceId
        )
      })
      const extract = compileExpression(
        new PropRef(followRefResult.path),
        true,
      ) as CompiledSingleRowExpression
      const compareTerm = makeComparator(sourceOrderBy[0]!.compareOptions)
      const compareSourceRows = (
        a: Record<string, unknown> | null | undefined,
        b: Record<string, unknown> | null | undefined,
      ) => compareTerm(a ? extract(a) : a, b ? extract(b) : b)
      const hasCrossAliasWhere =
        rawQuery.where?.some((where) =>
          [...getSourceAliasesFromExpression(getWhereExpression(where))].some(
            (alias) => alias !== orderByAlias,
          ),
        ) ?? false
      const joinedFilterSourceId =
        hasCrossAliasWhere &&
        rawQuery.join?.length === 1 &&
        rawQuery.join[0]!.type === `left` &&
        rawQuery.join[0]!.from.type === `collectionRef`
          ? rawQuery.join[0]!.from.sourceId
          : undefined

      const info: OrderByOptimizationInfo = {
        sourceId: orderBySourceId,
        alias: orderByAlias,
        offset: offset ?? 0,
        limit,
        comparator: compareSourceRows,
        valueExtractorForRawRow: extract,
        index,
        orderBy: sourceOrderBy,
        joinedFilterSourceId,
        sourceHoldsAllRows:
          followRefResult.collection.config.syncMode !== `on-demand`,
        requiresFullSource:
          sourceOrderBy.some(
            ({ compareOptions }) => compareOptions.stringSort === `custom`,
          ) ||
          !sourceOrderIsDirect ||
          rawQuery.from.type !== `collectionRef` ||
          rawQuery.from.sourceId !== orderBySourceId ||
          // Only a LEFT join keeps every root row of a bounded prefix and
          // adds no row the prefix cannot place: inner and cross joins drop
          // root rows, and right, full and outer joins add joined rows whose
          // root match may sit past the prefix.
          (rawQuery.join?.some(({ type }) => type !== `left`) ?? false) ||
          (rawQuery.where?.some(isResidualWhere) ?? false) ||
          (hasCrossAliasWhere && joinedFilterSourceId === undefined) ||
          (rawQuery.fnWhere?.length ?? 0) > 0 ||
          rawQuery.groupBy !== undefined ||
          rawQuery.having !== undefined ||
          rawQuery.fnHaving !== undefined ||
          rawQuery.distinct === true,
      }
      orderByOptimizationInfo = info

      // Ordered loading is owned by one lexical source. A collection can occur
      // more than once in a query tree, so collection ID and alias are not
      // sufficient identities here.
      optimizableOrderByCollections[orderBySourceId] = info

      // loadMoreIfNeeded reads how many rows the window needs. Without an
      // index, only an on-demand joined filter can leave the window short.
      const needsCount =
        info.joinedFilterSourceId !== undefined && !info.sourceHoldsAllRows
      if (index || needsCount) {
        setSizeCallback = (getSize) => {
          info.dataNeeded = (boundary) => {
            // Window rows at or before the boundary are a leading run of
            // the window order.
            const size = getSize(
              boundary &&
                ((row) =>
                  compareSourceRows(
                    (row as NamespacedRow)[orderByAlias],
                    boundary,
                  ) <= 0),
            )
            return Math.max(0, info.limit - size)
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

function resolveOrderBy(
  orderBy: OrderBy,
  defaults: CollectionLike[`compareOptions`],
): OrderBy {
  return orderBy.map((clause) => ({
    expression: clause.expression,
    compareOptions: resolveCompareOptions(clause, defaults),
  }))
}

function resolveCompareOptions(
  clause: OrderByClause,
  defaults: CollectionLike[`compareOptions`],
): CompareOptions {
  return clause.compareOptions.stringSort === undefined
    ? {
        ...defaults,
        direction: clause.compareOptions.direction,
        nulls: clause.compareOptions.nulls,
      }
    : clause.compareOptions
}
