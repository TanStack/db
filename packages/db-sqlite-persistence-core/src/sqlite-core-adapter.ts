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
import {
  PERSISTED_TYPE_TAG,
  PERSISTED_VALUE_TAG,
  assertSQLiteBigIntInRange,
  serializeSQLiteBigInt,
} from './sqlite-value'
import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  PersistedIndexSpec,
  PersistedKeySetEvidence,
  PersistedRowScanOptions,
  PersistedScannedRow,
  PersistedTx,
  PersistenceAdapter,
  ReplayableTxDelta,
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

type SqlExpressionCompilationContext = `predicate` | `index-expression`

type StoredSqliteRow = {
  key: string
  value: string
  metadata: string | null
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
      deltas: Array<ReplayableTxDelta<Record<string, unknown>, TKey>>
    }

const DEFAULT_SCHEMA_VERSION = 1
const DEFAULT_PULL_SINCE_RELOAD_THRESHOLD = 128

/**
 * Default cap on retained `applied_tx` rows per collection. The log is a
 * replayable cache, so a bounded row count keeps SQLite files from growing
 * without limit. Pass `appliedTxPruneMaxRows: 0` to disable the row cap.
 */
export const DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS = 1_000

/**
 * Default age backstop for retained `applied_tx` rows, in seconds (24h). Rows
 * older than this are pruned on the next write. Pass
 * `appliedTxPruneMaxAgeSeconds: 0` to disable the age backstop.
 */
export const DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS = 24 * 60 * 60

const SQLITE_MAX_IN_BATCH_SIZE = 900
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const FORBIDDEN_SQL_FRAGMENT_PATTERN = /(;|--|\/\*)/
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

function isDuplicateColumnAddError(
  error: unknown,
  columnName: string,
): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  const normalizedColumnName = columnName.toLowerCase()
  return (
    (message.includes(`duplicate column name`) &&
      message.includes(normalizedColumnName)) ||
    (message.includes(`already exists`) &&
      message.includes(normalizedColumnName))
  )
}

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
    return serializeSQLiteBigInt(value) satisfies PersistedTaggedValue
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
    assertSQLiteBigIntInRange(value)
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

function toSqliteExpressionLiteral(value: unknown): string {
  if (typeof value === `bigint`) {
    return assertSQLiteBigIntInRange(value).toString()
  }
  return toSqliteLiteral(toSqliteParameterValue(value))
}

type CompiledRowExpressionEvaluator = (row: Record<string, unknown>) => unknown

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
  return baseEvaluator
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
  leftExpression: IR.BasicExpression,
  rightExpression: IR.BasicExpression,
  leftSql: string,
  rightSql: string,
  valueKind: CompiledValueKind,
  leftKind: CompiledValueKind,
  rightKind: CompiledValueKind,
): string {
  const compileOperand = (
    expression: IR.BasicExpression,
    sql: string,
    otherKind: CompiledValueKind,
  ): string => {
    if (expression.type !== `val`) return sql
    if (valueKind === `date` && otherKind === `date`) return `date(${sql})`
    if (valueKind === `datetime` && otherKind === `datetime`) {
      return `datetime(${sql})`
    }
    return sql
  }

  return `(${compileOperand(leftExpression, leftSql, rightKind)} ${operator} ${compileOperand(rightExpression, rightSql, leftKind)})`
}

