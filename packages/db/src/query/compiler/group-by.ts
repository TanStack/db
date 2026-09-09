import {
  filter,
  groupBy,
  groupByOperators,
  map,
  serializeValue,
} from '@tanstack/db-ivm'
import {
  ConditionalSelect,
  Func,
  PropRef,
  getHavingExpression,
  isExpressionLike,
} from '../ir.js'
import {
  AggregateFunctionNotInSelectError,
  NonAggregateExpressionNotInGroupByError,
  UnknownHavingExpressionTypeError,
  UnsupportedAggregateFunctionError,
} from '../../errors.js'
import {
  getEqualityValueIdentity,
  getParentContextIdentity,
  getParentContextValue,
} from '../equality-value-identity.js'
import {
  compileExpression,
  isCaseWhenConditionTrue,
  toBooleanPredicate,
} from './evaluators.js'
import {
  INCLUDES_PUBLIC_KEY,
  attachRouteMetadata,
  getNamespacedRouteMetadata,
  stripInternalCallbackMetadata,
} from './route-metadata.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type { RouteMetadata } from './route-metadata.js'
import type {
  Aggregate,
  BasicExpression,
  GroupBy,
  Having,
  Select,
  SelectValueExpression,
} from '../ir.js'
import type { NamespacedAndKeyedStream, NamespacedRow } from '../../types.js'
import type { VirtualOrigin } from '../../virtual-props.js'

const RAW_REPRESENTATIVE = Symbol(`raw_group_representative`)

type InternalGroupFields = ReturnType<typeof createInternalGroupFields>

function createInternalGroupFields(groupCount: number, selectClause?: Select) {
  const aliases = Object.keys(selectClause ?? {})
  let prefix = `__tanstack_group_`
  while (aliases.some((alias) => alias.startsWith(prefix))) prefix += `_`

  return {
    virtual: `${prefix}virtual`,
    route: `${prefix}route`,
    correlationIdentity: `${prefix}correlation_identity`,
    parentContextIdentity: `${prefix}parent_context_identity`,
    singleGroup: `${prefix}single_group`,
    aggregatePrefix: `${prefix}aggregate_`,
    groupKeys: Array.from(
      { length: groupCount },
      (_, i) => `${prefix}key_${i}`,
    ),
    groupValues: Array.from(
      { length: groupCount },
      (_, i) => `${prefix}value_${i}`,
    ),
    groupKeyRefs: Array.from(
      { length: groupCount },
      (_, i) => `${prefix}key_ref_${i}`,
    ),
  }
}

type RowVirtualMetadata = {
  synced: boolean
  hasLocal: boolean
}

type Representative<T> = {
  key: string
  [RAW_REPRESENTATIVE]: T
}

function createPublicGroupKey(values: Array<unknown>): unknown {
  const identities = values.map(getEqualityValueIdentity)
  if (identities.length === 1) {
    const identity = identities[0]
    if (
      identity == null ||
      (typeof identity !== `object` &&
        typeof identity !== `function` &&
        typeof identity !== `symbol`)
    ) {
      return identity
    }
  }
  return serializeValue(identities)
}

function attachPublicGroupKey(
  row: Record<string, any>,
  publicKey: unknown,
): void {
  const keyedRow = row as Record<PropertyKey, unknown>
  keyedRow[INCLUDES_PUBLIC_KEY] = publicKey
}

function createRepresentative<T>(
  rowKey: string,
  value: T,
  identity: unknown,
): Representative<T> {
  // Encode once per contribution, not once per member on every group change.
  const representative = {
    key: serializeValue([rowKey, identity]),
  } as Representative<T>
  Object.defineProperty(representative, RAW_REPRESENTATIVE, { value })
  return representative
}

function getRepresentative<T>(
  values: Array<[Representative<T>, number]>,
): Representative<T> | undefined {
  let selected: Representative<T> | undefined
  for (const [candidate, multiplicity] of values) {
    if (multiplicity <= 0) continue
    if (selected === undefined || candidate.key < selected.key) {
      selected = candidate
    }
  }
  return selected
}

