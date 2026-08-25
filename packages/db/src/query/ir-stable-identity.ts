import { normalizeValue } from '../utils/comparison.js'
import { isRefProxy, toExpression } from './builder/ref-proxy.js'
import { getQueryIR } from './builder/index.js'
import { getRuntimeReferenceIdentity } from './runtime-reference-identity.js'
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
import type { LoadSubsetOptions } from '../types.js'

type StableIdentityValue =
  | null
  | boolean
  | number
  | string
  | Array<StableIdentityValue>
  | { [key: string]: StableIdentityValue }

type ValueIdentityContext =
  | `exact-output`
  | `equality-operand`
  | `ordering-operand`

type AliasScope = {
  bindings: ReadonlyMap<string, number>
  hasUnqualifiedOutput: boolean
  parent: AliasScope | undefined
}

declare const queryIdentityBrand: unique symbol
declare const demandKeyBrand: unique symbol

/** Semantic identity for a query plan, independent of its runtime owners. */
export type QueryIdentity = string & {
  readonly [queryIdentityBrand]: true
}

/** Exact identity for one loadSubset demand, including its requested window. */
export type DemandKey = string & {
  readonly [demandKeyBrand]: true
}

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
  return getQueryIdentity(query)
}

export function getStableQueryBuilderHash(
  query: InitialQueryBuilder | QueryBuilder<any>,
): string {
  return getStableQueryIRHash(getQueryIR(query))
}

export function getStableValueHash(value: unknown, path = `value`): string {
  return JSON.stringify(canonicalizeRuntimeValue(value, path, new WeakSet()))
}

/**
 * Returns the semantic identity of a structured query.
 *
 * Logical conjunctions and disjunctions are associative, commutative, and
 * idempotent. Equality operands are commutative, while reversed inequalities
 * are normalized by inverting their operator. Order-sensitive clauses and
 * function arguments retain their original order.
 */
export function getQueryIdentity(query: QueryIR): QueryIdentity {
  return JSON.stringify(canonicalizeQueryIR(query)) as QueryIdentity
}

/** Returns the semantic identity of one structured expression. */
export function getStableExpressionHash(expression: BasicExpression): string {
  return JSON.stringify(
    canonicalizeExpression(
      expression,
      `expression`,
      new WeakSet(),
      `exact-output`,
    ),
  )
}

/**
 * Returns the exact semantic identity of a loadSubset request.
 *
 * Abort signals and subscriptions are owners of a request, not part of the
 * requested data, and therefore do not affect the key. A demand generation
 * scopes one asynchronous attempt rather than the data it requests. Code that
 * rejects stale work compares this key alongside its generation; query-db uses
 * the key alone so equivalent data demands can reuse one cache entry across
 * generations.
 */
export function getLoadSubsetDemandKey(
  options: LoadSubsetOptions,
): DemandKey | undefined {
  if (
    options.where === undefined &&
    !options.orderBy?.length &&
    options.limit === undefined &&
    (options.offset === undefined || options.offset === 0) &&
    options.cursor === undefined
  ) {
    // Query-db uses its base query key for the one unconstrained demand. An
    // owner-only option must not create another cache entry for the same data.
    return undefined
  }

  const seen = new WeakSet<object>()
  const result: Record<string, StableIdentityValue> = {
    type: `loadSubsetDemand`,
    query: canonicalizeLoadSubsetQuery(options, `loadSubset`, seen),
  }

  if (options.limit !== undefined) {
    result.limit = canonicalizeRuntimeValue(
      options.limit,
      `loadSubset.limit`,
      seen,
    )
  }

  if (options.offset !== undefined && options.offset !== 0) {
    result.offset = canonicalizeRuntimeValue(
      options.offset,
      `loadSubset.offset`,
      seen,
    )
  }

  if (options.cursor !== undefined) {
    const cursor: Record<string, StableIdentityValue> = {
      whereFrom: canonicalizeExpression(
        options.cursor.whereFrom,
        `loadSubset.cursor.whereFrom`,
        seen,
        `exact-output`,
      ),
      whereCurrent: canonicalizeExpression(
        options.cursor.whereCurrent,
        `loadSubset.cursor.whereCurrent`,
        seen,
        `exact-output`,
      ),
    }
    if (options.cursor.lastKey !== undefined) {
      cursor.lastKey = canonicalizeRuntimeValue(
        options.cursor.lastKey,
        `loadSubset.cursor.lastKey`,
        seen,
      )
    }
    result.cursor = cursor
  }

  return JSON.stringify(result) as DemandKey
}

