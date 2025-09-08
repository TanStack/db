import {
  consolidate,
  filter,
  join as joinOperator,
  map,
  tap,
} from "@tanstack/db-ivm"
import {
  CollectionInputNotFoundError,
  InvalidJoinConditionSameTableError,
  InvalidJoinConditionTableMismatchError,
  InvalidJoinConditionWrongTablesError,
  JoinCollectionNotFoundError,
  UnsupportedJoinSourceTypeError,
  UnsupportedJoinTypeError,
} from "../../errors.js"
import { findIndexForField } from "../../utils/index-optimization.js"
import { ensureIndexForField } from "../../indexes/auto-index.js"
import { compileExpression } from "./evaluators.js"
import { compileQuery, followRef } from "./index.js"
import type { OrderByOptimizationInfo } from "./order-by.js"
import type {
  BasicExpression,
  CollectionRef,
  JoinClause,
  PropRef,
  QueryIR,
  QueryRef,
} from "../ir.js"
import type { IStreamBuilder, JoinType } from "@tanstack/db-ivm"
import type { Collection } from "../../collection.js"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../../types.js"
import type { QueryCache, QueryMapping } from "./types.js"
import type { BaseIndex } from "../../indexes/base-index.js"

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
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  rawQuery: QueryIR
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
      callbacks,
      lazyCollections,
      optimizableOrderByCollections,
      rawQuery
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
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  rawQuery: QueryIR
): NamespacedAndKeyedStream {
  // Get the joined table alias and input stream
  const {
    alias: joinedTableAlias,
    input: joinedInput,
    collectionId: joinedCollectionId,
  } = processJoinSource(
    joinClause.from,
    allInputs,
    collections,
    callbacks,
    lazyCollections,
    optimizableOrderByCollections,
    cache,
    queryMapping
  )

  // Add the joined table to the tables map
  tables[joinedTableAlias] = joinedInput

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
  const { mainExpr, joinedExpr } = analyzeJoinExpressions(
    joinClause.left,
    joinClause.right,
    mainTableAlias,
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

    if (!limitedSubquery) {
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

      let index: BaseIndex<string | number> | undefined

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

      let deoptimized = false

      const activePipelineWithLoading: IStreamBuilder<
        [key: unknown, [originalKey: string, namespacedRow: NamespacedRow]]
      > = activePipeline.pipe(
        tap(([joinKey, _]) => {
          if (deoptimized) {
            return
          }

          // Find the index for the path we join on
          // we need to find the index inside the map operator
          // because the indexes are only available after the initial sync
          // so we can't fetch it during compilation
          index ??= findIndexForField(
            followRefCollection.indexes,
            followRefResult.path
          )

          // The `callbacks` object is passed by the liveQueryCollection to the compiler.
          // It contains a function to lazy load keys for each lazy collection
          // as well as a function to switch back to a regular collection
          // (useful when there's no index for available for lazily loading the collection)
          const collectionCallbacks = callbacks[lazyCollection.id]
          if (!collectionCallbacks) {
            throw new Error(
              `Internal error: callbacks for collection are missing in join pipeline. Make sure the live query collection sets them before running the pipeline.`
            )
          }

          const { loadKeys, loadInitialState } = collectionCallbacks

          if (index && index.supports(`eq`)) {
            // Use the index to fetch the PKs of the rows in the lazy collection
            // that match this row from the active collection based on the value of the joinKey
            const matchingKeys = index.lookup(`eq`, joinKey)
            // Inform the lazy collection that those keys need to be loaded
            loadKeys(matchingKeys)
          } else {
            // We can't optimize the join because there is no index for the join key
            // on the lazy collection, so we load the initial state
            deoptimized = true
            loadInitialState()
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
 * and returns them in the correct order (main table expression first, joined table expression second)
 */
function analyzeJoinExpressions(
  left: BasicExpression,
  right: BasicExpression,
  mainTableAlias: string,
  joinedTableAlias: string
): { mainExpr: BasicExpression; joinedExpr: BasicExpression } {
  const leftTableAlias = getTableAliasFromExpression(left)
  const rightTableAlias = getTableAliasFromExpression(right)

  // If left expression refers to main table and right refers to joined table, keep as is
  if (
    leftTableAlias === mainTableAlias &&
    rightTableAlias === joinedTableAlias
  ) {
    return { mainExpr: left, joinedExpr: right }
  }

  // If left expression refers to joined table and right refers to main table, swap them
  if (
    leftTableAlias === joinedTableAlias &&
    rightTableAlias === mainTableAlias
  ) {
    return { mainExpr: right, joinedExpr: left }
  }

  // If both expressions refer to the same alias, this is an invalid join
  if (leftTableAlias === rightTableAlias) {
    throw new InvalidJoinConditionSameTableError(leftTableAlias || `unknown`)
  }

  // If one expression doesn't refer to either table, this is an invalid join
  if (!leftTableAlias || !rightTableAlias) {
    throw new InvalidJoinConditionTableMismatchError(
      mainTableAlias,
      joinedTableAlias
    )
  }

  // If expressions refer to tables not involved in this join, this is an invalid join
  throw new InvalidJoinConditionWrongTablesError(
    leftTableAlias,
    rightTableAlias,
    mainTableAlias,
    joinedTableAlias
  )
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
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  cache: QueryCache,
  queryMapping: QueryMapping
): { alias: string; input: KeyedStream; collectionId: string } {
  switch (from.type) {
    case `collectionRef`: {
      const input = allInputs[from.collection.id]
      if (!input) {
        throw new CollectionInputNotFoundError(from.collection.id)
      }
      return { alias: from.alias, input, collectionId: from.collection.id }
    }
    case `queryRef`: {
      // Find the original query for caching purposes
      const originalQuery = queryMapping.get(from.query) || from.query

      // Recursively compile the sub-query with cache
      const subQueryResult = compileQuery(
        originalQuery,
        allInputs,
        collections,
        callbacks,
        lazyCollections,
        optimizableOrderByCollections,
        cache,
        queryMapping
      )

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
