import {
  IR,
  compileSingleRowExpression,
  toBooleanPredicate,
} from '@tanstack/db'
import {
  InvalidPersistedCollectionConfigError,
  InvalidPersistedStorageKeyEncodingError,
} from './errors'
import {
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
} from './persisted'
import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  PersistedIndexSpec,
  PersistedTx,
  PersistenceAdapter,
  SQLiteDriver,
} from './persisted'

type SqliteSupportedValue = null | number | string

type CollectionTableMapping = {
  tableName: string
  tombstoneTableName: string
}

type CompiledSqlFragment = {
  supported: boolean
  sql: string
  params: Array<SqliteSupportedValue>
  valueKind?: CompiledValueKind
}

type StoredSqliteRow = {
  key: string
  value: string
  row_version: number
}

type SQLiteCoreAdapterSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type SQLiteCoreAdapterOptions = {
  driver: SQLiteDriver
  schemaVersion?: number
  schemaMismatchPolicy?: SQLiteCoreAdapterSchemaMismatchPolicy
  appliedTxPruneMaxRows?: number
  appliedTxPruneMaxAgeSeconds?: number
  pullSinceReloadThreshold?: number
}

export type SQLitePullSinceResult<TKey extends string | number> =
  | {
      latestRowVersion: number
      requiresFullReload: true
    }
  | {
      latestRowVersion: number
      requiresFullReload: false
      changedKeys: Array<TKey>
      deletedKeys: Array<TKey>
    }

const DEFAULT_SCHEMA_VERSION = 1
const DEFAULT_PULL_SINCE_RELOAD_THRESHOLD = 128
const SQLITE_MAX_IN_BATCH_SIZE = 900
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const FORBIDDEN_SQL_FRAGMENT_PATTERN = /(;|--|\/\*)/
const PERSISTED_TYPE_TAG = `__tanstack_db_persisted_type__`
const PERSISTED_VALUE_TAG = `value`

type CompiledValueKind = `unknown` | `bigint` | `date` | `datetime`
type PersistedTaggedValueType =
  | `bigint`
  | `date`
  | `nan`
  | `infinity`
  | `-infinity`
type PersistedTaggedValue = {
  [PERSISTED_TYPE_TAG]: PersistedTaggedValueType
  [PERSISTED_VALUE_TAG]: string
}

const persistedTaggedValueTypes = new Set<PersistedTaggedValueType>([
  `bigint`,
  `date`,
  `nan`,
  `infinity`,
  `-infinity`,
])

const orderByObjectIds = new WeakMap<object, number>()
let nextOrderByObjectId = 1

function quoteIdentifier(identifier: string): string {
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidPersistedCollectionConfigError(
      `Invalid SQLite identifier "${identifier}"`,
    )
  }
  return `"${identifier}"`
}

function isPersistedTaggedValue(value: unknown): value is PersistedTaggedValue {
  if (typeof value !== `object` || value === null) {
    return false
  }

  const taggedValue = value as {
    [PERSISTED_TYPE_TAG]?: unknown
    [PERSISTED_VALUE_TAG]?: unknown
  }
  if (
    typeof taggedValue[PERSISTED_TYPE_TAG] !== `string` ||
    typeof taggedValue[PERSISTED_VALUE_TAG] !== `string`
  ) {
    return false
  }

  return persistedTaggedValueTypes.has(
    taggedValue[PERSISTED_TYPE_TAG] as PersistedTaggedValueType,
  )
}

function encodePersistedJsonValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value
  }

  if (typeof value === `bigint`) {
    return {
      [PERSISTED_TYPE_TAG]: `bigint`,
      [PERSISTED_VALUE_TAG]: value.toString(),
    } satisfies PersistedTaggedValue
  }

  if (value instanceof Date) {
    return {
      [PERSISTED_TYPE_TAG]: `date`,
      [PERSISTED_VALUE_TAG]: value.toISOString(),
    } satisfies PersistedTaggedValue
  }

  if (typeof value === `number`) {
    if (Number.isNaN(value)) {
      return {
        [PERSISTED_TYPE_TAG]: `nan`,
        [PERSISTED_VALUE_TAG]: `NaN`,
      } satisfies PersistedTaggedValue
    }
    if (value === Number.POSITIVE_INFINITY) {
      return {
        [PERSISTED_TYPE_TAG]: `infinity`,
        [PERSISTED_VALUE_TAG]: `Infinity`,
      } satisfies PersistedTaggedValue
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return {
        [PERSISTED_TYPE_TAG]: `-infinity`,
        [PERSISTED_VALUE_TAG]: `-Infinity`,
      } satisfies PersistedTaggedValue
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => encodePersistedJsonValue(entry))
  }

  if (typeof value === `object`) {
    const encodedRecord: Record<string, unknown> = {}
    const recordValue = value as Record<string, unknown>
    for (const [key, entryValue] of Object.entries(recordValue)) {
      const encodedValue = encodePersistedJsonValue(entryValue)
      if (encodedValue !== undefined) {
        encodedRecord[key] = encodedValue
      }
    }
    return encodedRecord
  }

  return value
}

function decodePersistedJsonValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value
  }

  if (isPersistedTaggedValue(value)) {
    switch (value[PERSISTED_TYPE_TAG]) {
      case `bigint`:
        return BigInt(value[PERSISTED_VALUE_TAG])
      case `date`: {
        const parsedDate = new Date(value[PERSISTED_VALUE_TAG])
        return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
      }
      case `nan`:
        return Number.NaN
      case `infinity`:
        return Number.POSITIVE_INFINITY
      case `-infinity`:
        return Number.NEGATIVE_INFINITY
      default:
        return value
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => decodePersistedJsonValue(entry))
  }

  if (typeof value === `object`) {
    const decodedRecord: Record<string, unknown> = {}
    const recordValue = value as Record<string, unknown>
    for (const [key, entryValue] of Object.entries(recordValue)) {
      decodedRecord[key] = decodePersistedJsonValue(entryValue)
    }
    return decodedRecord
  }

  return value
}

function serializePersistedRowValue(value: unknown): string {
  return JSON.stringify(encodePersistedJsonValue(value))
}

