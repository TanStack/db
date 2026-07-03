import { filter, join as joinOperator, map, tap } from '@tanstack/db-ivm'
import {
  CollectionInputNotFoundError,
  InvalidJoinCondition,
  InvalidJoinConditionLeftSourceError,
  InvalidJoinConditionRightSourceError,
  InvalidJoinConditionSameSourceError,
  InvalidJoinConditionSourceMismatchError,
  JoinCollectionNotFoundError,
  SubscriptionNotFoundError,
  UnsupportedJoinSourceTypeError,
  UnsupportedJoinTypeError,
} from '../../errors.js'
import { normalizeValue } from '../../utils/comparison.js'
import { ensureIndexForField } from '../../indexes/auto-index.js'
import { PropRef } from '../ir.js'
import { inArray } from '../builder/functions.js'
import { compileExpression } from './evaluators.js'
import { getLazyLoadTargets } from './lazy-targets.js'
import type { CompileQueryFn } from './index.js'
import type { OrderByOptimizationInfo } from './order-by.js'
import type {
  BasicExpression,
  CollectionRef,
  JoinClause,
  QueryIR,
  QueryRef,
} from '../ir.js'
import type { IStreamBuilder, JoinType } from '@tanstack/db-ivm'
import type { Collection } from '../../collection/index.js'
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from '../../types.js'
import type { QueryCache, QueryMapping, WindowOptions } from './types.js'
import type { CollectionSubscription } from '../../collection/subscription.js'

/** Function type for loading specific keys into a lazy collection */
export type LoadKeysFn = (key: Set<string | number>) => void

/** Callbacks for managing lazy-loaded collections in optimized joins */
export type LazyCollectionCallbacks = {
  loadKeys: LoadKeysFn
  loadInitialState: () => void
}

