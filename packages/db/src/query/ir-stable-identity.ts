import { isRefProxy, toExpression } from './builder/ref-proxy.js'
import { getQueryIR } from './builder/index.js'
import type {
  Aggregate,
  BasicExpression,
  ConditionalSelect,
  From,
  Having,
  IncludesSubquery,
  JoinClause,
  OrderByClause,
  QueryIR,
  Select,
  Where,
} from './ir.js'
import type { InitialQueryBuilder, QueryBuilder } from './builder/index.js'

type StableIdentityValue =
  | null
  | boolean
  | number
  | string
  | Array<StableIdentityValue>
  | { [key: string]: StableIdentityValue }

export class UnhashableQueryIRError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`Query IR is not stably hashable at ${path}: ${reason}`)
    this.name = `UnhashableQueryIRError`
  }
}

export function getStableQueryIRHash(query: QueryIR): string {
  return JSON.stringify(canonicalizeQueryIR(query))
}

export function getStableQueryBuilderHash(
  query: InitialQueryBuilder | QueryBuilder<any>,
): string {
  return getStableQueryIRHash(getQueryIR(query))
}

export function canonicalizeQueryIR(query: QueryIR): StableIdentityValue {
  return canonicalizeQuery(query, `query`, new WeakSet<object>())
}

function canonicalizeQuery(
  query: QueryIR,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (query.fnSelect) {
    throw new UnhashableQueryIRError(`${path}.fnSelect`, `function select`)
  }

  if (query.fnWhere?.length) {
    throw new UnhashableQueryIRError(`${path}.fnWhere`, `function where`)
  }

  if (query.fnHaving?.length) {
    throw new UnhashableQueryIRError(`${path}.fnHaving`, `function having`)
  }

  const result: Record<string, StableIdentityValue> = {
    type: `query`,
    from: canonicalizeSource(query.from, `${path}.from`, seen),
  }

  if (query.select) {
    result.select = canonicalizeSelect(query.select, `${path}.select`, seen)
  }

  if (query.join) {
    result.join = query.join.map((join, index) =>
      canonicalizeJoin(join, `${path}.join[${index}]`, seen),
    )
  }

  if (query.where) {
    result.where = query.where.map((where, index) =>
      canonicalizeWhere(where, `${path}.where[${index}]`, seen),
    )
  }

  if (query.groupBy) {
    result.groupBy = query.groupBy.map((expression, index) =>
      canonicalizeExpression(expression, `${path}.groupBy[${index}]`, seen),
    )
  }

  if (query.having) {
    result.having = query.having.map((having, index) =>
      canonicalizeWhere(having, `${path}.having[${index}]`, seen),
    )
  }

  if (query.orderBy) {
    result.orderBy = query.orderBy.map((orderBy, index) =>
      canonicalizeOrderBy(orderBy, `${path}.orderBy[${index}]`, seen),
    )
  }

  if (query.limit !== undefined) {
    result.limit = canonicalizeRuntimeValue(query.limit, `${path}.limit`, seen)
  }

  if (query.offset !== undefined) {
    result.offset = canonicalizeRuntimeValue(
      query.offset,
      `${path}.offset`,
      seen,
    )
  }

  if (query.distinct) {
    result.distinct = true
  }

  if (query.singleResult) {
    result.singleResult = true
  }

  return result
}

function canonicalizeJoin(
  join: JoinClause,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  return {
    type: join.type,
    from: canonicalizeSource(join.from, `${path}.from`, seen),
    left: canonicalizeExpression(join.left, `${path}.left`, seen),
    right: canonicalizeExpression(join.right, `${path}.right`, seen),
  }
}