export function canonicalizeQueryIR(query: QueryIR): StableIdentityValue {
  return canonicalizeQuery(query, `query`, new WeakSet<object>())
}

function createAliasScope(
  query: QueryIR,
  parent: AliasScope | undefined,
): AliasScope {
  const bindings = new Map<string, number>()

  const bindSource = (source: From): void => {
    if (source.type === `unionFrom`) {
      source.sources.forEach(bindSource)
      return
    }
    if (source.type === `unionAll`) return
    if (!bindings.has(source.alias)) {
      bindings.set(source.alias, bindings.size)
    }
  }

  bindSource(query.from)
  query.join?.forEach(({ from }) => bindSource(from))
  return {
    bindings,
    hasUnqualifiedOutput: query.from.type === `unionAll`,
    parent,
  }
}

function resolveAliasBinding(
  scope: AliasScope | undefined,
  alias: string,
): readonly [number, number] | undefined {
  let current = scope
  let parentDistance = 0
  while (current) {
    const binding = current.bindings.get(alias)
    if (binding !== undefined) return [parentDistance, binding]
    // A result-level union has no source alias. Every downstream ref starts at
    // an output field, including nested paths such as profile.id, so it must
    // not fall through and bind that field name to an enclosing query alias.
    if (current.hasUnqualifiedOutput) return undefined
    current = current.parent
    parentDistance++
  }
  return undefined
}

function canonicalizeQuery(
  query: QueryIR,
  path: string,
  seen: WeakSet<object>,
  parentScope?: AliasScope,
): StableIdentityValue {
  return canonicalizeQueryInScope(
    query,
    path,
    seen,
    createAliasScope(query, parentScope),
  )
}