function deserializePersistedRowValue<T>(value: string): T {
  const parsedJson = JSON.parse(value) as unknown
  return decodePersistedJsonValue(parsedJson) as T
}

function toSqliteParameterValue(value: unknown): SqliteSupportedValue {
  if (value == null) {
    return null
  }

  if (typeof value === `number`) {
    if (!Number.isFinite(value)) {
      return null
    }
    return value
  }

  if (typeof value === `bigint`) {
    return value.toString()
  }

  if (typeof value === `boolean`) {
    return value ? 1 : 0
  }

  if (typeof value === `string`) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return serializePersistedRowValue(value)
}

function toSqliteLiteral(value: SqliteSupportedValue): string {
  if (value === null) {
    return `NULL`
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? String(value) : `NULL`
  }

  return `'${value.replace(/'/g, `''`)}'`
}

function inlineSqlParams(
  sql: string,
  params: ReadonlyArray<SqliteSupportedValue>,
): string {
  let index = 0
  const inlinedSql = sql.replace(/\?/g, () => {
    const paramValue = params[index]
    index++
    return toSqliteLiteral(paramValue ?? null)
  })

  if (index !== params.length) {
    throw new InvalidPersistedCollectionConfigError(
      `Unable to inline SQL params; placeholder count did not match provided params`,
    )
  }

  return inlinedSql
}

type CompiledRowExpressionEvaluator = (row: Record<string, unknown>) => unknown

function collectAliasQualifiedRefSegments(
  expression: IR.BasicExpression,
  segments: Set<string> = new Set<string>(),
): Set<string> {
  if (expression.type === `ref`) {
    if (expression.path.length > 1) {
      const rootSegment = String(expression.path[0])
      if (rootSegment.length > 0) {
        segments.add(rootSegment)
      }
    }
    return segments
  }

  if (expression.type === `func`) {
    for (const arg of expression.args) {
      collectAliasQualifiedRefSegments(arg, segments)
    }
  }

  return segments
}

function createAliasAwareRowProxy(
  row: Record<string, unknown>,
  aliasSegments: ReadonlySet<string>,
): Record<string, unknown> {
  return new Proxy(row, {
    get(target, prop, receiver) {
      if (typeof prop !== `string`) {
        return Reflect.get(target, prop, receiver)
      }

      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        const value = Reflect.get(target, prop, receiver)
        if (value !== undefined || !aliasSegments.has(prop)) {
          return value
        }

        return target
      }

      if (aliasSegments.has(prop)) {
        return target
      }

      return undefined
    },
  })
}

function compileRowExpressionEvaluator(
  expression: IR.BasicExpression,
): CompiledRowExpressionEvaluator {
  let baseEvaluator: ReturnType<typeof compileSingleRowExpression>
  try {
    baseEvaluator = compileSingleRowExpression(expression)
  } catch (error) {
    throw new InvalidPersistedCollectionConfigError(
      `Unsupported expression for SQLite adapter fallback evaluator: ${(error as Error).message}`,
    )
  }

  const aliasSegments = collectAliasQualifiedRefSegments(expression)
  if (aliasSegments.size === 0) {
    return (row) => baseEvaluator(row)
  }

  const proxyCache = new WeakMap<
    Record<string, unknown>,
    Record<string, unknown>
  >()
  return (row) => {
    let proxy = proxyCache.get(row)
    if (!proxy) {
      proxy = createAliasAwareRowProxy(row, aliasSegments)
      proxyCache.set(row, proxy)
    }
    return baseEvaluator(proxy)
  }
}

function getOrderByObjectId(value: object): number {
  const existing = orderByObjectIds.get(value)
  if (existing !== undefined) {
    return existing
  }

  const nextId = nextOrderByObjectId
  nextOrderByObjectId++
  orderByObjectIds.set(value, nextId)
  return nextId
}

function compareOrderByValues(
  left: unknown,
  right: unknown,
  compareOptions: IR.OrderByClause[`compareOptions`],
): number {
  if (left == null && right == null) {
    return 0
  }
  if (left == null) {
    return compareOptions.nulls === `first` ? -1 : 1
  }
  if (right == null) {
    return compareOptions.nulls === `first` ? 1 : -1
  }

  if (typeof left === `string` && typeof right === `string`) {
    if (compareOptions.stringSort === `locale`) {
      return left.localeCompare(
        right,
        compareOptions.locale,
        compareOptions.localeOptions,
      )
    }
    if (left < right) {
      return -1
    }
    if (left > right) {
      return 1
    }
    return 0
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const maxIndex = Math.min(left.length, right.length)
    for (let index = 0; index < maxIndex; index++) {
      const comparison = compareOrderByValues(
        left[index],
        right[index],
        compareOptions,
      )
      if (comparison !== 0) {
        return comparison
      }
    }
    return left.length - right.length
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime()
  }

  const leftIsObject = typeof left === `object`
  const rightIsObject = typeof right === `object`
  if (leftIsObject || rightIsObject) {
    if (leftIsObject && rightIsObject) {
      return getOrderByObjectId(left) - getOrderByObjectId(right)
    }
    return leftIsObject ? 1 : -1
  }

  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

function createJsonPath(path: Array<string>): string | null {
  if (path.length === 0) {
    return null
  }

  let jsonPath = `$`
  for (const segment of path) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      jsonPath = `${jsonPath}.${segment}`
      continue
    }

    if (/^[0-9]+$/.test(segment)) {
      jsonPath = `${jsonPath}[${segment}]`
      continue
    }

    return null
  }

  return jsonPath
}

function getLiteralValueKind(value: unknown): CompiledValueKind {
  if (typeof value === `bigint`) {
    return `bigint`
  }
  if (value instanceof Date) {
    return `datetime`
  }
  return `unknown`
}

function getCompiledValueKind(
  fragment: CompiledSqlFragment,
): CompiledValueKind {
  return fragment.valueKind ?? `unknown`
}

