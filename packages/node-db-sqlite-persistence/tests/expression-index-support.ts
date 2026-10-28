/**
 * Fixtures, the SQLite query observer, and plan classifiers shared by the
 * expression-index owner and its ordinary unit tests. The observer runs a
 * scenario through the public SQLite-core adapter and reports what happened.
 * It states no expectation: the law and its independent model are in
 * expression-index-oracle.test.ts.
 */
import { expect } from 'vitest'
import {
  BasicIndex,
  IR,
  coalesce as coalesceExpression,
  createCollection,
} from '@tanstack/db'
import {
  createPersistedTableName,
  createSQLiteCorePersistenceAdapter,
  decodePersistedStorageKey,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core'
import { Temporal } from '../../db-sqlite-persistence-core/tests/temporal-value-oracle'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persistence-core'

export const SQLITE_BIGINT_MIN = -9_223_372_036_854_775_808n
export const SQLITE_BIGINT_MAX = 9_223_372_036_854_775_807n
export const PERSISTED_TYPE_TAG = `__tanstack_db_persisted_type__`
export const PERSISTED_VALUE_TAG = `value`

export type OracleScalar = boolean | number | string

export type CapturedQuery = {
  sql: string
  params: ReadonlyArray<unknown>
}

export type QueryTransform = (query: CapturedQuery) => CapturedQuery

export type QueryPlanRow = {
  detail: string
}

export type ScanRow = {
  key: string | number
  value: Record<string, unknown>
}

export function createNestedRow(
  path: ReadonlyArray<string>,
  value: OracleScalar | bigint,
): Record<string, unknown> {
  let nested: unknown = value

  for (let index = path.length - 1; index >= 0; index--) {
    const segment = path[index]!
    if (/^\d+$/.test(segment)) {
      const entries = Array.from<unknown>({ length: Number(segment) + 1 })
      entries[Number(segment)] = nested
      nested = entries
    } else {
      nested = { [segment]: nested }
    }
  }

  if (typeof nested !== `object` || nested === null || Array.isArray(nested)) {
    throw new Error(`generated path must be rooted in an object`)
  }
  return nested as Record<string, unknown>
}

export function readPath(
  row: Record<string, unknown>,
  path: ReadonlyArray<string>,
): unknown {
  let value: unknown = row

  for (const segment of path) {
    if (Array.isArray(value) && /^\d+$/.test(segment)) {
      value = value[Number(segment)]
      continue
    }
    if (typeof value !== `object` || value === null || Array.isArray(value)) {
      return undefined
    }
    value = (value as Record<string, unknown>)[segment]
  }

  return value
}

export function sqliteJsonPath(path: ReadonlyArray<string>): string {
  return path.reduce((result, segment) => {
    return /^\d+$/.test(segment)
      ? `${result}[${segment}]`
      : `${result}.${segment}`
  }, `$`)
}

export function sqliteLiteral(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}

export function sqliteScalarParameter(value: OracleScalar): number | string {
  return typeof value === `boolean` ? (value ? 1 : 0) : value
}

export function serializeIndexExpression(
  expression: IR.BasicExpression,
): string {
  return JSON.stringify(
    expression,
    function (this: Record<string, unknown>, key, value: unknown) {
      // Read the original before Temporal.toJSON converts it to an ordinary string.
      const original = this[key]
      if (
        original instanceof Temporal.Instant ||
        original instanceof Temporal.PlainDate
      ) {
        return {
          [PERSISTED_TYPE_TAG]:
            original instanceof Temporal.Instant
              ? `Temporal.Instant`
              : `Temporal.PlainDate`,
          [PERSISTED_VALUE_TAG]: original.toString(),
        }
      }
      return typeof value === `bigint`
        ? {
            [PERSISTED_TYPE_TAG]: `bigint`,
            [PERSISTED_VALUE_TAG]: value.toString(),
          }
        : value
    },
  )
}

export function bigintRangeError(value: bigint): string {
  return `SQLite BigInt value ${value} is outside the signed 64-bit range [${SQLITE_BIGINT_MIN}, ${SQLITE_BIGINT_MAX}]`
}

export function createQueryObservingDriver(
  inner: SQLiteDriver,
  observe: (query: CapturedQuery) => void,
  transform?: QueryTransform,
): SQLiteDriver {
  const wrap = (driver: SQLiteDriver): SQLiteDriver => ({
    exec: (sql) => driver.exec(sql),
    query: async <T>(sql: string, params: ReadonlyArray<unknown> = []) => {
      const query = transform
        ? transform({ sql, params: [...params] })
        : { sql, params: [...params] }
      observe(query)
      return driver.query<T>(query.sql, query.params)
    },
    run: (sql, params) => driver.run(sql, params),
    transaction: (body) =>
      driver.transaction((transactionDriver) => body(wrap(transactionDriver))),
    transactionWithDriver: driver.transactionWithDriver
      ? (body) =>
          driver.transactionWithDriver!((transactionDriver) =>
            body(wrap(transactionDriver)),
          )
      : undefined,
  })

  return wrap(inner)
}

export async function withFailurePreservingCleanup<T>(
  body: () => T | Promise<T>,
  cleanups: ReadonlyArray<() => void | Promise<void>>,
): Promise<T> {
  let primary: { error: unknown } | undefined
  let result: T
  try {
    result = await body()
  } catch (error) {
    primary = { error }
  }

  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }

  if (cleanupFailures.length > 0) {
    if (primary) {
      throw new AggregateError(
        [primary.error, ...cleanupFailures],
        `Expression-index oracle and cleanup failed`,
        { cause: primary.error },
      )
    }
    if (cleanupFailures.length === 1) throw cleanupFailures[0]
    throw new AggregateError(
      cleanupFailures,
      `Expression-index oracle cleanup failed`,
    )
  }
  if (primary) throw primary.error
  return result!
}