function canonicalizeQueryInScope(
  query: QueryIR,
  path: string,
  seen: WeakSet<object>,
  scope: AliasScope,
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
    from: canonicalizeSource(query.from, `${path}.from`, seen, scope),
  }

  if (query.select) {
    result.select = canonicalizeSelect(
      query.select,
      `${path}.select`,
      seen,
      scope,
    )
  }

  if (
    !query.select &&
    (Boolean(query.join?.length) || Boolean(query.groupBy?.length))
  ) {
    // Without an explicit projection, these query shapes return a namespaced
    // row. Its alias keys are public output and therefore part of identity.
    result.implicitOutput = {
      type: `namespaced`,
      aliases: Array.from(scope.bindings.keys()),
    }
  }

  if (query.join) {
    result.join = query.join.map((join, index) =>
      canonicalizeJoin(join, `${path}.join[${index}]`, seen, scope),
    )
  }

  if (query.where) {
    result.where = canonicalizeImplicitConjunction(
      query.where,
      `${path}.where`,
      seen,
      scope,
    )
  }

  if (query.groupBy) {
    result.groupBy = query.groupBy.map((expression, index) =>
      canonicalizeExpression(
        expression,
        `${path}.groupBy[${index}]`,
        seen,
        `exact-output`,
        scope,
      ),
    )
  }

  if (query.having) {
    result.having = canonicalizeImplicitConjunction(
      query.having,
      `${path}.having`,
      seen,
      scope,
    )
  }

  if (query.orderBy) {
    result.orderBy = query.orderBy.map((orderBy, index) =>
      canonicalizeOrderBy(
        orderBy,
        `${path}.orderBy[${index}]`,
        seen,
        `ordering-operand`,
        scope,
      ),
    )
  }

  if (query.limit !== undefined) {
    result.limit = canonicalizeRuntimeValue(query.limit, `${path}.limit`, seen)
  }

  if (query.offset !== undefined && query.offset !== 0) {
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

function canonicalizeImplicitConjunction(
  clauses: ReadonlyArray<Where | Having>,
  path: string,
  seen: WeakSet<object>,
  scope: AliasScope,
): Array<StableIdentityValue> {
  const canonical = clauses.map((clause, index) =>
    canonicalizeWhere(clause, `${path}[${index}]`, seen, scope),
  )
  canonical.sort(compareStableIdentityValues)

  return canonical.filter(
    (clause, index) =>
      index === 0 ||
      compareStableIdentityValues(clause, canonical[index - 1]!) !== 0,
  )
}

function canonicalizeLoadSubsetQuery(
  options: LoadSubsetOptions,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  const result: Record<string, StableIdentityValue> = {
    type: `loadSubsetQuery`,
  }

  if (options.where !== undefined) {
    result.where = canonicalizeExpression(
      options.where,
      `${path}.where`,
      seen,
      `exact-output`,
    )
  }

  if (options.orderBy?.length) {
    result.orderBy = options.orderBy.map((orderBy, index) =>
      canonicalizeOrderBy(
        orderBy,
        `${path}.orderBy[${index}]`,
        seen,
        `ordering-operand`,
      ),
    )
  }

  return result
}

function canonicalizeJoin(
  join: JoinClause,
  path: string,
  seen: WeakSet<object>,
  scope: AliasScope,
): StableIdentityValue {
  return {
    type: join.type,
    from: canonicalizeSource(join.from, `${path}.from`, seen, scope),
    left: canonicalizeExpression(
      join.left,
      `${path}.left`,
      seen,
      `equality-operand`,
      scope,
    ),
    right: canonicalizeExpression(
      join.right,
      `${path}.right`,
      seen,
      `equality-operand`,
      scope,
    ),
  }
}

function canonicalizeSource(
  source: From,
  path: string,
  seen: WeakSet<object>,
  scope: AliasScope,
): StableIdentityValue {
  if (source.type === `collectionRef`) {
    return {
      type: `collectionRef`,
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
      sources: source.sources.map((unionSource, index) =>
        canonicalizeSource(
          unionSource,
          `${path}.sources[${index}]`,
          seen,
          scope,
        ),
      ),
    }
  }

  if (source.type === `unionAll`) {
    return {
      type: `unionAll`,
      queries: source.queries.map((query, index) =>
        // Branches are peers that may capture the union query's outer scope;
        // they are not children of the union result row itself.
        canonicalizeQuery(
          query,
          `${path}.queries[${index}]`,
          seen,
          scope.parent,
        ),
      ),
    }
  }

  return {
    type: `queryRef`,
    query: canonicalizeQuery(source.query, `${path}.query`, seen, scope),
  }
}

function canonicalizeSelect(
  select: Select,
  path: string,
  seen: WeakSet<object>,
  scope?: AliasScope,
): StableIdentityValue {
  return {
    type: `select`,
    fields: Object.keys(select)
      .sort()
      .map((key) => [
        key,
        canonicalizeSelectValue(select[key]!, `${path}.${key}`, seen, scope),
      ]),
  }
}

function canonicalizeSelectValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  scope?: AliasScope,
): StableIdentityValue {
  if (isRefProxy(value)) {
    return canonicalizeExpression(
      toExpression(value),
      path,
      seen,
      `exact-output`,
      scope,
    )
  }

  if (isExpression(value)) {
    return canonicalizeExpression(value, path, seen, `exact-output`, scope)
  }

  if (isPlainObject(value)) {
    return canonicalizeSelect(value as Select, path, seen, scope)
  }

  return canonicalizeExactOutputRuntimeValue(value, path, seen)
}

function canonicalizeWhere(
  where: Where | Having,
  path: string,
  seen: WeakSet<object>,
  scope?: AliasScope,
): StableIdentityValue {
  if (isWhereObject(where)) {
    const result: Record<string, StableIdentityValue> = {
      type: `where`,
      expression: canonicalizeExpression(
        where.expression,
        `${path}.expression`,
        seen,
        `exact-output`,
        scope,
      ),
    }

    if (where.residual === true) {
      result.residual = true
    }

    return result
  }

  return canonicalizeExpression(where, path, seen, `exact-output`, scope)
}