function compileRefExpressionSql(jsonPath: string): CompiledSqlFragment {
  const typePath = `${jsonPath}.${PERSISTED_TYPE_TAG}`
  const taggedValuePath = `${jsonPath}.${PERSISTED_VALUE_TAG}`
  // createJsonPath has already validated every segment. Keep these paths as
  // canonical SQL literals so runtime refs match persisted expression indexes.
  const typePathSql = toSqliteLiteral(typePath)
  const taggedValuePathSql = toSqliteLiteral(taggedValuePath)
  const jsonPathSql = toSqliteLiteral(jsonPath)

  return {
    supported: true,
    sql: `(CASE json_extract(value, ${typePathSql})
      WHEN 'bigint' THEN CAST(json_extract(value, ${taggedValuePathSql}) AS NUMERIC)
      WHEN 'date' THEN json_extract(value, ${taggedValuePathSql})
      WHEN 'nan' THEN NULL
      WHEN 'infinity' THEN NULL
      WHEN '-infinity' THEN NULL
      ELSE json_extract(value, ${jsonPathSql})
    END)`,
    params: [],
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

type InMemoryRow<
  TKey extends string | number = string | number,
  T extends object = Record<string, unknown>,
> = {
  key: TKey
  value: T
  metadata?: unknown
  rowVersion: number
}

function decodeStoredSqliteRows<
  TKey extends string | number = string | number,
  T extends object = Record<string, unknown>,
>(storedRows: ReadonlyArray<StoredSqliteRow>): Array<InMemoryRow<TKey, T>> {
  return storedRows.map((row) => {
    const key = decodePersistedStorageKey(row.key) as TKey
    const value = deserializePersistedRowValue<T>(row.value)
    return {
      key,
      value,
      metadata:
        row.metadata != null
          ? deserializePersistedRowValue(row.metadata)
          : undefined,
      rowVersion: row.row_version,
    }
  })
}

function stableStringify(value: unknown): string {
  return serializePersistedRowValue(value)
}

function argumentCompilationContext(
  parentName: string,
  argumentIndex: number,
  argument: IR.BasicExpression,
  parentContext: SqlExpressionCompilationContext,
): SqlExpressionCompilationContext {
  if (parentContext === `index-expression`) return `index-expression`

  switch (parentName) {
    case `and`:
    case `or`:
    case `not`:
      return `predicate`
    case `eq`:
    case `gt`:
    case `gte`:
    case `lt`:
    case `lte`:
    case `like`:
    case `ilike`:
      if (argument.type !== `val`) return `index-expression`
      return typeof argument.value === `bigint`
        ? `index-expression`
        : `predicate`
    case `in`:
      return argumentIndex === 0 ? `index-expression` : `predicate`
    case `isNull`:
    case `isUndefined`:
      return `index-expression`
    default:
      return `index-expression`
  }
}

function compileSqlExpression(
  expression: IR.BasicExpression,
  context: SqlExpressionCompilationContext = `predicate`,
): CompiledSqlFragment {
  if (expression.type === `val`) {
    const valueKind = getLiteralValueKind(expression.value)
    return {
      supported: true,
      sql:
        context === `index-expression`
          ? toSqliteExpressionLiteral(expression.value)
          : `?`,
      params:
        context === `predicate`
          ? [toSqliteParameterValue(expression.value)]
          : [],
      valueKind,
    }
  }

  if (expression.type === `ref`) {
    const jsonPath = createJsonPath(
      IR.getPropRefPropertyPath(expression).map(String),
    )
    if (!jsonPath) {
      return {
        supported: false,
        sql: ``,
        params: [],
      }
    }

    return compileRefExpressionSql(jsonPath)
  }

  const compiledArgs = expression.args.map((arg, index) =>
    compileSqlExpression(
      arg,
      argumentCompilationContext(expression.name, index, arg, context),
    ),
  )
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
          expression.args[0]!,
          expression.args[1]!,
          argSql[0],
          argSql[1],
          valueKind,
          getCompiledValueKind(compiledArgs[0]),
          getCompiledValueKind(compiledArgs[1]),
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

      if (context === `index-expression`) {
        return {
          supported: true,
          sql: `(${leftSql} IN (${listValue
            .map((value) => toSqliteExpressionLiteral(value))
            .join(`, `)}))`,
          params: leftParams,
        }
      }

      if (listValue.length > SQLITE_MAX_IN_BATCH_SIZE) {
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
          const chunkParams: Array<SqliteSupportedValue> = []
          const chunkValueSql = chunkValues.map((value) => {
            chunkParams.push(toSqliteParameterValue(value))
            return typeof value === `bigint` ? `CAST(? AS NUMERIC)` : `?`
          })
          chunkClauses.push(`(${leftSql} IN (${chunkValueSql.join(`, `)}))`)
          batchedParams.push(...leftParams, ...chunkParams)
        }

        return {
          supported: true,
          sql: `(${chunkClauses.join(` OR `)})`,
          params: batchedParams,
        }
      }

      const listParams: Array<SqliteSupportedValue> = []
      const listValueSql = listValue.map((value) => {
        listParams.push(toSqliteParameterValue(value))
        return typeof value === `bigint` ? `CAST(? AS NUMERIC)` : `?`
      })
      return {
        supported: true,
        sql: `(${leftSql} IN (${listValueSql.join(`, `)}))`,
        params: [...leftParams, ...listParams],
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
    const compiledExpression = compileSqlExpression(
      clause.expression,
      `index-expression`,
    )
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
    sourceAlias?: unknown
  }

  if (candidate.type === `val`) {
    return Object.prototype.hasOwnProperty.call(candidate, `value`)
  }

  if (candidate.type === `ref`) {
    return (
      Array.isArray(candidate.path) &&
      (candidate.sourceAlias === undefined ||
        (typeof candidate.sourceAlias === `string` &&
          candidate.path[0] === candidate.sourceAlias))
    )
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

  const decodedJson = hasParsedJson
    ? decodePersistedJsonValue(parsedJson)
    : undefined
  if (hasParsedJson && isExpressionLikeShape(decodedJson)) {
    const compiled = compileSqlExpression(decodedJson, `index-expression`)
    if (!compiled.supported) {
      throw new InvalidPersistedCollectionConfigError(
        `Persisted index expression is not supported by the SQLite compiler`,
      )
    }
    if (compiled.params.length !== 0) {
      throw new InvalidPersistedCollectionConfigError(
        `Persisted index expression cannot contain bound parameters`,
      )
    }
    return compiled.sql
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

export class SQLiteCorePersistenceAdapter implements PersistenceAdapter {
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
  private readonly collectionTableLoads = new Map<
    string,
    Promise<CollectionTableMapping>
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

  private runInTransaction<TResult>(
    fn: (transactionDriver: SQLiteDriver) => Promise<TResult>,
  ): Promise<TResult> {
    if (typeof this.driver.transactionWithDriver === `function`) {
      return this.driver.transactionWithDriver(fn)
    }

    return this.driver.transaction(fn)
  }

  private async assertCurrentSchemaVersion(
    collectionId: string,
    driver: SQLiteDriver,
    operation: string,
  ): Promise<void> {
    const schemaRows = await driver.query<{ schema_version: number }>(
      `SELECT schema_version
       FROM collection_registry
       WHERE collection_id = ?
       LIMIT 1`,
      [collectionId],
    )
    const persistedSchemaVersion = schemaRows[0]?.schema_version
    if (persistedSchemaVersion !== this.schemaVersion) {
      throw new InvalidPersistedCollectionConfigError(
        `Schema version mismatch for collection "${collectionId}": ` +
          `found ${persistedSchemaVersion ?? `missing`}, expected ${this.schemaVersion}. ` +
          `Refusing to ${operation} through a stale cached adapter.`,
      )
    }
  }

  async loadSubset(
    collectionId: string,
    options: LoadSubsetOptions,
    ctx?: { requiredIndexSignatures?: ReadonlyArray<string> },
  ): Promise<
    Array<{
      key: string | number
      value: Record<string, unknown>
      metadata?: unknown
    }>
  > {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `load persisted rows`,
      )
      await this.touchRequiredIndexes(
        collectionId,
        ctx?.requiredIndexSignatures,
        transactionDriver,
      )

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
          this.loadSubsetInternal(
            tableMapping,
            whereCurrentOptions,
            transactionDriver,
          ),
          this.loadSubsetInternal(
            tableMapping,
            whereFromOptions,
            transactionDriver,
          ),
        ])

        const mergedRows = new Map<
          string,
          InMemoryRow<string | number, Record<string, unknown>>
        >()
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
          metadata: row.metadata,
        }))
      }

      const rows = await this.loadSubsetInternal(
        tableMapping,
        options,
        transactionDriver,
      )
      return rows.map((row) => ({
        key: row.key,
        value: row.value,
        metadata: row.metadata,
      }))
    })
  }

  async loadResumeSnapshot(
    collectionId: string,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      includeRows?: boolean
    },
  ): Promise<{
    rows: Array<{
      key: string | number
      value: Record<string, unknown>
      metadata?: unknown
    }>
    keySet: PersistedKeySetEvidence
    collectionMetadata: Array<{ key: string; value: unknown }>
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
    resetEpoch: number
  }> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    const includeRows = ctx?.includeRows !== false

    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `load a resume snapshot`,
      )
      if (includeRows) {
        await this.touchRequiredIndexes(
          collectionId,
          ctx?.requiredIndexSignatures,
          transactionDriver,
        )
      }

      const rows = includeRows
        ? await this.loadSubsetInternal(tableMapping, {}, transactionDriver)
        : []
      const { latestRowVersion, keySet } = await this.readKeySetEvidence(
        collectionId,
        transactionDriver,
      )
      const collectionMetadataRows = await transactionDriver.query<{
        key: string
        value: string
      }>(
        `SELECT key, value
         FROM collection_metadata
         WHERE collection_id = ?`,
        [collectionId],
      )
      const { latestTerm, latestSeq } = await this.readStreamPosition(
        collectionId,
        transactionDriver,
      )
      const resetRows = await transactionDriver.query<{ reset_epoch: number }>(
        `SELECT reset_epoch
         FROM collection_reset_epoch
         WHERE collection_id = ?
         LIMIT 1`,
        [collectionId],
      )

      return {
        rows: rows.map((row) => ({
          key: row.key,
          value: row.value,
          metadata: row.metadata,
        })),
        keySet,
        collectionMetadata: collectionMetadataRows.map((row) => ({
          key: row.key,
          value: deserializePersistedRowValue(row.value),
        })),
        latestTerm,
        latestSeq,
        latestRowVersion,
        resetEpoch: resetRows[0]?.reset_epoch ?? 0,
      }
    })
  }

  async applyCommittedTx(collectionId: string, tx: PersistedTx): Promise<void> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const tombstoneTableSql = quoteIdentifier(tableMapping.tombstoneTableName)

    await this.runInTransaction(async (transactionDriver) => {
      const versionRows = await transactionDriver.query<{
        latest_row_version: number
        key_set_evidence_available: number
        schema_version: number
        already_applied: number
      }>(
        `SELECT
           latest_row_version,
           key_set_evidence_available,
           (
             SELECT schema_version
             FROM collection_registry
             WHERE collection_id = ?
             LIMIT 1
           ) AS schema_version,
           EXISTS (
             SELECT 1
             FROM applied_tx
             WHERE collection_id = ? AND term = ? AND seq = ?
           ) AS already_applied
         FROM collection_version
         WHERE collection_id = ?
         LIMIT 1`,
        [collectionId, collectionId, tx.term, tx.seq, collectionId],
      )
      const version = versionRows[0]

      if (!version) {
        throw new InvalidPersistedCollectionConfigError(
          `Missing persisted version state for collection "${collectionId}"`,
        )
      }
      if (version.schema_version !== this.schemaVersion) {
        throw new InvalidPersistedCollectionConfigError(
          `Schema version mismatch for collection "${collectionId}": ` +
            `found ${version.schema_version}, expected ${this.schemaVersion}. ` +
            `Refusing to apply a committed transaction through a stale cached adapter.`,
        )
      }

      if (version.already_applied === 1) {
        return
      }

      const currentRowVersion = version.latest_row_version
      const nextRowVersion = Math.max(currentRowVersion + 1, tx.rowVersion)
      const replacesPersistedBaseline = tx.truncate === true
      const tracksPersistedKeySet =
        version.key_set_evidence_available === 1 || replacesPersistedBaseline
      const replayDelta: ReplayableTxDelta | null = replacesPersistedBaseline
        ? null
        : {
            txId: tx.txId,
            latestRowVersion: nextRowVersion,
            changedRows: tx.mutations
              .filter((mutation) => mutation.type !== `delete`)
              .map((mutation) => ({
                key: mutation.key,
                value: mutation.value,
              })),
            deletedKeys: tx.mutations
              .filter((mutation) => mutation.type === `delete`)
              .map((mutation) => mutation.key),
            rowMetadataMutations: tx.rowMetadataMutations ?? [],
            collectionMetadataMutations: tx.collectionMetadataMutations ?? [],
          }

      if (replacesPersistedBaseline) {
        await transactionDriver.run(
          `DELETE FROM collection_expected_keys
           WHERE collection_id = ?`,
          [collectionId],
        )
        await transactionDriver.run(`DELETE FROM ${collectionTableSql}`)
        await transactionDriver.run(`DELETE FROM ${tombstoneTableSql}`)
      }

      for (const mutation of tx.mutations) {
        const encodedKey = encodePersistedStorageKey(mutation.key)
        if (mutation.type === `delete`) {
          if (tracksPersistedKeySet) {
            await transactionDriver.run(
              `DELETE FROM collection_expected_keys
               WHERE collection_id = ? AND key = ?`,
              [collectionId, encodedKey],
            )
          }
          await transactionDriver.run(
            `DELETE FROM ${collectionTableSql}
             WHERE key = ?`,
            [encodedKey],
          )
          await transactionDriver.run(
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

        const existingRows = await transactionDriver.query<{
          value: string
          metadata: string | null
        }>(
          `SELECT value, metadata
           FROM ${collectionTableSql}
           WHERE key = ?
           LIMIT 1`,
          [encodedKey],
        )
        const existingValue = existingRows[0]?.value
          ? deserializePersistedRowValue(existingRows[0].value)
          : undefined
        const existingMetadata =
          existingRows[0]?.metadata != null
            ? deserializePersistedRowValue(existingRows[0].metadata)
            : undefined
        const mergedValue =
          mutation.type === `update`
            ? mergeObjectRows(existingValue, mutation.value)
            : mutation.value
        const nextMetadata =
          mutation.metadataChanged === true
            ? mutation.metadata
            : existingMetadata

        if (tracksPersistedKeySet) {
          await transactionDriver.run(
            `INSERT INTO collection_expected_keys (collection_id, key)
             VALUES (?, ?)
             ON CONFLICT(collection_id, key) DO NOTHING`,
            [collectionId, encodedKey],
          )
        }
        await transactionDriver.run(
          `INSERT INTO ${collectionTableSql} (key, value, metadata, row_version)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             metadata = excluded.metadata,
             row_version = excluded.row_version`,
          [
            encodedKey,
            serializePersistedRowValue(mergedValue),
            nextMetadata === undefined
              ? null
              : serializePersistedRowValue(nextMetadata),
            nextRowVersion,
          ],
        )
        await transactionDriver.run(
          `DELETE FROM ${tombstoneTableSql}
           WHERE key = ?`,
          [encodedKey],
        )
      }

      for (const rowMetadataMutation of tx.rowMetadataMutations ?? []) {
        const encodedKey = encodePersistedStorageKey(rowMetadataMutation.key)
        if (rowMetadataMutation.type === `delete`) {
          await transactionDriver.run(
            `UPDATE ${collectionTableSql}
             SET metadata = NULL
             WHERE key = ?`,
            [encodedKey],
          )
        } else {
          await transactionDriver.run(
            `UPDATE ${collectionTableSql}
             SET metadata = ?
             WHERE key = ?`,
            [
              rowMetadataMutation.value === undefined
                ? null
                : serializePersistedRowValue(rowMetadataMutation.value),
              encodedKey,
            ],
          )
        }
      }

      for (const metadataMutation of tx.collectionMetadataMutations ?? []) {
        if (metadataMutation.type === `delete`) {
          await transactionDriver.run(
            `DELETE FROM collection_metadata
             WHERE collection_id = ? AND key = ?`,
            [collectionId, metadataMutation.key],
          )
        } else {
          await transactionDriver.run(
            `INSERT INTO collection_metadata (collection_id, key, value, updated_at)
             VALUES (?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))
             ON CONFLICT(collection_id, key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at`,
            [
              collectionId,
              metadataMutation.key,
              serializePersistedRowValue(metadataMutation.value),
            ],
          )
        }
      }

      await transactionDriver.run(
        `UPDATE collection_version
         SET latest_row_version = ?,
             key_set_evidence_available = CASE
               WHEN ? = 1 THEN 1
               ELSE key_set_evidence_available
             END,
             key_set_evidence_incompatible = CASE
               WHEN ? = 1 THEN 0
               ELSE key_set_evidence_incompatible
             END
         WHERE collection_id = ?`,
        [
          nextRowVersion,
          replacesPersistedBaseline ? 1 : 0,
          replacesPersistedBaseline ? 1 : 0,
          collectionId,
        ],
      )

      await transactionDriver.run(
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

      await transactionDriver.run(
        `INSERT INTO applied_tx (
           collection_id,
           term,
           seq,
           tx_id,
           row_version,
           replay_json,
           replay_requires_full_reload,
           applied_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))`,
        [
          collectionId,
          tx.term,
          tx.seq,
          tx.txId,
          nextRowVersion,
          replayDelta ? stableStringify(replayDelta) : null,
          replacesPersistedBaseline ? 1 : 0,
        ],
      )

      await this.pruneAppliedTxRows(collectionId, transactionDriver)
    })
  }

  async loadCollectionMetadata(
    collectionId: string,
  ): Promise<Array<{ key: string; value: unknown }>> {
    await this.ensureCollectionReady(collectionId)
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `load collection metadata`,
      )
      const rows = await transactionDriver.query<{
        key: string
        value: string
      }>(
        `SELECT key, value
         FROM collection_metadata
         WHERE collection_id = ?`,
        [collectionId],
      )

      return rows.map((row) => ({
        key: row.key,
        value: deserializePersistedRowValue(row.value),
      }))
    })
  }

  async scanRows(
    collectionId: string,
    options?: PersistedRowScanOptions,
  ): Promise<Array<PersistedScannedRow>> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `scan persisted rows`,
      )
      const storedRows = await transactionDriver.query<StoredSqliteRow>(
        options?.metadataOnly
          ? `SELECT key, value, metadata, row_version
             FROM ${collectionTableSql}
             WHERE metadata IS NOT NULL`
          : `SELECT key, value, metadata, row_version
             FROM ${collectionTableSql}`,
      )

      return decodeStoredSqliteRows(storedRows).map((row) => ({
        key: row.key,
        value: row.value,
        metadata: row.metadata,
      }))
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
    const persistedExpressionSql = JSON.stringify(normalizedExpressionSql)
    const whereSql = spec.whereSql
      ? normalizeIndexSqlFragment(spec.whereSql)
      : undefined
    const persistedWhereSql = whereSql ?? null

    await this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `create a persisted index`,
      )

      const existingRows = await transactionDriver.query<{
        index_name: string
        expression_sql: string
        where_sql: string | null
      }>(
        `SELECT index_name, expression_sql, where_sql
         FROM persisted_index_registry
         WHERE collection_id = ? AND signature = ?
         LIMIT 1`,
        [collectionId, signature],
      )
      const existing = existingRows[0]
      if (
        existing &&
        (existing.index_name !== indexName ||
          existing.expression_sql !== persistedExpressionSql ||
          existing.where_sql !== persistedWhereSql)
      ) {
        // A compiler upgrade can change normalized SQL without changing the
        // logical index signature. Rebuild only that stale physical index so
        // the registry and SQLite planner describe the same expression.
        await transactionDriver.exec(
          `DROP INDEX IF EXISTS ${quoteIdentifier(existing.index_name)}`,
        )
      }
      await transactionDriver.run(
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
          persistedExpressionSql,
          persistedWhereSql,
        ],
      )

      const createIndexSql = whereSql
        ? `CREATE INDEX IF NOT EXISTS ${indexNameSql}
           ON ${collectionTableSql} (${expressionSql})
           WHERE ${whereSql}`
        : `CREATE INDEX IF NOT EXISTS ${indexNameSql}
           ON ${collectionTableSql} (${expressionSql})`
      await transactionDriver.exec(createIndexSql)
    })
  }

  async markIndexRemoved(
    collectionId: string,
    signature: string,
  ): Promise<void> {
    await this.ensureCollectionReady(collectionId)
    await this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `remove a persisted index`,
      )
      const rows = await transactionDriver.query<{ index_name: string }>(
        `SELECT index_name
         FROM persisted_index_registry
         WHERE collection_id = ? AND signature = ?
         LIMIT 1`,
        [collectionId, signature],
      )
      const indexName = rows[0]?.index_name

      await transactionDriver.run(
        `UPDATE persisted_index_registry
         SET removed = 1,
             updated_at = CAST(strftime('%s', 'now') AS INTEGER),
             last_used_at = CAST(strftime('%s', 'now') AS INTEGER)
         WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )

      if (indexName) {
        await transactionDriver.exec(
          `DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`,
        )
      }
    })
  }

  async getStreamPosition(collectionId: string): Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }> {
    await this.ensureCollectionReady(collectionId)
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `read the stream position`,
      )
      const [position, latestRowVersion] = await Promise.all([
        this.readStreamPosition(collectionId, transactionDriver),
        this.readLatestRowVersion(collectionId, transactionDriver),
      ])

      return {
        ...position,
        latestRowVersion,
      }
    })
  }

  private async readLatestRowVersion(
    collectionId: string,
    driver: SQLiteDriver,
  ): Promise<number> {
    const versionRows = await driver.query<{ latest_row_version: number }>(
      `SELECT latest_row_version
       FROM collection_version
       WHERE collection_id = ?
       LIMIT 1`,
      [collectionId],
    )
    return versionRows[0]?.latest_row_version ?? 0
  }

  private async readStreamPosition(
    collectionId: string,
    driver: SQLiteDriver,
  ): Promise<{ latestTerm: number; latestSeq: number }> {
    const [termRows, seqRows] = await Promise.all([
      driver.query<{ latest_term: number }>(
        `SELECT latest_term
         FROM leader_term
         WHERE collection_id = ?
         LIMIT 1`,
        [collectionId],
      ),
      driver.query<{ max_seq: number }>(
        `SELECT MAX(seq) AS max_seq
         FROM applied_tx
         WHERE collection_id = ? AND term = (
           SELECT latest_term FROM leader_term WHERE collection_id = ? LIMIT 1
         )`,
        [collectionId, collectionId],
      ),
    ])

    return {
      latestTerm: termRows[0]?.latest_term ?? 0,
      latestSeq: seqRows[0]?.max_seq ?? 0,
    }
  }

  private async readKeySetEvidence(
    collectionId: string,
    driver: SQLiteDriver,
  ): Promise<{
    latestRowVersion: number
    keySet: PersistedKeySetEvidence
  }> {
    const versionRows = await driver.query<{
      latest_row_version: number
      key_set_evidence_available: number
      key_set_incompatible: number
    }>(
      `SELECT
         latest_row_version,
         key_set_evidence_available,
         key_set_evidence_incompatible AS key_set_incompatible
       FROM collection_version
       WHERE collection_id = ?
       LIMIT 1`,
      [collectionId],
    )
    const version = versionRows[0]

    return {
      latestRowVersion: version?.latest_row_version ?? 0,
      keySet: {
        status:
          version?.key_set_evidence_available !== 1
            ? `unknown`
            : version.key_set_incompatible === 1
              ? `incompatible`
              : `consistent`,
      },
    }
  }

  async pullSince(
    collectionId: string,
    fromRowVersion: number,
  ): Promise<SQLitePullSinceResult<string | number>> {
    const tableMapping = await this.ensureCollectionReady(collectionId)
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const tombstoneTableSql = quoteIdentifier(tableMapping.tombstoneTableName)

    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCurrentSchemaVersion(
        collectionId,
        transactionDriver,
        `read persisted transaction deltas`,
      )
      const [
        changedRows,
        deletedRows,
        latestVersionRows,
        replayRows,
        replayAvailabilityRows,
      ] = await Promise.all([
        transactionDriver.query<{ key: string }>(
          `SELECT key
         FROM ${collectionTableSql}
         WHERE row_version > ?`,
          [fromRowVersion],
        ),
        transactionDriver.query<{ key: string }>(
          `SELECT key
         FROM ${tombstoneTableSql}
         WHERE row_version > ?`,
          [fromRowVersion],
        ),
        transactionDriver.query<{ latest_row_version: number }>(
          `SELECT latest_row_version
         FROM collection_version
         WHERE collection_id = ?
         LIMIT 1`,
          [collectionId],
        ),
        transactionDriver.query<{
          tx_id: string
          row_version: number
          replay_json: string | null
          replay_requires_full_reload: number
        }>(
          `SELECT tx_id, row_version, replay_json, replay_requires_full_reload
         FROM applied_tx
         WHERE collection_id = ? AND row_version > ?
         ORDER BY term ASC, seq ASC`,
          [collectionId, fromRowVersion],
        ),
        transactionDriver.query<{ min_row_version: number | null }>(
          `SELECT MIN(row_version) AS min_row_version
         FROM applied_tx
         WHERE collection_id = ?`,
          [collectionId],
        ),
      ])

      const latestRowVersion = latestVersionRows[0]?.latest_row_version ?? 0
      const replayFloor = replayAvailabilityRows[0]?.min_row_version
      if (
        latestRowVersion > fromRowVersion &&
        (replayFloor == null || replayFloor > fromRowVersion + 1)
      ) {
        return {
          latestRowVersion,
          requiresFullReload: true,
        }
      }

      const changedKeyCount = changedRows.length + deletedRows.length

      if (changedKeyCount > this.pullSinceReloadThreshold) {
        return {
          latestRowVersion,
          requiresFullReload: true,
        }
      }

      if (
        replayRows.some(
          (row) =>
            row.replay_requires_full_reload !== 0 || row.replay_json == null,
        )
      ) {
        return {
          latestRowVersion,
          requiresFullReload: true,
        }
      }

      const decodeKey = (encodedKey: string): string | number => {
        try {
          return decodePersistedStorageKey(encodedKey)
        } catch (error) {
          throw new InvalidPersistedStorageKeyEncodingError(
            `${encodedKey}: ${(error as Error).message}`,
          )
        }
      }

      const deltas = replayRows.map((row) => {
        const parsed = deserializePersistedRowValue<ReplayableTxDelta | null>(
          row.replay_json ?? `null`,
        )
        if (!parsed) {
          throw new InvalidPersistedCollectionConfigError(
            `missing replay payload for applied_tx row`,
          )
        }
        return parsed
      })

      const replayChangeCount = deltas.reduce(
        (count, delta) =>
          count +
          delta.changedRows.length +
          delta.deletedKeys.length +
          delta.rowMetadataMutations.length +
          delta.collectionMetadataMutations.length,
        0,
      )

      if (replayChangeCount > this.pullSinceReloadThreshold) {
        return {
          latestRowVersion,
          requiresFullReload: true,
        }
      }

      return {
        latestRowVersion,
        requiresFullReload: false,
        changedKeys: changedRows.map((row) => decodeKey(row.key)),
        deletedKeys: deletedRows.map((row) => decodeKey(row.key)),
        deltas,
      }
    })
  }

  private async loadSubsetInternal(
    tableMapping: CollectionTableMapping,
    options: LoadSubsetOptions,
    driver: SQLiteDriver = this.driver,
  ): Promise<Array<InMemoryRow<string | number, Record<string, unknown>>>> {
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const whereCompiled = options.where
      ? compileSqlExpression(options.where)
      : { supported: true, sql: ``, params: [] as Array<SqliteSupportedValue> }
    const orderByCompiled = compileOrderByClauses(options.orderBy)

    const queryParams: Array<SqliteSupportedValue> = []
    let sql = `SELECT key, value, metadata, row_version FROM ${collectionTableSql}`

    if (options.where && whereCompiled.supported) {
      sql = `${sql} WHERE ${whereCompiled.sql}`
      queryParams.push(...whereCompiled.params)
    }

    if (options.orderBy && orderByCompiled.supported) {
      sql = `${sql} ORDER BY ${orderByCompiled.sql}, key ASC`
      queryParams.push(...orderByCompiled.params)
    }

    const storedRows = await driver.query<StoredSqliteRow>(sql, queryParams)
    const parsedRows = decodeStoredSqliteRows(storedRows)

    const filteredRows = this.applyInMemoryWhere(parsedRows, options.where)
    const orderedRows = this.applyInMemoryOrderBy(filteredRows, options.orderBy)
    return this.applyInMemoryPagination(
      orderedRows,
      options.limit,
      options.offset,
    )
  }

  private applyInMemoryWhere(
    rows: Array<InMemoryRow<string | number, Record<string, unknown>>>,
    where: IR.BasicExpression<boolean> | undefined,
  ): Array<InMemoryRow<string | number, Record<string, unknown>>> {
    if (!where) {
      return rows
    }

    const evaluator = compileRowExpressionEvaluator(where)
    return rows.filter((row) =>
      toBooleanPredicate(evaluator(row.value) as boolean | null),
    )
  }

  private applyInMemoryOrderBy(
    rows: Array<InMemoryRow<string | number, Record<string, unknown>>>,
    orderBy: IR.OrderBy | undefined,
  ): Array<InMemoryRow<string | number, Record<string, unknown>>> {
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
        const leftValue = clause.evaluator(left.value)
        const rightValue = clause.evaluator(right.value)

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
    rows: Array<InMemoryRow<string | number, Record<string, unknown>>>,
    limit: number | undefined,
    offset: number | undefined,
  ): Array<InMemoryRow<string | number, Record<string, unknown>>> {
    const start = offset ?? 0
    if (limit === undefined) {
      return rows.slice(start)
    }
    return rows.slice(start, start + limit)
  }

  private async touchRequiredIndexes(
    collectionId: string,
    requiredIndexSignatures: ReadonlyArray<string> | undefined,
    driver: SQLiteDriver = this.driver,
  ): Promise<void> {
    if (!requiredIndexSignatures || requiredIndexSignatures.length === 0) {
      return
    }

    for (const signature of requiredIndexSignatures) {
      await driver.run(
        `UPDATE persisted_index_registry
         SET last_used_at = CAST(strftime('%s', 'now') AS INTEGER),
             updated_at = CAST(strftime('%s', 'now') AS INTEGER)
         WHERE collection_id = ? AND signature = ? AND removed = 0`,
        [collectionId, signature],
      )
    }
  }

  private async pruneAppliedTxRows(
    collectionId: string,
    driver: SQLiteDriver = this.driver,
  ): Promise<void> {
    if (
      this.appliedTxPruneMaxAgeSeconds !== undefined &&
      this.appliedTxPruneMaxAgeSeconds > 0
    ) {
      await driver.run(
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

    const countRows = await driver.query<{ count: number }>(
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

    await driver.run(
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

    const inFlight = this.collectionTableLoads.get(collectionId)
    if (inFlight) {
      return inFlight
    }

    const loadPromise = this.ensureCollectionReadyInternal(collectionId)
    this.collectionTableLoads.set(collectionId, loadPromise)

    try {
      return await loadPromise
    } finally {
      this.collectionTableLoads.delete(collectionId)
    }
  }

  private async loadCollectionRegistration(collectionId: string): Promise<
    | {
        table_name: string
        tombstone_table_name: string
        schema_version: number
      }
    | undefined
  > {
    const rows = await this.driver.query<{
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

    return rows[0]
  }

  private async ensureCollectionReadyInternal(
    collectionId: string,
  ): Promise<CollectionTableMapping> {
    let registration = await this.loadCollectionRegistration(collectionId)

    if (!registration) {
      const tableName = createPersistedTableName(collectionId, `c`)
      const tombstoneTableName = createPersistedTableName(collectionId, `t`)
      await this.driver.run(
        `INSERT INTO collection_registry (
           collection_id,
           table_name,
           tombstone_table_name,
           schema_version,
           updated_at
         )
         VALUES (?, ?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))
         ON CONFLICT DO NOTHING`,
        [collectionId, tableName, tombstoneTableName, this.schemaVersion],
      )

      registration = await this.loadCollectionRegistration(collectionId)
      if (!registration) {
        throw new InvalidPersistedCollectionConfigError(
          `Unable to register persistence tables for collection "${collectionId}"`,
        )
      }
    }

    const tableName = registration.table_name
    const tombstoneTableName = registration.tombstone_table_name
    if (registration.schema_version !== this.schemaVersion) {
      await this.handleSchemaMismatch(
        collectionId,
        registration.schema_version,
        this.schemaVersion,
        tableName,
        tombstoneTableName,
      )
    }

    const collectionTableSql = quoteIdentifier(tableName)
    const tombstoneTableSql = quoteIdentifier(tombstoneTableName)

    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS ${collectionTableSql} (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         metadata TEXT,
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
      `INSERT INTO collection_version (
         collection_id,
         latest_row_version,
         key_set_evidence_available,
         key_set_evidence_incompatible
       )
       VALUES (?, 0, 1, 0)
       ON CONFLICT(collection_id) DO NOTHING`,
      [collectionId],
    )
    await this.driver.run(
      `INSERT INTO collection_reset_epoch (collection_id, reset_epoch, updated_at)
       VALUES (?, 0, CAST(strftime('%s', 'now') AS INTEGER))
       ON CONFLICT(collection_id) DO NOTHING`,
      [collectionId],
    )
    await this.ensureCollectionKeyEvidenceTriggers(collectionId, tableName)
    const mapping = {
      tableName,
      tombstoneTableName,
    }
    this.collectionTableCache.set(collectionId, mapping)
    return mapping
  }

  private async ensureCollectionKeyEvidenceTriggers(
    collectionId: string,
    tableName: string,
  ): Promise<void> {
    const collectionTableSql = quoteIdentifier(tableName)
    const collectionIdLiteral = toSqliteLiteral(collectionId)
    const insertTriggerSql = quoteIdentifier(`${tableName}_key_evidence_insert`)
    const deleteTriggerSql = quoteIdentifier(`${tableName}_key_evidence_delete`)
    const updateTriggerSql = quoteIdentifier(`${tableName}_key_evidence_update`)

    await this.driver.exec(
      `CREATE TRIGGER IF NOT EXISTS ${insertTriggerSql}
       AFTER INSERT ON ${collectionTableSql}
       WHEN EXISTS (
         SELECT 1
         FROM collection_version
         WHERE collection_id = ${collectionIdLiteral}
           AND key_set_evidence_available = 1
       ) AND NOT EXISTS (
         SELECT 1
         FROM collection_expected_keys
         WHERE collection_id = ${collectionIdLiteral}
           AND key = NEW.key
       )
       BEGIN
         UPDATE collection_version
         SET key_set_evidence_incompatible = 1
         WHERE collection_id = ${collectionIdLiteral};
       END`,
    )
    await this.driver.exec(
      `CREATE TRIGGER IF NOT EXISTS ${deleteTriggerSql}
       AFTER DELETE ON ${collectionTableSql}
       WHEN EXISTS (
         SELECT 1
         FROM collection_version
         WHERE collection_id = ${collectionIdLiteral}
           AND key_set_evidence_available = 1
       ) AND EXISTS (
         SELECT 1
         FROM collection_expected_keys
         WHERE collection_id = ${collectionIdLiteral}
           AND key = OLD.key
       )
       BEGIN
         UPDATE collection_version
         SET key_set_evidence_incompatible = 1
         WHERE collection_id = ${collectionIdLiteral};
       END`,
    )
    await this.driver.exec(
      `CREATE TRIGGER IF NOT EXISTS ${updateTriggerSql}
       AFTER UPDATE OF key ON ${collectionTableSql}
       WHEN OLD.key <> NEW.key AND EXISTS (
         SELECT 1
         FROM collection_version
         WHERE collection_id = ${collectionIdLiteral}
           AND key_set_evidence_available = 1
       )
       BEGIN
         UPDATE collection_version
         SET key_set_evidence_incompatible = 1
         WHERE collection_id = ${collectionIdLiteral};
       END`,
    )
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

    await this.runInTransaction(async (transactionDriver) => {
      const currentSchemaRows = await transactionDriver.query<{
        schema_version: number
      }>(
        `SELECT schema_version
         FROM collection_registry
         WHERE collection_id = ?
         LIMIT 1`,
        [collectionId],
      )
      const currentSchemaVersion = currentSchemaRows[0]?.schema_version
      if (currentSchemaVersion === nextSchemaVersion) {
        return
      }
      if (currentSchemaVersion !== previousSchemaVersion) {
        throw new InvalidPersistedCollectionConfigError(
          `Schema version changed concurrently for collection "${collectionId}": ` +
            `found ${currentSchemaVersion ?? `no registry entry`} after observing ${previousSchemaVersion}; ` +
            `refusing to reset it to ${nextSchemaVersion}.`,
        )
      }

      const persistedIndexes = await transactionDriver.query<{
        index_name: string
      }>(
        `SELECT index_name
         FROM persisted_index_registry
         WHERE collection_id = ?`,
        [collectionId],
      )
      for (const row of persistedIndexes) {
        await transactionDriver.exec(
          `DROP INDEX IF EXISTS ${quoteIdentifier(row.index_name)}`,
        )
      }

      await transactionDriver.run(
        `DELETE FROM collection_expected_keys
         WHERE collection_id = ?`,
        [collectionId],
      )
      await transactionDriver.run(`DELETE FROM ${collectionTableSql}`)
      await transactionDriver.run(`DELETE FROM ${tombstoneTableSql}`)
      await transactionDriver.run(
        `DELETE FROM applied_tx
         WHERE collection_id = ?`,
        [collectionId],
      )
      await transactionDriver.run(
        `DELETE FROM persisted_index_registry
         WHERE collection_id = ?`,
        [collectionId],
      )
      await transactionDriver.run(
        `DELETE FROM collection_metadata
         WHERE collection_id = ?`,
        [collectionId],
      )
      await transactionDriver.run(
        `UPDATE collection_registry
         SET schema_version = ?,
             updated_at = CAST(strftime('%s', 'now') AS INTEGER)
         WHERE collection_id = ?`,
        [nextSchemaVersion, collectionId],
      )
      await transactionDriver.run(
        `INSERT INTO collection_version (
           collection_id,
           latest_row_version,
           key_set_evidence_available,
           key_set_evidence_incompatible
         )
         VALUES (?, 0, 1, 0)
         ON CONFLICT(collection_id) DO UPDATE SET
           latest_row_version = 0,
           key_set_evidence_available = 1,
           key_set_evidence_incompatible = 0`,
        [collectionId],
      )
      await transactionDriver.run(
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
         replay_json TEXT,
         replay_requires_full_reload INTEGER NOT NULL DEFAULT 0,
         applied_at INTEGER NOT NULL,
         PRIMARY KEY (collection_id, term, seq)
       )`,
    )
    try {
      await this.driver.exec(
        `ALTER TABLE applied_tx ADD COLUMN replay_json TEXT`,
      )
    } catch (error) {
      if (!isDuplicateColumnAddError(error, `replay_json`)) {
        throw error
      }
    }
    try {
      await this.driver.exec(
        `ALTER TABLE applied_tx ADD COLUMN replay_requires_full_reload INTEGER NOT NULL DEFAULT 0`,
      )
    } catch (error) {
      if (!isDuplicateColumnAddError(error, `replay_requires_full_reload`)) {
        throw error
      }
    }
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS collection_version (
         collection_id TEXT PRIMARY KEY,
         latest_row_version INTEGER NOT NULL,
         key_set_evidence_available INTEGER NOT NULL DEFAULT 0,
         key_set_evidence_incompatible INTEGER NOT NULL DEFAULT 0
       )`,
    )
    const collectionVersionColumns = await this.driver.query<{ name: string }>(
      `PRAGMA table_info(collection_version)`,
    )
    const keyEvidenceColumns = [
      `key_set_evidence_available`,
      `key_set_evidence_incompatible`,
    ] as const
    for (const columnName of keyEvidenceColumns) {
      if (collectionVersionColumns.some(({ name }) => name === columnName)) {
        continue
      }
      try {
        await this.driver.exec(
          `ALTER TABLE collection_version ADD COLUMN ${columnName} INTEGER NOT NULL DEFAULT 0`,
        )
      } catch (error) {
        if (!isDuplicateColumnAddError(error, columnName)) {
          throw error
        }
      }
    }
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS collection_expected_keys (
         collection_id TEXT NOT NULL,
         key TEXT NOT NULL,
         PRIMARY KEY (collection_id, key)
       )`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS collection_metadata (
         collection_id TEXT NOT NULL,
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (collection_id, key)
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

export function createSQLiteCorePersistenceAdapter(
  options: SQLiteCoreAdapterOptions,
): PersistenceAdapter {
  return new SQLiteCorePersistenceAdapter(options)
}