function unwrapRepresentative<T>(
  value: Representative<T> | undefined,
): T | undefined {
  return value?.[RAW_REPRESENTATIVE]
}

function addCorrelationRouteIdentityToGroupKey(
  key: Record<string, unknown>,
  row: NamespacedRow,
  mainSource: string,
  fields: InternalGroupFields,
  valueIdentity: ValueIdentity,
): void {
  const route = getNamespacedRouteMetadata(row, mainSource)
  key[fields.correlationIdentity] = valueIdentity.equality(
    route?.correlationKey,
  )
  if (route?.parentContext != null) {
    key[fields.parentContextIdentity] = getParentContextIdentity(
      route.parentContext,
    )
  }
}

/** One representative carries the whole route so both parts come from one row. */
function addCorrelationRouteAggregate(
  aggregates: Record<string, any>,
  mainSource: string,
  fields: InternalGroupFields,
  valueIdentity: ValueIdentity,
): void {
  aggregates[fields.route] = {
    preMap: ([rowKey, row]: [string, NamespacedRow]) => {
      const route = getNamespacedRouteMetadata(row, mainSource)
      return createRepresentative(rowKey, route, [
        valueIdentity.exact(route?.correlationKey),
        getParentContextIdentity(route?.parentContext),
      ])
    },
    reduce: getRepresentative,
    postMap: unwrapRepresentative,
  }
}

function getGroupRoute(
  aggregatedRow: Record<string, unknown>,
  fields: InternalGroupFields,
): RouteMetadata | undefined {
  return aggregatedRow[fields.route] as RouteMetadata | undefined
}

function getCorrelationRouteIdentity(
  aggregatedRow: Record<string, unknown>,
  fields: InternalGroupFields,
): unknown {
  return getGroupRoute(aggregatedRow, fields)?.parentContext == null
    ? aggregatedRow[fields.correlationIdentity]
    : [
        aggregatedRow[fields.correlationIdentity],
        aggregatedRow[fields.parentContextIdentity],
      ]
}

function getGroupEvaluationRow(
  row: Record<string, unknown>,
  fields: InternalGroupFields,
  selected = row.$selected as Record<string, unknown>,
): NamespacedRow {
  return {
    ...getParentContextValue(getGroupRoute(row, fields)?.parentContext),
    $selected: selected,
  }
}

function getRowVirtualMetadata(row: NamespacedRow): RowVirtualMetadata {
  let found = false
  let allSynced = true
  let hasLocal = false

  for (const [alias, value] of Object.entries(row as Record<string, unknown>)) {
    if (alias === `$selected`) continue
    if (value === null || typeof value !== `object`) continue
    const asRecord = value as Record<string, unknown>
    const hasSyncedProp = `$synced` in asRecord
    const hasOriginProp = `$origin` in asRecord
    if (!hasSyncedProp && !hasOriginProp) {
      continue
    }
    found = true
    if (asRecord.$synced === false) {
      allSynced = false
    }
    if (asRecord.$origin === `local`) {
      hasLocal = true
    }
  }

  return {
    synced: found ? allSynced : true,
    hasLocal,
  }
}

const { sum, count, avg, min, max } = groupByOperators

/**
 * Validates that all non-aggregate expressions in SELECT are present in GROUP BY
 * and creates a cached mapping for efficient lookup during processing
 */
function validateAndCreateMapping(
  groupByClause: GroupBy,
  selectClause?: Select,
): Map<string, number> {
  const selectToGroupByIndex = new Map<string, number>()

  if (!selectClause) {
    return selectToGroupByIndex
  }

  // Validate each SELECT expression
  for (const [alias, expr] of Object.entries(selectClause)) {
    if (expr.type === `agg` || containsAggregate(expr)) {
      // Aggregate expressions (plain or wrapped) are allowed and don't need to be in GROUP BY
      continue
    }

    // Non-aggregate expression must be in GROUP BY
    const groupIndex = groupByClause.findIndex((groupExpr) =>
      expressionsEqual(expr, groupExpr),
    )

    if (groupIndex === -1) {
      throw new NonAggregateExpressionNotInGroupByError(alias)
    }

    // Cache the mapping
    selectToGroupByIndex.set(alias, groupIndex)
  }

  return selectToGroupByIndex
}

