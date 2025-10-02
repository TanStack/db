import {
  consolidate,
  filter,
  join as joinOperator,
  map,
  tap,
} from "@tanstack/db-ivm"
import {
  CollectionInputNotFoundError,
  InvalidJoinCondition,
  InvalidJoinConditionLeftTableError,
  InvalidJoinConditionRightTableError,
  InvalidJoinConditionSameTableError,
  InvalidJoinConditionTableMismatchError,
  JoinCollectionNotFoundError,
  UnsupportedJoinSourceTypeError,
  UnsupportedJoinTypeError,
} from "../../errors.js"
import { ensureIndexForField } from "../../indexes/auto-index.js"
import { PropRef, followRef } from "../ir.js"
import { inArray } from "../builder/functions.js"
import { compileExpression } from "./evaluators.js"
import type { CompileQueryFn } from "./index.js"
import type { OrderByOptimizationInfo } from "./order-by.js"
import type {
  BasicExpression,
  CollectionRef,
  JoinClause,
  QueryIR,
  QueryRef,
} from "../ir.js"
import type { IStreamBuilder, JoinType } from "@tanstack/db-ivm"
import type { Collection } from "../../collection/index.js"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../../types.js"
import type { QueryCache, QueryMapping } from "./types.js"
import type { CollectionSubscription } from "../../collection/subscription.js"

export type LoadKeysFn = (key: Set<string | number>) => void
export type LazyCollectionCallbacks = {
  loadKeys: LoadKeysFn
  loadInitialState: () => void
}

/**
 * Processes all join clauses in a query
 */
export function processJoins(
  pipeline: NamespacedAndKeyedStream,
  joinClauses: Array<JoinClause>,
  tables: Record<string, KeyedStream>,
  mainTableId: string,
  mainTableAlias: string,
  allInputs: Record<string, KeyedStream>,
  cache: QueryCache,
  queryMapping: QueryMapping,
  collections: Record<string, Collection>,
  subscriptions: Record<string, CollectionSubscription>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  rawQuery: QueryIR,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>
): NamespacedAndKeyedStream {
  let resultPipeline = pipeline

  for (const joinClause of joinClauses) {
    resultPipeline = processJoin(
      resultPipeline,
      joinClause,
      tables,
      mainTableId,
      mainTableAlias,
      allInputs,
      cache,
      queryMapping,
      collections,
      subscriptions,
      callbacks,
      lazyCollections,
      optimizableOrderByCollections,
      rawQuery,
      onCompileSubquery,
      aliasToCollectionId
    )
  }

  return resultPipeline
}

/**
 * Processes a single join clause
 */