/**
 * Processes all join clauses, applying lazy loading optimizations and maintaining
 * alias tracking for per-alias subscriptions (enables self-joins).
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
  setWindowFn: (windowFn: (options: WindowOptions) => void) => void,
  rawQuery: QueryIR,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>,
  sourceWhereClauses: Map<string, BasicExpression<boolean>>,
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
      setWindowFn,
      rawQuery,
      onCompileSubquery,
      aliasToCollectionId,
      aliasRemapping,
      sourceWhereClauses,
    )
  }

  return resultPipeline
}

/**
 * Processes a single join clause with lazy loading optimization.
 * For LEFT/RIGHT/INNER joins, marks one side as "lazy" (loads on-demand based on join keys).
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
  setWindowFn: (windowFn: (options: WindowOptions) => void) => void,
  rawQuery: QueryIR,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>,
  sourceWhereClauses: Map<string, BasicExpression<boolean>>,
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
    setWindowFn,
    cache,
    queryMapping,
    onCompileSubquery,
    aliasToCollectionId,
    aliasRemapping,
    sourceWhereClauses,
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
    joinedCollection,
  )

  // Analyze which source each expression refers to and swap if necessary
  const availableSources = Object.keys(sources)
  const { mainExpr, joinedExpr } = analyzeJoinExpressions(
    joinClause.left,
    joinClause.right,
    availableSources,
    joinedSource,
    rawQuery.from.type === `unionAll`,
  )

  // Pre-compile the join expressions
  const compiledMainExpr = compileExpression(mainExpr)
  const compiledJoinedExpr = compileExpression(joinedExpr)

  // Per-item join key extractors. The join operator derives keys itself
  // (JoinKeyExtractors) so neither side needs a re-keying map operator that
  // wraps every row in a [joinKey, [key, row]] pair.
  const mainItemKey = (item: [unknown, NamespacedRow]): unknown =>
    normalizeValue(compiledMainExpr(item[1]))
  const joinedItemKey = (item: [unknown, NamespacedRow]): unknown =>
    normalizeValue(compiledJoinedExpr(item[1]))

  // The main pipeline is already keyed as [originalKey, namespacedRow]
  let mainPipeline = pipeline

  // Prepare the joined pipeline: wrap rows in a namespaced structure
  let joinedPipeline = joinedInput.pipe(
    map(([currentKey, row]) => {
      const namespacedRow: NamespacedRow = { [joinedSource]: row }
      return [currentKey, namespacedRow] as [unknown, NamespacedRow]
    }),
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
    const resultUnionLazySide = lazyFrom.type === `unionAll`

    const lazySourceJoinExpr = activeSource === `main` ? joinedExpr : mainExpr
    const lazyAlias = activeSource === `main` ? joinedSource : mainSource
    const lazyTargets = resultUnionLazySide
      ? []
      : getLazyLoadTargets(
          rawQuery,
          lazyFrom,
          lazyAlias,
          lazySourceJoinExpr,
          lazySource,
          aliasRemapping,
        )

    if (!limitedSubquery && lazyTargets.length > 0) {
      // This join can be optimized by having the active collection
      // dynamically load keys into the lazy collection
      // based on the value of the joinKey and by looking up
      // matching rows in the index of the lazy collection

      // Mark the lazy source aliases as lazy
      // this Set is passed by the liveQueryCollection to the compiler
      // such that the liveQueryCollection can check it after compilation
      // to know which source aliases should load data lazily (not initially)
      for (const target of lazyTargets) {
        lazySources.add(target.alias)
      }

      const activePipeline =
        activeSource === `main` ? mainPipeline : joinedPipeline
      const activeItemKey =
        activeSource === `main` ? mainItemKey : joinedItemKey

      for (const target of lazyTargets) {
        const fieldName = target.path[0]
        if (fieldName) {
          ensureIndexForField(fieldName, target.path, target.collection)
        }
      }

      // Set up lazy loading: intercept active side's stream and dynamically load
      // matching rows from lazy side based on join keys.
      const activePipelineWithLoading: IStreamBuilder<
        [key: unknown, namespacedRow: NamespacedRow]
      > = activePipeline.pipe(
        tap((data) => {
          // Deduplicate and filter null keys before requesting snapshot
          const joinKeys = [
            ...new Set(
              data
                .getInner()
                .map(([item]) =>
                  activeItemKey(item as [unknown, NamespacedRow]),
                )
                .filter((key) => key != null),
            ),
          ]

          if (joinKeys.length === 0) {
            return
          }

          for (const target of lazyTargets) {
            const lazySourceSubscription = subscriptions[target.alias]

            if (!lazySourceSubscription) {
              throw new SubscriptionNotFoundError(
                target.alias,
                lazyAlias,
                target.collection.id,
                Object.keys(subscriptions),
              )
            }

            if (lazySourceSubscription.hasLoadedInitialState()) {
              // Entire state was already loaded because we deoptimized the join
              continue
            }

            const lazyJoinRef = new PropRef(target.path)
            const loaded = lazySourceSubscription.requestSnapshot({
              where: inArray(lazyJoinRef, joinKeys),
              optimizedOnly: true,
            })

            if (!loaded) {
              // Snapshot wasn't sent because it could not be loaded from the indexes
              const collectionId = target.collection.id
              const fieldPath = target.path.join(`.`)
              console.warn(
                `[TanStack DB]${collectionId ? ` [${collectionId}]` : ``} Join requires an index on "${fieldPath}" for efficient loading. ` +
                  `Falling back to loading all data. ` +
                  `Consider creating an index on the collection with collection.createIndex((row) => row.${fieldPath}) ` +
                  `or enable auto-indexing with autoIndex: 'eager' and a defaultIndexType.`,
              )
              lazySourceSubscription.requestSnapshot()
            }
          }
        }),
      )

      if (activeSource === `main`) {
        mainPipeline = activePipelineWithLoading
      } else {
        joinedPipeline = activePipelineWithLoading
      }
    }
  }

  return mainPipeline.pipe(
    joinOperator(joinedPipeline as any, joinClause.type as JoinType, {
      keyExtractorA: mainItemKey as any,
      keyExtractorB: joinedItemKey as any,
    }),
    processJoinResults(joinClause.type),
  )
}

/**
 * Analyzes join expressions to determine which refers to which source
 * and returns them in the correct order (available source expression first, joined source expression second)
 */