/**
 * Processes the GROUP BY clause with optional HAVING and SELECT
 * Works with the new $selected structure from early SELECT processing
 */
export function processGroupBy(
  pipeline: NamespacedAndKeyedStream,
  groupByClause: GroupBy,
  valueIdentity: ValueIdentity,
  havingClauses?: Array<Having>,
  selectClause?: Select,
  fnHavingClauses?: Array<(row: any) => any>,
  aggregateCollectionId?: string,
  mainSource?: string,
  sanitizeCallbackRows = false,
): NamespacedAndKeyedStream {
  const fields = createInternalGroupFields(groupByClause.length, selectClause)
  const virtualAggregates: Record<string, any> = {
    [fields.virtual]: {
      preMap: ([, row]: [string, NamespacedRow]) => getRowVirtualMetadata(row),
      reduce: (values: Array<[RowVirtualMetadata, number]>) => {
        const group: RowVirtualMetadata = { synced: true, hasLocal: false }
        for (const [metadata, multiplicity] of values) {
          if (multiplicity <= 0) continue
          if (!metadata.synced) group.synced = false
          if (metadata.hasLocal) group.hasLocal = true
        }
        return group
      },
    },
  }

  if (mainSource) {
    addCorrelationRouteAggregate(
      virtualAggregates,
      mainSource,
      fields,
      valueIdentity,
    )
  }

  const singleGroup = groupByClause.length === 0
  // Single-group aggregation accepts selections without grouping validation.
  const mapping = singleGroup
    ? undefined
    : validateAndCreateMapping(groupByClause, selectClause)

  // Pre-compile groupBy expressions
  const compiledGroupByExpressions = groupByClause.map((e) =>
    compileExpression(e),
  )

  // Include the complete route so distinct parent inputs stay apart.
  const keyExtractor = ([, row]: [
    string,
    NamespacedRow & { $selected?: any },
  ]) => {
    // Use the original namespaced row for GROUP BY expressions, not $selected
    const namespacedRow = singleGroup ? row : { ...row }
    if (!singleGroup) delete namespacedRow.$selected

    const key: Record<string, unknown> = singleGroup
      ? { [fields.singleGroup]: true }
      : {}

    // D2 must key groups by the same relation as the query evaluator. The raw
    // representative is retained separately as an aggregate for projection.
    for (let i = 0; i < groupByClause.length; i++) {
      const compiledExpr = compiledGroupByExpressions[i]!
      const value = compiledExpr(namespacedRow)
      key[fields.groupKeys[i]!] = valueIdentity.equality(value)
    }

    if (mainSource) {
      addCorrelationRouteIdentityToGroupKey(
        key,
        row,
        mainSource,
        fields,
        valueIdentity,
      )
    }

    return key
  }

  // Create aggregate functions for any aggregated columns in the SELECT clause
  const aggregates: Record<string, any> = virtualAggregates
  const wrappedAggExprs: Record<string, (data: any) => any> = {}
  const aggCounter = { value: 0 }

  for (let i = 0; i < compiledGroupByExpressions.length; i++) {
    const compiledExpr = compiledGroupByExpressions[i]!
    aggregates[fields.groupValues[i]!] = {
      preMap: ([rowKey, row]: [string, NamespacedRow]) => {
        const value = compiledExpr(row)
        return createRepresentative(rowKey, value, valueIdentity.exact(value))
      },
      reduce: getRepresentative,
      postMap: unwrapRepresentative,
    }
  }

  if (selectClause) {
    // Scan the SELECT clause for aggregate functions
    for (const [alias, expr] of Object.entries(selectClause)) {
      if (expr.type === `agg`) {
        aggregates[alias] = getAggregateFunction(expr)
      } else if (containsAggregate(expr)) {
        const { transformed, extracted } = extractAndReplaceAggregates(
          expr as SelectValueExpression,
          aggCounter,
          fields.aggregatePrefix,
        )
        for (const [syntheticAlias, aggExpr] of Object.entries(extracted)) {
          aggregates[syntheticAlias] = getAggregateFunction(aggExpr)
        }
        wrappedAggExprs[alias] = compileGroupedSelectValue(
          singleGroup
            ? transformed
            : replaceGroupByRefsInSelectValue(
                transformed,
                groupByClause,
                fields.groupKeyRefs,
              ),
        )
      }
    }
  }

  // Apply the groupBy operator
  pipeline = pipeline.pipe(groupBy(keyExtractor, aggregates))

  // Update $selected to handle GROUP BY results
  pipeline = pipeline.pipe(
    map(([, aggregatedRow]) => {
      // Start with the existing $selected from early SELECT processing
      const selectResults = (aggregatedRow as any).$selected || {}
      const finalResults: Record<string, any> = singleGroup
        ? { ...selectResults }
        : {}

      if (selectClause) {
        // First pass: populate group keys, plain aggregates, and synthetic aliases
        for (const [alias, expr] of Object.entries(selectClause)) {
          if (expr.type === `agg`) {
            finalResults[alias] = aggregatedRow[alias]
          } else if (!singleGroup && !wrappedAggExprs[alias]) {
            // Use cached mapping to get the corresponding __key_X for non-aggregates
            const groupIndex = mapping?.get(alias)
            if (groupIndex !== undefined) {
              finalResults[alias] =
                aggregatedRow[fields.groupValues[groupIndex]!]
            } else {
              // Fallback to original SELECT results
              finalResults[alias] = selectResults[alias]
            }
          }
        }
        evaluateWrappedAggregates(
          finalResults,
          aggregatedRow as Record<string, any>,
          wrappedAggExprs,
          fields,
        )
      } else {
        // No SELECT clause - just use the group keys
        for (let i = 0; i < groupByClause.length; i++) {
          finalResults[`__key_${i}`] = aggregatedRow[fields.groupValues[i]!]
        }
      }

      // Generate a simple key for the live collection using group values.
      // In includes mode, add the complete route so correlated groups do not
      // collide.
      const route = mainSource
        ? getGroupRoute(aggregatedRow, fields)
        : undefined
      const correlationKey = route?.correlationKey
      const correlationRoute = mainSource
        ? getCorrelationRouteIdentity(aggregatedRow, fields)
        : undefined
      const keyParts: Array<unknown> = []
      const publicKeyParts: Array<unknown> = []
      for (let i = 0; i < groupByClause.length; i++) {
        keyParts.push(aggregatedRow[fields.groupKeys[i]!])
        publicKeyParts.push(aggregatedRow[fields.groupValues[i]!])
      }
      if (correlationRoute !== undefined) {
        keyParts.push(correlationRoute)
      }
      const finalKey = singleGroup
        ? correlationRoute !== undefined
          ? `single_group_${serializeValue(correlationRoute)}`
          : `single_group`
        : keyParts.length === 1
          ? keyParts[0]
          : serializeValue(keyParts)
      const publicKey = singleGroup
        ? `single_group`
        : createPublicGroupKey(publicKeyParts)

      // When in includes mode, restore route metadata for output routing.
      const resultRow: Record<string, any> = {
        ...(aggregatedRow as Record<string, any>),
        $selected: finalResults,
      }
      const virtual = (aggregatedRow as Record<string, any>)[fields.virtual] as
        | RowVirtualMetadata
        | undefined
      resultRow.$synced = virtual?.synced ?? true
      resultRow.$origin = (
        virtual?.hasLocal ? `local` : `remote`
      ) satisfies VirtualOrigin
      resultRow.$key = publicKey
      resultRow.$collectionId = aggregateCollectionId ?? resultRow.$collectionId
      if (mainSource && correlationKey !== undefined) {
        attachPublicGroupKey(resultRow, publicKey)
        attachRouteMetadata(
          resultRow,
          correlationKey,
          route?.parentContext ?? null,
        )
      }
      return [mainSource ? finalKey : publicKey, resultRow] as [
        unknown,
        Record<string, any>,
      ]
    }),
  )

  // Apply HAVING clauses if present
  if (havingClauses && havingClauses.length > 0) {
    for (const havingClause of havingClauses) {
      const havingExpression = getHavingExpression(havingClause)
      const transformedHavingClause = replaceAggregatesByRefs(
        havingExpression,
        selectClause || {},
      )
      const compiledHaving = compileExpression(transformedHavingClause)

      pipeline = pipeline.pipe(
        filter(([, row]) => {
          const namespacedRow = getGroupEvaluationRow(row, fields)
          const result = compiledHaving(namespacedRow)
          // Preserve each path's coercion for unchecked nonboolean IR values.
          return singleGroup ? toBooleanPredicate(result) : result
        }),
      )
    }
  }

  // Apply functional HAVING clauses if present
  if (fnHavingClauses && fnHavingClauses.length > 0) {
    for (const fnHaving of fnHavingClauses) {
      pipeline = pipeline.pipe(
        filter(([, row]) => {
          const namespacedRow = getGroupEvaluationRow(row, fields)
          const callbackRow = sanitizeCallbackRows
            ? stripInternalCallbackMetadata(namespacedRow)
            : namespacedRow
          return toBooleanPredicate(fnHaving(callbackRow))
        }),
      )
    }
  }

  return pipeline
}