function resolveComparisonValueKind(
  leftExpression: IR.BasicExpression,
  rightExpression: IR.BasicExpression,
  leftCompiled: CompiledSqlFragment,
  rightCompiled: CompiledSqlFragment,
): CompiledValueKind {
  const leftKind = getCompiledValueKind(leftCompiled)
  const rightKind = getCompiledValueKind(rightCompiled)

  const hasBigIntLiteral =
    (leftExpression.type === `val` &&
      typeof leftExpression.value === `bigint`) ||
    (rightExpression.type === `val` &&
      typeof rightExpression.value === `bigint`)
  if (hasBigIntLiteral || leftKind === `bigint` || rightKind === `bigint`) {
    return `bigint`
  }

  const hasDateLiteral =
    (leftExpression.type === `val` && leftExpression.value instanceof Date) ||
    (rightExpression.type === `val` && rightExpression.value instanceof Date)
  if (hasDateLiteral || leftKind === `datetime` || rightKind === `datetime`) {
    return `datetime`
  }

  if (leftKind === `date` || rightKind === `date`) {
    return `date`
  }

  return `unknown`
}

function compileComparisonSql(
  operator: `=` | `>` | `>=` | `<` | `<=`,
  leftSql: string,
  rightSql: string,
  valueKind: CompiledValueKind,
): string {
  if (valueKind === `bigint`) {
    return `(CAST(${leftSql} AS NUMERIC) ${operator} CAST(${rightSql} AS NUMERIC))`
  }
  if (valueKind === `date`) {
    return `(date(${leftSql}) ${operator} date(${rightSql}))`
  }
  if (valueKind === `datetime`) {
    return `(datetime(${leftSql}) ${operator} datetime(${rightSql}))`
  }
  return `(${leftSql} ${operator} ${rightSql})`
}

function compileRefExpressionSql(jsonPath: string): CompiledSqlFragment {
  const typePath = `${jsonPath}.${PERSISTED_TYPE_TAG}`
  const taggedValuePath = `${jsonPath}.${PERSISTED_VALUE_TAG}`

  return {
    supported: true,
    sql: `(CASE json_extract(value, ?)
      WHEN 'bigint' THEN CAST(json_extract(value, ?) AS NUMERIC)
      WHEN 'date' THEN json_extract(value, ?)
      WHEN 'nan' THEN NULL
      WHEN 'infinity' THEN NULL
      WHEN '-infinity' THEN NULL
      ELSE json_extract(value, ?)
    END)`,
    params: [typePath, taggedValuePath, taggedValuePath, jsonPath],
    valueKind: `unknown`,
  }
}

function sanitizeExpressionSqlFragment(fragment: string): string {
  if (
    fragment.trim().length === 0 ||
    FORBIDDEN_SQL_FRAGMENT_PATTERN.test(fragment)
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `Invalid persisted index SQL fragment: "${fragment}"`,
    )
  }

  return fragment
}

type InMemoryRow<TKey extends string | number, T extends object> = {
  key: TKey
  value: T
  rowVersion: number
}

function compileSqlExpression(
  expression: IR.BasicExpression,
): CompiledSqlFragment {
  if (expression.type === `val`) {
    const valueKind = getLiteralValueKind(expression.value)
    return {
      supported: true,
      sql: `?`,
      params: [toSqliteParameterValue(expression.value)],
      valueKind,
    }
  }

  if (expression.type === `ref`) {
    const jsonPath = createJsonPath(expression.path.map(String))
    if (!jsonPath) {
      return {
        supported: false,
        sql: ``,
        params: [],
      }
    }

    return compileRefExpressionSql(jsonPath)
  }

  const compiledArgs = expression.args.map((arg) => compileSqlExpression(arg))
  if (compiledArgs.some((arg) => !arg.supported)) {
    return {
      supported: false,
      sql: ``,
      params: [],
    }
  }

  const params = compiledArgs.flatMap((arg) => arg.params)
  const argSql = compiledArgs.map((arg) => arg.sql)

  switch (expression.name) {
    case `eq`:
    case `gt`:
    case `gte`:
    case `lt`:
    case `lte`: {
      if (
        expression.args.length !== 2 ||
        !argSql[0] ||
        !argSql[1] ||
        !compiledArgs[0] ||
        !compiledArgs[1]
      ) {
        return { supported: false, sql: ``, params: [] }
      }

      const valueKind = resolveComparisonValueKind(
        expression.args[0]!,
        expression.args[1]!,
        compiledArgs[0],
        compiledArgs[1],
      )
      const operatorByName: Record<
        `eq` | `gt` | `gte` | `lt` | `lte`,
        `=` | `>` | `>=` | `<` | `<=`
      > = {
        eq: `=`,
        gt: `>`,
        gte: `>=`,
        lt: `<`,
        lte: `<=`,
      }

      return {
        supported: true,
        sql: compileComparisonSql(
          operatorByName[expression.name],
          argSql[0],
          argSql[1],
          valueKind,
        ),
        params,
      }
    }
    case `and`: {
      if (argSql.length < 2) {
        return { supported: false, sql: ``, params: [] }
      }
      return {
        supported: true,
        sql: argSql.map((sql) => `(${sql})`).join(` AND `),
        params,
      }
    }
    case `or`: {
      if (argSql.length < 2) {
        return { supported: false, sql: ``, params: [] }
      }
      return {
        supported: true,
        sql: argSql.map((sql) => `(${sql})`).join(` OR `),
        params,
      }
    }
    case `not`: {
      if (argSql.length !== 1) {
        return { supported: false, sql: ``, params: [] }
      }
      return {
        supported: true,
        sql: `(NOT (${argSql[0]}))`,
        params,
      }
    }
    case `in`: {
      if (expression.args.length !== 2 || expression.args[1]?.type !== `val`) {
        return { supported: false, sql: ``, params: [] }
      }

      const listValue = expression.args[1].value
      if (!Array.isArray(listValue)) {
        return { supported: false, sql: ``, params: [] }
      }

      if (listValue.length === 0) {
        return { supported: true, sql: `(0 = 1)`, params: [] }
      }

      const leftSql = argSql[0]
      const leftParams = compiledArgs[0]?.params ?? []
      if (!leftSql) {
        return { supported: false, sql: ``, params: [] }
      }

      if (listValue.length > SQLITE_MAX_IN_BATCH_SIZE) {
        const hasBigIntValues = listValue.some(
          (value) => typeof value === `bigint`,
        )
        const inLeftSql = hasBigIntValues
          ? `CAST(${leftSql} AS NUMERIC)`
          : leftSql
        const chunkClauses: Array<string> = []
        const batchedParams: Array<SqliteSupportedValue> = []

        for (
          let startIndex = 0;
          startIndex < listValue.length;
          startIndex += SQLITE_MAX_IN_BATCH_SIZE
        ) {
          const chunkValues = listValue.slice(
            startIndex,
            startIndex + SQLITE_MAX_IN_BATCH_SIZE,
          )
          chunkClauses.push(
            `(${inLeftSql} IN (${chunkValues.map(() => `?`).join(`, `)}))`,
          )
          batchedParams.push(...leftParams)
          batchedParams.push(
            ...chunkValues.map((value) => toSqliteParameterValue(value)),
          )
        }

        return {
          supported: true,
          sql: `(${chunkClauses.join(` OR `)})`,
          params: batchedParams,
        }
      }

      const hasBigIntValues = listValue.some(
        (value) => typeof value === `bigint`,
      )
      const inLeftSql = hasBigIntValues
        ? `CAST(${leftSql} AS NUMERIC)`
        : leftSql
      const listPlaceholders = listValue.map(() => `?`).join(`, `)
      return {
        supported: true,
        sql: `(${inLeftSql} IN (${listPlaceholders}))`,
        params: [
          ...leftParams,
          ...listValue.map((value) => toSqliteParameterValue(value)),
        ],
      }
    }
    case `like`:
      return {
        supported: true,
        sql: `(${argSql[0]} LIKE ${argSql[1]})`,
        params,
      }
    case `ilike`:
      return {
        supported: true,
        sql: `(LOWER(${argSql[0]}) LIKE LOWER(${argSql[1]}))`,
        params,
      }
    case `isNull`:
    case `isUndefined`:
      return { supported: true, sql: `(${argSql[0]} IS NULL)`, params }
    case `upper`:
      return { supported: true, sql: `UPPER(${argSql[0]})`, params }
    case `lower`:
      return { supported: true, sql: `LOWER(${argSql[0]})`, params }
    case `length`:
      return { supported: true, sql: `LENGTH(${argSql[0]})`, params }
    case `concat`:
      return { supported: true, sql: `(${argSql.join(` || `)})`, params }
    case `coalesce`:
      return { supported: true, sql: `COALESCE(${argSql.join(`, `)})`, params }
    case `add`:
      return { supported: true, sql: `(${argSql[0]} + ${argSql[1]})`, params }
    case `subtract`:
      return { supported: true, sql: `(${argSql[0]} - ${argSql[1]})`, params }
    case `multiply`:
      return { supported: true, sql: `(${argSql[0]} * ${argSql[1]})`, params }
    case `divide`:
      return { supported: true, sql: `(${argSql[0]} / ${argSql[1]})`, params }
    case `date`:
      return {
        supported: true,
        sql: `date(${argSql[0]})`,
        params,
        valueKind: `date`,
      }
    case `datetime`:
      return {
        supported: true,
        sql: `datetime(${argSql[0]})`,
        params,
        valueKind: `datetime`,
      }
    case `strftime`:
      return {
        supported: true,
        sql: `strftime(${argSql.join(`, `)})`,
        params,
      }
    default:
      return {
        supported: false,
        sql: ``,
        params: [],
      }
  }
}

