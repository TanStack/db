import { IR  } from '@tanstack/db'
import {
  InvalidPersistedCollectionConfigError,
  InvalidPersistedStorageKeyEncodingError,
} from './errors'
import {
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
} from './persisted'
import type {LoadSubsetOptions} from '@tanstack/db';
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
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const FORBIDDEN_SQL_FRAGMENT_PATTERN = /(;|--|\/\*)/

function quoteIdentifier(identifier: string): string {
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidPersistedCollectionConfigError(
      `Invalid SQLite identifier "${identifier}"`,
    )
  }
  return `"${identifier}"`
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

  if (typeof value === `boolean`) {
    return value ? 1 : 0
  }

  if (typeof value === `string`) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return JSON.stringify(value)
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined
}

function normalizeSortableValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.getTime()
  }
  return value
}

function compareUnknownValues(left: unknown, right: unknown): number {
  const normalizedLeft = normalizeSortableValue(left)
  const normalizedRight = normalizeSortableValue(right)

  if (normalizedLeft === normalizedRight) {
    return 0
  }

  if (
    typeof normalizedLeft === `number` &&
    typeof normalizedRight === `number`
  ) {
    return normalizedLeft < normalizedRight ? -1 : 1
  }

  if (
    typeof normalizedLeft === `string` &&
    typeof normalizedRight === `string`
  ) {
    return normalizedLeft < normalizedRight ? -1 : 1
  }

  if (
    typeof normalizedLeft === `boolean` &&
    typeof normalizedRight === `boolean`
  ) {
    return normalizedLeft === false ? -1 : 1
  }

  const leftString =
    typeof normalizedLeft === `string`
      ? normalizedLeft
      : JSON.stringify(normalizedLeft)
  const rightString =
    typeof normalizedRight === `string`
      ? normalizedRight
      : JSON.stringify(normalizedRight)

  if (leftString === rightString) {
    return 0
  }
  return leftString < rightString ? -1 : 1
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }

  if (typeof left === `object` && left !== null) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  if (typeof right === `object` && right !== null) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  return Object.is(left, right)
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

function resolveRowValueByPath(
  row: Record<string, unknown>,
  path: Array<string>,
): unknown {
  const resolvePath = (candidatePath: Array<string>): unknown => {
    let current: unknown = row
    for (const segment of candidatePath) {
      if (typeof current !== `object` || current === null) {
        return undefined
      }

      current = (current as Record<string, unknown>)[segment]
    }
    return current
  }

  const directValue = resolvePath(path)
  if (directValue !== undefined || path.length <= 1) {
    return directValue
  }

  return resolvePath(path.slice(1))
}