/**
 * Helper function to check if two expressions are equal
 */
function expressionsEqual(expr1: any, expr2: any): boolean {
  if (!expr1 || !expr2) return false
  if (expr1.type !== expr2.type) return false

  switch (expr1.type) {
    case `ref`:
      // Compare paths as arrays
      if (!expr1.path || !expr2.path) return false
      if (expr1.path.length !== expr2.path.length) return false
      return expr1.path.every(
        (segment: string, i: number) => segment === expr2.path[i],
      )
    case `val`:
      return expr1.value === expr2.value
    case `func`:
      return (
        expr1.name === expr2.name &&
        expr1.args?.length === expr2.args?.length &&
        (expr1.args || []).every((arg: any, i: number) =>
          expressionsEqual(arg, expr2.args[i]),
        )
      )
    case `agg`:
      return (
        expr1.name === expr2.name &&
        expr1.args?.length === expr2.args?.length &&
        (expr1.args || []).every((arg: any, i: number) =>
          expressionsEqual(arg, expr2.args[i]),
        )
      )
    default:
      return false
  }
}

/**
 * Helper function to get an aggregate function based on the Agg expression
 */
function getAggregateFunction(aggExpr: Aggregate) {
  // Pre-compile the value extractor expression
  const compiledExpr = compileExpression(aggExpr.args[0]!)

  // Create a value extractor function for the expression to aggregate
  const valueExtractor = ([, namespacedRow]: [string, NamespacedRow]) => {
    const value = compiledExpr(namespacedRow)
    // Ensure we return a number for numeric aggregate functions
    if (typeof value === `number`) {
      return value
    }
    return value != null ? Number(value) : 0
  }

  // Create a value extractor function for min/max that preserves comparable types
  const valueExtractorForMinMax = ([, namespacedRow]: [
    string,
    NamespacedRow,
  ]) => {
    const value = compiledExpr(namespacedRow)
    // Preserve strings, numbers, Dates, and bigints for comparison
    if (
      typeof value === `number` ||
      typeof value === `string` ||
      typeof value === `bigint` ||
      value instanceof Date
    ) {
      return value
    }
    return value != null ? Number(value) : 0
  }

  // Create a raw value extractor function for the expression to aggregate
  const rawValueExtractor = ([, namespacedRow]: [string, NamespacedRow]) => {
    return compiledExpr(namespacedRow)
  }

  // Return the appropriate aggregate function
  switch (aggExpr.name.toLowerCase()) {
    case `sum`:
      return sum(valueExtractor)
    case `count`:
      return count(rawValueExtractor)
    case `avg`:
      return avg(valueExtractor)
    case `min`:
      return min(valueExtractorForMinMax)
    case `max`:
      return max(valueExtractorForMinMax)
    default:
      throw new UnsupportedAggregateFunctionError(aggExpr.name)
  }
}

