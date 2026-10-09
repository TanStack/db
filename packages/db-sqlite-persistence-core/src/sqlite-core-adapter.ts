import {
  IR,
  compareTemporalValues,
  compileSingleRowExpression,
  safeRandomUUID,
  toBooleanPredicate,
} from '@tanstack/db'
import {
  InvalidPersistedCollectionConfigError,
  InvalidPersistedStorageKeyEncodingError,
} from './errors'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
} from './persisted'
import {
  PERSISTED_TYPE_TAG,
  PERSISTED_VALUE_TAG,
  assertSQLiteBigIntInRange,
  reviveSQLiteTemporal,
  serializeSQLiteBigInt,
  serializeSQLiteTemporal,
  sqliteTemporalIdentity,
  sqliteTemporalKind,
} from './sqlite-value'
import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  HydrationPersistenceAdapter,
  PersistedCacheGenerationClaim,
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

// The default stays below SQLite's older 999-variable limit. Drivers with a
// lower binding cap use smaller chunks; each replacement row binds four values.
const REPLACEMENT_BATCH_SIZE = 125

type CollectionTableMapping = {
  tableName: string
  tombstoneTableName: string
}

type CompiledSqlFragment = {
  supported: boolean
  sql: string
  params: Array<SqliteSupportedValue>
  identitySql?: string
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
  `sync-present-reset` | `sync-absent-error` | `reset`

export type SQLiteCoreAdapterOptions = {
  driver: SQLiteDriver
  schemaVersion?: number
  schemaMismatchPolicy?: SQLiteCoreAdapterSchemaMismatchPolicy
  appliedTxPruneMaxRows?: number
  appliedTxPruneMaxAgeSeconds?: number
  pullSinceReloadThreshold?: number
  /** Milliseconds without renewal before a sync run loses cache access. */
  cacheGenerationClaimTtlMs?: number
  /** Host clock, injectable for expiry histories. */
  now?: () => number
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

type ScheduledOperationKind = `regular` | `hydrate`

type ScheduledOperation<T> = {
  kind: ScheduledOperationKind
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

class SharedPersistenceScheduler {
  private readonly regularQueue: Array<ScheduledOperation<unknown>> = []
  private readonly hydrateQueue: Array<ScheduledOperation<unknown>> = []
  private running = false
  private lastCompletedKind: ScheduledOperationKind | undefined

  runRegular<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueue(`regular`, task)
  }

  runHydrate<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueue(`hydrate`, task)
  }

  adoptRunningHydrate(completion: Promise<unknown>): void {
    if (this.running) return
    this.running = true
    const finish = () => {
      this.lastCompletedKind = `hydrate`
      this.running = false
      this.drain()
    }
    void completion.then(finish, finish)
  }

  private enqueue<T>(
    kind: ScheduledOperationKind,
    task: () => Promise<T>,
  ): Promise<T> {
    const result = new Promise<T>((resolve, reject) => {
      const operation: ScheduledOperation<T> = {
        kind,
        task,
        resolve,
        reject,
      }
      const queue = kind === `hydrate` ? this.hydrateQueue : this.regularQueue
      queue.push(operation as ScheduledOperation<unknown>)
    })
    this.drain()
    return result
  }

  private drain(): void {
    if (this.running) return

    const operation = this.takeNext()
    if (!operation) return

    this.running = true
    void this.execute(operation)
  }

  private async execute(operation: ScheduledOperation<unknown>): Promise<void> {
    try {
      operation.resolve(await operation.task())
    } catch (error) {
      operation.reject(error)
    } finally {
      this.lastCompletedKind = operation.kind
      this.running = false
      this.drain()
    }
  }

  private takeNext(): ScheduledOperation<unknown> | undefined {
    // Hydrates get priority after the currently running non-preemptible unit.
    // While both lanes remain queued, alternate one regular operation after
    // each hydrate (K=1), preserving FIFO order within each lane.
    if (this.hydrateQueue.length > 0) {
      if (
        this.regularQueue.length > 0 &&
        this.lastCompletedKind === `hydrate`
      ) {
        return this.regularQueue.shift()
      }
      return this.hydrateQueue.shift()
    }
    return this.regularQueue.shift()
  }
}

const sharedPersistenceSchedulers = new WeakMap<
  object,
  SharedPersistenceScheduler
>()
const observedDriverSchedulingKeys = new WeakMap<object, object>()

function getSharedPersistenceScheduler(
  key: object,
): SharedPersistenceScheduler {
  let scheduler = sharedPersistenceSchedulers.get(key)
  if (!scheduler) {
    scheduler = new SharedPersistenceScheduler()
    sharedPersistenceSchedulers.set(key, scheduler)
  }
  return scheduler
}

function getSharedLogicalSchedulingKey(value: unknown): object | undefined {
  if ((typeof value !== `object` && typeof value !== `function`) || !value) {
    return undefined
  }
  const key = (
    value as {
      [SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]?: unknown
    }
  )[SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]
  return key !== null && (typeof key === `object` || typeof key === `function`)
    ? key
    : undefined
}

function observeSharedLogicalSchedulingSupport(
  driver: SQLiteDriver,
  onSupport: (key: object) => void,
): SQLiteDriver {
  let observationPending = true
  const observe = <T>(promise: Promise<T>): Promise<T> => {
    if (!observationPending) return promise
    observationPending = false
    const key = getSharedLogicalSchedulingKey(promise)
    if (key) onSupport(key)
    return promise
  }

  return {
    maxBoundParameters: driver.maxBoundParameters,
    exec: (sql) => observe(driver.exec(sql)),
    query: <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
      observe(driver.query<T>(sql, params)),
    run: (sql, params = []) => observe(driver.run(sql, params)),
    transaction: <T>(fn: (transactionDriver: SQLiteDriver) => Promise<T>) =>
      observe(driver.transaction(fn)),
    transactionWithDriver: <T>(
      fn: (transactionDriver: SQLiteDriver) => Promise<T>,
    ) =>
      observe(
        driver.transactionWithDriver
          ? driver.transactionWithDriver(fn)
          : driver.transaction(fn),
      ),
  }
}

const DEFAULT_SCHEMA_VERSION = 1
const CACHE_GENERATION_ID_PREFIX = `tanstack-db-cache:`
const LEGACY_CACHE_GENERATION_ID_PREFIX = `\u0000tanstack-db-cache:`

function hasCacheGenerationIdPrefix(collectionId: string): boolean {
  return (
    collectionId.startsWith(CACHE_GENERATION_ID_PREFIX) ||
    collectionId.startsWith(LEGACY_CACHE_GENERATION_ID_PREFIX)
  )
}
export const DEFAULT_CACHE_GENERATION_CLAIM_TTL_MS = 5 * 60_000
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

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const FORBIDDEN_SQL_FRAGMENT_PATTERN = /(;|--|\/\*)/
type CompiledValueKind = `unknown` | `bigint` | `date` | `datetime`
type PersistedTaggedValueType =
  | `bigint`
  | `date`
  | `nan`
  | `infinity`
  | `-infinity`
  | `string`
  | `Temporal.Instant`
  | `Temporal.PlainDate`
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
  `string`,
  `Temporal.Instant`,
  `Temporal.PlainDate`,
])

const orderByObjectIds = new WeakMap<object, number>()
let nextOrderByObjectId = 1