function canonicalizeOrderBy(
  orderBy: OrderByClause,
  path: string,
  seen: WeakSet<object>,
  valueContext: ValueIdentityContext = `exact-output`,
  scope?: AliasScope,
): StableIdentityValue {
  return {
    expression: canonicalizeExpression(
      orderBy.expression,
      `${path}.expression`,
      seen,
      valueContext,
      scope,
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
  valueContext: ValueIdentityContext = `exact-output`,
  scope?: AliasScope,
): StableIdentityValue {
  if (expression.type === `ref`) {
    const binding = resolveAliasBinding(scope, expression.path[0] ?? ``)
    return {
      type: `ref`,
      path:
        binding === undefined
          ? expression.path.map((segment, index) =>
              canonicalizeRuntimeValue(segment, `${path}.path[${index}]`, seen),
            )
          : [
              [`binding`, ...binding],
              ...expression.path
                .slice(1)
                .map((segment, index) =>
                  canonicalizeRuntimeValue(
                    segment,
                    `${path}.path[${index + 1}]`,
                    seen,
                  ),
                ),
            ],
    }
  }

  if (expression.type === `val`) {
    return {
      type: `val`,
      value:
        valueContext === `equality-operand`
          ? canonicalizeEqualityRuntimeValue(
              expression.value,
              `${path}.value`,
              seen,
              scope,
            )
          : valueContext === `ordering-operand`
            ? canonicalizeOrderingRuntimeValue(
                expression.value,
                `${path}.value`,
                seen,
              )
            : canonicalizeExactOutputRuntimeValue(
                expression.value,
                `${path}.value`,
                seen,
              ),
    }
  }

  if (expression.type === `func`) {
    if (
      expression.name === `in` &&
      expression.args.length === 2 &&
      expression.args[1]?.type === `val` &&
      Array.isArray(expression.args[1].value)
    ) {
      const candidates = expression.args[1].value.map((value, index) =>
        canonicalizeEqualityRuntimeValue(
          value,
          `${path}.args[1].value[${index}]`,
          seen,
          scope,
        ),
      )
      return canonicalizeFunction(expression.name, [
        canonicalizeExpression(
          expression.args[0]!,
          `${path}.args[0]`,
          seen,
          `equality-operand`,
          scope,
        ),
        {
          type: `val`,
          // IN tests membership. Candidate order and duplicates do not change
          // its result, but each candidate keeps its own equality semantics.
          value: [`set`, sortUniqueStableIdentityValues(candidates)],
        },
      ])
    }

    const operandContext: ValueIdentityContext =
      expression.name === `eq`
        ? `equality-operand`
        : expression.name === `gt` ||
            expression.name === `gte` ||
            expression.name === `lt` ||
            expression.name === `lte`
          ? `ordering-operand`
          : `exact-output`
    const args = expression.args.map((arg, index) =>
      canonicalizeExpression(
        arg,
        `${path}.args[${index}]`,
        seen,
        operandContext,
        scope,
      ),
    )
    return canonicalizeFunction(expression.name, args)
  }

  if (expression.type === `agg`) {
    return {
      type: `agg`,
      name: expression.name,
      args: expression.args.map((arg, index) =>
        canonicalizeExpression(
          arg,
          `${path}.args[${index}]`,
          seen,
          `exact-output`,
          scope,
        ),
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
          `exact-output`,
          scope,
        ),
        value: canonicalizeSelectValue(
          branch.value,
          `${path}.branches[${index}].value`,
          seen,
          scope,
        ),
      })),
    }

    if (expression.defaultValue !== undefined) {
      result.defaultValue = canonicalizeSelectValue(
        expression.defaultValue,
        `${path}.defaultValue`,
        seen,
        scope,
      )
    }

    return result
  }

  const childScope = createAliasScope(expression.query, scope)
  const result: Record<string, StableIdentityValue> = {
    type: `includesSubquery`,
    query: canonicalizeQueryInScope(
      expression.query,
      `${path}.query`,
      seen,
      childScope,
    ),
    correlationField: canonicalizeExpression(
      expression.correlationField,
      `${path}.correlationField`,
      seen,
      `equality-operand`,
      scope,
    ),
    childCorrelationField: canonicalizeExpression(
      expression.childCorrelationField,
      `${path}.childCorrelationField`,
      seen,
      `equality-operand`,
      childScope,
    ),
    fieldName: expression.fieldName,
    materialization: expression.materialization,
  }

  if (expression.parentFilters) {
    result.parentFilters = expression.parentFilters.map((where, index) =>
      canonicalizeWhere(where, `${path}.parentFilters[${index}]`, seen, scope),
    )
  }

  if (expression.parentProjection) {
    result.parentProjection = expression.parentProjection.map(
      (projection, index) =>
        canonicalizeExpression(
          projection,
          `${path}.parentProjection[${index}]`,
          seen,
          `exact-output`,
          scope,
        ),
    )
  }

  if (expression.scalarField !== undefined) {
    result.scalarField = expression.scalarField
  }

  return result
}