/**
 * Transforms expressions to replace aggregate functions with references to computed values.
 *
 * For aggregate expressions, finds matching aggregates in the SELECT clause and replaces them
 * with PropRef([resultAlias, alias]) to reference the computed aggregate value.
 *
 * Ref expressions (table columns and $selected fields) and value expressions are passed through unchanged.
 * Function expressions are recursively transformed.
 *
 * @param havingExpr - The expression to transform (can be aggregate, ref, func, or val)
 * @param selectClause - The SELECT clause containing aliases and aggregate definitions
 * @param resultAlias - The namespace alias for SELECT results (default: '$selected')
 * @returns A transformed BasicExpression that references computed values instead of raw expressions
 */
export function replaceAggregatesByRefs(
  havingExpr: BasicExpression | Aggregate,
  selectClause: Select,
  resultAlias: string = `$selected`,
): BasicExpression {
  switch (havingExpr.type) {
    case `agg`: {
      const aggExpr = havingExpr
      // Find matching aggregate in SELECT clause
      for (const [alias, selectExpr] of Object.entries(selectClause)) {
        if (selectExpr.type === `agg` && aggregatesEqual(aggExpr, selectExpr)) {
          // Replace with a reference to the computed aggregate
          return new PropRef([resultAlias, alias])
        }
      }
      // If no matching aggregate found in SELECT, throw error
      throw new AggregateFunctionNotInSelectError(aggExpr.name)
    }

    case `func`: {
      const funcExpr = havingExpr
      // Transform function arguments recursively
      const transformedArgs = funcExpr.args.map(
        (arg: BasicExpression | Aggregate) =>
          replaceAggregatesByRefs(arg, selectClause),
      )
      return new Func(funcExpr.name, transformedArgs)
    }

    case `ref`:
      // Ref expressions are passed through unchanged - they reference either:
      // - $selected fields (which are already in the correct namespace)
      // - Table column references (which remain valid)
      return havingExpr as BasicExpression

    case `val`:
      // Return as-is
      return havingExpr as BasicExpression

    default:
      throw new UnknownHavingExpressionTypeError((havingExpr as any).type)
  }
}