function isDuplicateColumnAddError(
  error: unknown,
  columnName: string,
): boolean {
  if (typeof error !== `string` && !(error instanceof Error)) {
    return false
  }

  const normalizedMessage = (
    typeof error === `string` ? error : error.message
  ).toLowerCase()
  return (
    normalizedMessage.includes(columnName.toLowerCase()) &&
    (normalizedMessage.includes(`duplicate column name`) ||
      normalizedMessage.includes(`already exists`))
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

  const temporal = serializeSQLiteTemporal(value)
  if (temporal) return temporal

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
    // Escape the marker field itself, leaving ordinary nested JSON paths intact.
    if (typeof recordValue[PERSISTED_TYPE_TAG] === `string`) {
      encodedRecord[PERSISTED_TYPE_TAG] = {
        [PERSISTED_TYPE_TAG]: `string`,
        [PERSISTED_VALUE_TAG]: recordValue[PERSISTED_TYPE_TAG],
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
      case `string`:
        return value[PERSISTED_VALUE_TAG]
      case `Temporal.Instant`:
      case `Temporal.PlainDate`:
        return reviveSQLiteTemporal(
          value[PERSISTED_TYPE_TAG],
          value[PERSISTED_VALUE_TAG],
        )
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

  const temporal = serializeSQLiteTemporal(value)
  return temporal?.order ?? serializePersistedRowValue(value)
}

function toSqliteLiteral(value: SqliteSupportedValue): string {
  if (value === null) {
    return `NULL`
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? String(value) : `NULL`
  }

  if (value.includes(`\u0000`)) {
    // JSON escapes NUL before SQL parsing and matches stored-string extraction.
    return `json_extract(${toSqliteLiteral(JSON.stringify(value))}, '$')`
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
    if (compareOptions.stringSort === `custom`) {
      return compareOptions.compare(left, right)
    }
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

  if (sqliteTemporalKind(left) && sqliteTemporalKind(right)) {
    return compareTemporalValues(left, right)
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

const MAX_INDEXED_NUMERIC_PATH_SEGMENTS = 3

function hasDeepNumericPath(expression: IR.BasicExpression): boolean {
  if (expression.type === `ref`) {
    return (
      IR.getPropRefPropertyPath(expression).filter((segment) =>
        /^[0-9]+$/.test(String(segment)),
      ).length > MAX_INDEXED_NUMERIC_PATH_SEGMENTS
    )
  }
  return expression.type === `func` && expression.args.some(hasDeepNumericPath)
}

function createJsonPathVariants(path: Array<string>): Array<string> | null {
  const canonical = createJsonPath(path)
  if (!canonical) return null

  let paths = [`$`]
  for (const segment of path) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      paths = paths.map((prefix) => `${prefix}.${segment}`)
    } else if (/^[0-9]+$/.test(segment)) {
      if (paths.length >= 2 ** MAX_INDEXED_NUMERIC_PATH_SEGMENTS)
        return [canonical]
      paths = paths.flatMap((prefix) => [
        `${prefix}[${segment}]`,
        `${prefix}."${segment}"`,
      ])
    }
  }
  return paths
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

  const typeSql = `json_extract(value, ${typePathSql})`
  const orderPathSql = toSqliteLiteral(`${jsonPath}.order`)
  const sql = `(CASE ${typeSql}
      WHEN 'bigint' THEN CAST(json_extract(value, ${taggedValuePathSql}) AS NUMERIC)
      WHEN 'date' THEN json_extract(value, ${taggedValuePathSql})
      WHEN 'string' THEN json_extract(value, ${taggedValuePathSql})
      WHEN 'Temporal.Instant' THEN json_extract(value, ${orderPathSql})
      WHEN 'Temporal.PlainDate' THEN json_extract(value, ${orderPathSql})
      WHEN 'nan' THEN NULL
      WHEN 'infinity' THEN NULL
      WHEN '-infinity' THEN NULL
      ELSE json_extract(value, ${jsonPathSql})
    END)`
  return {
    supported: true,
    sql,
    identitySql: `(CASE WHEN ${typeSql} IN ('Temporal.Instant', 'Temporal.PlainDate') THEN ${typeSql} || ':' || json_extract(value, ${taggedValuePathSql}) ELSE ${sql} END)`,
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

/** Balance disjunctions so a large membership index stays below SQL depth limits. */
function joinSqlDisjunction(parts: ReadonlyArray<string>): string {
  if (parts.length === 1) return parts[0]!
  const middle = Math.floor(parts.length / 2)
  return `(${joinSqlDisjunction(parts.slice(0, middle))} OR ${joinSqlDisjunction(parts.slice(middle))})`
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

function hasUnpairedSurrogate(value: string): boolean {
  // With /u, paired surrogates form one code point; lone surrogates still match.
  return /[\uD800-\uDFFF]/u.test(value)
}

function isSafeEqualityLiteral(value: unknown): boolean {
  return (
    typeof value === `string` ||
    typeof value === `boolean` ||
    typeof value === `bigint` ||
    sqliteTemporalKind(value) !== undefined
  )
}

function isSafeCoalesceOperand(
  expression: IR.BasicExpression | undefined,
): boolean {
  return (
    expression?.type === `func` &&
    expression.name === `coalesce` &&
    expression.args.length === 2 &&
    expression.args[0]?.type === `ref` &&
    expression.args[1]?.type === `val` &&
    isSafeEqualityLiteral(expression.args[1].value) &&
    !(
      typeof expression.args[1].value === `string` &&
      hasUnpairedSurrogate(expression.args[1].value)
    )
  )
}

function compileSqlExpression(
  expression: IR.BasicExpression,
  context: SqlExpressionCompilationContext = `predicate`,
): CompiledSqlFragment {
  if (expression.type === `val`) {
    if (
      context === `predicate` &&
      typeof expression.value === `string` &&
      hasUnpairedSurrogate(expression.value)
    ) {
      // JSON extraction changes lone surrogates in stored strings. Apply the
      // same extraction to the binding so an indexed equality keeps its row.
      return {
        supported: true,
        sql: `json_extract(?, '$')`,
        params: [JSON.stringify(expression.value)],
      }
    }
    const temporal = serializeSQLiteTemporal(expression.value)
    const value = temporal?.order ?? toSqliteParameterValue(expression.value)
    return {
      identitySql: temporal
        ? toSqliteLiteral(sqliteTemporalIdentity(temporal))
        : undefined,
      supported: true,
      sql:
        context === `index-expression`
          ? toSqliteExpressionLiteral(
              typeof expression.value === `bigint` ? expression.value : value,
            )
          : `?`,
      params: context === `predicate` ? [value] : [],
      valueKind: getLiteralValueKind(expression.value),
    }
  }

  if (expression.type === `ref`) {
    const jsonPaths = createJsonPathVariants(
      IR.getPropRefPropertyPath(expression).map(String),
    )
    if (!jsonPaths) {
      return {
        supported: false,
        sql: ``,
        params: [],
      }
    }

    if (jsonPaths.length === 1) return compileRefExpressionSql(jsonPaths[0]!)
    const variants = jsonPaths.map(compileRefExpressionSql)
    return {
      supported: true,
      identitySql: `COALESCE(${variants.map((variant) => variant.identitySql).join(`, `)})`,
      sql: `COALESCE(${variants.map((variant) => variant.sql).join(`, `)})`,
      params: [],
      valueKind: `unknown`,
    }
  }

  // IN owns its list encoding; compiling that list as a scalar discards work.
  const args =
    expression.name === `in` ? expression.args.slice(0, 1) : expression.args
  const compiledArgs = args.map((arg, index) =>
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

      const comparison = compileComparisonSql(
        operatorByName[expression.name],
        expression.args[0]!,
        expression.args[1]!,
        argSql[0],
        argSql[1],
        valueKind,
        getCompiledValueKind(compiledArgs[0]),
        getCompiledValueKind(compiledArgs[1]),
      )
      // Native order ties need canonical identity, including in persisted
      // expressions. Ordinary string predicates keep one binding; residual
      // filtering removes native order-key collisions from their candidate set.
      const needsIdentity =
        expression.name === `eq` &&
        expression.args.every(
          (arg) =>
            arg.type !== `val` ||
            sqliteTemporalKind(arg.value) ||
            (context === `index-expression` && typeof arg.value === `string`),
        )
      return {
        supported: true,
        sql: needsIdentity
          ? `(${comparison} AND (${compiledArgs[0].identitySql ?? argSql[0]} = ${compiledArgs[1].identitySql ?? argSql[1]}))`
          : comparison,
        params,
      }
    }
    case `and`:
    case `or`: {
      if (argSql.length === 0) {
        return {
          supported: true,
          sql: expression.name === `and` ? `(1 = 1)` : `(0 = 1)`,
          params: [],
        }
      }
      return {
        supported: true,
        sql: argSql
          .map((sql) => `(${sql})`)
          .join(expression.name === `and` ? ` AND ` : ` OR `),
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

      // Order and identity are two projections of one validated native encoding.
      const values = listValue.map((value) => {
        const temporal = serializeSQLiteTemporal(value)
        return {
          value:
            typeof value === `bigint`
              ? assertSQLiteBigIntInRange(value)
              : (temporal?.order ?? toSqliteParameterValue(value)),
          identity: temporal ? sqliteTemporalIdentity(temporal) : undefined,
        }
      })
      let identity = ``
      if (
        listValue.some(
          (value) =>
            sqliteTemporalKind(value) ||
            (context === `index-expression` && typeof value === `string`),
        )
      ) {
        const leftIdentity = compiledArgs[0]?.identitySql ?? leftSql
        // Index expressions cannot contain subqueries. Both forms preserve
        // correlated membership and SQL's three-valued Boolean semantics.
        identity =
          context === `index-expression`
            ? ` AND (${joinSqlDisjunction(values.map(({ value, identity: nativeIdentity }) => `(${leftSql} = ${toSqliteExpressionLiteral(value)} AND ${leftIdentity} = ${toSqliteExpressionLiteral(nativeIdentity ?? value)})`))})`
            : ` AND ((${leftSql}, ${leftIdentity}) IN (VALUES ${[...new Set(values.map(({ value, identity: nativeIdentity }) => `(${toSqliteExpressionLiteral(value)}, ${toSqliteExpressionLiteral(nativeIdentity ?? value)})`))].join(`, `)}))`
      }
      if (context === `index-expression`) {
        return {
          supported: true,
          sql: `(${leftSql} IN (${values
            .map(({ value }) => toSqliteExpressionLiteral(value))
            .join(`, `)})${identity})`,
          params: leftParams,
        }
      }

      const jsonList = `[${values
        .map(({ value }) =>
          typeof value === `bigint`
            ? assertSQLiteBigIntInRange(value).toString()
            : JSON.stringify(value),
        )
        .join(`,`)}]`
      return {
        supported: true,
        sql: `(${leftSql} IN (SELECT value FROM json_each(?))${identity})`,
        params: [...leftParams, jsonList],
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
      return {
        supported: true,
        sql: `COALESCE(${argSql.join(`, `)})`,
        identitySql: `COALESCE(${compiledArgs.map((arg) => arg.identitySql ?? arg.sql).join(`, `)})`,
        params,
      }
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

/** A raw ref/native-literal leaf has exact native truth before prefilter broadening. */
function nativeComparisonRef(
  expression: IR.BasicExpression,
): IR.PropRef | undefined {
  if (expression.type !== `func` || expression.args.length !== 2)
    return undefined
  const [left, right] = expression.args
  if (expression.name === `in`) {
    return left?.type === `ref` &&
      right?.type === `val` &&
      Array.isArray(right.value) &&
      right.value.length > 0 &&
      right.value.every((value) => sqliteTemporalKind(value))
      ? left
      : undefined
  }
  if (![`eq`, `gt`, `gte`, `lt`, `lte`].includes(expression.name))
    return undefined
  if (
    left?.type === `ref` &&
    right?.type === `val` &&
    sqliteTemporalKind(right.value)
  )
    return left
  if (
    right?.type === `ref` &&
    left?.type === `val` &&
    sqliteTemporalKind(left.value)
  )
    return right
  return undefined
}

function compileNativeRefGuard(ref: IR.PropRef): string {
  const paths = createJsonPathVariants(
    IR.getPropRefPropertyPath(ref).map(String),
  )!
  const kinds = paths.map(
    (path) =>
      `json_extract(value, ${toSqliteLiteral(`${path}.${PERSISTED_TYPE_TAG}`)})`,
  )
  const kind = kinds.length === 1 ? kinds[0] : `COALESCE(${kinds.join(`, `)})`
  return `${kind} IN ('Temporal.Instant', 'Temporal.PlainDate')`
}

function compileSafeSqlPrefilter(
  expression: IR.BasicExpression,
  compiled?: CompiledSqlFragment,
): CompiledSqlFragment | undefined {
  // Every public match must pass this SQL candidate before JavaScript applies
  // the authoritative row predicate. Extra candidates are allowed.
  const direct = () => {
    const candidate = compiled ?? compileSqlExpression(expression)
    return candidate.supported ? candidate : undefined
  }
  if (expression.type === `val`) {
    return typeof expression.value === `boolean` || expression.value == null
      ? direct()
      : undefined
  }
  if (expression.type === `ref`) return undefined

  if (expression.name === `and` || expression.name === `or`) {
    if (expression.args.length === 0) return direct()
    const candidates = expression.args.map((argument) =>
      compileSafeSqlPrefilter(argument),
    )
    if (expression.name === `or` && candidates.some((candidate) => !candidate))
      return undefined
    const selected = candidates.filter(
      (candidate): candidate is CompiledSqlFragment => candidate !== undefined,
    )
    if (selected.length === 0) return undefined
    return {
      supported: true,
      sql: selected
        .map(({ sql }) => `(${sql})`)
        .join(expression.name === `and` ? ` AND ` : ` OR `),
      params: selected.flatMap(({ params }) => params),
    }
  }

  // More than three digit segments need too many alternative JSON paths.
  // Keep their prefilter unbounded rather than exclude an object-key match.
  if (hasDeepNumericPath(expression)) return undefined
  compiled ??= compileSqlExpression(expression)
  if (!compiled.supported) return undefined
  const [left, right] = expression.args
  if (
    expression.name === `not` &&
    expression.args.length === 1 &&
    left &&
    nativeComparisonRef(left)
  ) {
    // Negate the original leaf, never a broadened prefilter. Nonfinite stored
    // scalars project to NULL; retaining them also retains valid NOT matches.
    return { ...compiled, sql: `COALESCE(${compiled.sql}, 1)` }
  }
  if (expression.args.length === 2) {
    const nativeRef = nativeComparisonRef(expression)
    if (nativeRef) {
      if (expression.name === `eq` || expression.name === `in`) return compiled
      // NaN orders above native values in the core evaluator. NULL candidates
      // also preserve that law with either operand direction.
      const fieldSql = compileSqlExpression(nativeRef, `index-expression`).sql
      return { ...compiled, sql: `(${compiled.sql} OR ${fieldSql} IS NULL)` }
    }
    if (
      expression.name === `eq` &&
      left?.type === `ref` &&
      right?.type === `ref`
    ) {
      // Ref/ref scalar coercions are not generally SQL-exact. Restrict only
      // native pairs; leave every other pair to the authoritative evaluator.
      return {
        ...compiled,
        sql: `(CASE WHEN ${compileNativeRefGuard(left)} AND ${compileNativeRefGuard(right)} THEN ${compiled.sql} ELSE 1 END)`,
      }
    }
    if (
      [`gt`, `gte`, `lt`, `lte`].includes(expression.name) &&
      (left?.type === `ref` || right?.type === `ref`)
    ) {
      const field =
        left?.type === `ref` ? left : right?.type === `ref` ? right : undefined
      const literal = field === left ? right : left
      if (
        field &&
        literal?.type === `val` &&
        ((typeof literal.value === `number` &&
          Number.isSafeInteger(literal.value)) ||
          typeof literal.value === `bigint`)
      ) {
        const fieldSql = compileSqlExpression(field, `index-expression`).sql
        const literalSql = compileSqlExpression(
          literal,
          typeof literal.value === `bigint` ? `index-expression` : `predicate`,
        )
        const greaterSide =
          (field === left && [`gt`, `gte`].includes(expression.name)) ||
          (field === right && [`lt`, `lte`].includes(expression.name))
        const unsafeBigInt =
          typeof literal.value === `bigint` &&
          !Number.isSafeInteger(Number(literal.value))
        const roundedNumberCandidates = unsafeBigInt
          ? literal.value > 0n
            ? ` OR ${fieldSql} >= ${Number.MAX_SAFE_INTEGER}`
            : ` OR ${fieldSql} <= -${Number.MAX_SAFE_INTEGER}`
          : ``
        return {
          supported: true,
          sql: greaterSide
            ? `(${fieldSql} >= ${literalSql.sql} OR ${fieldSql} IS NULL${roundedNumberCandidates})`
            : `(${fieldSql} <= ${literalSql.sql} OR ${fieldSql} IS NULL OR ${fieldSql} >= ''${roundedNumberCandidates})`,
          params: literalSql.params,
        }
      }
    }
    if (expression.name === `eq`) {
      if (
        ((left?.type === `ref` || isSafeCoalesceOperand(left)) &&
          right?.type === `val` &&
          isSafeEqualityLiteral(right.value)) ||
        ((right?.type === `ref` || isSafeCoalesceOperand(right)) &&
          left?.type === `val` &&
          isSafeEqualityLiteral(left.value))
      ) {
        return compiled
      }
      const lower =
        left?.type === `func` && left.name === `lower`
          ? left
          : right?.type === `func` && right.name === `lower`
            ? right
            : undefined
      const literal = lower === left ? right : left
      if (
        lower?.args.length === 1 &&
        lower.args[0]?.type === `ref` &&
        literal?.type === `val` &&
        typeof literal.value === `string` &&
        [...literal.value].every((char) => char.charCodeAt(0) <= 0x7f) &&
        !literal.value.includes(`\u0000`)
      ) {
        const lowerSql = compileSqlExpression(lower, `index-expression`).sql
        return {
          supported: true,
          sql: `(${compiled.sql} OR (${lowerSql} >= ? AND ${lowerSql} GLOB '*[^ -~]*'))`,
          params: [...compiled.params, literal.value],
        }
      }
    }
  }
  if (
    expression.name === `in` &&
    expression.args.length === 2 &&
    right?.type === `val` &&
    Array.isArray(right.value)
  ) {
    if (right.value.length === 0) return compiled
    if (left?.type === `ref`) {
      if (right.value.every((value) => typeof value === `bigint`))
        return compiled
      if (right.value.every((value) => typeof value === `string`)) {
        // Both sides pass through SQLite's JSON decoder; one binding keeps
        // large string scopes within the host parameter limit, even in OR.
        return {
          supported: true,
          sql: `(${compileSqlExpression(left, `index-expression`).sql} IN (SELECT value FROM json_each(?)))`,
          params: [JSON.stringify(right.value)],
        }
      }
    }
  }
  if (
    expression.name === `like` &&
    expression.args.length === 2 &&
    left?.type === `ref` &&
    right?.type === `val` &&
    typeof right.value === `string` &&
    /^[\x20-\x7e]*%$/.test(right.value) &&
    !right.value.slice(0, -1).includes(`%`) &&
    !right.value.includes(`_`)
  ) {
    return compiled
  }
  return undefined
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

function* batches<T>(
  changes: ReadonlyArray<T>,
  maxSize: number,
): Generator<Array<T>> {
  for (let offset = 0; offset < changes.length; offset += maxSize) {
    yield changes.slice(offset, offset + maxSize)
  }
}

function lastMetadataByKey<
  T extends { type: `set` | `delete`; value?: unknown },
>(
  changes: ReadonlyArray<T>,
  keyOf: (change: T) => string,
  undefinedSetIsNull = false,
): Array<T> {
  const latest = new Map<string, T>()
  for (const change of changes) {
    const key = keyOf(change)
    const previous = latest.get(key)
    if (
      previous?.type === `set` &&
      (previous.value !== undefined || !undefinedSetIsNull) &&
      (serializePersistedRowValue(previous.value) as string | undefined) ===
        undefined
    ) {
      throw new TypeError(`Metadata value cannot be bound to SQLite`)
    }
    latest.set(key, change)
  }
  return [...latest.values()]
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
  private readonly schedulingIdentitySource: SQLiteDriver
  private scheduler: SharedPersistenceScheduler | undefined
  private activeUnscheduledHydration: Promise<unknown> | undefined
  private readonly hydrationAdapter: HydrationPersistenceAdapter
  private readonly schemaVersion: number
  private readonly schemaMismatchPolicy: SQLiteCoreAdapterSchemaMismatchPolicy
  private readonly appliedTxPruneMaxRows: number | undefined
  private readonly appliedTxPruneMaxAgeSeconds: number | undefined
  private readonly pullSinceReloadThreshold: number
  private readonly replacementBatchSize: number
  private readonly cacheGenerationClaimTtlMs: number
  private readonly now: () => number

  private initialized = false
  private readonly collectionTableCache = new Map<
    string,
    CollectionTableMapping
  >()
  private readonly collectionTableLoads = new Map<
    string,
    Promise<CollectionTableMapping>
  >()

  claimCacheGeneration(
    collectionId: string,
  ): Promise<PersistedCacheGenerationClaim> {
    return this.runRegular(async () => {
      await this.ensureInitialized()
      return this.driver.transaction(async (driver) => {
        const expiresAtMs = this.now() + this.cacheGenerationClaimTtlMs
        // The first generation must not reuse the legacy collection ID: an older
        // adapter can still write that ID without a claim after an upgrade.
        const initialPhysicalId = `${CACHE_GENERATION_ID_PREFIX}${safeRandomUUID()}`
        await driver.run(
          `INSERT INTO cache_generation (logical_id, generation, physical_id, retired)
           SELECT ?, 0, ?, 0
           WHERE NOT EXISTS (
             SELECT 1 FROM cache_generation WHERE logical_id = ?
           )`,
          [collectionId, initialPhysicalId, collectionId],
        )
        const head = await driver.query<{ physical_id: string }>(
          `SELECT physical_id FROM cache_generation
           WHERE logical_id = ? AND retired = 0`,
          [collectionId],
        )
        const storageCollectionId = head[0]?.physical_id
        if (!storageCollectionId) {
          throw new InvalidPersistedCollectionConfigError(
            `No active persisted cache generation for collection "${collectionId}"`,
          )
        }
        const claimId = safeRandomUUID()
        await driver.run(
          `INSERT INTO cache_generation_claim
             (claim_id, logical_id, physical_id, expires_at_ms)
           VALUES (?, ?, ?, ?)`,
          [claimId, collectionId, storageCollectionId, expiresAtMs],
        )
        await this.collectRetiredCacheGenerations(driver)
        return { storageCollectionId, claimId, expiresAtMs }
      })
    })
  }

  rotateCacheGeneration(
    collectionId: string,
    claimId: string,
    resetMetadata?: { key: string; value: unknown },
    expectedStorageCollectionId?: string,
  ): Promise<PersistedCacheGenerationClaim> {
    return this.runRegular(async () => {
      await this.ensureInitialized()
      return this.driver.transaction(async (driver) => {
        const now = this.now()
        const expiresAtMs = now + this.cacheGenerationClaimTtlMs
        const claimed = await driver.query<{
          physical_id: string
          expires_at_ms: number
        }>(
          `SELECT physical_id, expires_at_ms
           FROM cache_generation_claim
           WHERE claim_id = ? AND logical_id = ?`,
          [claimId, collectionId],
        )
        const claimedPhysicalId =
          claimed[0] && claimed[0].expires_at_ms > now
            ? claimed[0].physical_id
            : undefined
        if (
          claimedPhysicalId &&
          expectedStorageCollectionId &&
          claimedPhysicalId !== expectedStorageCollectionId
        ) {
          throw new InvalidPersistedCollectionConfigError(
            `Persisted cache claim changed generations before recovery`,
          )
        }
        const head = await driver.query<{
          generation: number
          physical_id: string
        }>(
          `SELECT generation, physical_id FROM cache_generation
           WHERE logical_id = ? AND retired = 0`,
          [collectionId],
        )
        const active = head[0]
        if (!active) {
          throw new InvalidPersistedCollectionConfigError(
            `No active persisted cache generation for collection "${collectionId}"`,
          )
        }
        await driver.run(
          `INSERT INTO cache_generation_sequence (logical_id, next_generation)
           SELECT ?, COALESCE(MAX(generation), -1) + 1
           FROM cache_generation WHERE logical_id = ?
           ON CONFLICT(logical_id) DO NOTHING`,
          [collectionId, collectionId],
        )
        const nextRows = await driver.query<{ next_generation: number }>(
          `SELECT next_generation FROM cache_generation_sequence
           WHERE logical_id = ?`,
          [collectionId],
        )
        const nextGeneration = nextRows[0]!.next_generation
        await driver.run(
          `UPDATE cache_generation_sequence SET next_generation = ?
           WHERE logical_id = ?`,
          [nextGeneration + 1, collectionId],
        )
        // An expired claim no longer owns the head, even when it remembers
        // the current storage ID. Its recovery is private so another run's
        // valid current cache remains claimable.
        const ownedHead = claimedPhysicalId === active.physical_id
        const storageCollectionId = `${CACHE_GENERATION_ID_PREFIX}${safeRandomUUID()}`
        if (ownedHead) {
          await driver.run(
            `UPDATE cache_generation SET retired = 1
             WHERE logical_id = ? AND generation = ?`,
            [collectionId, active.generation],
          )
        }
        await driver.run(
          `INSERT INTO cache_generation (logical_id, generation, physical_id, retired)
           VALUES (?, ?, ?, ?)`,
          [
            collectionId,
            nextGeneration,
            storageCollectionId,
            ownedHead ? 0 : 1,
          ],
        )
        const nextClaimId = claimed[0] ? claimId : safeRandomUUID()
        if (claimed[0]) {
          await driver.run(
            `UPDATE cache_generation_claim
             SET physical_id = ?, expires_at_ms = ? WHERE claim_id = ?`,
            [storageCollectionId, expiresAtMs, claimId],
          )
        } else {
          await driver.run(
            `INSERT INTO cache_generation_claim
               (claim_id, logical_id, physical_id, expires_at_ms)
             VALUES (?, ?, ?, ?)`,
            [nextClaimId, collectionId, storageCollectionId, expiresAtMs],
          )
        }
        await driver.run(
          `INSERT INTO collection_version (
             collection_id, latest_row_version,
             key_set_evidence_available, key_set_evidence_incompatible
           ) VALUES (?, 0, 1, 1)`,
          [storageCollectionId],
        )
        if (resetMetadata) {
          await driver.run(
            `INSERT INTO collection_metadata (collection_id, key, value, updated_at)
             VALUES (?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))`,
            [
              storageCollectionId,
              resetMetadata.key,
              serializePersistedRowValue(resetMetadata.value),
            ],
          )
        }
        await this.collectRetiredCacheGenerations(driver)
        return { storageCollectionId, claimId: nextClaimId, expiresAtMs }
      })
    })
  }

  releaseCacheGenerationClaim(claimId: string): Promise<void> {
    return this.runRegular(async () => {
      await this.ensureInitialized()
      await this.runInTransaction(async (driver) => {
        await driver.run(
          `DELETE FROM cache_generation_claim WHERE claim_id = ?`,
          [claimId],
        )
        await this.collectRetiredCacheGenerations(driver)
      })
    })
  }

  renewCacheGenerationClaim(
    storageCollectionId: string,
    claimId: string,
  ): Promise<number | undefined> {
    return this.runRegular(() =>
      this.renewCacheGenerationClaimUnscheduled(storageCollectionId, claimId),
    )
  }

  private async renewCacheGenerationClaimUnscheduled(
    storageCollectionId: string,
    claimId: string,
  ): Promise<number | undefined> {
    await this.ensureInitialized()
    return this.runInTransaction(async (driver) => {
      const now = this.now()
      const rows = await driver.query<{ claim_id: string }>(
        `SELECT claim_id FROM cache_generation_claim
           WHERE claim_id = ? AND physical_id = ? AND expires_at_ms > ?`,
        [claimId, storageCollectionId, now],
      )
      if (!rows[0]) {
        await this.collectRetiredCacheGenerations(driver)
        return undefined
      }
      const expiresAtMs = now + this.cacheGenerationClaimTtlMs
      await driver.run(
        `UPDATE cache_generation_claim SET expires_at_ms = ?
           WHERE claim_id = ?`,
        [expiresAtMs, claimId],
      )
      return expiresAtMs
    })
  }

  private async collectRetiredCacheGenerations(
    driver: SQLiteDriver,
  ): Promise<void> {
    await driver.run(
      `DELETE FROM cache_generation_claim WHERE expires_at_ms <= ?`,
      [this.now()],
    )
    const retired = await driver.query<{
      physical_id: string
      table_name: string | null
      tombstone_table_name: string | null
    }>(
      `SELECT generation.physical_id, registry.table_name,
              registry.tombstone_table_name
       FROM cache_generation AS generation
       LEFT JOIN collection_registry AS registry
         ON registry.collection_id = generation.physical_id
       WHERE generation.retired = 1
         AND NOT EXISTS (
           SELECT 1 FROM cache_generation_claim AS claim
           WHERE claim.physical_id = generation.physical_id
         )`,
    )
    for (const generation of retired) {
      if (generation.table_name) {
        await driver.exec(
          `DROP TABLE IF EXISTS ${quoteIdentifier(generation.table_name)}`,
        )
      }
      if (generation.tombstone_table_name) {
        await driver.exec(
          `DROP TABLE IF EXISTS ${quoteIdentifier(generation.tombstone_table_name)}`,
        )
      }
      for (const table of [
        `applied_tx`,
        `collection_expected_keys`,
        `collection_metadata`,
        `persisted_index_registry`,
        `leader_term`,
      ]) {
        await driver.run(`DELETE FROM ${table} WHERE collection_id = ?`, [
          generation.physical_id,
        ])
      }
      await driver.run(
        `DELETE FROM collection_version WHERE collection_id = ?`,
        [generation.physical_id],
      )
      await driver.run(
        `DELETE FROM collection_reset_epoch WHERE collection_id = ?`,
        [generation.physical_id],
      )
      await driver.run(
        `DELETE FROM collection_registry WHERE collection_id = ?`,
        [generation.physical_id],
      )
      await driver.run(`DELETE FROM cache_generation WHERE physical_id = ?`, [
        generation.physical_id,
      ])
      this.collectionTableCache.delete(generation.physical_id)
    }
  }

  getCacheGenerationNow(): number {
    return this.now()
  }

  constructor(options: SQLiteCoreAdapterOptions) {
    const maxBoundParameters = options.driver.maxBoundParameters
    if (
      maxBoundParameters !== undefined &&
      (!Number.isInteger(maxBoundParameters) || maxBoundParameters < 4)
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `SQLite driver maxBoundParameters must be an integer of at least 4`,
      )
    }
    this.replacementBatchSize =
      maxBoundParameters === undefined
        ? REPLACEMENT_BATCH_SIZE
        : Math.min(REPLACEMENT_BATCH_SIZE, Math.floor(maxBoundParameters / 4))

    this.cacheGenerationClaimTtlMs =
      options.cacheGenerationClaimTtlMs ?? DEFAULT_CACHE_GENERATION_CLAIM_TTL_MS
    if (
      !Number.isSafeInteger(this.cacheGenerationClaimTtlMs) ||
      this.cacheGenerationClaimTtlMs <= 0
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `SQLite adapter cacheGenerationClaimTtlMs must be a positive safe integer`,
      )
    }
    this.now = options.now ?? Date.now

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

    this.schedulingIdentitySource = options.driver
    const schedulingKey =
      getSharedLogicalSchedulingKey(options.driver) ??
      observedDriverSchedulingKeys.get(options.driver)
    this.scheduler = schedulingKey
      ? getSharedPersistenceScheduler(schedulingKey)
      : undefined
    this.driver = schedulingKey
      ? options.driver
      : observeSharedLogicalSchedulingSupport(options.driver, (key) => {
          observedDriverSchedulingKeys.set(options.driver, key)
          const scheduler = getSharedPersistenceScheduler(key)
          this.scheduler ??= scheduler
          if (this.activeUnscheduledHydration) {
            scheduler.adoptRunningHydrate(this.activeUnscheduledHydration)
          }
        })
    this.schemaVersion = schemaVersion
    this.schemaMismatchPolicy =
      options.schemaMismatchPolicy ?? `sync-present-reset`
    this.appliedTxPruneMaxRows = options.appliedTxPruneMaxRows
    this.appliedTxPruneMaxAgeSeconds = options.appliedTxPruneMaxAgeSeconds
    this.pullSinceReloadThreshold = pullSinceReloadThreshold
    this.hydrationAdapter = {
      loadSubset: (collectionId, loadOptions, context) =>
        this.loadSubsetUnscheduled(collectionId, loadOptions, context),
      loadResumeSnapshot: (collectionId, context) =>
        this.loadResumeSnapshotUnscheduled(collectionId, context),
      applyCommittedTx: (collectionId, tx) =>
        this.applyCommittedTxUnscheduled(collectionId, tx),
      renewCacheGenerationClaim: (storageCollectionId, claimId) =>
        this.renewCacheGenerationClaimUnscheduled(storageCollectionId, claimId),
      loadCollectionMetadata: (collectionId, context) =>
        this.loadCollectionMetadataUnscheduled(collectionId, context),
      scanRows: (collectionId, scanOptions, context) =>
        this.scanRowsUnscheduled(collectionId, scanOptions, context),
      ensureIndex: (collectionId, signature, spec, ctx) =>
        this.ensureIndexUnscheduled(collectionId, signature, spec, ctx),
      markIndexRemoved: (collectionId, signature, ctx) =>
        this.markIndexRemovedUnscheduled(collectionId, signature, ctx),
      getStreamPosition: (collectionId, ctx) =>
        this.getStreamPositionUnscheduled(collectionId, ctx),
      pullSince: (collectionId, fromRowVersion, ctx) =>
        this.pullSinceUnscheduled(collectionId, fromRowVersion, ctx),
      runInHydrationScope: async (task) => task(this.hydrationAdapter),
    }
  }

  runInHydrationScope<T>(
    task: (adapter: HydrationPersistenceAdapter) => Promise<T>,
  ): Promise<T> {
    const scheduler = this.resolveScheduler()
    if (scheduler) {
      return scheduler.runHydrate(() => task(this.hydrationAdapter))
    }

    const hydration = Promise.resolve().then(() => task(this.hydrationAdapter))
    this.activeUnscheduledHydration = hydration
    const clear = () => {
      if (this.activeUnscheduledHydration === hydration) {
        this.activeUnscheduledHydration = undefined
      }
    }
    void hydration.then(clear, clear)
    return hydration
  }

  runInRegularScope<T>(
    task: (adapter: HydrationPersistenceAdapter) => Promise<T>,
  ): Promise<T> {
    return this.runRegular(() => task(this.hydrationAdapter))
  }

  isHydrationScopeScheduled(): boolean {
    return this.resolveScheduler() !== undefined
  }

  private runRegular<T>(task: () => Promise<T>): Promise<T> {
    const scheduler = this.resolveScheduler()
    return scheduler ? scheduler.runRegular(task) : task()
  }

  private resolveScheduler(): SharedPersistenceScheduler | undefined {
    if (this.scheduler) return this.scheduler
    const key = observedDriverSchedulingKeys.get(this.schedulingIdentitySource)
    if (key) {
      this.scheduler = getSharedPersistenceScheduler(key)
    }
    return this.scheduler
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

  private async assertCacheGenerationReadClaim(
    driver: SQLiteDriver,
    storageCollectionId: string,
    claimId?: string,
  ): Promise<void> {
    await this.ensureInitialized()
    if (!claimId) {
      if (!hasCacheGenerationIdPrefix(storageCollectionId)) return
      const generation = await driver.query<{ physical_id: string }>(
        `SELECT physical_id FROM cache_generation WHERE physical_id = ?`,
        [storageCollectionId],
      )
      if (generation[0]) {
        throw new InvalidPersistedCollectionConfigError(
          `Persisted cache claim is required for collection "${storageCollectionId}"`,
        )
      }
      return
    }
    const rows = await driver.query<{ claim_id: string }>(
      `SELECT claim.claim_id
       FROM cache_generation_claim AS claim
       JOIN cache_generation AS generation
         ON generation.physical_id = claim.physical_id
       WHERE claim.claim_id = ? AND claim.physical_id = ?
         AND claim.expires_at_ms > ?`,
      [claimId, storageCollectionId, this.now()],
    )
    if (!rows[0]) {
      throw new InvalidPersistedCollectionConfigError(
        `Persisted cache claim is no longer active for collection "${storageCollectionId}"`,
      )
    }
  }

  loadSubset(
    collectionId: string,
    options: LoadSubsetOptions,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      cacheGenerationClaimId?: string
    },
  ): Promise<
    Array<{
      key: string | number
      value: Record<string, unknown>
      metadata?: unknown
    }>
  > {
    return this.runRegular(() =>
      this.loadSubsetUnscheduled(collectionId, options, ctx),
    )
  }

  private async loadSubsetUnscheduled(
    collectionId: string,
    options: LoadSubsetOptions,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      cacheGenerationClaimId?: string
    },
  ): Promise<
    Array<{
      key: string | number
      value: Record<string, unknown>
      metadata?: unknown
    }>
  > {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const tableMapping = await this.ensureCollectionReady(
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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

  loadResumeSnapshot(
    collectionId: string,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      includeRows?: boolean
      cacheGenerationClaimId?: string
    },
  ) {
    return this.runRegular(() =>
      this.loadResumeSnapshotUnscheduled(collectionId, ctx),
    )
  }

  private async loadResumeSnapshotUnscheduled(
    collectionId: string,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      includeRows?: boolean
      cacheGenerationClaimId?: string
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
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const tableMapping = await this.ensureCollectionReady(
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const includeRows = ctx?.includeRows !== false

    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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

  applyCommittedTx(collectionId: string, tx: PersistedTx): Promise<void> {
    return this.runRegular(() =>
      this.applyCommittedTxUnscheduled(collectionId, tx),
    )
  }

  private async applyCommittedTxUnscheduled(
    collectionId: string,
    tx: PersistedTx,
  ): Promise<void> {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      tx.cacheGenerationClaimId,
    )
    const tableMapping = await this.ensureCollectionReady(
      collectionId,
      tx.cacheGenerationClaimId,
    )
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const tombstoneTableSql = quoteIdentifier(tableMapping.tombstoneTableName)

    await this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        tx.cacheGenerationClaimId,
      )

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

      const rowMutations = new Map<string, PersistedTx[`mutations`][number]>()
      for (const mutation of tx.mutations) {
        const key = encodePersistedStorageKey(mutation.key)
        const previous = rowMutations.get(key)
        if (!previous) {
          rowMutations.set(key, mutation)
          continue
        }

        // A superseded action still had to serialize successfully.
        serializePersistedRowValue(previous.value)
        if (
          previous.type !== `delete` &&
          previous.metadataChanged === true &&
          previous.metadata !== undefined
        ) {
          serializePersistedRowValue(previous.metadata)
        }
        if (mutation.type === `delete`) {
          rowMutations.set(key, mutation)
          continue
        }
        const value =
          mutation.type === `insert` || previous.type === `delete`
            ? mutation.value
            : mergeObjectRows(previous.value, mutation.value)
        const metadataChanged =
          mutation.metadataChanged === true ||
          previous.type === `delete` ||
          previous.metadataChanged === true
        const metadata =
          mutation.metadataChanged === true
            ? mutation.metadata
            : previous.type === `delete`
              ? undefined
              : previous.metadata
        const next = { key: mutation.key, value, metadataChanged, metadata }
        rowMutations.set(
          key,
          mutation.type === `insert` || previous.type !== `update`
            ? { type: `insert`, ...next }
            : { type: `update`, ...next },
        )
      }

      for (const batch of batches(
        [...rowMutations.values()],
        this.replacementBatchSize,
      )) {
        const writes = batch.filter((mutation) => mutation.type !== `delete`)
        const deletes = batch.filter((mutation) => mutation.type === `delete`)
        const readKeys = writes
          .filter(
            (mutation) =>
              mutation.type === `update` || mutation.metadataChanged !== true,
          )
          .map((mutation) => encodePersistedStorageKey(mutation.key))
        const existingRows =
          readKeys.length > 0
            ? await transactionDriver.query<{
                key: string
                value: string
                metadata: string | null
              }>(
                `SELECT key, value, metadata
               FROM ${collectionTableSql}
               WHERE key IN (${readKeys.map(() => `?`).join(`, `)})`,
                readKeys,
              )
            : []
        const existing = new Map(existingRows.map((row) => [row.key, row]))
        const writeKeys = writes.map((mutation) =>
          encodePersistedStorageKey(mutation.key),
        )
        const deleteKeys = deletes.map((mutation) =>
          encodePersistedStorageKey(mutation.key),
        )

        if (tracksPersistedKeySet && writeKeys.length > 0) {
          await transactionDriver.run(
            `INSERT INTO collection_expected_keys (collection_id, key)
             VALUES ${writeKeys.map(() => `(?, ?)`).join(`, `)}
             ON CONFLICT(collection_id, key) DO NOTHING`,
            writeKeys.flatMap((key) => [collectionId, key]),
          )
        }
        if (tracksPersistedKeySet && deleteKeys.length > 0) {
          await transactionDriver.run(
            `DELETE FROM collection_expected_keys
             WHERE collection_id = ? AND key IN (${deleteKeys.map(() => `?`).join(`, `)})`,
            [collectionId, ...deleteKeys],
          )
        }
        if (deleteKeys.length > 0) {
          await transactionDriver.run(
            `DELETE FROM ${collectionTableSql}
             WHERE key IN (${deleteKeys.map(() => `?`).join(`, `)})`,
            deleteKeys,
          )
        }
        if (writeKeys.length > 0) {
          await transactionDriver.run(
            `INSERT INTO ${collectionTableSql} (key, value, metadata, row_version)
             VALUES ${writeKeys.map(() => `(?, ?, ?, ?)`).join(`, `)}
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               metadata = excluded.metadata,
               row_version = excluded.row_version`,
            writes.flatMap((mutation, index) => {
              const previous = existing.get(writeKeys[index]!)
              const previousValue = previous?.value
                ? deserializePersistedRowValue(previous.value)
                : undefined
              const previousMetadata =
                previous?.metadata != null
                  ? deserializePersistedRowValue(previous.metadata)
                  : undefined
              const value =
                mutation.type === `update`
                  ? mergeObjectRows(previousValue, mutation.value)
                  : mutation.value
              const metadata =
                mutation.metadataChanged === true
                  ? mutation.metadata
                  : previousMetadata
              return [
                writeKeys[index]!,
                serializePersistedRowValue(value),
                metadata === undefined
                  ? null
                  : serializePersistedRowValue(metadata),
                nextRowVersion,
              ]
            }),
          )
          await transactionDriver.run(
            `DELETE FROM ${tombstoneTableSql}
             WHERE key IN (${writeKeys.map(() => `?`).join(`, `)})`,
            writeKeys,
          )
        }
        if (deletes.length > 0) {
          await transactionDriver.run(
            `INSERT INTO ${tombstoneTableSql} (key, value, row_version, deleted_at)
             VALUES ${deleteKeys.map(() => `(?, ?, ?, ?)`).join(`, `)}
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               row_version = excluded.row_version,
               deleted_at = excluded.deleted_at`,
            deletes.flatMap((mutation, index) => [
              deleteKeys[index]!,
              serializePersistedRowValue(mutation.value),
              nextRowVersion,
              new Date().toISOString(),
            ]),
          )
        }
      }

      for (const batch of batches(
        lastMetadataByKey(
          tx.rowMetadataMutations ?? [],
          (mutation) => encodePersistedStorageKey(mutation.key),
          true,
        ),
        this.replacementBatchSize,
      )) {
        const keys = batch.map((mutation) =>
          encodePersistedStorageKey(mutation.key),
        )
        await transactionDriver.run(
          `UPDATE ${collectionTableSql}
           SET metadata = CASE key ${keys.map(() => `WHEN ? THEN ?`).join(` `)} END
           WHERE key IN (${keys.map(() => `?`).join(`, `)})`,
          [
            ...batch.flatMap((mutation, index) => [
              keys[index]!,
              mutation.type === `delete` || mutation.value === undefined
                ? null
                : serializePersistedRowValue(mutation.value),
            ]),
            ...keys,
          ],
        )
      }

      for (const batch of batches(
        lastMetadataByKey(
          tx.collectionMetadataMutations ?? [],
          (mutation) => mutation.key,
        ),
        this.replacementBatchSize,
      )) {
        const deletes = batch.filter((mutation) => mutation.type === `delete`)
        const sets = batch.filter((mutation) => mutation.type === `set`)
        if (deletes.length > 0) {
          await transactionDriver.run(
            `DELETE FROM collection_metadata
             WHERE collection_id = ? AND key IN (${deletes.map(() => `?`).join(`, `)})`,
            [collectionId, ...deletes.map((mutation) => mutation.key)],
          )
        }
        if (sets.length > 0) {
          await transactionDriver.run(
            `INSERT INTO collection_metadata (collection_id, key, value, updated_at)
             VALUES ${sets.map(() => `(?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))`).join(`, `)}
             ON CONFLICT(collection_id, key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at`,
            sets.flatMap((mutation) => [
              collectionId,
              mutation.key,
              serializePersistedRowValue(mutation.value),
            ]),
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

  loadCollectionMetadata(
    collectionId: string,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<Array<{ key: string; value: unknown }>> {
    return this.runRegular(() =>
      this.loadCollectionMetadataUnscheduled(collectionId, ctx),
    )
  }

  private async loadCollectionMetadataUnscheduled(
    collectionId: string,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<Array<{ key: string; value: unknown }>> {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    await this.ensureCollectionReady(collectionId, ctx?.cacheGenerationClaimId)
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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

  scanRows(
    collectionId: string,
    options?: PersistedRowScanOptions,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<Array<PersistedScannedRow>> {
    return this.runRegular(() =>
      this.scanRowsUnscheduled(collectionId, options, ctx),
    )
  }

  private async scanRowsUnscheduled(
    collectionId: string,
    options?: PersistedRowScanOptions,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<Array<PersistedScannedRow>> {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const tableMapping = await this.ensureCollectionReady(
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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

  ensureIndex(
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<void> {
    return this.runRegular(() =>
      this.ensureIndexUnscheduled(collectionId, signature, spec, ctx),
    )
  }

  private async ensureIndexUnscheduled(
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<void> {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const tableMapping = await this.ensureCollectionReady(
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
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
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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

  markIndexRemoved(
    collectionId: string,
    signature: string,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<void> {
    return this.runRegular(() =>
      this.markIndexRemovedUnscheduled(collectionId, signature, ctx),
    )
  }

  private async markIndexRemovedUnscheduled(
    collectionId: string,
    signature: string,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<void> {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    await this.ensureCollectionReady(collectionId, ctx?.cacheGenerationClaimId)
    await this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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

  getStreamPosition(
    collectionId: string,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }> {
    // Election must not queue behind a hydrate awaiting its first writer route.
    // The stream-position snapshot still uses the driver's transaction admission.
    return this.getStreamPositionUnscheduled(collectionId, ctx)
  }

  private async getStreamPositionUnscheduled(
    collectionId: string,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }> {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    await this.ensureCollectionReady(collectionId, ctx?.cacheGenerationClaimId)
    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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

  pullSince(
    collectionId: string,
    fromRowVersion: number,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<SQLitePullSinceResult<string | number>> {
    return this.runRegular(() =>
      this.pullSinceUnscheduled(collectionId, fromRowVersion, ctx),
    )
  }

  private async pullSinceUnscheduled(
    collectionId: string,
    fromRowVersion: number,
    ctx?: { cacheGenerationClaimId?: string },
  ): Promise<SQLitePullSinceResult<string | number>> {
    await this.assertCacheGenerationReadClaim(
      this.driver,
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const tableMapping = await this.ensureCollectionReady(
      collectionId,
      ctx?.cacheGenerationClaimId,
    )
    const collectionTableSql = quoteIdentifier(tableMapping.tableName)
    const tombstoneTableSql = quoteIdentifier(tableMapping.tombstoneTableName)

    return this.runInTransaction(async (transactionDriver) => {
      await this.assertCacheGenerationReadClaim(
        transactionDriver,
        collectionId,
        ctx?.cacheGenerationClaimId,
      )
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
    // Compile even when SQL cannot safely prefilter: invalid bindings must
    // reject before the in-memory fallback reads rows.
    const whereCompiled = options.where
      ? compileSqlExpression(options.where)
      : { supported: false, sql: ``, params: [] as Array<SqliteSupportedValue> }
    const safePrefilter = options.where
      ? compileSafeSqlPrefilter(options.where, whereCompiled)
      : undefined
    const orderByCompiled = compileOrderByClauses(options.orderBy)

    const queryParams: Array<SqliteSupportedValue> = []
    let sql = `SELECT key, value, metadata, row_version FROM ${collectionTableSql}`

    if (safePrefilter) {
      sql = `${sql} WHERE ${safePrefilter.sql}`
      queryParams.push(...safePrefilter.params)
    }

    if (options.orderBy && orderByCompiled.supported) {
      sql = `${sql} ORDER BY ${orderByCompiled.sql}, key ASC`
      queryParams.push(...orderByCompiled.params)
    }

    if (
      queryParams.length >
      (driver.maxBoundParameters ?? this.driver.maxBoundParameters ?? 999)
    ) {
      sql = `SELECT key, value, metadata, row_version FROM ${collectionTableSql}`
      queryParams.length = 0
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
    cacheGenerationClaimId?: string,
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

    const loadPromise = this.ensureCollectionReadyInternal(
      collectionId,
      cacheGenerationClaimId,
    )
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
    cacheGenerationClaimId?: string,
  ): Promise<CollectionTableMapping> {
    // Record whether registration began for a managed physical ID. Collection
    // may remove that catalog row while this operation waits on external DDL.
    const managedAtAdmission =
      cacheGenerationClaimId !== undefined ||
      (hasCacheGenerationIdPrefix(collectionId) &&
        (
          await this.driver.query<{ physical_id: string }>(
            `SELECT physical_id FROM cache_generation WHERE physical_id = ?`,
            [collectionId],
          )
        )[0] !== undefined)
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
    if (managedAtAdmission) {
      // Registration is outside the read/write transaction. If collection
      // retired this generation while the DDL was in flight, remove any
      // empty table recreated after collection instead of caching it.
      const generation = await this.driver.query<{ physical_id: string }>(
        `SELECT physical_id FROM cache_generation WHERE physical_id = ?`,
        [collectionId],
      )
      if (!generation[0]) {
        await this.driver.exec(
          `DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`,
        )
        await this.driver.exec(
          `DROP TABLE IF EXISTS ${quoteIdentifier(tombstoneTableName)}`,
        )
        await this.driver.run(
          `DELETE FROM collection_registry WHERE collection_id = ?`,
          [collectionId],
        )
        await this.driver.run(
          `DELETE FROM collection_version WHERE collection_id = ?`,
          [collectionId],
        )
        await this.driver.run(
          `DELETE FROM collection_reset_epoch WHERE collection_id = ?`,
          [collectionId],
        )
        throw new InvalidPersistedCollectionConfigError(
          `Persisted cache generation was collected before registration finished`,
        )
      }
    }
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
      `CREATE TABLE IF NOT EXISTS cache_generation (
         logical_id TEXT NOT NULL,
         generation INTEGER NOT NULL,
         physical_id TEXT NOT NULL UNIQUE,
         retired INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (logical_id, generation)
       )`,
    )
    await this.driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS cache_generation_head
       ON cache_generation (logical_id) WHERE retired = 0`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS cache_generation_sequence (
         logical_id TEXT PRIMARY KEY,
         next_generation INTEGER NOT NULL
       )`,
    )
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS cache_generation_claim (
         claim_id TEXT PRIMARY KEY,
         logical_id TEXT NOT NULL,
         physical_id TEXT NOT NULL,
         expires_at_ms INTEGER NOT NULL
       )`,
    )
    const claimColumns = await this.driver.query<{ name: string }>(
      `PRAGMA table_info(cache_generation_claim)`,
    )
    if (!claimColumns.some(({ name }) => name === `logical_id`)) {
      await this.driver.exec(
        `ALTER TABLE cache_generation_claim
         ADD COLUMN logical_id TEXT NOT NULL DEFAULT ''`,
      )
    }
    if (!claimColumns.some(({ name }) => name === `expires_at_ms`)) {
      await this.driver.exec(
        `ALTER TABLE cache_generation_claim
         ADD COLUMN expires_at_ms INTEGER NOT NULL DEFAULT 0`,
      )
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