function processJoin(
  pipeline: NamespacedAndKeyedStream,
  joinClause: JoinClause,
  tables: Record<string, KeyedStream>,
  mainTableId: string,
  mainTableAlias: string,
  allInputs: Record<string, KeyedStream>,
  cache: QueryCache,
  queryMapping: QueryMapping,
  collections: Record<string, Collection>,
  subscriptions: Record<string, CollectionSubscription>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  rawQuery: QueryIR,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>
): NamespacedAndKeyedStream {
  const isCollectionRef = joinClause.from.type === `collectionRef`

  // Get the joined table alias and input stream
  const {
    alias: joinedTableAlias,
    input: joinedInput,
    collectionId: joinedCollectionId,
  } = processJoinSource(
    joinClause.from,
    allInputs,
    collections,
    subscriptions,
    callbacks,
    lazyCollections,
    optimizableOrderByCollections,
    cache,
    queryMapping,
    onCompileSubquery,
    aliasToCollectionId
  )

  // Add the joined table to the tables map
  tables[joinedTableAlias] = joinedInput
  if (isCollectionRef) {
    // Only direct collection references form new alias bindings. Subquery
    // aliases reuse the mapping returned from the recursive compilation above.
    aliasToCollectionId[joinedTableAlias] = joinedCollectionId
  }

  const mainCollection = collections[mainTableId]
  const joinedCollection = collections[joinedCollectionId]

  if (!mainCollection) {
    throw new JoinCollectionNotFoundError(mainTableId)
  }

  if (!joinedCollection) {
    throw new JoinCollectionNotFoundError(joinedCollectionId)
  }

  const { activeCollection, lazyCollection } = getActiveAndLazyCollections(
    joinClause.type,
    mainCollection,
    joinedCollection
  )

  // Analyze which table each expression refers to and swap if necessary
  const availableTableAliases = Object.keys(tables)
  const { mainExpr, joinedExpr } = analyzeJoinExpressions(
    joinClause.left,
    joinClause.right,
    availableTableAliases,
    joinedTableAlias
  )

  // Pre-compile the join expressions
  const compiledMainExpr = compileExpression(mainExpr)
  const compiledJoinedExpr = compileExpression(joinedExpr)

  // Prepare the main pipeline for joining
  let mainPipeline = pipeline.pipe(
    map(([currentKey, namespacedRow]) => {
      // Extract the join key from the main table expression
      const mainKey = compiledMainExpr(namespacedRow)

      // Return [joinKey, [originalKey, namespacedRow]]
      return [mainKey, [currentKey, namespacedRow]] as [
        unknown,
        [string, typeof namespacedRow],
      ]
    })
  )

  // Prepare the joined pipeline
  let joinedPipeline = joinedInput.pipe(
    map(([currentKey, row]) => {
      // Wrap the row in a namespaced structure
      const namespacedRow: NamespacedRow = { [joinedTableAlias]: row }

      // Extract the join key from the joined table expression
      const joinedKey = compiledJoinedExpr(namespacedRow)

      // Return [joinKey, [originalKey, namespacedRow]]
      return [joinedKey, [currentKey, namespacedRow]] as [
        unknown,
        [string, typeof namespacedRow],
      ]
    })
  )

  // Apply the join operation
  if (![`inner`, `left`, `right`, `full`].includes(joinClause.type)) {
    throw new UnsupportedJoinTypeError(joinClause.type)
  }

  if (activeCollection) {
    // If the lazy collection comes from a subquery that has a limit and/or an offset clause
    // then we need to deoptimize the join because we don't know which rows are in the result set
    // since we simply lookup matching keys in the index but the index contains all rows
    // (not just the ones that pass the limit and offset clauses)
    const lazyFrom =
      activeCollection === `main` ? joinClause.from : rawQuery.from
    const limitedSubquery =
      lazyFrom.type === `queryRef` &&
      (lazyFrom.query.limit || lazyFrom.query.offset)

    // If join expressions contain computed values (like concat functions)
    // we don't optimize the join because we don't have an index over the computed values
    const hasComputedJoinExpr =
      mainExpr.type === `func` || joinedExpr.type === `func`

    if (!limitedSubquery && !hasComputedJoinExpr) {
      // This join can be optimized by having the active collection
      // dynamically load keys into the lazy collection
      // based on the value of the joinKey and by looking up
      // matching rows in the index of the lazy collection

      // Mark the lazy collection as lazy
      // this Set is passed by the liveQueryCollection to the compiler
      // such that the liveQueryCollection can check it after compilation
      // to know which collections are lazy collections
      lazyCollections.add(lazyCollection.id)

      const activePipeline =
        activeCollection === `main` ? mainPipeline : joinedPipeline

      const lazyCollectionJoinExpr =
        activeCollection === `main`
          ? (joinedExpr as PropRef)
          : (mainExpr as PropRef)

      const followRefResult = followRef(
        rawQuery,
        lazyCollectionJoinExpr,
        lazyCollection
      )!
      const followRefCollection = followRefResult.collection

      const fieldName = followRefResult.path[0]
      if (fieldName) {
        ensureIndexForField(
          fieldName,
          followRefResult.path,
          followRefCollection
        )
      }

      const activePipelineWithLoading: IStreamBuilder<
        [key: unknown, [originalKey: string, namespacedRow: NamespacedRow]]
      > = activePipeline.pipe(
        tap((data) => {
          // For outer joins (LEFT/RIGHT), the driving side determines which alias's
          // subscription we consult for lazy loading. The main table drives LEFT joins,
          // joined table drives RIGHT joins.
          const lazyAliasCandidate =
            activeCollection === `main` ? joinedTableAlias : mainTableAlias
          const lazyCollectionSubscription =
            subscriptions[lazyAliasCandidate] ??
            subscriptions[`__collection:${lazyCollection.id}`]

          if (!lazyCollectionSubscription) {
            throw new Error(
              `Internal error: subscription for collection is missing in join pipeline. Make sure the live query collection sets the subscription before running the pipeline.`
            )
          }

          if (lazyCollectionSubscription.hasLoadedInitialState()) {
            // Entire state was already loaded because we deoptimized the join
            return
          }

          const joinKeys = data.getInner().map(([[joinKey]]) => joinKey)
          const lazyJoinRef = new PropRef(followRefResult.path)
          const loaded = lazyCollectionSubscription.requestSnapshot({
            where: inArray(lazyJoinRef, joinKeys),
            optimizedOnly: true,
          })

          if (!loaded) {
            // Snapshot wasn't sent because it could not be loaded from the indexes
            lazyCollectionSubscription.requestSnapshot()
          }
        })
      )

      if (activeCollection === `main`) {
        mainPipeline = activePipelineWithLoading
      } else {
        joinedPipeline = activePipelineWithLoading
      }
    }
  }

  return mainPipeline.pipe(
    joinOperator(joinedPipeline, joinClause.type as JoinType),
    consolidate(),
    processJoinResults(joinClause.type)
  )
}