export function planUsesNamedIndex(
  plan: ReadonlyArray<QueryPlanRow>,
  tableName: string,
  indexName: string,
): boolean {
  const tablePattern = sqlitePlanIdentifierPattern(tableName)
  const indexPattern = sqlitePlanIdentifierPattern(indexName)
  const searchPattern = new RegExp(
    `\\bSEARCH(?: TABLE)? ${tablePattern}(?:\\s|$)`,
  )
  const indexUsagePattern = new RegExp(
    `\\bUSING INDEX ${indexPattern}(?:\\s|$)`,
  )

  return plan.some(
    ({ detail }) =>
      searchPattern.test(detail) && indexUsagePattern.test(detail),
  )
}

export function planScansTable(
  plan: ReadonlyArray<QueryPlanRow>,
  tableName: string,
): boolean {
  const tablePattern = sqlitePlanIdentifierPattern(tableName)
  const scanPattern = new RegExp(`^SCAN(?: TABLE)? ${tablePattern}(?:\\s|$)`)
  return plan.some(({ detail }) => scanPattern.test(detail))
}

export function sqlitePlanIdentifierPattern(identifier: string): string {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
  return `(?:"${escaped}"|${escaped})`
}

export type ExpressionIndexScenario = {
  viaWrapper?: boolean
  observeIndexValues?: boolean
  label: string
  indexExpression: IR.BasicExpression
  where?: IR.BasicExpression<boolean>
  orderBy?: IR.OrderBy
  preserveResultOrder?: boolean
  rows: ReadonlyArray<{
    key: string
    value: Record<string, unknown>
  }>
  preparePreviousIndex?: (
    adapter: ReturnType<typeof createSQLiteCorePersistenceAdapter>,
    collectionId: string,
    signature: string,
  ) => Promise<void>
  transformQuery?: QueryTransform
}

export type ExpressionIndexObservation = {
  indexSql: unknown
  indexValues?: Array<{ key: string; value: unknown }>
  adapterKeys: Array<string>
  directSqlKeys: Array<string>
  indexName: string
  plan: Array<QueryPlanRow>
  predicateQuery: CapturedQuery
  tableName: string
}