function compileOrderByClauses(
  orderBy: IR.OrderBy | undefined,
): CompiledSqlFragment {
  if (!orderBy || orderBy.length === 0) {
    return {
      supported: true,
      sql: ``,
      params: [],
    }
  }

  const parts: Array<string> = []
  const params: Array<SqliteSupportedValue> = []

  for (const clause of orderBy) {
    const compiledExpression = compileSqlExpression(clause.expression)
    if (!compiledExpression.supported) {
      return {
        supported: false,
        sql: ``,
        params: [],
      }
    }

    params.push(...compiledExpression.params)

    const direction =
      clause.compareOptions.direction === `desc` ? `DESC` : `ASC`
    const nulls =
      clause.compareOptions.nulls === `first` ? `NULLS FIRST` : `NULLS LAST`
    parts.push(`${compiledExpression.sql} ${direction} ${nulls}`)
  }

  return {
    supported: true,
    sql: parts.join(`, `),
    params,
  }
}

function isExpressionLikeShape(value: unknown): value is IR.BasicExpression {
  if (typeof value !== `object` || value === null) {
    return false
  }

  const candidate = value as {
    type?: unknown
    value?: unknown
    path?: unknown
    name?: unknown
    args?: unknown
  }

  if (candidate.type === `val`) {
    return Object.prototype.hasOwnProperty.call(candidate, `value`)
  }

  if (candidate.type === `ref`) {
    return Array.isArray(candidate.path)
  }

  if (candidate.type === `func`) {
    if (typeof candidate.name !== `string` || !Array.isArray(candidate.args)) {
      return false
    }
    return candidate.args.every((arg) => isExpressionLikeShape(arg))
  }

  return false
}

function normalizeIndexSqlFragment(fragment: string): string {
  const trimmed = fragment.trim()
  if (trimmed.length === 0) {
    throw new InvalidPersistedCollectionConfigError(
      `Index SQL fragment cannot be empty`,
    )
  }

  let parsedJson: unknown
  let hasParsedJson = false
  try {
    parsedJson = JSON.parse(trimmed) as unknown
    hasParsedJson = true
  } catch {
    // Non-JSON strings are treated as raw SQL fragments below.
  }

  if (hasParsedJson && isExpressionLikeShape(parsedJson)) {
    const compiled = compileSqlExpression(parsedJson)
    if (!compiled.supported) {
      throw new InvalidPersistedCollectionConfigError(
        `Persisted index expression is not supported by the SQLite compiler`,
      )
    }
    return inlineSqlParams(compiled.sql, compiled.params)
  }

  return sanitizeExpressionSqlFragment(fragment)
}

function mergeObjectRows<T extends object>(existing: unknown, incoming: T): T {
  if (typeof existing === `object` && existing !== null) {
    return Object.assign({}, existing as Record<string, unknown>, incoming) as T
  }
  return incoming
}