function analyzeJoinExpressions(
  left: BasicExpression,
  right: BasicExpression,
  allAvailableSourceAliases: Array<string>,
  joinedSource: string,
  allowResultFields: boolean = false,
): { mainExpr: BasicExpression; joinedExpr: BasicExpression } {
  // Filter out the joined source alias from the available source aliases
  const availableSources = allAvailableSourceAliases.filter(
    (alias) => alias !== joinedSource,
  )

  const leftSourceAliases = getSourceAliasesFromExpression(left)
  const rightSourceAliases = getSourceAliasesFromExpression(right)
  const leftReferencesJoined = leftSourceAliases.has(joinedSource)
  const rightReferencesJoined = rightSourceAliases.has(joinedSource)
  const leftAvailableAliases = [...leftSourceAliases].filter(
    (alias) =>
      availableSources.includes(alias) ||
      (allowResultFields && alias !== joinedSource),
  )
  const rightAvailableAliases = [...rightSourceAliases].filter(
    (alias) =>
      availableSources.includes(alias) ||
      (allowResultFields && alias !== joinedSource),
  )

  // If left expression refers to an available source and right refers to joined source, keep as is
  if (
    leftAvailableAliases.length > 0 &&
    !leftReferencesJoined &&
    rightReferencesJoined &&
    rightAvailableAliases.length === 0
  ) {
    return { mainExpr: left, joinedExpr: right }
  }

  // If left expression refers to joined source and right refers to an available source, swap them
  if (
    leftReferencesJoined &&
    leftAvailableAliases.length === 0 &&
    rightAvailableAliases.length > 0 &&
    !rightReferencesJoined
  ) {
    return { mainExpr: right, joinedExpr: left }
  }

  // If one expression doesn't refer to any source, this is an invalid join
  if (leftSourceAliases.size === 0 || rightSourceAliases.size === 0) {
    throw new InvalidJoinConditionSourceMismatchError()
  }

  // If both expressions refer to the same alias, this is an invalid join
  if (
    leftSourceAliases.size === 1 &&
    rightSourceAliases.size === 1 &&
    [...leftSourceAliases][0] === [...rightSourceAliases][0]
  ) {
    throw new InvalidJoinConditionSameSourceError([...leftSourceAliases][0]!)
  }

  // Left side must refer to an available source
  // This cannot happen with the query builder as there is no way to build a ref
  // to an unavailable source, but just in case, but could happen with the IR
  if (leftAvailableAliases.length === 0) {
    throw new InvalidJoinConditionLeftSourceError([...leftSourceAliases][0]!)
  }

  // Right side must refer to the joined source
  if (!rightReferencesJoined) {
    throw new InvalidJoinConditionRightSourceError(joinedSource)
  }

  // This should not be reachable given the logic above, but just in case
  throw new InvalidJoinCondition()
}

/**
 * Extracts the source alias from a join expression
 */
