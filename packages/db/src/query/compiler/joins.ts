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
  sources: Record<string, KeyedStream>,
  mainCollectionId: string,
  mainSource: string,
  allInputs: Record<string, KeyedStream>,
  cache: QueryCache,
  queryMapping: QueryMapping,
  collections: Record<string, Collection>,
  subscriptions: Record<string, CollectionSubscription>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazySources: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  rawQuery: QueryIR,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>
): NamespacedAndKeyedStream {
  let resultPipeline = pipeline

  for (const joinClause of joinClauses) {
    resultPipeline = processJoin(
      resultPipeline,
      joinClause,
      sources,
      mainCollectionId,
      mainSource,
      allInputs,
      cache,
      queryMapping,
      collections,
      subscriptions,
      callbacks,
      lazySources,
      optimizableOrderByCollections,
      rawQuery,
      onCompileSubquery,
      aliasToCollectionId,
      aliasRemapping
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
  sources: Record<string, KeyedStream>,
  mainCollectionId: string,
  mainSource: string,
  allInputs: Record<string, KeyedStream>,
  cache: QueryCache,
  queryMapping: QueryMapping,
  collections: Record<string, Collection>,
  subscriptions: Record<string, CollectionSubscription>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazySources: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  rawQuery: QueryIR,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>
): NamespacedAndKeyedStream {
  const isCollectionRef = joinClause.from.type === `collectionRef`

  // Get the joined source alias and input stream
  const {
    alias: joinedSource,
    input: joinedInput,
    collectionId: joinedCollectionId,
  } = processJoinSource(
    joinClause.from,
    allInputs,
    collections,
    subscriptions,
    callbacks,
    lazySources,
    optimizableOrderByCollections,
    cache,
    queryMapping,
    onCompileSubquery,
    aliasToCollectionId,
    aliasRemapping
  )

  // Add the joined source to the sources map
  sources[joinedSource] = joinedInput
  if (isCollectionRef) {
    // Only direct collection references form new alias bindings. Subquery
    // aliases reuse the mapping returned from the recursive compilation above.
    aliasToCollectionId[joinedSource] = joinedCollectionId
  }

  const mainCollection = collections[mainCollectionId]
  const joinedCollection = collections[joinedCollectionId]

  if (!mainCollection) {
    throw new JoinCollectionNotFoundError(mainCollectionId)
  }

  if (!joinedCollection) {
    throw new JoinCollectionNotFoundError(joinedCollectionId)
  }

  const { activeSource, lazySource } = getActiveAndLazySources(
    joinClause.type,
    mainCollection,
    joinedCollection
  )

  // Analyze which source each expression refers to and swap if necessary
  const availableSources = Object.keys(sources)
  const { mainExpr, joinedExpr } = analyzeJoinExpressions(
    joinClause.left,
    joinClause.right,
    availableSources,
    joinedSource
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
      const namespacedRow: NamespacedRow = { [joinedSource]: row }

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

  if (activeSource) {
    // If the lazy collection comes from a subquery that has a limit and/or an offset clause
    // then we need to deoptimize the join because we don't know which rows are in the result set
    // since we simply lookup matching keys in the index but the index contains all rows
    // (not just the ones that pass the limit and offset clauses)
    const lazyFrom = activeSource === `main` ? joinClause.from : rawQuery.from
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

      // Mark the lazy source alias as lazy
      // this Set is passed by the liveQueryCollection to the compiler
      // such that the liveQueryCollection can check it after compilation
      // to know which source aliases should load data lazily (not initially)
      const lazyAlias = activeSource === `main` ? joinedSource : mainSource
      lazySources.add(lazyAlias)

      const activePipeline =
        activeSource === `main` ? mainPipeline : joinedPipeline

      const lazySourceJoinExpr =
        activeSource === `main`
          ? (joinedExpr as PropRef)
          : (mainExpr as PropRef)

      const followRefResult = followRef(
        rawQuery,
        lazySourceJoinExpr,
        lazySource
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
            activeSource === `main` ? joinedSource : mainSource

          // Find the subscription for lazy loading.
          // For subqueries, the outer join alias (e.g., 'activeUser') may differ from the
          // inner alias (e.g., 'user'). Use aliasRemapping to resolve outer → inner alias.
          // Example: .join({ activeUser: subquery }) where subquery uses .from({ user: collection })
          // → aliasRemapping['activeUser'] = 'user'
          const resolvedAlias =
            aliasRemapping[lazyAliasCandidate] || lazyAliasCandidate
          const lazySourceSubscription = subscriptions[resolvedAlias]

          if (!lazySourceSubscription) {
            throw new Error(
              `Internal error: subscription for alias '${resolvedAlias}' (remapped from '${lazyAliasCandidate}', collection '${lazySource.id}') is missing in join pipeline. Available aliases: ${Object.keys(subscriptions).join(`, `)}. This indicates a bug in alias tracking.`
            )
          }

          if (lazySourceSubscription.hasLoadedInitialState()) {
            // Entire state was already loaded because we deoptimized the join
            return
          }

          const joinKeys = data.getInner().map(([[joinKey]]) => joinKey)
          const lazyJoinRef = new PropRef(followRefResult.path)
          const loaded = lazySourceSubscription.requestSnapshot({
            where: inArray(lazyJoinRef, joinKeys),
            optimizedOnly: true,
          })

          if (!loaded) {
            // Snapshot wasn't sent because it could not be loaded from the indexes
            lazySourceSubscription.requestSnapshot()
          }
        })
      )

      if (activeSource === `main`) {
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
  joinedSource: string
): { mainExpr: BasicExpression; joinedExpr: BasicExpression } {
  // Filter out the joined table alias from the available table aliases
  const availableSources = allAvailableTableAliases.filter(
    (alias) => alias !== joinedSource
  )

  const leftTableAlias = getTableAliasFromExpression(left)
  const rightTableAlias = getTableAliasFromExpression(right)

  // If left expression refers to an available table and right refers to joined table, keep as is
  if (
    leftTableAlias &&
    availableSources.includes(leftTableAlias) &&
    rightTableAlias === joinedSource
  ) {
    return { mainExpr: left, joinedExpr: right }
  }

  // If left expression refers to joined table and right refers to an available table, swap them
  if (
    leftTableAlias === joinedSource &&
    rightTableAlias &&
    availableSources.includes(rightTableAlias)
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
  if (!availableSources.includes(leftTableAlias)) {
    throw new InvalidJoinConditionLeftTableError(leftTableAlias)
  }

  // Right side must refer to the joined table
  if (rightTableAlias !== joinedSource) {
    throw new InvalidJoinConditionRightTableError(joinedSource)
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
  lazySources: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  cache: QueryCache,
  queryMapping: QueryMapping,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>
): { alias: string; input: KeyedStream; collectionId: string } {
  switch (from.type) {
    case `collectionRef`: {
      const input = allInputs[from.alias]
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
        lazySources,
        optimizableOrderByCollections,
        cache,
        queryMapping
      )

      // Pull up the inner alias mappings
      Object.assign(aliasToCollectionId, subQueryResult.aliasToCollectionId)
      Object.assign(aliasRemapping, subQueryResult.aliasRemapping)

      // For subqueries, the outer alias (from.alias) may differ from inner aliases.
      // Find the inner alias that corresponds to the subquery's main collection and create a remapping.
      const innerAlias = Object.keys(subQueryResult.aliasToCollectionId).find(
        (alias) =>
          subQueryResult.aliasToCollectionId[alias] ===
          subQueryResult.collectionId
      )
      if (innerAlias && innerAlias !== from.alias) {
        aliasRemapping[from.alias] = innerAlias
      }

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
function getActiveAndLazySources(
  joinType: JoinClause[`type`],
  leftCollection: Collection,
  rightCollection: Collection
):
  | { activeSource: `main` | `joined`; lazySource: Collection }
  | { activeSource: undefined; lazySource: undefined } {
  // Self-joins can now be optimized since we track lazy loading by source alias
  // rather than collection ID. Each alias has its own subscription and lazy state.

  switch (joinType) {
    case `left`:
      return { activeSource: `main`, lazySource: rightCollection }
    case `right`:
      return { activeSource: `joined`, lazySource: leftCollection }
    case `inner`:
      // The smallest collection should be the active collection
      // and the biggest collection should be lazy
      return leftCollection.size < rightCollection.size
        ? { activeSource: `main`, lazySource: rightCollection }
        : { activeSource: `joined`, lazySource: leftCollection }
    default:
      return { activeSource: undefined, lazySource: undefined }
  }
}
