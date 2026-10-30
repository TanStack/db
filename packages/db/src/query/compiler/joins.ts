import {
  join as joinOperator,
  map,
  serializeValue,
  tap,
} from '@tanstack/db-ivm'
import {
  CollectionInputNotFoundError,
  InvalidJoinCondition,
  InvalidJoinConditionLeftSourceError,
  InvalidJoinConditionRightSourceError,
  InvalidJoinConditionSameSourceError,
  InvalidJoinConditionSourceMismatchError,
  JoinCollectionNotFoundError,
  UnsupportedFromTypeError,
  UnsupportedJoinSourceTypeError,
  UnsupportedJoinTypeError,
} from '../../errors.js'
import { getParentContextIdentity } from '../equality-value-identity.js'
import { ensureIndexForField } from '../../indexes/auto-index.js'
import { validateJoinConditions } from '../join-conditions.js'
import {
  Value as ValClass,
  collectPropRefs,
  getFromSources,
  getPropRefSourceAlias,
  requireCollectionSource,
} from '../ir.js'
import { compileExpression } from './evaluators.js'
import { getLazyLoadTargets } from './lazy-targets.js'
import { crossJoinParentRoutes } from './parent-routes.js'
import { queriesMatchForCaching } from './query-equivalence.js'
import {
  CALLBACK_INPUT,
  attachRouteMetadata,
  attachRouteMetadataToResult,
  getCallbackInput,
  getNamespacedRouteMetadata,
  wrapInputRow,
} from './route-metadata.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type { CompilationResult, IncludesCompilationResult } from './index.js'
import type {
  BasicExpression,
  CollectionSourceRef,
  From,
  JoinClause,
  PropRef,
  QueryIR,
  QueryRef,
} from '../ir.js'
import type { IStreamBuilder, JoinType } from '@tanstack/db-ivm'
import type { Collection } from '../../collection/index.js'
import type {
  InputRow,
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from '../../types.js'
import type { QueryMapping } from './types.js'

type CompileSubquery = (
  query: QueryIR,
  parentKeyStream?: KeyedStream,
) => CompilationResult

export type LazyDemandPlan = {
  id: string
  path: Array<string>
  collectionId: string
  initialKeys: Set<unknown>
}

/** Callbacks for managing lazy-loaded collections in optimized joins */
export type LazyCollectionCallbacks = {
  plans?: Array<LazyDemandPlan>
  setDemand?: (plan: LazyDemandPlan, keys: Set<unknown>) => void
}

type JoinInputValue = [
  originalKey: unknown,
  namespacedRow: NamespacedRow,
  joinValue: unknown,
]

let nextLazyDemandPlanId = 0

function parameterizeJoinInputByParentRoutes(
  input: KeyedStream,
  parentKeyStream: KeyedStream,
  valueIdentity: ValueIdentity,
): KeyedStream {
  return crossJoinParentRoutes(
    input,
    parentKeyStream,
    (rowKey, row, correlationKey, parentContext, callbackValue) => {
      return [
        serializeValue([
          valueIdentity.equality(rowKey),
          valueIdentity.equality(correlationKey),
          getParentContextIdentity(parentContext),
        ]),
        attachRouteMetadata(
          {
            ...(row as Record<string, unknown>),
          },
          correlationKey,
          parentContext,
        ),
        callbackValue,
      ] as unknown as [unknown, unknown]
    },
  )
}

function getRouteJoinKey(
  row: NamespacedRow,
  source: string,
  equalityKey: unknown,
  valueIdentity: ValueIdentity,
): string {
  const route = getNamespacedRouteMetadata(row, source)
  return serializeValue([
    valueIdentity.equality(route?.correlationKey),
    getParentContextIdentity(route?.parentContext ?? null),
    equalityKey,
  ])
}

function keyJoinInput(
  originalKey: unknown,
  row: NamespacedRow,
  source: string,
  side: `main` | `joined`,
  expressions: Array<(row: NamespacedRow) => unknown>,
  routeJoinedSource: boolean,
  valueIdentity: ValueIdentity,
): [string, JoinInputValue] {
  const value = expressions[0]!(row)
  const input: JoinInputValue = [originalKey, row, undefined]
  // NUL-prefixed side-local keys cannot collide with serializeValue output.
  // Unsatisfiable tuples retain their row but contribute no lazy demand.
  const unmatchedKey = side === `main` ? `\0m` : `\0j`
  if (value == null) return [unmatchedKey, input]
  let key = valueIdentity.equality(value)
  // Keep the single-equality path free of temporary operand arrays.
  if (expressions.length > 1) {
    const values = [key]
    for (let index = 1; index < expressions.length; index++) {
      const component = expressions[index]!(row)
      if (component == null) return [unmatchedKey, input]
      values.push(valueIdentity.equality(component))
    }
    key = values
  }
  // Demand uses the raw value, while matching uses graph-local equality.
  input[2] = value
  return [
    routeJoinedSource
      ? getRouteJoinKey(row, source, key, valueIdentity)
      : serializeValue(key),
    input,
  ]
}

export function registerLazyDemandPlan(
  callbacks: Record<string, LazyCollectionCallbacks>,
  target: { sourceId: string; path: Array<string>; collection: Collection },
  initialKeys: Set<unknown> = new Set(),
): LazyDemandPlan {
  const plan: LazyDemandPlan = {
    id: `lazy-demand-${++nextLazyDemandPlanId}`,
    path: target.path,
    collectionId: target.collection.id,
    initialKeys: new Set(initialKeys),
  }
  const state = (callbacks[target.sourceId] ??= {})
  ;(state.plans ??= []).push(plan)
  return plan
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
  queryMapping: QueryMapping,
  collections: Record<string, Collection>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazySources: Set<string>,
  rawQuery: QueryIR,
  localFrom: From,
  onCompileSubquery: CompileSubquery,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>,
  sourceWhereClauses: Map<string, BasicExpression<boolean>>,
  mainSourceIsParentFiltered: boolean,
  valueIdentity: ValueIdentity,
  parentKeyStream?: KeyedStream,
): NamespacedAndKeyedStream {
  const localBindings = new Set(
    getFromSources(localFrom).map((source) => source.bindingId),
  )

  // The loop owns the source bindings and compiler context for each join.
  function processJoin(
    inputPipeline: NamespacedAndKeyedStream,
    joinClause: JoinClause,
  ): NamespacedAndKeyedStream {
    const joinedSource = joinClause.from.alias
    const mainAliases = Object.keys(sources)
    const role = (ref: PropRef): JoinRefRole => {
      const alias = getJoinRefAlias(ref)
      if (ref.bindingId !== undefined) {
        if (ref.bindingId === joinClause.from.bindingId) return `joined`
        return localBindings.has(ref.bindingId) ? `main` : `ancestor`
      }
      if (alias === joinedSource) return `joined`
      if (
        alias &&
        (mainAliases.includes(alias) || rawQuery.from.type === `unionAll`)
      )
        return `main`
      return `unknown`
    }
    const conditions = validateJoinConditions(joinClause.on).map(
      ([left, right]) =>
        analyzeJoinExpressions(left, right, joinedSource, role),
    )
    // The first equality supplies candidate demand; the full tuple decides matches.
    const { mainExpr, joinedExpr } = conditions[0]!
    const joinedExpressionUsesParent = conditions.some(
      ({ joinedExpr: expression }) =>
        collectPropRefs(expression).some((ref) => {
          const sourceRole = role(ref)
          return sourceRole === `ancestor` || sourceRole === `unknown`
        }),
    )
    const routeJoinedSource =
      parentKeyStream !== undefined &&
      (joinClause.from.type === `queryRef` ||
        ((joinClause.type === `right` || joinClause.type === `full`) &&
          !mainSourceIsParentFiltered) ||
        joinedExpressionUsesParent)

    // Get the joined source alias and input stream
    const {
      alias: processedJoinedSource,
      input: joinedInput,
      collectionId: joinedCollectionId,
    } = processSource(
      joinClause.from,
      allInputs,
      queryMapping,
      onCompileSubquery,
      aliasToCollectionId,
      aliasRemapping,
      sourceWhereClauses,
      valueIdentity,
      `join`,
      routeJoinedSource ? parentKeyStream : undefined,
    )

    if (processedJoinedSource !== joinedSource) {
      throw new InvalidJoinConditionSourceMismatchError()
    }

    // Add the joined source to the sources map
    sources[joinedSource] = joinedInput

    const mainCollection = collections[mainCollectionId]
    const joinedCollection = collections[joinedCollectionId]

    if (!mainCollection) {
      throw new JoinCollectionNotFoundError(mainCollectionId)
    }

    if (!joinedCollection) {
      throw new JoinCollectionNotFoundError(joinedCollectionId)
    }

    const sourceActivity = getActiveAndLazySources(
      joinClause.type,
      mainCollection,
      joinedCollection,
      mainSourceIsParentFiltered,
    )
    const activeSource = routeJoinedSource
      ? undefined
      : sourceActivity.activeSource
    const lazySource = sourceActivity.lazySource

    // Pre-compile the join expressions
    const compiledMainExpressions = conditions.map((condition) =>
      compileExpression(condition.mainExpr),
    )
    const compiledJoinedExpressions = conditions.map((condition) =>
      compileExpression(condition.joinedExpr),
    )

    // Prepare both sides with the same key and raw-demand rules.
    let mainPipeline = inputPipeline.pipe(
      map(([currentKey, namespacedRow]) =>
        keyJoinInput(
          currentKey,
          namespacedRow,
          mainSource,
          `main`,
          compiledMainExpressions,
          routeJoinedSource,
          valueIdentity,
        ),
      ),
    )

    let joinedPipeline = joinedInput.pipe(
      map(([currentKey, row, callbackValue]: [...InputRow, unknown?]) =>
        keyJoinInput(
          currentKey,
          wrapInputRow(joinedSource, row, callbackValue),
          joinedSource,
          `joined`,
          compiledJoinedExpressions,
          routeJoinedSource,
          valueIdentity,
        ),
      ),
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
        (lazyFrom.query.limit !== undefined ||
          lazyFrom.query.offset !== undefined ||
          lazyFrom.query.singleResult)
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
          lazySources.add(target.sourceId)
        }

        const demandPlans = lazyTargets.map((target) =>
          registerLazyDemandPlan(callbacks, target),
        )
        const demandWeights = new Map<
          string,
          { key: unknown; weight: number }
        >()

        const activePipeline =
          activeSource === `main` ? mainPipeline : joinedPipeline

        for (const target of lazyTargets) {
          const fieldName = target.path[0]
          if (fieldName) {
            ensureIndexForField(fieldName, target.path, target.collection)
          }
        }

        // Set up lazy loading: intercept active side's stream and dynamically load
        // matching rows from lazy side based on join keys.
        const activePipelineWithLoading: IStreamBuilder<
          [key: string, value: JoinInputValue]
        > = activePipeline.pipe(
          tap((data) => {
            for (const [
              [joinKey, [, , joinValue]],
              weight,
            ] of data.getInner()) {
              if (joinValue == null) continue
              const previous = demandWeights.get(joinKey)
              const nextWeight = (previous?.weight ?? 0) + weight
              if (nextWeight === 0) {
                demandWeights.delete(joinKey)
              } else {
                demandWeights.set(joinKey, {
                  key: previous?.key ?? joinValue,
                  weight: nextWeight,
                })
              }
            }

            const keys = new Set(
              [...demandWeights.values()]
                .filter(({ weight }) => weight > 0)
                .map(({ key }) => key),
            )
            for (let index = 0; index < lazyTargets.length; index++) {
              const target = lazyTargets[index]!
              callbacks[target.sourceId]?.setDemand?.(demandPlans[index]!, keys)
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
      joinOperator(joinedPipeline, joinClause.type as JoinType),
      processJoinResults(joinedSource, mainAliases),
    )
  }

  for (const joinClause of joinClauses) {
    pipeline = processJoin(pipeline, joinClause)
    localBindings.add(joinClause.from.bindingId)
  }

  return pipeline
}

type JoinRefRole = `joined` | `main` | `ancestor` | `unknown`

function getJoinRefAlias(ref: PropRef): string | undefined {
  return getPropRefSourceAlias(ref) ?? ref.path[0]
}

/**
 * Analyzes join expressions to determine which refers to which source
 * and returns them in the correct order (available source expression first, joined source expression second)
 */
function analyzeJoinExpressions(
  left: BasicExpression,
  right: BasicExpression,
  joinedSource: string,
  role: (ref: PropRef) => JoinRefRole,
): { mainExpr: BasicExpression; joinedExpr: BasicExpression } {
  const leftRefs = collectPropRefs(left)
  const rightRefs = collectPropRefs(right)
  const leftRoles = new Set(leftRefs.map(role))
  const rightRoles = new Set(rightRefs.map(role))
  const leftMain = leftRoles.has(`main`) || leftRoles.has(`ancestor`)
  const rightMain = rightRoles.has(`main`) || rightRoles.has(`ancestor`)
  const leftJoined = leftRoles.has(`joined`)
  const rightJoined = rightRoles.has(`joined`)

  // If left expression refers to an available source and right refers to joined source, keep as is
  if (leftMain && !leftJoined && rightJoined && !rightRoles.has(`main`)) {
    return { mainExpr: left, joinedExpr: right }
  }

  // If left expression refers to joined source and right refers to an available source, swap them
  if (leftJoined && !leftRoles.has(`main`) && rightMain && !rightJoined) {
    return { mainExpr: right, joinedExpr: left }
  }

  // If one expression doesn't refer to any source, this is an invalid join
  if (leftRefs.length === 0 || rightRefs.length === 0) {
    throw new InvalidJoinConditionSourceMismatchError()
  }

  // If both expressions refer to the same alias, this is an invalid join
  if (
    leftRefs.length === 1 &&
    rightRefs.length === 1 &&
    (leftRefs[0]!.bindingId !== undefined &&
    rightRefs[0]!.bindingId !== undefined
      ? leftRefs[0]!.bindingId === rightRefs[0]!.bindingId
      : getJoinRefAlias(leftRefs[0]!) === getJoinRefAlias(rightRefs[0]!))
  ) {
    throw new InvalidJoinConditionSameSourceError(
      getJoinRefAlias(leftRefs[0]!)!,
    )
  }

  // Left side must refer to an available source
  // This cannot happen with the query builder as there is no way to build a ref
  // to an unavailable source, but just in case, but could happen with the IR
  if (!leftMain) {
    throw new InvalidJoinConditionLeftSourceError(
      getJoinRefAlias(leftRefs[0]!)!,
    )
  }

  // Right side must refer to the joined source
  if (!rightJoined) {
    throw new InvalidJoinConditionRightSourceError(joinedSource)
  }

  // This should not be reachable given the logic above, but just in case
  throw new InvalidJoinCondition()
}

/**
 * Compiles a FROM or JOIN source and propagates its source metadata.
 */
export function processSource(
  from: CollectionSourceRef | QueryRef,
  allInputs: Record<string, KeyedStream>,
  queryMapping: QueryMapping,
  onCompileSubquery: CompileSubquery,
  aliasToCollectionId: Record<string, string>,
  aliasRemapping: Record<string, string>,
  sourceWhereClauses: Map<string, BasicExpression<boolean>>,
  valueIdentity: ValueIdentity,
  sourceKind: `from` | `join`,
  parentKeyStream?: KeyedStream,
): {
  alias: string
  input: KeyedStream
  collectionId: string
  includes?: Array<IncludesCompilationResult>
} {
  switch (from.type) {
    case `descriptorRef`:
      return requireCollectionSource(from)
    case `collectionRef`: {
      const input = allInputs[from.sourceId]
      if (!input) {
        throw new CollectionInputNotFoundError(
          from.alias,
          from.collection.id,
          Object.keys(allInputs),
        )
      }
      aliasToCollectionId[from.alias] = from.collection.id
      return {
        alias: from.alias,
        input:
          sourceKind === `join` && parentKeyStream
            ? parameterizeJoinInputByParentRoutes(
                input,
                parentKeyStream,
                valueIdentity,
              )
            : input,
        collectionId: from.collection.id,
      }
    }
    case `queryRef`: {
      // Preserve the user-defined query as the cache key when optimization
      // only copied it. If the optimizer changed the query, compile that IR;
      // substituting its origin would discard pushed predicates.
      const originalQuery = queryMapping.get(from.query)
      const queryToCompile =
        originalQuery && queriesMatchForCaching(from.query, originalQuery)
          ? originalQuery
          : from.query
      const subQueryResult = onCompileSubquery(queryToCompile, parentKeyStream)

      Object.assign(aliasToCollectionId, subQueryResult.aliasToCollectionId)
      Object.assign(aliasRemapping, subQueryResult.aliasRemapping)
      // Optimizer-created wrappers already contributed their predicates to the
      // parent. User-authored subqueries must export their own source predicates.
      if (
        queryMapping.has(from.query) ||
        from.alias !== getFromSources(from.query.from)[0]?.alias
      ) {
        for (const [alias, where] of subQueryResult.sourceWhereClauses)
          sourceWhereClauses.set(alias, where)
      }
      // Resolve directly to the innermost alias, so nested scopes need one lookup.
      const innerAlias = Object.keys(subQueryResult.aliasToCollectionId).find(
        (alias) =>
          subQueryResult.aliasToCollectionId[alias] ===
          subQueryResult.collectionId,
      )
      if (innerAlias && innerAlias !== from.alias)
        aliasRemapping[from.alias] = innerAlias

      // Extract the pipeline from the compilation result
      const subQueryInput = subQueryResult.pipeline

      // Subqueries may return [key, [value, orderByIndex]] (with ORDER BY) or [key, value] (without ORDER BY)
      // We need to extract just the value for use in parent queries
      const extractedInput = subQueryInput.pipe(
        map((data: any) => {
          const [
            key,
            [
              value,
              _orderByIndex,
              correlationKey,
              parentContext,
              publicKey,
              callbackValue,
            ],
          ] = data
          if (sourceKind === `join` && !parentKeyStream) {
            return [key, value, callbackValue] as unknown as InputRow
          }
          return [
            key,
            attachRouteMetadataToResult(
              sourceKind === `from` && value instanceof ValClass
                ? value.value
                : value,
              correlationKey,
              parentContext,
              publicKey,
            ),
            callbackValue,
          ] as unknown as InputRow
        }),
      )

      return {
        alias: from.alias,
        input: extractedInput as KeyedStream,
        collectionId: subQueryResult.collectionId,
        includes: subQueryResult.includes,
      }
    }
    default:
      throw sourceKind === `join`
        ? new UnsupportedJoinSourceTypeError((from as any).type)
        : new UnsupportedFromTypeError((from as any).type)
  }
}

// JSON prints non-finite numbers as null, the missing-side marker. An object
// never collides with a source key, which is a string or a number.
function encodeNonFiniteKey(_: string, value: unknown): unknown {
  return typeof value === `number` && !Number.isFinite(value)
    ? { number: String(value) }
    : value
}

function processJoinResults(
  joinedSource: string,
  mainAliases: ReadonlyArray<string>,
): (
  pipeline: IStreamBuilder<
    [key: string, [JoinInputValue | undefined, JoinInputValue | undefined]]
  >,
) => NamespacedAndKeyedStream {
  return (pipeline) =>
    pipeline.pipe(
      map((result) => {
        const [_key, [main, joined]] = result
        const mainKey = main?.[0]
        const mainNamespacedRow = main?.[1]
        const joinedKey = joined?.[0]
        const joinedNamespacedRow = joined?.[1]

        // The main side owns inherited parent aliases. Missing local sides
        // must not expose an ancestor with the same alias.
        const mergeRows = (
          mainRow: NamespacedRow | undefined,
          joinedRow: NamespacedRow | undefined,
        ): NamespacedRow => {
          const row = { ...(mainRow ?? joinedRow) } as NamespacedRow
          if (main == null) for (const alias of mainAliases) delete row[alias]
          if (joinedRow) row[joinedSource] = joinedRow[joinedSource]!
          else delete row[joinedSource]
          return row
        }
        const mergedNamespacedRow = mergeRows(
          mainNamespacedRow,
          joinedNamespacedRow,
        )
        const mainView =
          mainNamespacedRow && getCallbackInput(mainNamespacedRow)
        const joinedView =
          joinedNamespacedRow && getCallbackInput(joinedNamespacedRow)
        if (
          mainView !== mainNamespacedRow ||
          joinedView !== joinedNamespacedRow
        ) {
          Object.assign(mergedNamespacedRow, {
            [CALLBACK_INPUT]: mergeRows(mainView, joinedView),
          })
        }

        // Combine the main and joined keys without ambiguity: keys may contain
        // delimiters, numbers and strings may print alike, and a missing outer
        // side encodes as null, which no source key can be.
        const resultKey = JSON.stringify(
          [mainKey ?? null, joinedKey ?? null],
          encodeNonFiniteKey,
        )

        return [resultKey, mergedNamespacedRow] as [string, NamespacedRow]
      }),
    )
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
  mainSourceIsParentFiltered: boolean,
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
      // A correlated include has already reduced the main relation to active
      // parent routes. Keep that relation active and load the joined side from
      // its keys; reversing the join would create an independent demand plan
      // that widens the correlated source back to a union of constraints.
      if (mainSourceIsParentFiltered) {
        return { activeSource: `main`, lazySource: rightCollection }
      }
      // The smallest collection should be the active collection
      // and the biggest collection should be lazy
      return leftCollection.size < rightCollection.size
        ? { activeSource: `main`, lazySource: rightCollection }
        : { activeSource: `joined`, lazySource: leftCollection }
    default:
      return { activeSource: undefined, lazySource: undefined }
  }
}