/**
 * Analyzes join expressions to determine which refers to which table
 * and returns them in the correct order (available table expression first, joined table expression second)
 */
function analyzeJoinExpressions(
  left: BasicExpression,
  right: BasicExpression,
  allAvailableTableAliases: Array<string>,
  joinedTableAlias: string
): { mainExpr: BasicExpression; joinedExpr: BasicExpression } {
  // Filter out the joined table alias from the available table aliases
  const availableTableAliases = allAvailableTableAliases.filter(
    (alias) => alias !== joinedTableAlias
  )

  const leftTableAlias = getTableAliasFromExpression(left)
  const rightTableAlias = getTableAliasFromExpression(right)

  // If left expression refers to an available table and right refers to joined table, keep as is
  if (
    leftTableAlias &&
    availableTableAliases.includes(leftTableAlias) &&
    rightTableAlias === joinedTableAlias
  ) {
    return { mainExpr: left, joinedExpr: right }
  }

  // If left expression refers to joined table and right refers to an available table, swap them
  if (
    leftTableAlias === joinedTableAlias &&
    rightTableAlias &&
    availableTableAliases.includes(rightTableAlias)
  ) {
    return { mainExpr: right, joinedExpr: left }
  }

  // If one expression doesn't refer to any table, this is an invalid join
  if (!leftTableAlias || !rightTableAlias) {
    // For backward compatibility, use the first available table alias in error message
    throw new InvalidJoinConditionTableMismatchError()
  }

  // If both expressions refer to the same alias, this is an invalid join
  if (leftTableAlias === rightTableAlias) {
    throw new InvalidJoinConditionSameTableError(leftTableAlias)
  }

  // Left side must refer to an available table
  // This cannot happen with the query builder as there is no way to build a ref
  // to an unavailable table, but just in case, but could happen with the IR
  if (!availableTableAliases.includes(leftTableAlias)) {
    throw new InvalidJoinConditionLeftTableError(leftTableAlias)
  }

  // Right side must refer to the joined table
  if (rightTableAlias !== joinedTableAlias) {
    throw new InvalidJoinConditionRightTableError(joinedTableAlias)
  }

  // This should not be reachable given the logic above, but just in case
  throw new InvalidJoinCondition()
}

/**
 * Extracts the table alias from a join expression
 */
function getTableAliasFromExpression(expr: BasicExpression): string | null {
  switch (expr.type) {
    case `ref`:
      // PropRef path has the table alias as the first element
      return expr.path[0] || null
    case `func`: {
      // For function expressions, we need to check if all arguments refer to the same table
      const tableAliases = new Set<string>()
      for (const arg of expr.args) {
        const alias = getTableAliasFromExpression(arg)
        if (alias) {
          tableAliases.add(alias)
        }
      }
      // If all arguments refer to the same table, return that table alias
      return tableAliases.size === 1 ? Array.from(tableAliases)[0]! : null
    }
    default:
      // Values (type='val') don't reference any table
      return null
  }
}

/**
 * Processes the join source (collection or sub-query)
 */