function evaluateLikePattern(
  value: unknown,
  pattern: unknown,
  caseInsensitive: boolean,
): boolean | null {
  if (isNullish(value) || isNullish(pattern)) {
    return null
  }

  if (typeof value !== `string` || typeof pattern !== `string`) {
    return false
  }

  const candidateValue = caseInsensitive ? value.toLowerCase() : value
  const candidatePattern = caseInsensitive ? pattern.toLowerCase() : pattern
  let regexPattern = candidatePattern.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
  regexPattern = regexPattern.replace(/%/g, `.*`).replace(/_/g, `.`)
  return new RegExp(`^${regexPattern}$`).test(candidateValue)
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === `string` || typeof value === `number`) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function evaluateExpressionOnRow(
  expression: IR.BasicExpression,
  row: Record<string, unknown>,
): unknown {
  if (expression.type === `val`) {
    return expression.value
  }

  if (expression.type === `ref`) {
    return resolveRowValueByPath(row, expression.path.map(String))
  }

  const evaluatedArgs = expression.args.map((arg) =>
    evaluateExpressionOnRow(arg, row),
  )

  switch (expression.name) {
    case `eq`: {
      const [left, right] = evaluatedArgs
      if (isNullish(left) || isNullish(right)) {
        return null
      }
      return valuesEqual(left, right)
    }
    case `gt`: {
      const [left, right] = evaluatedArgs
      if (isNullish(left) || isNullish(right)) {
        return null
      }
      return compareUnknownValues(left, right) > 0
    }
    case `gte`: {
      const [left, right] = evaluatedArgs
      if (isNullish(left) || isNullish(right)) {
        return null
      }
      return compareUnknownValues(left, right) >= 0
    }
    case `lt`: {
      const [left, right] = evaluatedArgs
      if (isNullish(left) || isNullish(right)) {
        return null
      }
      return compareUnknownValues(left, right) < 0
    }
    case `lte`: {
      const [left, right] = evaluatedArgs
      if (isNullish(left) || isNullish(right)) {
        return null
      }
      return compareUnknownValues(left, right) <= 0
    }
    case `and`: {
      let hasUnknown = false
      for (const value of evaluatedArgs) {
        if (value === false) {
          return false
        }
        if (isNullish(value)) {
          hasUnknown = true
        }
      }
      return hasUnknown ? null : true
    }
    case `or`: {
      let hasUnknown = false
      for (const value of evaluatedArgs) {
        if (value === true) {
          return true
        }
        if (isNullish(value)) {
          hasUnknown = true
        }
      }
      return hasUnknown ? null : false
    }
    case `not`: {
      const [value] = evaluatedArgs
      if (isNullish(value)) {
        return null
      }
      return !value
    }
    case `in`: {
      const [value, list] = evaluatedArgs
      if (isNullish(value)) {
        return null
      }
      if (!Array.isArray(list)) {
        return false
      }
      return list.some((entry) => valuesEqual(entry, value))
    }
    case `like`:
      return evaluateLikePattern(evaluatedArgs[0], evaluatedArgs[1], false)
    case `ilike`:
      return evaluateLikePattern(evaluatedArgs[0], evaluatedArgs[1], true)
    case `isNull`:
    case `isUndefined`:
      return isNullish(evaluatedArgs[0])
    case `upper`: {
      const [value] = evaluatedArgs
      return typeof value === `string` ? value.toUpperCase() : value
    }
    case `lower`: {
      const [value] = evaluatedArgs
      return typeof value === `string` ? value.toLowerCase() : value
    }
    case `length`: {
      const [value] = evaluatedArgs
      if (typeof value === `string` || Array.isArray(value)) {
        return value.length
      }
      return 0
    }
    case `concat`:
      return evaluatedArgs.map((value) => String(value ?? ``)).join(``)
    case `coalesce`:
      return evaluatedArgs.find((value) => !isNullish(value)) ?? null
    case `add`:
      return (Number(evaluatedArgs[0] ?? 0) || 0) + (Number(evaluatedArgs[1] ?? 0) || 0)
    case `date`: {
      const dateValue = toDateValue(evaluatedArgs[0])
      return dateValue ? dateValue.toISOString().slice(0, 10) : null
    }
    case `datetime`: {
      const dateValue = toDateValue(evaluatedArgs[0])
      return dateValue ? dateValue.toISOString() : null
    }
    case `strftime`: {
      const [format, source] = evaluatedArgs
      if (typeof format !== `string`) {
        return null
      }
      const dateValue = toDateValue(source)
      if (!dateValue) {
        return null
      }
      if (format === `%Y-%m-%d`) {
        return dateValue.toISOString().slice(0, 10)
      }
      if (format === `%Y-%m-%dT%H:%M:%fZ`) {
        return dateValue.toISOString()
      }
      return dateValue.toISOString()
    }
    default:
      throw new InvalidPersistedCollectionConfigError(
        `Unsupported expression function "${expression.name}" in SQLite adapter fallback evaluator`,
      )
  }
}

function toBooleanPredicate(value: unknown): boolean {
  return value === true
}

type InMemoryRow<TKey extends string | number, T extends object> = {
  key: TKey
  value: T
  rowVersion: number
}