function getSourceAliasesFromExpression(expr: BasicExpression): Set<string> {
  switch (expr.type) {
    case `ref`:
      // PropRef path has the source alias as the first element
      return new Set(expr.path[0] ? [expr.path[0]] : [])
    case `func`: {
      // For function expressions, we need to check if all arguments refer to the same source
      const sourceAliases = new Set<string>()
      for (const arg of expr.args) {
        for (const alias of getSourceAliasesFromExpression(arg)) {
          sourceAliases.add(alias)
        }
      }
      return sourceAliases
    }
    default:
      // Values (type='val') don't reference any source
      return new Set()
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
  setWindowFn: (windowFn: (options: WindowOptions) => void) => void,
  cache: QueryCache,
  queryMapping: QueryMapping,
  onCompileSubquery: CompileQueryFn,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>,
  sourceWhereClauses: Map<string, BasicExpression<boolean>>,
): { alias: string; input: KeyedStream; collectionId: string } {
  switch (from.type) {
    case `collectionRef`: {
      const input = allInputs[from.alias]
      if (!input) {
        throw new CollectionInputNotFoundError(
          from.alias,
          from.collection.id,
          Object.keys(allInputs),
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
        setWindowFn,
        cache,
        queryMapping,
      )

      // Pull up alias mappings from subquery to parent scope.
      // This includes both the innermost alias-to-collection mappings AND
      // any existing remappings from nested subquery levels.
      Object.assign(aliasToCollectionId, subQueryResult.aliasToCollectionId)
      Object.assign(aliasRemapping, subQueryResult.aliasRemapping)

      // Pull up source WHERE clauses from subquery to parent scope.
      // This enables loadSubset to receive the correct where clauses for subquery collections.
      //
      // IMPORTANT: Skip pull-up for optimizer-created subqueries. These are detected when:
      // 1. The outer alias (from.alias) matches the inner alias (from.query.from.alias)
      // 2. The subquery was found in queryMapping (it's a user-defined subquery, not optimizer-created)
      //
      // For optimizer-created subqueries, the parent already has the sourceWhereClauses
      // extracted from the original raw query, so pulling up would be redundant.
      const isUserDefinedSubquery = queryMapping.has(from.query)
      const fromInnerAlias = getFirstFromAlias(from.query)
      const isOptimizerCreated =
        !isUserDefinedSubquery &&
        fromInnerAlias !== undefined &&
        from.alias === fromInnerAlias

      if (!isOptimizerCreated) {
        for (const [alias, whereClause] of subQueryResult.sourceWhereClauses) {
          sourceWhereClauses.set(alias, whereClause)
        }
      }

      // Create a flattened remapping from outer alias to innermost alias.
      // For nested subqueries, this ensures one-hop lookups (not recursive chains).
      //
      // Example with 3-level nesting:
      //   Inner:  .from({ user: usersCollection })
      //   Middle: .from({ activeUser: innerSubquery })     → creates: activeUser → user
      //   Outer:  .join({ author: middleSubquery }, ...)   → creates: author → user (not author → activeUser)
      //
      // We search through the PULLED-UP aliasToCollectionId (which contains the
      // innermost 'user' alias), so we always map directly to the deepest level.
      // This means aliasRemapping[lazyAlias] is always a single lookup, never recursive.
      const innerAlias = Object.keys(subQueryResult.aliasToCollectionId).find(
        (alias) =>
          subQueryResult.aliasToCollectionId[alias] ===
          subQueryResult.collectionId,
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
        }),
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

function getFirstFromAlias(query: QueryIR): string | undefined {
  if (query.from.type === `unionFrom`) {
    return query.from.sources[0]?.alias
  }

  if (query.from.type === `unionAll`) {
    return undefined
  }

  return query.from.alias
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
    >,
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
      }),
    )
  }
}

/**
 * Returns the active and lazy collections for a join clause.
 * The active collection is the one that we need to fully iterate over
 * and it can be the main source (i.e. left collection) or the joined source (i.e. right collection).
 * The lazy collection is the one that we should join-in lazily based on matches in the active collection.
 * @param joinClause - The join clause to analyze
 * @param leftCollection - The left collection
 * @param rightCollection - The right collection
 * @returns The active and lazy collections. They are undefined if we need to loop over both collections (i.e. both are active)
 */
function getActiveAndLazySources(
  joinType: JoinClause[`type`],
  leftCollection: Collection,
  rightCollection: Collection,
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