function processJoinSource(
  from: CollectionRef | QueryRef,
  allInputs: Record<string, KeyedStream>,
  collections: Record<string, Collection>,
  subscriptions: Record<string, CollectionSubscription>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  cache: QueryCache,
  queryMapping: QueryMapping,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>
): { alias: string; input: KeyedStream; collectionId: string } {
  switch (from.type) {
    case `collectionRef`: {
      const input = allInputs[from.alias] ?? allInputs[from.collection.id]
      if (!input) {
        throw new CollectionInputNotFoundError(
          from.alias,
          from.collection.id,
          Object.keys(allInputs)
        )
      }
      aliasToCollectionId[from.alias] = from.collection.id
      return { alias: from.alias, input, collectionId: from.collection.id }
    }
    case `queryRef`: {
      // Find the original query for caching purposes
      const originalQuery = queryMapping.get(from.query) || from.query

      // Recursively compile the sub-query with cache
      const subQueryResult = onCompileSubquery(
        originalQuery,
        allInputs,
        collections,
        subscriptions,
        callbacks,
        lazyCollections,
        optimizableOrderByCollections,
        cache,
        queryMapping
      )

      // Pull the nested alias map up so the caller can subscribe to those aliases
      // and keep the current alias pointing at the subquery's collection.
      Object.assign(aliasToCollectionId, subQueryResult.aliasToCollectionId)

      // Extract the pipeline from the compilation result
      const subQueryInput = subQueryResult.pipeline

      // Subqueries may return [key, [value, orderByIndex]] (with ORDER BY) or [key, value] (without ORDER BY)
      // We need to extract just the value for use in parent queries
      const extractedInput = subQueryInput.pipe(
        map((data: any) => {
          const [key, [value, _orderByIndex]] = data
          return [key, value] as [unknown, any]
        })
      )

      return {
        alias: from.alias,
        input: extractedInput as KeyedStream,
        collectionId: subQueryResult.collectionId,
      }
    }
    default:
      throw new UnsupportedJoinSourceTypeError((from as any).type)
  }
}

/**
 * Processes the results of a join operation
 */
function processJoinResults(joinType: string) {
  return function (
    pipeline: IStreamBuilder<
      [
        key: string,
        [
          [string, NamespacedRow] | undefined,
          [string, NamespacedRow] | undefined,
        ],
      ]
    >
  ): NamespacedAndKeyedStream {
    return pipeline.pipe(
      // Process the join result and handle nulls
      filter((result) => {
        const [_key, [main, joined]] = result
        const mainNamespacedRow = main?.[1]
        const joinedNamespacedRow = joined?.[1]

        // Handle different join types
        if (joinType === `inner`) {
          return !!(mainNamespacedRow && joinedNamespacedRow)
        }

        if (joinType === `left`) {
          return !!mainNamespacedRow
        }

        if (joinType === `right`) {
          return !!joinedNamespacedRow
        }

        // For full joins, always include
        return true
      }),
      map((result) => {
        const [_key, [main, joined]] = result
        const mainKey = main?.[0]
        const mainNamespacedRow = main?.[1]
        const joinedKey = joined?.[0]
        const joinedNamespacedRow = joined?.[1]

        // Merge the namespaced rows
        const mergedNamespacedRow: NamespacedRow = {}

        // Add main row data if it exists
        if (mainNamespacedRow) {
          Object.assign(mergedNamespacedRow, mainNamespacedRow)
        }

        // Add joined row data if it exists
        if (joinedNamespacedRow) {
          Object.assign(mergedNamespacedRow, joinedNamespacedRow)
        }

        // We create a composite key that combines the main and joined keys
        const resultKey = `[${mainKey},${joinedKey}]`

        return [resultKey, mergedNamespacedRow] as [string, NamespacedRow]
      })
    )
  }
}

/**
 * Returns the active and lazy collections for a join clause.
 * The active collection is the one that we need to fully iterate over
 * and it can be the main table (i.e. left collection) or the joined table (i.e. right collection).
 * The lazy collection is the one that we should join-in lazily based on matches in the active collection.
 * @param joinClause - The join clause to analyze
 * @param leftCollection - The left collection
 * @param rightCollection - The right collection
 * @returns The active and lazy collections. They are undefined if we need to loop over both collections (i.e. both are active)
 */
function getActiveAndLazyCollections(
  joinType: JoinClause[`type`],
  leftCollection: Collection,
  rightCollection: Collection
):
  | { activeCollection: `main` | `joined`; lazyCollection: Collection }
  | { activeCollection: undefined; lazyCollection: undefined } {
  if (leftCollection.id === rightCollection.id) {
    // We can't apply this optimization if there's only one collection
    // because `liveQueryCollection` will detect that the collection is lazy
    // and treat it lazily (because the collection is shared)
    // and thus it will not load any keys because both sides of the join
    // will be handled lazily
    return { activeCollection: undefined, lazyCollection: undefined }
  }

  switch (joinType) {
    case `left`:
      return { activeCollection: `main`, lazyCollection: rightCollection }
    case `right`:
      return { activeCollection: `joined`, lazyCollection: leftCollection }
    case `inner`:
      // The smallest collection should be the active collection
      // and the biggest collection should be lazy
      return leftCollection.size < rightCollection.size
        ? { activeCollection: `main`, lazyCollection: rightCollection }
        : { activeCollection: `joined`, lazyCollection: leftCollection }
    default:
      return { activeCollection: undefined, lazyCollection: undefined }
  }
}
