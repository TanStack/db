import { IR } from '@tanstack/db'

// The expression shape the PostgREST filter renderer understands. TanStack DB's
// `IR.BasicExpression` is structurally assignable to it, so `loadSubset` where
// clauses can be rendered without converting them first.
export type SerializedExpression =
  | { type: `ref`; path: Array<string> }
  | { type: `val`; value: unknown }
  | { type: `func`; name: string; args: Array<SerializedExpression> }
  | { type: `agg`; name: string; args: Array<SerializedExpression> }
  | SerializedIncludesSubquery
  | SerializedConditionalSelect

export interface SerializedConditionalSelect {
  branches: Array<{
    condition: SerializedExpression
    value: SerializedExpression | SerializedSelect
  }>
  defaultValue?: SerializedExpression | SerializedSelect
  type: `conditionalSelect`
}

export interface SerializedIncludesSubquery {
  childCorrelationField: SerializedExpression
  correlationField: SerializedExpression
  fieldName: string
  materialization: string
  parentFilters?: Array<SerializedWhere>
  parentProjection?: Array<SerializedExpression>
  query: SerializedQueryIR
  scalarField?: string
  type: `includesSubquery`
}

export type SerializedFrom =
  | { type: `table`; name: string; alias: string }
  | { type: `subquery`; query: SerializedQueryIR; alias: string }
  | { type: `union`; sources: Array<SerializedFrom>; alias: string }
  | { type: `unionAll`; queries: Array<SerializedQueryIR>; alias: string }

export type SerializedWhere =
  | SerializedExpression
  | { expression: SerializedExpression; residual?: boolean }

export interface SerializedOrderByClause {
  direction: string
  expression: SerializedExpression
  locale?: string
  localeOptions?: object
  nulls: string
  stringSort?: string
}

export interface SerializedJoinClause {
  from: SerializedFrom
  on: SerializedExpression
  type: string
}

export type SerializedSelect = {
  [alias: string]: SerializedExpression | SerializedSelect
}

export interface SerializedQueryIR {
  distinct?: true
  from: SerializedFrom
  groupBy?: Array<SerializedExpression>
  having?: Array<SerializedWhere>
  join?: Array<SerializedJoinClause>
  limit?: number
  offset?: number
  orderBy?: Array<SerializedOrderByClause>
  select?: SerializedSelect
  singleResult?: true
  where?: Array<SerializedWhere>
}

// ── Serialization functions ─────────────────────────────────────────

export function serializeQueryIR(query: IR.QueryIR): SerializedQueryIR {
  const result: SerializedQueryIR = {
    from: serializeFrom(query.from),
  }

  if (query.select) {
    result.select = serializeSelect(query.select)
  }

  if (query.join?.length) {
    result.join = query.join.map(serializeJoinClause)
  }

  if (query.where?.length) {
    result.where = query.where.map(serializeWhere)
  }

  if (query.groupBy?.length) {
    result.groupBy = query.groupBy.map(serializeExpression)
  }

  if (query.having?.length) {
    result.having = query.having.map(serializeWhere)
  }

  if (query.orderBy?.length) {
    result.orderBy = query.orderBy.map(serializeOrderByClause)
  }

  if (query.limit !== undefined) {
    result.limit = query.limit
  }

  if (query.offset !== undefined) {
    result.offset = query.offset
  }

  if (query.distinct) {
    result.distinct = true
  }

  if (query.singleResult) {
    result.singleResult = true
  }

  return result
}

function serializeFrom(from: IR.From): SerializedFrom {
  switch (from.type) {
    case `collectionRef`:
      return {
        type: `table`,
        name: from.collection.id,
        alias: from.alias,
      }
    case `descriptorRef`:
      // An unbound descriptor names its table by the descriptor's id.
      return {
        type: `table`,
        name: from.descriptor.id,
        alias: from.alias,
      }
    case `queryRef`:
      return {
        type: `subquery`,
        query: serializeQueryIR(from.query),
        alias: from.alias,
      }
    case `unionFrom`:
      return {
        type: `union`,
        sources: from.sources.map(serializeFrom),
        alias: from.alias,
      }
    case `unionAll`:
      return {
        type: `unionAll`,
        queries: from.queries.map(serializeQueryIR),
        alias: from.alias,
      }
    default:
      throw new Error(`Unknown from type: ${(from as { type: string }).type}`)
  }
}