/**
 * Evaluates wrapped-aggregate expressions against the aggregated row.
 * Copies synthetic __agg_N values into finalResults so the compiled wrapper
 * expressions can reference them, evaluates each wrapper, then removes the
 * synthetic keys so they don't leak onto user-visible result rows.
 */
function evaluateWrappedAggregates(
  finalResults: Record<string, any>,
  aggregatedRow: Record<string, any>,
  wrappedAggExprs: Record<string, (data: any) => any>,
  fields: InternalGroupFields,
): void {
  for (const key of Object.keys(aggregatedRow)) {
    if (key.startsWith(fields.aggregatePrefix)) {
      finalResults[key] = aggregatedRow[key]
    }
  }
  for (let i = 0; i < fields.groupKeyRefs.length; i++) {
    finalResults[fields.groupKeyRefs[i]!] =
      aggregatedRow[fields.groupValues[i]!]
  }
  for (const [alias, evaluator] of Object.entries(wrappedAggExprs)) {
    finalResults[alias] = evaluator(
      getGroupEvaluationRow(aggregatedRow, fields, finalResults),
    )
  }
  for (const key of Object.keys(finalResults)) {
    if (
      key.startsWith(fields.aggregatePrefix) ||
      fields.groupKeyRefs.includes(key)
    ) {
      delete finalResults[key]
    }
  }
}

/**
 * Checks whether an expression contains an aggregate anywhere in its tree.
 * Returns true for a top-level Aggregate, or a Func whose args (recursively)
 * contain an Aggregate. Safely returns false for nested Select objects.
 */
export function containsAggregate(
  expr: BasicExpression | Aggregate | Select | { type: string },
): boolean {
  if (isConditionalSelect(expr)) {
    const branchHasAggregate = expr.branches.some(
      (branch) =>
        containsAggregate(branch.condition) || containsAggregate(branch.value),
    )

    return (
      branchHasAggregate ||
      (expr.defaultValue !== undefined && containsAggregate(expr.defaultValue))
    )
  }

  if (isNestedSelectObject(expr)) {
    return Object.values(expr).some((value) =>
      containsAggregate(value as BasicExpression | Aggregate | Select),
    )
  }

  if (!isExpressionLike(expr)) {
    return false
  }

  if (expr.type === `agg`) {
    return true
  }
  if (expr.type === `func` && `args` in expr) {
    return (expr.args as Array<BasicExpression | Aggregate>).some(
      (arg: BasicExpression | Aggregate) => containsAggregate(arg),
    )
  }
  return false
}