export async function observeExpressionIndexScenario({
  viaWrapper = false,
  observeIndexValues = false,
  label,
  indexExpression,
  where,
  orderBy,
  preserveResultOrder = false,
  rows,
  preparePreviousIndex,
  transformQuery,
}: ExpressionIndexScenario): Promise<ExpressionIndexObservation> {
  const baseDriver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  const collectionId = `expression-index-${label}`
  let signature = `generated-expression`
  let cleanupCollection: (() => Promise<void>) | undefined
  const tableName = createPersistedTableName(collectionId, `c`)
  let predicateQuery: CapturedQuery | undefined

  const observingDriver = createQueryObservingDriver(
    baseDriver,
    (query) => {
      if (
        query.sql.includes(`SELECT key, value, metadata, row_version`) &&
        query.sql.includes(`FROM "${tableName}"`)
      ) {
        predicateQuery = query
      }
    },
    transformQuery
      ? (query) =>
          query.sql.includes(`SELECT key, value, metadata, row_version`) &&
          query.sql.includes(`FROM "${tableName}"`)
            ? transformQuery(query)
            : query
      : undefined,
  )
  const adapter = createSQLiteCorePersistenceAdapter({
    driver: observingDriver,
  })

  return withFailurePreservingCleanup(async () => {
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      {
        txId: `seed-${label}`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: rows.map((row) => ({
          type: `insert` as const,
          key: row.key,
          value: row.value,
        })),
      },
    )
    await preparePreviousIndex?.(adapter, collectionId, signature)
    if (viaWrapper) {
      if (
        indexExpression.type !== `func` ||
        indexExpression.name !== `coalesce` ||
        indexExpression.args[1]?.type !== `val`
      )
        throw new Error(`Expected coalesce wrapper witness`)
      const fallback = indexExpression.args[1].value
      const collection = createCollection(
        persistedCollectionOptions<Record<string, unknown>, string>({
          id: collectionId,
          getKey: (row) => String(row.id),
          defaultIndexType: BasicIndex,
          sync: {
            sync: ({ markReady }) => {
              markReady()
            },
          },
          persistence: { adapter },
        }),
      )
      cleanupCollection = () => collection.cleanup()
      collection.createIndex((row) => coalesceExpression(row.stamp, fallback))
      const metadata = collection.getIndexMetadata()[0]!
      signature = metadata.signature
      expect(metadata.expression.type).toBe(`func`)
      if (
        metadata.expression.type !== `func` ||
        metadata.expression.args[1]?.type !== `val`
      )
        throw new Error(`Missing native literal`)
      expect(metadata.expression.args[1].value).toBeInstanceOf(
        fallback instanceof Temporal.Instant
          ? Temporal.Instant
          : Temporal.PlainDate,
      )
      const adjacent =
        fallback instanceof Temporal.Instant
          ? fallback.add({ nanoseconds: 1 })
          : (fallback as Temporal.PlainDate).add({ days: 1 })
      const second = collection.createIndex((row) =>
        coalesceExpression(row.stamp, new IR.Value(adjacent)),
      )
      expect(collection.getIndexMetadata()[1]!.signature).not.toBe(signature)
      collection.removeIndex(second)
      await collection.preload()
    } else {
      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        {
          expressionSql: [serializeIndexExpression(indexExpression)],
        },
      )
    }

    const adapterRows = await adapter.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {
        ...(where ? { where } : {}),
        ...(orderBy ? { orderBy } : {}),
      },
    )
    if (!predicateQuery) {
      throw new Error(`predicate query checkpoint was not reached`)
    }

    const directSqlRows = baseDriver
      .getDatabase()
      .prepare(predicateQuery.sql)
      .all(...predicateQuery.params) as Array<{ key: string }>
    const registryRow = baseDriver
      .getDatabase()
      .prepare(
        `SELECT index_name, expression_sql FROM persisted_index_registry
           WHERE collection_id = ? AND signature = ?`,
      )
      .get(collectionId, signature) as
      { index_name: string; expression_sql: string } | undefined
    if (!registryRow) {
      throw new Error(`expression index registry checkpoint was not reached`)
    }

    const plan = baseDriver
      .getDatabase()
      .prepare(`EXPLAIN QUERY PLAN ${predicateQuery.sql}`)
      .all(...predicateQuery.params) as Array<QueryPlanRow>

    const normalizeKeys = (keys: Array<string>): Array<string> =>
      preserveResultOrder ? keys : keys.sort()

    const expressionSql = (
      JSON.parse(registryRow.expression_sql) as Array<string>
    )[0]!
    const indexValues = observeIndexValues
      ? (
          baseDriver
            .getDatabase()
            .prepare(
              `SELECT key, ${expressionSql} AS value FROM "${tableName}" ORDER BY key`,
            )
            .all() as Array<{ key: string; value: unknown }>
        ).map((row) => ({
          key: String(decodePersistedStorageKey(row.key)),
          value: row.value,
        }))
      : undefined
    return {
      indexValues,
      indexSql: baseDriver
        .getDatabase()
        .prepare(`SELECT sql FROM sqlite_master WHERE name = ?`)
        .get(registryRow.index_name),
      adapterKeys: normalizeKeys(adapterRows.map((row) => String(row.key))),
      directSqlKeys: normalizeKeys(
        directSqlRows.map((row) => String(decodePersistedStorageKey(row.key))),
      ),
      indexName: registryRow.index_name,
      plan,
      predicateQuery,
      tableName,
    }
  }, [() => cleanupCollection?.(), () => baseDriver.close()])
}

export function makeOverbroadEqualityMutation(
  query: CapturedQuery,
): CapturedQuery {
  if (!query.sql.includes(` WHERE `)) return query
  const sql = query.sql.replace(/ = \?/g, ` >= ?`)
  if (sql === query.sql) {
    throw new Error(`overbroad equality mutation did not reach the predicate`)
  }
  return { sql, params: query.params }
}

export function makeLegacyPathBindingMutation(
  query: CapturedQuery,
): CapturedQuery {
  if (!query.sql.includes(` WHERE `)) return query

  const params: Array<unknown> = []
  let pathCount = 0
  let bindingIndex = 0
  const sql = query.sql.replace(
    /json_extract\(value, ('(?:''|[^'])+')\)|\?/g,
    (match, literal: string | undefined) => {
      if (literal === undefined) {
        params.push(query.params[bindingIndex++])
        return match
      }
      pathCount++
      params.push(literal.slice(1, -1).replace(/''/g, `'`))
      return `json_extract(value, ?)`
    },
  )
  if (pathCount === 0 || bindingIndex !== query.params.length) {
    throw new Error(
      `legacy path-binding mutation did not reach all reference paths and bindings`,
    )
  }
  return { sql, params }
}

export function planUsesNamedIndexForOrdering(
  plan: ReadonlyArray<QueryPlanRow>,
  tableName: string,
  indexName: string,
): boolean {
  const tablePattern = sqlitePlanIdentifierPattern(tableName)
  const indexPattern = sqlitePlanIdentifierPattern(indexName)
  const orderedScanPattern = new RegExp(
    `^SCAN(?: TABLE)? ${tablePattern} USING INDEX ${indexPattern}(?:\\s|$)`,
  )
  return plan.some(({ detail }) => orderedScanPattern.test(detail))
}