function compileSqlExpression(expression: IR.BasicExpression): CompiledSqlFragment {
  if (expression.type === `val`) {
    return {
      supported: true,
      sql: `?`,
      params: [toSqliteParameterValue(expression.value)],
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

    return {
      supported: true,
      sql: `json_extract(value, ?)`,
      params: [jsonPath],
    }
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
      return { supported: true, sql: `(${argSql[0]} = ${argSql[1]})`, params }
    case `gt`:
      return { supported: true, sql: `(${argSql[0]} > ${argSql[1]})`, params }
    case `gte`:
      return { supported: true, sql: `(${argSql[0]} >= ${argSql[1]})`, params }
    case `lt`:
      return { supported: true, sql: `(${argSql[0]} < ${argSql[1]})`, params }
    case `lte`:
      return { supported: true, sql: `(${argSql[0]} <= ${argSql[1]})`, params }
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

      const listPlaceholders = listValue.map(() => `?`).join(`, `)
      return {
        supported: true,
        sql: `(${argSql[0]} IN (${listPlaceholders}))`,
        params: [
          ...(compiledArgs[0]?.params ?? []),
          ...listValue.map((value) => toSqliteParameterValue(value)),
        ],
      }
    }
    case `like`:
      return { supported: true, sql: `(${argSql[0]} LIKE ${argSql[1]})`, params }
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
    case `date`:
      return { supported: true, sql: `date(${argSql[0]})`, params }
    case `datetime`:
      return { supported: true, sql: `datetime(${argSql[0]})`, params }
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

function compileOrderByClauses(orderBy: IR.OrderBy | undefined): CompiledSqlFragment {
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

    const direction = clause.compareOptions.direction === `desc` ? `DESC` : `ASC`
    const nulls = clause.compareOptions.nulls === `first` ? `NULLS FIRST` : `NULLS LAST`
    parts.push(`${compiledExpression.sql} ${direction} ${nulls}`)
  }

  return {
    supported: true,
    sql: parts.join(`, `),
    params,
  }
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
  private readonly pullSinceReloadThreshold: number

  private initialized = false
  private readonly collectionTableCache = new Map<string, CollectionTableMapping>()

  constructor(options: SQLiteCoreAdapterOptions) {
    this.driver = options.driver
    this.schemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION
    this.schemaMismatchPolicy =
      options.schemaMismatchPolicy ?? `sync-present-reset`
    this.appliedTxPruneMaxRows = options.appliedTxPruneMaxRows
    this.pullSinceReloadThreshold =
      options.pullSinceReloadThreshold ?? DEFAULT_PULL_SINCE_RELOAD_THRESHOLD
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
        offset: options.offset,
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

      const versionRows = await this.driver.query<{ latest_row_version: number }>(
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
              JSON.stringify(mutation.value),
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
          ? (JSON.parse(existingRows[0].value) as unknown)
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
          [encodedKey, JSON.stringify(mergedValue), nextRowVersion],
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
    const expressionSql = spec.expressionSql
      .map((fragment) => sanitizeExpressionSqlFragment(fragment))
      .join(`, `)
    const whereSql = spec.whereSql
      ? sanitizeExpressionSqlFragment(spec.whereSql)
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
          JSON.stringify(spec.expressionSql),
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
      await this.driver.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`)
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
      sql = `${sql} ORDER BY ${orderByCompiled.sql}`
      queryParams.push(...orderByCompiled.params)
    }

    const storedRows = await this.driver.query<StoredSqliteRow>(sql, queryParams)
    const parsedRows = storedRows.map((row) => {
      const key = decodePersistedStorageKey(row.key) as TKey
      const value = JSON.parse(row.value) as T
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

    return rows.filter((row) =>
      toBooleanPredicate(evaluateExpressionOnRow(where, row.value as Record<string, unknown>)),
    )
  }

  private applyInMemoryOrderBy(
    rows: Array<InMemoryRow<TKey, T>>,
    orderBy: IR.OrderBy | undefined,
  ): Array<InMemoryRow<TKey, T>> {
    if (!orderBy || orderBy.length === 0) {
      return rows
    }

    const ordered = [...rows]
    ordered.sort((left, right) => {
      for (const clause of orderBy) {
        const leftValue = evaluateExpressionOnRow(
          clause.expression,
          left.value as Record<string, unknown>,
        )
        const rightValue = evaluateExpressionOnRow(
          clause.expression,
          right.value as Record<string, unknown>,
        )

        if (isNullish(leftValue) || isNullish(rightValue)) {
          if (isNullish(leftValue) && isNullish(rightValue)) {
            continue
          }

          if (isNullish(leftValue)) {
            return clause.compareOptions.nulls === `first` ? -1 : 1
          }

          return clause.compareOptions.nulls === `first` ? 1 : -1
        }

        let comparison = 0
        if (
          clause.compareOptions.stringSort === `locale` &&
          typeof leftValue === `string` &&
          typeof rightValue === `string`
        ) {
          comparison = leftValue.localeCompare(
            rightValue,
            clause.compareOptions.locale,
            clause.compareOptions.localeOptions,
          )
        } else {
          comparison = compareUnknownValues(leftValue, rightValue)
        }

        if (comparison !== 0) {
          return clause.compareOptions.direction === `desc`
            ? comparison * -1
            : comparison
        }
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
    await this.driver.exec(
      `INSERT INTO schema_version (scope, version, updated_at)
       VALUES ('global', ${this.schemaVersion}, CAST(strftime('%s', 'now') AS INTEGER))
       ON CONFLICT(scope) DO UPDATE SET
         version = excluded.version,
         updated_at = excluded.updated_at`,
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