/**
 * Walks an expression tree containing nested aggregates.
 * Each Aggregate node is extracted, assigned a synthetic alias (__agg_N),
 * and replaced with PropRef(["$selected", "__agg_N"]) so the wrapper
 * expression can be compiled as a pure BasicExpression after groupBy
 * populates the synthetic values.
 */
function extractAndReplaceAggregates(
  expr: SelectValueExpression,
  counter: { value: number },
  aggregatePrefix: string,
): {
  transformed: SelectValueExpression
  extracted: Record<string, Aggregate>
} {
  if (expr.type === `includesSubquery`) {
    return { transformed: expr, extracted: {} }
  }

  if (expr.type === `agg`) {
    const alias = `${aggregatePrefix}${counter.value++}`
    return {
      transformed: new PropRef([`$selected`, alias]),
      extracted: { [alias]: expr },
    }
  }

  if (expr.type === `func`) {
    const allExtracted: Record<string, Aggregate> = {}
    const newArgs = expr.args.map((arg: BasicExpression | Aggregate) => {
      const result = extractAndReplaceAggregates(arg, counter, aggregatePrefix)
      Object.assign(allExtracted, result.extracted)
      return result.transformed as BasicExpression
    })
    return {
      transformed: new Func(expr.name, newArgs),
      extracted: allExtracted,
    }
  }

  if (isConditionalSelect(expr)) {
    const allExtracted: Record<string, Aggregate> = {}
    const branches = expr.branches.map((branch) => {
      const condition = extractAndReplaceAggregates(
        branch.condition,
        counter,
        aggregatePrefix,
      )
      const value = extractAndReplaceAggregates(
        branch.value,
        counter,
        aggregatePrefix,
      )
      Object.assign(allExtracted, condition.extracted, value.extracted)
      return {
        condition: condition.transformed as BasicExpression,
        value: value.transformed,
      }
    })
    const defaultValue =
      expr.defaultValue === undefined
        ? undefined
        : extractAndReplaceAggregates(
            expr.defaultValue,
            counter,
            aggregatePrefix,
          )

    if (defaultValue) {
      Object.assign(allExtracted, defaultValue.extracted)
    }

    return {
      transformed: new ConditionalSelect(branches, defaultValue?.transformed),
      extracted: allExtracted,
    }
  }

  if (isNestedSelectObject(expr)) {
    const allExtracted: Record<string, Aggregate> = {}
    const transformed: Select = {}

    for (const [key, value] of Object.entries(expr)) {
      const result = extractAndReplaceAggregates(
        value as SelectValueExpression,
        counter,
        aggregatePrefix,
      )
      Object.assign(allExtracted, result.extracted)
      transformed[key] = result.transformed
    }

    return { transformed, extracted: allExtracted }
  }

  // ref / val – pass through unchanged
  return { transformed: expr, extracted: {} }
}

function replaceGroupByRefsInSelectValue(
  value: SelectValueExpression,
  groupByClause: GroupBy,
  groupKeyRefs: Array<string>,
): SelectValueExpression {
  if (isConditionalSelect(value)) {
    return new ConditionalSelect(
      value.branches.map((branch) => ({
        condition: replaceGroupByRefsInExpression(
          branch.condition,
          groupByClause,
          groupKeyRefs,
        ),
        value: replaceGroupByRefsInSelectValue(
          branch.value,
          groupByClause,
          groupKeyRefs,
        ),
      })),
      value.defaultValue === undefined
        ? undefined
        : replaceGroupByRefsInSelectValue(
            value.defaultValue,
            groupByClause,
            groupKeyRefs,
          ),
    )
  }

  if (isNestedSelectObject(value)) {
    const transformed: Select = {}
    for (const [key, entry] of Object.entries(value)) {
      transformed[key] = replaceGroupByRefsInSelectValue(
        entry as SelectValueExpression,
        groupByClause,
        groupKeyRefs,
      )
    }
    return transformed
  }

  if (!isExpressionLike(value)) {
    return value
  }

  if (value.type === `includesSubquery` || value.type === `agg`) {
    return value
  }

  return replaceGroupByRefsInExpression(value, groupByClause, groupKeyRefs)
}