function serializeExpression(
  expr: IR.BasicExpression | IR.Aggregate | IR.IncludesSubquery,
): SerializedExpression {
  switch (expr.type) {
    case `ref`:
      return { type: `ref`, path: [...(expr).path] }
    case `val`:
      return { type: `val`, value: serializeValue((expr).value) }
    case `func`:
      return {
        type: `func`,
        name: (expr).name,
        args: (expr).args.map(serializeExpression),
      }
    case `agg`:
      return {
        type: `agg`,
        name: (expr).name,
        args: (expr).args.map(serializeExpression),
      }
    case `includesSubquery`:
      return serializeIncludesSubquery(expr)
    default:
      throw new Error(`Unknown expression type: ${(expr as any).type}`)
  }
}

function serializeIncludesSubquery(
  expr: IR.IncludesSubquery,
): SerializedIncludesSubquery {
  const result: SerializedIncludesSubquery = {
    type: `includesSubquery`,
    query: serializeQueryIR(expr.query),
    correlationField: serializeExpression(expr.correlationField),
    childCorrelationField: serializeExpression(expr.childCorrelationField),
    fieldName: expr.fieldName,
    materialization: expr.materialization,
  }

  if (expr.parentFilters?.length) {
    result.parentFilters = expr.parentFilters.map(serializeWhere)
  }

  if (expr.parentProjection?.length) {
    result.parentProjection = expr.parentProjection.map(serializeExpression)
  }

  if (expr.scalarField !== undefined) {
    result.scalarField = expr.scalarField
  }

  return result
}

function serializeWhere(where: IR.Where): SerializedWhere {
  if (typeof where === `object` && `expression` in where) {
    const result: { expression: SerializedExpression; residual?: boolean } = {
      expression: serializeExpression(where.expression),
    }
    if (where.residual) {
      result.residual = true
    }
    return result
  }
  return serializeExpression(where)
}

/** A `...row` spread leaves an uncompiled ref proxy in the select IR */
function isRefProxy(value: unknown): value is { __path: Array<string> } {
  return (
    typeof value === `object` &&
    value !== null &&
    (value as { __refProxy?: boolean }).__refProxy === true
  )
}

function serializeSelect(select: IR.Select): SerializedSelect {
  const result: SerializedSelect = {}
  for (const [alias, value] of Object.entries(select)) {
    result[alias] = serializeSelectValue(value)
  }
  return result
}

function serializeSelectValue(
  value: IR.SelectValueExpression,
): SerializedExpression | SerializedSelect {
  // A spread (`...row`) is keyed by a `__SPREAD_SENTINEL__` alias and its
  // value is a raw ref proxy rather than a compiled expression. Recursing
  // into it would access proxy props endlessly, so serialize it as a plain
  // ref and let consumers decide how to handle it (PostgREST falls back to
  // `select=*`).
  if (isRefProxy(value)) {
    return { type: `ref`, path: [...value.__path] }
  }
  if (value instanceof IR.ConditionalSelect) {
    const result: SerializedConditionalSelect = {
      type: `conditionalSelect`,
      branches: value.branches.map((branch) => ({
        condition: serializeExpression(branch.condition),
        value: serializeSelectValue(branch.value),
      })),
    }
    if (value.defaultValue !== undefined) {
      result.defaultValue = serializeSelectValue(value.defaultValue)
    }
    return result
  }
  if (
    IR.isBasicOrAggregateExpression(value) ||
    value instanceof IR.IncludesSubquery
  ) {
    return serializeExpression(value)
  }
  // Nested Select object
  return serializeSelect(value)
}

function serializeJoinClause(clause: IR.JoinClause): SerializedJoinClause {
  return {
    from: serializeFrom(clause.from),
    type: clause.type,
    on: serializeExpression(clause.on),
  }
}

function serializeOrderByClause(
  clause: IR.OrderByClause,
): SerializedOrderByClause {
  const result: SerializedOrderByClause = {
    expression: serializeExpression(clause.expression),
    direction: clause.compareOptions.direction,
    nulls: clause.compareOptions.nulls,
  }

  if (clause.compareOptions.stringSort) {
    result.stringSort = clause.compareOptions.stringSort
  }

  if (
    clause.compareOptions.stringSort === `locale` &&
    `locale` in clause.compareOptions
  ) {
    result.locale = clause.compareOptions.locale
    result.localeOptions = clause.compareOptions.localeOptions
  }

  return result
}

function serializeValue(value: unknown): unknown {
  if (value === undefined) {
    return { __type: `undefined` }
  }

  if (typeof value === `number`) {
    if (Number.isNaN(value)) {
      return { __type: `nan` }
    }
    if (value === Number.POSITIVE_INFINITY) {
      return { __type: `infinity`, sign: 1 }
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return { __type: `infinity`, sign: -1 }
    }
  }

  if (
    value === null ||
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `boolean`
  ) {
    return value
  }

  if (value instanceof Date) {
    return { __type: `date`, value: value.toJSON() }
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item))
  }

  if (typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        serializeValue(val),
      ]),
    )
  }

  return value
}