function canonicalizeFunction(
  name: string,
  args: Array<StableIdentityValue>,
): StableIdentityValue {
  if ((name === `and` || name === `or`) && args.length > 0) {
    const flattened = args.flatMap((arg) =>
      isCanonicalFunction(arg, name) ? arg.args : [arg],
    )
    const unique = sortUniqueStableIdentityValues(flattened)

    return unique.length === 1
      ? unique[0]!
      : { type: `func`, name, args: unique }
  }

  if (name === `eq` && args.length === 2) {
    args.sort(compareStableIdentityValues)
    return { type: `func`, name, args }
  }

  if (
    (name === `gt` || name === `gte` || name === `lt` || name === `lte`) &&
    args.length === 2 &&
    compareStableIdentityValues(args[0]!, args[1]!) > 0
  ) {
    return {
      type: `func`,
      name: invertComparison(name),
      args: [args[1]!, args[0]!],
    }
  }

  return { type: `func`, name, args }
}

function sortUniqueStableIdentityValues(
  values: Array<StableIdentityValue>,
): Array<StableIdentityValue> {
  values.sort(compareStableIdentityValues)
  return values.filter(
    (value, index) =>
      index === 0 ||
      compareStableIdentityValues(value, values[index - 1]!) !== 0,
  )
}

function isCanonicalFunction(
  value: StableIdentityValue,
  name: string,
): value is {
  type: string
  name: string
  args: Array<StableIdentityValue>
} {
  return (
    value !== null &&
    typeof value === `object` &&
    !Array.isArray(value) &&
    value.type === `func` &&
    value.name === name &&
    Array.isArray(value.args)
  )
}

function invertComparison(
  name: `gt` | `gte` | `lt` | `lte`,
): `gt` | `gte` | `lt` | `lte` {
  switch (name) {
    case `gt`:
      return `lt`
    case `gte`:
      return `lte`
    case `lt`:
      return `gt`
    case `lte`:
      return `gte`
  }
}

function canonicalizeRuntimeValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (value === null) return [`null`]

  if (typeof value === `string`) {
    return [`string`, value]
  }

  if (typeof value === `boolean`) {
    return [`boolean`, value]
  }

  if (typeof value === `number`) {
    if (Number.isNaN(value)) {
      return [`number`, `NaN`]
    }

    if (value === Infinity) {
      return [`number`, `Infinity`]
    }

    if (value === -Infinity) {
      return [`number`, `-Infinity`]
    }

    if (Object.is(value, -0)) {
      return [`number`, `-0`]
    }

    return [`number`, value]
  }

  if (typeof value === `undefined`) {
    return [`undefined`]
  }

  if (typeof value === `bigint`) {
    return [`bigint`, value.toString()]
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
    return withCircularGuard(value, path, seen, () => [
      `array`,
      value.map((item, index) =>
        canonicalizeRuntimeValue(item, `${path}[${index}]`, seen),
      ),
    ])
  }

  if (value instanceof Date) {
    const timestamp = value.getTime()
    if (Number.isNaN(timestamp)) {
      throw new UnhashableQueryIRError(path, `invalid Date`)
    }

    return [`Date`, value.toISOString()]
  }

  if (value instanceof ArrayBuffer) {
    return [`binary`, `ArrayBuffer`, Array.from(new Uint8Array(value))]
  }

  if (ArrayBuffer.isView(value)) {
    return [
      `binary`,
      value.constructor.name,
      Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    ]
  }

  if (value instanceof Map) {
    return withCircularGuard(value, path, seen, () => {
      const entries = Array.from(
        value.entries(),
        ([key, entryValue], index) => [
          canonicalizeRuntimeValue(key, `${path}.key[${index}]`, seen),
          canonicalizeRuntimeValue(entryValue, `${path}.value[${index}]`, seen),
        ],
      )
      entries.sort(compareStableIdentityValues)
      return [`Map`, entries]
    })
  }

  if (value instanceof Set) {
    return withCircularGuard(value, path, seen, () => {
      const entries = Array.from(value, (entry, index) =>
        canonicalizeRuntimeValue(entry, `${path}[${index}]`, seen),
      )
      entries.sort(compareStableIdentityValues)
      return [`Set`, entries]
    })
  }

  if (isPlainObject(value)) {
    return canonicalizeObject(value, path, seen)
  }

  throw new UnhashableQueryIRError(path, `non-plain object value`)
}

function canonicalizeExactOutputRuntimeValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (typeof value === `object` && value !== null) {
    return getRuntimeReferenceIdentity(value)
  }

  return canonicalizeRuntimeValue(value, path, seen)
}

function canonicalizeEqualityRuntimeValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  scope?: AliasScope,
): StableIdentityValue {
  if (isRefProxy(value)) {
    return canonicalizeExpression(
      toExpression(value),
      path,
      seen,
      `equality-operand`,
      scope,
    )
  }

  if (typeof value === `number` && Object.is(value, -0)) {
    return canonicalizeRuntimeValue(0, path, seen)
  }

  // Equality compares Uint8Array and Buffer values by content, independent of
  // their concrete constructor and size.
  const isUint8Array =
    (typeof Buffer !== `undefined` && value instanceof Buffer) ||
    value instanceof Uint8Array
  if (isUint8Array) {
    return [`binary`, `Uint8Array`, Array.from(value as Uint8Array)]
  }

  const normalized = normalizeValue(value)
  if (normalized !== value) {
    return canonicalizeRuntimeValue(normalized, path, seen)
  }

  if (typeof value === `object` && value !== null) {
    return getRuntimeReferenceIdentity(value)
  }

  return canonicalizeRuntimeValue(value, path, seen)
}

function canonicalizeOrderingRuntimeValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  if (typeof value === `number` && Object.is(value, -0)) {
    return canonicalizeRuntimeValue(0, path, seen)
  }

  if (value instanceof Date && Number.isNaN(value.getTime())) {
    return canonicalizeRuntimeValue(Number.NaN, path, seen)
  }

  const normalized = normalizeValue(value)
  if (normalized !== value && !(value instanceof Uint8Array)) {
    return canonicalizeRuntimeValue(normalized, path, seen)
  }

  try {
    return canonicalizeRuntimeValue(value, path, seen)
  } catch (error) {
    if (
      error instanceof UnhashableQueryIRError &&
      typeof value === `object` &&
      value !== null
    ) {
      return getRuntimeReferenceIdentity(value)
    }
    throw error
  }
}

function compareStableIdentityValues(
  left: StableIdentityValue,
  right: StableIdentityValue,
): number {
  const serializedLeft = JSON.stringify(left)
  const serializedRight = JSON.stringify(right)
  return serializedLeft < serializedRight
    ? -1
    : serializedLeft > serializedRight
      ? 1
      : 0
}

function canonicalizeObject(
  value: Record<string, unknown>,
  path: string,
  seen: WeakSet<object>,
): StableIdentityValue {
  return withCircularGuard(value, path, seen, () => [
    `object`,
    Object.keys(value)
      .sort()
      .map((key) => [
        key,
        canonicalizeRuntimeValue(value[key], `${path}.${key}`, seen),
      ]),
  ])
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