function canonicalizeSource(
  source: From,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (source.type === `collectionRef`) {
    return {
      type: `collectionRef`,
      alias: source.alias,
      collectionId: canonicalizeRuntimeValue(
        source.collection.id,
        `${path}.collection.id`,
        seen,
      ),
    }
  }

  if (source.type === `unionFrom`) {
    return {
      type: `unionFrom`,
      sources: [...source.sources]
        .sort((a, b) => a.alias.localeCompare(b.alias))
        .map((unionSource, index) =>
          canonicalizeSource(unionSource, `${path}.sources[${index}]`, seen),
        ),
    }
  }

  if (source.type === `unionAll`) {
    return {
      type: `unionAll`,
      queries: source.queries.map((query, index) =>
        canonicalizeQuery(query, `${path}.queries[${index}]`, seen),
      ),
    }
  }

  return {
    type: `queryRef`,
    alias: source.alias,
    query: canonicalizeQuery(source.query, `${path}.query`, seen),
  }
}

function canonicalizeSelect(
  select: Select,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  const result: Record<string, StableIdentityValue> = {}

  for (const key of Object.keys(select).sort()) {
    result[key] = canonicalizeSelectValue(select[key]!, `${path}.${key}`, seen)
  }

  return result
}

function canonicalizeSelectValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (isRefProxy(value)) {
    return canonicalizeExpression(toExpression(value), path, seen)
  }

  if (isExpression(value)) {
    return canonicalizeExpression(value, path, seen)
  }

  if (isPlainObject(value)) {
    return canonicalizeSelect(value as Select, path, seen)
  }

  return canonicalizeRuntimeValue(value, path, seen)
}

function canonicalizeWhere(
  where: Where | Having,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (isWhereObject(where)) {
    const result: Record<string, StableIdentityValue> = {
      type: `where`,
      expression: canonicalizeExpression(
        where.expression,
        `${path}.expression`,
        seen,
      ),
    }

    if (where.residual === true) {
      result.residual = true
    }

    return result
  }

  return canonicalizeExpression(where, path, seen)
}

function canonicalizeOrderBy(
  orderBy: OrderByClause,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  return {
    expression: canonicalizeExpression(
      orderBy.expression,
      `${path}.expression`,
      seen,
    ),
    compareOptions: canonicalizeRuntimeValue(
      orderBy.compareOptions,
      `${path}.compareOptions`,
      seen,
    ),
  }
}

function canonicalizeExpression(
  expression:
    | BasicExpression
    | Aggregate
    | IncludesSubquery
    | ConditionalSelect,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (expression.type === `ref`) {
    return {
      type: `ref`,
      path: expression.path.map((segment, index) =>
        canonicalizeRuntimeValue(segment, `${path}.path[${index}]`, seen),
      ),
    }
  }

  if (expression.type === `val`) {
    return {
      type: `val`,
      value: canonicalizeRuntimeValue(expression.value, `${path}.value`, seen),
    }
  }

  if (expression.type === `func`) {
    return {
      type: `func`,
      name: expression.name,
      args: expression.args.map((arg, index) =>
        canonicalizeExpression(arg, `${path}.args[${index}]`, seen),
      ),
    }
  }

  if (expression.type === `agg`) {
    return {
      type: `agg`,
      name: expression.name,
      args: expression.args.map((arg, index) =>
        canonicalizeExpression(arg, `${path}.args[${index}]`, seen),
      ),
    }
  }

  if (expression.type === `conditionalSelect`) {
    const result: Record<string, StableIdentityValue> = {
      type: `conditionalSelect`,
      branches: expression.branches.map((branch, index) => ({
        condition: canonicalizeExpression(
          branch.condition,
          `${path}.branches[${index}].condition`,
          seen,
        ),
        value: canonicalizeSelectValue(
          branch.value,
          `${path}.branches[${index}].value`,
          seen,
        ),
      })),
    }

    if (expression.defaultValue !== undefined) {
      result.defaultValue = canonicalizeSelectValue(
        expression.defaultValue,
        `${path}.defaultValue`,
        seen,
      )
    }

    return result
  }

  const result: Record<string, StableIdentityValue> = {
    type: `includesSubquery`,
    query: canonicalizeQuery(expression.query, `${path}.query`, seen),
    correlationField: canonicalizeExpression(
      expression.correlationField,
      `${path}.correlationField`,
      seen,
    ),
    childCorrelationField: canonicalizeExpression(
      expression.childCorrelationField,
      `${path}.childCorrelationField`,
      seen,
    ),
    fieldName: expression.fieldName,
    materialization: expression.materialization,
  }

  if (expression.parentFilters) {
    result.parentFilters = expression.parentFilters.map((where, index) =>
      canonicalizeWhere(where, `${path}.parentFilters[${index}]`, seen),
    )
  }

  if (expression.parentProjection) {
    result.parentProjection = expression.parentProjection.map(
      (projection, index) =>
        canonicalizeExpression(
          projection,
          `${path}.parentProjection[${index}]`,
          seen,
        ),
    )
  }

  if (expression.scalarField !== undefined) {
    result.scalarField = expression.scalarField
  }

  return result
}

function canonicalizeRuntimeValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (value === null) return null

  if (typeof value === `string` || typeof value === `boolean`) {
    return value
  }

  if (typeof value === `number`) {
    if (Number.isNaN(value)) {
      return { type: `number`, value: `NaN` }
    }

    if (value === Infinity) {
      return { type: `number`, value: `Infinity` }
    }

    if (value === -Infinity) {
      return { type: `number`, value: `-Infinity` }
    }

    if (Object.is(value, -0)) {
      return { type: `number`, value: `-0` }
    }

    return value
  }

  if (typeof value === `undefined`) {
    return { type: `undefined` }
  }

  if (typeof value === `bigint`) {
    return { type: `bigint`, value: value.toString() }
  }

  if (typeof value === `function`) {
    throw new UnhashableQueryIRError(path, `function value`)
  }

  if (typeof value === `symbol`) {
    throw new UnhashableQueryIRError(path, `symbol value`)
  }

  if (isRefProxy(value)) {
    return canonicalizeExpression(toExpression(value), path, seen)
  }

  if (Array.isArray(value)) {
    return withCircularGuard(value, path, seen, () =>
      value.map((item, index) =>
        canonicalizeRuntimeValue(item, `${path}[${index}]`, seen),
      ),
    )
  }

  if (value instanceof Date) {
    const timestamp = value.getTime()
    if (Number.isNaN(timestamp)) {
      throw new UnhashableQueryIRError(path, `invalid Date`)
    }

    return { type: `Date`, value: value.toISOString() }
  }

  if (value instanceof ArrayBuffer) {
    return {
      type: `ArrayBuffer`,
      value: Array.from(new Uint8Array(value)),
    }
  }

  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor.name,
      value: Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    }
  }

  if (isPlainObject(value)) {
    return canonicalizeObject(value, path, seen)
  }

  throw new UnhashableQueryIRError(path, `non-plain object value`)
}

function canonicalizeObject(
  value: Record<string, unknown>,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  return withCircularGuard(value, path, seen, () => {
    const result: Record<string, StableIdentityValue> = {}

    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalizeRuntimeValue(value[key], `${path}.${key}`, seen)
    }

    return result
  })
}

function withCircularGuard<T>(
  value: object,
  path: string,
  seen: WeakSet<object>,
  callback: () => T,
): T {
  if (seen.has(value)) {
    throw new UnhashableQueryIRError(path, `circular value`)
  }

  seen.add(value)
  try {
    return callback()
  } finally {
    seen.delete(value)
  }
}

function isWhereObject(
  where: Where | Having,
): where is { expression: BasicExpression<boolean>; residual?: boolean } {
  return `expression` in where
}

function isExpression(
  value: unknown,
): value is BasicExpression | Aggregate | IncludesSubquery {
  if (value === null || typeof value !== `object`) {
    return false
  }

  const expressionType = (value as { type?: unknown }).type
  return (
    expressionType === `agg` ||
    expressionType === `conditionalSelect` ||
    expressionType === `func` ||
    expressionType === `ref` ||
    expressionType === `val` ||
    expressionType === `includesSubquery`
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== `object`) return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