function buildIndexName(collectionId: string, signature: string): string {
  const sanitizedSignature = signature
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, `_`)
    .replace(/^_+|_+$/g, ``)
    .slice(0, 24)
  const hashSource = `${collectionId}:${signature}`
  const hashedPart = createPersistedTableName(hashSource, `c`)
  const suffix = sanitizedSignature.length > 0 ? sanitizedSignature : `sig`
  return `idx_${hashedPart}_${suffix}`
}

export class SQLiteCorePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
> implements PersistenceAdapter<T, TKey> {
  private readonly driver: SQLiteDriver
  private readonly schemaVersion: number
  private readonly schemaMismatchPolicy: SQLiteCoreAdapterSchemaMismatchPolicy
  private readonly appliedTxPruneMaxRows: number | undefined
  private readonly appliedTxPruneMaxAgeSeconds: number | undefined
  private readonly pullSinceReloadThreshold: number

  private initialized = false
  private readonly collectionTableCache = new Map<
    string,
    CollectionTableMapping
  >()

  constructor(options: SQLiteCoreAdapterOptions) {
    const schemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION
    if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
      throw new InvalidPersistedCollectionConfigError(
        `SQLite adapter schemaVersion must be a non-negative integer`,
      )
    }

    if (
      options.appliedTxPruneMaxRows !== undefined &&
      (!Number.isInteger(options.appliedTxPruneMaxRows) ||
        options.appliedTxPruneMaxRows < 0)
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `SQLite adapter appliedTxPruneMaxRows must be a non-negative integer when provided`,
      )
    }

    if (
      options.appliedTxPruneMaxAgeSeconds !== undefined &&
      (!Number.isInteger(options.appliedTxPruneMaxAgeSeconds) ||
        options.appliedTxPruneMaxAgeSeconds < 0)
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `SQLite adapter appliedTxPruneMaxAgeSeconds must be a non-negative integer when provided`,
      )
    }

    const pullSinceReloadThreshold =
      options.pullSinceReloadThreshold ?? DEFAULT_PULL_SINCE_RELOAD_THRESHOLD
    if (
      !Number.isInteger(pullSinceReloadThreshold) ||
      pullSinceReloadThreshold < 0
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `SQLite adapter pullSinceReloadThreshold must be a non-negative integer`,
      )
    }

    this.driver = options.driver
    this.schemaVersion = schemaVersion
    this.schemaMismatchPolicy =
      options.schemaMismatchPolicy ?? `sync-present-reset`
    this.appliedTxPruneMaxRows = options.appliedTxPruneMaxRows
    this.appliedTxPruneMaxAgeSeconds = options.appliedTxPruneMaxAgeSeconds
    this.pullSinceReloadThreshold = pullSinceReloadThreshold
  }

  async loadSubset(
    collectionId: string,
    options: LoadSubsetOptions,
    ctx?: { requiredIndexSignatures?: ReadonlyArray<string> },
  ): Promise<Array<{ key: TKey; value: T }>> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    await this.touchRequiredIndexes(collectionId, ctx?.requiredIndexSignatures)

    if (options.cursor) {
      const whereCurrentOptions: LoadSubsetOptions = {
        where: options.where
          ? new IR.Func(`and`, [options.where, options.cursor.whereCurrent])
          : options.cursor.whereCurrent,
        orderBy: options.orderBy,
      }
      const whereFromOptions: LoadSubsetOptions = {
        where: options.where
          ? new IR.Func(`and`, [options.where, options.cursor.whereFrom])
          : options.cursor.whereFrom,
        orderBy: options.orderBy,
        limit: options.limit,
      }

      const [whereCurrentRows, whereFromRows] = await Promise.all([
        this.loadSubsetInternal(tableMapping, whereCurrentOptions),
        this.loadSubsetInternal(tableMapping, whereFromOptions),
      ])

      const mergedRows = new Map<string, InMemoryRow<TKey, T>>()
      for (const row of [...whereCurrentRows, ...whereFromRows]) {
        mergedRows.set(encodePersistedStorageKey(row.key), row)
      }

      const orderedRows = this.applyInMemoryOrderBy(
        Array.from(mergedRows.values()),
        options.orderBy,
      )

      return orderedRows.map((row) => ({
        key: row.key,
        value: row.value,
      }))
    }

    const rows = await this.loadSubsetInternal(tableMapping, options)
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
    }))
  }

  async applyCommittedTx(
    collectionId: string,
    tx: PersistedTx<T, TKey>,
  ): Promise<void> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const tombstoneTableSql = quoteIdentifier(tableMapping.tombstoneTableName)

    await this.driver.transaction(async () => {
      const alreadyApplied = await this.driver.query<{ applied: number }>(
        `SELECT 1 AS applied
         FROM applied_tx
         WHERE collection_id = ? AND term = ? AND seq = ?
         LIMIT 1`,
        [collectionId, tx.term, tx.seq],
      )

      if (alreadyApplied.length > 0) {
        return
      }

      const versionRows = await this.driver.query<{
        latest_row_version: number
      }>(
        `SELECT latest_row_version
         FROM collection_version
         WHERE collection_id = ?
         LIMIT 1`,
        [collectionId],
      )
      const currentRowVersion = versionRows[0]?.latest_row_version ?? 0
      const nextRowVersion = Math.max(currentRowVersion + 1, tx.rowVersion)

      for (const mutation of tx.mutations) {
        const encodedKey = encodePersistedStorageKey(mutation.key)
        if (mutation.type === `delete`) {
          await this.driver.run(
            `DELETE FROM ${collectionTableSql}
             WHERE key = ?`,
            [encodedKey],
          )
          await this.driver.run(
            `INSERT INTO ${tombstoneTableSql} (key, value, row_version, deleted_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               row_version = excluded.row_version,
               deleted_at = excluded.deleted_at`,
            [
              encodedKey,
              serializePersistedRowValue(mutation.value),
              nextRowVersion,
              new Date().toISOString(),
            ],
          )
          continue
        }

        const existingRows = await this.driver.query<{ value: string }>(
          `SELECT value
           FROM ${collectionTableSql}
           WHERE key = ?
           LIMIT 1`,
          [encodedKey],
        )
        const existingValue = existingRows[0]?.value
          ? deserializePersistedRowValue(existingRows[0].value)
          : undefined
        const mergedValue =
          mutation.type === `update`
            ? mergeObjectRows(existingValue, mutation.value)
            : mutation.value

        await this.driver.run(
          `INSERT INTO ${collectionTableSql} (key, value, row_version)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             row_version = excluded.row_version`,
          [encodedKey, serializePersistedRowValue(mergedValue), nextRowVersion],
        )
        await this.driver.run(
          `DELETE FROM ${tombstoneTableSql}
           WHERE key = ?`,
          [encodedKey],
        )
      }

      await this.driver.run(
        `INSERT INTO collection_version (collection_id, latest_row_version)
         VALUES (?, ?)
         ON CONFLICT(collection_id) DO UPDATE SET
           latest_row_version = excluded.latest_row_version`,
        [collectionId, nextRowVersion],
      )

      await this.driver.run(
        `INSERT INTO leader_term (collection_id, latest_term)
         VALUES (?, ?)
         ON CONFLICT(collection_id) DO UPDATE SET
           latest_term = CASE
             WHEN leader_term.latest_term > excluded.latest_term
             THEN leader_term.latest_term
             ELSE excluded.latest_term
           END`,
        [collectionId, tx.term],
      )

      await this.driver.run(
        `INSERT INTO applied_tx (
           collection_id,
           term,
           seq,
           tx_id,
           row_version,
           applied_at
         )
         VALUES (?, ?, ?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))`,
        [collectionId, tx.term, tx.seq, tx.txId, nextRowVersion],
      )

      await this.pruneAppliedTxRows(collectionId)
    })
  }

  async ensureIndex(
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ): Promise<void> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const indexName = buildIndexName(collectionId, signature)
    const indexNameSql = quoteIdentifier(indexName)
    const normalizedExpressionSql = spec.expressionSql.map((fragment) =>
      normalizeIndexSqlFragment(fragment),
    )
    const expressionSql = normalizedExpressionSql.join(`, `)
    const whereSql = spec.whereSql
      ? normalizeIndexSqlFragment(spec.whereSql)
      : undefined

    await this.driver.transaction(async () => {
      await this.driver.run(
        `INSERT INTO persisted_index_registry (
           collection_id,
           signature,
           index_name,
           expression_sql,
           where_sql,
           removed,
           created_at,
           updated_at,
           last_used_at
         )
         VALUES (?, ?, ?, ?, ?, 0,
                 CAST(strftime('%s', 'now') AS INTEGER),
                 CAST(strftime('%s', 'now') AS INTEGER),
                 CAST(strftime('%s', 'now') AS INTEGER))
         ON CONFLICT(collection_id, signature) DO UPDATE SET
           index_name = excluded.index_name,
           expression_sql = excluded.expression_sql,
           where_sql = excluded.where_sql,
           removed = 0,
           updated_at = CAST(strftime('%s', 'now') AS INTEGER),
           last_used_at = CAST(strftime('%s', 'now') AS INTEGER)`,
        [
          collectionId,
          signature,
          indexName,
          JSON.stringify(normalizedExpressionSql),
          whereSql ?? null,
        ],
      )

      const createIndexSql = whereSql
        ? `CREATE INDEX IF NOT EXISTS ${indexNameSql}
           ON ${collectionTableSql} (${expressionSql})
           WHERE ${whereSql}`
        : `CREATE INDEX IF NOT EXISTS ${indexNameSql}
           ON ${collectionTableSql} (${expressionSql})`
      await this.driver.exec(createIndexSql)
    })
  }

  async markIndexRemoved(
    collectionId: string,
    signature: string,
  ): Promise<void> {
    await this.ensureCollectionReady(collectionId)
    const rows = await this.driver.query<{ index_name: string }>(
      `SELECT index_name
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?
       LIMIT 1`,
      [collectionId, signature],
    )
    const indexName = rows[0]?.index_name

    await this.driver.run(
      `UPDATE persisted_index_registry
       SET removed = 1,
           updated_at = CAST(strftime('%s', 'now') AS INTEGER),
           last_used_at = CAST(strftime('%s', 'now') AS INTEGER)
       WHERE collection_id = ? AND signature = ?`,
      [collectionId, signature],
    )

    if (indexName) {
      await this.driver.exec(
        `DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`,
      )
    }
  }

  async pullSince(
    collectionId: string,
    fromRowVersion: number,
  ): Promise<SQLitePullSinceResult<TKey>> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const tombstoneTableSql = quoteIdentifier(tableMapping.tombstoneTableName)

    const [changedRows, deletedRows, latestVersionRows] = await Promise.all([
      this.driver.query<{ key: string }>(
        `SELECT key
         FROM ${collectionTableSql}
         WHERE row_version > ?`,
        [fromRowVersion],
      ),
      this.driver.query<{ key: string }>(
        `SELECT key
         FROM ${tombstoneTableSql}
         WHERE row_version > ?`,
        [fromRowVersion],
      ),
      this.driver.query<{ latest_row_version: number }>(
        `SELECT latest_row_version
         FROM collection_version
         WHERE collection_id = ?
         LIMIT 1`,
        [collectionId],
      ),
    ])

    const latestRowVersion = latestVersionRows[0]?.latest_row_version ?? 0
    const changedKeyCount = changedRows.length + deletedRows.length

    if (changedKeyCount > this.pullSinceReloadThreshold) {
      return {
        latestRowVersion,
        requiresFullReload: true,
      }
    }

    const decodeKey = (encodedKey: string): TKey => {
      try {
        return decodePersistedStorageKey(encodedKey) as TKey
      } catch (error) {
        throw new InvalidPersistedStorageKeyEncodingError(
          `${encodedKey}: ${(error as Error).message}`,
        )
      }
    }

    return {
      latestRowVersion,
      requiresFullReload: false,
      changedKeys: changedRows.map((row) => decodeKey(row.key)),
      deletedKeys: deletedRows.map((row) => decodeKey(row.key)),
    }
  }

  private async loadSubsetInternal(
    tableMapping: CollectionTableMapping,
    options: LoadSubsetOptions,
  ): Promise<Array<InMemoryRow<TKey, T>>> {
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const whereCompiled = options.where
      ? compileSqlExpression(options.where)
      : { supported: true, sql: ``, params: [] as Array<SqliteSupportedValue> }
    const orderByCompiled = compileOrderByClauses(options.orderBy)

    const queryParams: Array<SqliteSupportedValue> = []
    let sql = `SELECT key, value, row_version FROM ${collectionTableSql}`

    if (options.where && whereCompiled.supported) {
      sql = `${sql} WHERE ${whereCompiled.sql}`
      queryParams.push(...whereCompiled.params)
    }

    if (options.orderBy && orderByCompiled.supported) {
      sql = `${sql} ORDER BY ${orderByCompiled.sql}, key ASC`
      queryParams.push(...orderByCompiled.params)
    }

    const storedRows = await this.driver.query<StoredSqliteRow>(
      sql,
      queryParams,
    )
    const parsedRows = storedRows.map((row) => {
      const key = decodePersistedStorageKey(row.key) as TKey
      const value = deserializePersistedRowValue<T>(row.value)
      return {
        key,
        value,
        rowVersion: row.row_version,
      }
    })

    const filteredRows = this.applyInMemoryWhere(parsedRows, options.where)
    const orderedRows = this.applyInMemoryOrderBy(filteredRows, options.orderBy)
    return this.applyInMemoryPagination(
      orderedRows,
      options.limit,
      options.offset,
    )
  }

  private applyInMemoryWhere(
    rows: Array<InMemoryRow<TKey, T>>,
    where: IR.BasicExpression<boolean> | undefined,
  ): Array<InMemoryRow<TKey, T>> {
    if (!where) {
      return rows
    }

    const evaluator = compileRowExpressionEvaluator(where)
    return rows.filter((row) =>
      toBooleanPredicate(
        evaluator(row.value as Record<string, unknown>) as boolean | null,
      ),
    )
  }

  private applyInMemoryOrderBy(
    rows: Array<InMemoryRow<TKey, T>>,
    orderBy: IR.OrderBy | undefined,
  ): Array<InMemoryRow<TKey, T>> {
    if (!orderBy || orderBy.length === 0) {
      return rows
    }

    const compiledClauses = orderBy.map((clause) => ({
      evaluator: compileRowExpressionEvaluator(clause.expression),
      compareOptions: clause.compareOptions,
    }))

    const ordered = [...rows]
    ordered.sort((left, right) => {
      for (const clause of compiledClauses) {
        const leftValue = clause.evaluator(
          left.value as Record<string, unknown>,
        )
        const rightValue = clause.evaluator(
          right.value as Record<string, unknown>,
        )

        const comparison = compareOrderByValues(
          leftValue,
          rightValue,
          clause.compareOptions,
        )

        if (comparison !== 0) {
          return clause.compareOptions.direction === `desc`
            ? comparison * -1
            : comparison
        }
      }

      const leftKey = encodePersistedStorageKey(left.key)
      const rightKey = encodePersistedStorageKey(right.key)
      if (leftKey < rightKey) {
        return -1
      }
      if (leftKey > rightKey) {
        return 1
      }
      return 0
    })

    return ordered
  }

  private applyInMemoryPagination(
    rows: Array<InMemoryRow<TKey, T>>,
    limit: number | undefined,
    offset: number | undefined,
  ): Array<InMemoryRow<TKey, T>> {
    const start = offset ?? 0
    if (limit === undefined) {
      return rows.slice(start)
    }
    return rows.slice(start, start + limit)
  }

  private async touchRequiredIndexes(
    collectionId: string,
    requiredIndexSignatures: ReadonlyArray<string> | undefined,
  ): Promise<void> {
    if (!requiredIndexSignatures || requiredIndexSignatures.length === 0) {
      return
    }

    for (const signature of requiredIndexSignatures) {
      await this.driver.run(
        `UPDATE persisted_index_registry
         SET last_used_at = CAST(strftime('%s', 'now') AS INTEGER),
             updated_at = CAST(strftime('%s', 'now') AS INTEGER)
         WHERE collection_id = ? AND signature = ? AND removed = 0`,
        [collectionId, signature],
      )
    }
  }

  private async pruneAppliedTxRows(collectionId: string): Promise<void> {
    if (
      this.appliedTxPruneMaxAgeSeconds !== undefined &&
      this.appliedTxPruneMaxAgeSeconds > 0
    ) {
      await this.driver.run(
        `DELETE FROM applied_tx
         WHERE collection_id = ?
           AND applied_at < (CAST(strftime('%s', 'now') AS INTEGER) - ?)`,
        [collectionId, this.appliedTxPruneMaxAgeSeconds],
      )
    }

    if (
      this.appliedTxPruneMaxRows === undefined ||
      this.appliedTxPruneMaxRows <= 0
    ) {
      return
    }

    const countRows = await this.driver.query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM applied_tx
       WHERE collection_id = ?`,
      [collectionId],
    )
    const count = countRows[0]?.count ?? 0
    const excessRows = count - this.appliedTxPruneMaxRows
    if (excessRows <= 0) {
      return
    }

    await this.driver.run(
      `DELETE FROM applied_tx
       WHERE rowid IN (
         SELECT rowid
         FROM applied_tx
         WHERE collection_id = ?
         ORDER BY term ASC, seq ASC
         LIMIT ?
       )`,
      [collectionId, excessRows],
    )
  }

  private async ensureCollectionReady(
    collectionId: string,
  ): Promise<CollectionTableMapping> {
    await this.ensureInitialized()

    const cached = this.collectionTableCache.get(collectionId)
    if (cached) {
      return cached
    }

    const existingRows = await this.driver.query<{
      table_name: string
      tombstone_table_name: string
      schema_version: number
    }>(
      `SELECT table_name, tombstone_table_name, schema_version
       FROM collection_registry
       WHERE collection_id = ?
       LIMIT 1`,
      [collectionId],
    )

    let tableName: string
    let tombstoneTableName: string

    if (existingRows.length > 0) {
      tableName = existingRows[0]!.table_name
      tombstoneTableName = existingRows[0]!.tombstone_table_name

      if (existingRows[0]!.schema_version !== this.schemaVersion) {
        await this.handleSchemaMismatch(
          collectionId,
          existingRows[0]!.schema_version,
          this.schemaVersion,
          tableName,
          tombstoneTableName,
        )
      }
    } else {
      tableName = createPersistedTableName(collectionId, `c`)
      tombstoneTableName = createPersistedTableName(collectionId, `t`)
      await this.driver.run(
        `INSERT INTO collection_registry (
           collection_id,
           table_name,
           tombstone_table_name,
           schema_version,
           updated_at
         )
         VALUES (?, ?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))`,
        [collectionId, tableName, tombstoneTableName, this.schemaVersion],
      )
    }

    const collectionTableSql = quoteIdentifier(tableName)
    const tombstoneTableSql = quoteIdentifier(tombstoneTableName)

    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS ${collectionTableSql} (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         row_version INTEGER NOT NULL
       )`,
    )
    await this.driver.exec(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${tableName}_row_version_idx`)}
       ON ${collectionTableSql} (row_version)`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS ${tombstoneTableSql} (
         key TEXT PRIMARY KEY,
         value TEXT,
         row_version INTEGER NOT NULL,
         deleted_at TEXT NOT NULL
       )`,
    )
    await this.driver.exec(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${tombstoneTableName}_row_version_idx`)}
       ON ${tombstoneTableSql} (row_version)`,
    )
    await this.driver.run(
      `INSERT INTO collection_version (collection_id, latest_row_version)
       VALUES (?, 0)
       ON CONFLICT(collection_id) DO NOTHING`,
      [collectionId],
    )
    await this.driver.run(
      `INSERT INTO collection_reset_epoch (collection_id, reset_epoch, updated_at)
       VALUES (?, 0, CAST(strftime('%s', 'now') AS INTEGER))
       ON CONFLICT(collection_id) DO NOTHING`,
      [collectionId],
    )

    const mapping = {
      tableName,
      tombstoneTableName,
    }
    this.collectionTableCache.set(collectionId, mapping)
    return mapping
  }

  private async handleSchemaMismatch(
    collectionId: string,
    previousSchemaVersion: number,
    nextSchemaVersion: number,
    tableName: string,
    tombstoneTableName: string,
  ): Promise<void> {
    if (this.schemaMismatchPolicy === `sync-absent-error`) {
      throw new InvalidPersistedCollectionConfigError(
        `Schema version mismatch for collection "${collectionId}": found ${previousSchemaVersion}, expected ${nextSchemaVersion}. ` +
          `Set schemaMismatchPolicy to "sync-present-reset" or "reset" to allow automatic reset.`,
      )
    }

    const collectionTableSql = quoteIdentifier(tableName)
    const tombstoneTableSql = quoteIdentifier(tombstoneTableName)

    await this.driver.transaction(async () => {
      const persistedIndexes = await this.driver.query<{ index_name: string }>(
        `SELECT index_name
         FROM persisted_index_registry
         WHERE collection_id = ?`,
        [collectionId],
      )
      for (const row of persistedIndexes) {
        await this.driver.exec(
          `DROP INDEX IF EXISTS ${quoteIdentifier(row.index_name)}`,
        )
      }

      await this.driver.run(`DELETE FROM ${collectionTableSql}`)
      await this.driver.run(`DELETE FROM ${tombstoneTableSql}`)
      await this.driver.run(
        `DELETE FROM applied_tx
         WHERE collection_id = ?`,
        [collectionId],
      )
      await this.driver.run(
        `DELETE FROM persisted_index_registry
         WHERE collection_id = ?`,
        [collectionId],
      )
      await this.driver.run(
        `UPDATE collection_registry
         SET schema_version = ?,
             updated_at = CAST(strftime('%s', 'now') AS INTEGER)
         WHERE collection_id = ?`,
        [nextSchemaVersion, collectionId],
      )
      await this.driver.run(
        `INSERT INTO collection_version (collection_id, latest_row_version)
         VALUES (?, 0)
         ON CONFLICT(collection_id) DO UPDATE SET
           latest_row_version = 0`,
        [collectionId],
      )
      await this.driver.run(
        `INSERT INTO collection_reset_epoch (collection_id, reset_epoch, updated_at)
         VALUES (?, 1, CAST(strftime('%s', 'now') AS INTEGER))
         ON CONFLICT(collection_id) DO UPDATE SET
           reset_epoch = collection_reset_epoch.reset_epoch + 1,
           updated_at = CAST(strftime('%s', 'now') AS INTEGER)`,
        [collectionId],
      )
    })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS collection_registry (
         collection_id TEXT PRIMARY KEY,
         table_name TEXT NOT NULL UNIQUE,
         tombstone_table_name TEXT NOT NULL UNIQUE,
         schema_version INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS persisted_index_registry (
         collection_id TEXT NOT NULL,
         signature TEXT NOT NULL,
         index_name TEXT NOT NULL,
         expression_sql TEXT NOT NULL,
         where_sql TEXT,
         removed INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         last_used_at INTEGER NOT NULL,
         PRIMARY KEY (collection_id, signature)
       )`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS applied_tx (
         collection_id TEXT NOT NULL,
         term INTEGER NOT NULL,
         seq INTEGER NOT NULL,
         tx_id TEXT NOT NULL,
         row_version INTEGER NOT NULL,
         applied_at INTEGER NOT NULL,
         PRIMARY KEY (collection_id, term, seq)
       )`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS collection_version (
         collection_id TEXT PRIMARY KEY,
         latest_row_version INTEGER NOT NULL
       )`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS leader_term (
         collection_id TEXT PRIMARY KEY,
         latest_term INTEGER NOT NULL
       )`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS schema_version (
         scope TEXT PRIMARY KEY,
         version INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    )
    await this.driver.run(
      `INSERT INTO schema_version (scope, version, updated_at)
       VALUES ('global', ?, CAST(strftime('%s', 'now') AS INTEGER))
       ON CONFLICT(scope) DO UPDATE SET
         version = excluded.version,
         updated_at = excluded.updated_at`,
      [this.schemaVersion],
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS collection_reset_epoch (
         collection_id TEXT PRIMARY KEY,
         reset_epoch INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    )

    this.initialized = true
  }
}

export function createSQLiteCorePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(options: SQLiteCoreAdapterOptions): PersistenceAdapter<T, TKey> {
  return new SQLiteCorePersistenceAdapter<T, TKey>(options)
}