function replaceGroupByRefsInExpression(
  expr: BasicExpression,
  groupByClause: GroupBy,
  groupKeyRefs: Array<string>,
): BasicExpression {
  if (expr.type === `ref`) {
    const groupIndex = groupByClause.findIndex((groupExpr) =>
      expressionsEqual(expr, groupExpr),
    )
    return groupIndex === -1
      ? expr
      : new PropRef([`$selected`, groupKeyRefs[groupIndex]!])
  }

  if (expr.type === `func`) {
    return new Func(
      expr.name,
      expr.args.map((arg) =>
        replaceGroupByRefsInExpression(arg, groupByClause, groupKeyRefs),
      ),
    )
  }

  return expr
}

function compileGroupedSelectValue(
  value: SelectValueExpression,
): (row: NamespacedRow) => any {
  if (isConditionalSelect(value)) {
    return compileGroupedConditionalSelect(value)
  }

  if (value.type === `includesSubquery`) {
    return () => null
  }

  if (isNestedSelectObject(value)) {
    return compileGroupedSelectObject(value)
  }

  if (!isExpressionLike(value)) {
    return () => value
  }

  return compileExpression(value as BasicExpression)
}

function compileGroupedSelectObject(
  obj: Select,
): (row: NamespacedRow) => Record<string, any> {
  const entries = Object.entries(obj).map(([key, value]) => {
    if (key.startsWith(`__SPREAD_SENTINEL__`)) {
      const rest = key.slice(`__SPREAD_SENTINEL__`.length)
      const splitIndex = rest.lastIndexOf(`__`)
      const pathStr = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      const isRefExpr =
        typeof value === `object` && `type` in value && value.type === `ref`
      const expression = isRefExpr
        ? (value as BasicExpression)
        : (new PropRef(pathStr.split(`.`)) as BasicExpression)

      return {
        key,
        spread: true,
        value: compileExpression(expression),
      }
    }

    return {
      key,
      spread: false,
      value: compileGroupedSelectValue(value as SelectValueExpression),
    }
  })

  return (row) => {
    const result: Record<string, any> = {}
    for (const entry of entries) {
      const value = entry.value(row)
      if (entry.spread) {
        if (value && typeof value === `object`) {
          Object.assign(result, value)
        }
      } else {
        result[entry.key] = value
      }
    }
    return result
  }
}

function compileGroupedConditionalSelect(
  conditional: ConditionalSelect,
): (row: NamespacedRow) => any {
  const branches = conditional.branches.map((branch) => ({
    condition: compileExpression(branch.condition),
    value: compileGroupedSelectValue(branch.value),
  }))
  const defaultValue =
    conditional.defaultValue === undefined
      ? undefined
      : compileGroupedSelectValue(conditional.defaultValue)

  return (row) => {
    for (const branch of branches) {
      if (isCaseWhenConditionTrue(branch.condition(row))) {
        return branch.value(row)
      }
    }

    return defaultValue !== undefined ? defaultValue(row) : null
  }
}

function isNestedSelectObject(value: unknown): value is Select {
  return (
    value != null &&
    typeof value === `object` &&
    !Array.isArray(value) &&
    !(value as any).__refProxy &&
    !isExpressionLike(value)
  )
}

function isConditionalSelect(value: unknown): value is ConditionalSelect {
  return (
    value instanceof ConditionalSelect ||
    (value != null &&
      typeof value === `object` &&
      (value as { type?: string }).type === `conditionalSelect`)
  )
}

/**
 * Checks if two aggregate expressions are equal
 */
function aggregatesEqual(agg1: Aggregate, agg2: Aggregate): boolean {
  return (
    agg1.name === agg2.name &&
    agg1.args.length === agg2.args.length &&
    agg1.args.every((arg, i) => expressionsEqual(arg, agg2.args[i]))
  )
}
