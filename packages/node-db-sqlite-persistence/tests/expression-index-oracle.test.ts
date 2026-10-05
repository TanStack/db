/**
 * # When does SQLite use a persisted expression index?
 *
 * Contract and source: RFC #1659 invariant 8 requires persisted index DDL and
 * the indexed runtime predicate to have the same SQLite expression shape.
 * SQLite requires syntactically matching expressions before an expression
 * index can satisfy a predicate.
 *
 * History grammar and domain: every generated matrix reaches indexed string
 * equality, ordinary and 901-value batched BigInt IN, numeric range, string
 * conjunction, ordering, and lower(ref). Paths have a one-to-six-character
 * identifier root and up to three identifier/0..3 tail segments. Numeric
 * targets are -10_000..10_000; generated BigInts use the same bounds plus a
 * 900-member suffix. Fixed cases cover constant-bearing coalesce indexes,
 * BigInt ranges/IN within SQLite's signed-integer domain, and indexed numeric
 * comparisons with tagged values, null, missing, and text controls. Numeric
 * equality/IN, lower-wrapped BigInt IN, lone-surrogate coalesce, Date ranges,
 * strftime, and add keep full reads where SQLite could exclude a JavaScript
 * match. Integer threshold checks include adjacent fractional values.
 * Fixed candidate-superset cases cover large Number versus BigInt bounds,
 * numeric object keys and array indexes through three digit segments, and
 * Unicode lowercase matches around NUL. The numeric-path cases also check
 * named-index use; deeper digit paths retain a full candidate read.
 * Native fixture families add EQ/IN, same-kind ranges, raw-ref NOT leaves,
 * native field pairs, wrapper coalesce indexes, and numeric array/object paths.
 * Rank/text expectations are independent of the SQL compiler. Mixed cases
 * include NaN, null/missing, ordinary strings and alternate native kinds.
 * SQL candidates must contain every expected match; exact native fixtures also
 * check raw keys and supported index plans. NOT/coalesce and scalar
 * eq(in(...), true) retain the safe classifier's full-read fallback.
 * Explicitly qualified refs lower to the same JSON field expression
 * without reinterpreting legacy nested paths. Known omissions: null, arbitrary
 * raw SQL, and native-host planning. Generated BigInts stay inside SQLite's
 * signed range. A fixed legacy-byte case checks read compatibility beyond it.
 *
 * Independent model: fixed keys encode the result of each generated relation;
 * the equality witness also uses a full adapter scan, a small path walker, and
 * strict scalar equality. Neither judgment calls the SQL compiler.
 *
 * Production path and checkpoint: the public SQLite-core adapter factory with
 * the real BetterSqlite3SQLiteDriver. The exact SQL and bindings passed to the
 * driver's predicate query are captured and executed directly before adapter
 * re-filtering, then replayed through EXPLAIN QUERY PLAN. Result keys, ordering
 * when promised, and named-index use are separate observations.
 *
 * Reach, challenge, replay, and cleanup: the expression-index matrix and both
 * generated BigInt range checks run in fixed-seed and seedless-random campaigns.
 * Supplying both TANSTACK_DB_WS5A_SEED and TANSTACK_DB_WS5A_PATH selects only
 * the exact replay campaign; TANSTACK_DB_WS5A_PROPERTY selects a BigInt check
 * instead of the default expression-index matrix. Either replay value alone
 * rejects. Per-axis grammar ablations and same-path SQL/compiler faults must
 * fail the expression-index property. The
 * retained fixed campaign reconstructs the known valid matrix. The bounds
 * above state its range; exact grammar checks reject missing, duplicate, and
 * unexpected axes as nearby invalid matrices. The focused overbroad and former
 * path-binding controls remain independent. In-memory SQLite teardown
 * retains the semantic failure if cleanup also fails.
 */
import fc from 'fast-check'
import { describe, expect, vi, it as vitestIt } from 'vitest'
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
import {
  Temporal,
  temporalFamilies,
  temporalQueryCases,
  temporalValue,
} from '../../db-sqlite-persistence-core/tests/temporal-value-oracle'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import type {
  PersistedTx,
  SQLiteDriver,
} from '@tanstack/db-sqlite-persistence-core'

const DEFAULT_ORACLE_SEED = 1_659_005
const DEFAULT_ORACLE_RUNS = 8
const SQLITE_BIGINT_MIN = -9_223_372_036_854_775_808n
const SQLITE_BIGINT_MAX = 9_223_372_036_854_775_807n
const PERSISTED_TYPE_TAG = `__tanstack_db_persisted_type__`
const PERSISTED_VALUE_TAG = `value`

type OracleScalar = boolean | number | string

type OracleCase = {
  path: Array<string>
  target: OracleScalar
  distractors: [OracleScalar, OracleScalar]
}

type CapturedQuery = {
  sql: string
  params: ReadonlyArray<unknown>
}

type QueryTransform = (query: CapturedQuery) => CapturedQuery

type QueryPlanRow = {
  detail: string
}

type ScanRow = {
  key: string | number
  value: Record<string, unknown>
}

const identifierStart = [`a`, `m`, `p`, `t`, `x`] as const
const identifierRest = [`a`, `b`, `e`, `i`, `n`, `r`, `s`, `0`, `1`] as const

const identifierArbitrary = fc
  .tuple(
    fc.constantFrom(...identifierStart),
    fc.array(fc.constantFrom(...identifierRest), { maxLength: 5 }),
  )
  .map(([start, rest]) => `${start}${rest.join(``)}`)

const legalPathArbitrary = fc
  .tuple(
    identifierArbitrary,
    fc.array(
      fc.oneof(identifierArbitrary, fc.integer({ min: 0, max: 3 }).map(String)),
      { maxLength: 3 },
    ),
  )
  .map(([root, tail]) => [root, ...tail])

type OracleReplayConfiguration = {
  seed: number
  path: string
  numRuns: 1
}

type GeneratedPropertyCampaign = {
  name: `fixed` | `random` | `replay`
  seed?: number
  path?: string
  numRuns: number
}

function oracleReplayConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): OracleReplayConfiguration | undefined {
  const seedText = environment.TANSTACK_DB_WS5A_SEED
  const path = environment.TANSTACK_DB_WS5A_PATH
  if (seedText !== undefined && !/^-?\d+$/.test(seedText)) {
    throw new Error(`TANSTACK_DB_WS5A_SEED must be an integer`)
  }
  if (seedText !== undefined && !Number.isSafeInteger(Number(seedText))) {
    throw new Error(`TANSTACK_DB_WS5A_SEED must be an integer`)
  }
  if (path !== undefined && !/^\d+(?::\d+)*$/.test(path)) {
    throw new Error(
      `TANSTACK_DB_WS5A_PATH must contain colon-separated nonnegative integers`,
    )
  }
  if (seedText === undefined && path === undefined) return undefined
  if (seedText === undefined) {
    throw new Error(
      `TANSTACK_DB_WS5A_PATH requires TANSTACK_DB_WS5A_SEED for exact replay`,
    )
  }
  if (path === undefined) {
    throw new Error(
      `TANSTACK_DB_WS5A_SEED requires TANSTACK_DB_WS5A_PATH for exact replay`,
    )
  }

  return {
    seed: Number(seedText),
    path,
    numRuns: 1,
  }
}

const requestedReplay = oracleReplayConfiguration()
const requestedReplayProperty =
  process.env.TANSTACK_DB_WS5A_PROPERTY ?? `expression-index`
if (
  ![`expression-index`, `bigint-roundtrip`, `bigint-rejection`].includes(
    requestedReplayProperty,
  )
) {
  throw new Error(`TANSTACK_DB_WS5A_PROPERTY must name a generated property`)
}

const generatedPropertyCampaigns: Array<GeneratedPropertyCampaign> =
  requestedReplay === undefined
    ? [
        {
          name: `fixed`,
          seed: DEFAULT_ORACLE_SEED,
          numRuns: DEFAULT_ORACLE_RUNS,
        },
        { name: `random`, numRuns: DEFAULT_ORACLE_RUNS },
      ]
    : [{ name: `replay`, ...requestedReplay }]

function generatedCampaignParameters(campaign: GeneratedPropertyCampaign) {
  return {
    numRuns: campaign.numRuns,
    verbose: 2 as const,
    ...(campaign.seed === undefined ? {} : { seed: campaign.seed }),
    ...(campaign.path === undefined ? {} : { path: campaign.path }),
  }
}

function createNestedRow(
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

function readPath(
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

function expectedKeysFromScan(
  rows: ReadonlyArray<ScanRow>,
  path: ReadonlyArray<string>,
  target: OracleScalar,
): Array<string> {
  return rows
    .filter((row) => readPath(row.value, path) === target)
    .map((row) => String(row.key))
    .sort()
}

function sqliteJsonPath(path: ReadonlyArray<string>): string {
  return path.reduce((result, segment) => {
    return /^\d+$/.test(segment)
      ? `${result}[${segment}]`
      : `${result}.${segment}`
  }, `$`)
}

function sqliteLiteral(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}

function sqliteScalarParameter(value: OracleScalar): number | string {
  return typeof value === `boolean` ? (value ? 1 : 0) : value
}

function serializeIndexExpression(expression: IR.BasicExpression): string {
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

function bigintRangeError(value: bigint): string {
  return `SQLite BigInt value ${value} is outside the signed 64-bit range [${SQLITE_BIGINT_MIN}, ${SQLITE_BIGINT_MAX}]`
}

function createQueryObservingDriver(
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

async function withFailurePreservingCleanup<T>(
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

function planUsesNamedIndex(
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

function planScansTable(
  plan: ReadonlyArray<QueryPlanRow>,
  tableName: string,
): boolean {
  const tablePattern = sqlitePlanIdentifierPattern(tableName)
  const scanPattern = new RegExp(`^SCAN(?: TABLE)? ${tablePattern}(?:\\s|$)`)
  return plan.some(({ detail }) => scanPattern.test(detail))
}

function sqlitePlanIdentifierPattern(identifier: string): string {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
  return `(?:"${escaped}"|${escaped})`
}

type ExpressionIndexScenario = {
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

const GENERATED_SCENARIO_KINDS = [
  `eq`,
  `in`,
  `batched-in`,
  `range`,
  `and`,
  `order-by`,
  `wrapped-lower`,
] as const

type GeneratedScenarioKind = (typeof GENERATED_SCENARIO_KINDS)[number]

const GENERATED_SCENARIO_FAULTS = [
  { kind: `eq`, wrongAnswer: `inverted equality operator` },
  { kind: `in`, wrongAnswer: `shifted first IN binding` },
  { kind: `batched-in`, wrongAnswer: `replaced final batch member` },
  { kind: `range`, wrongAnswer: `exclusive lower boundary` },
  { kind: `and`, wrongAnswer: `wrong conjunct binding` },
  { kind: `order-by`, wrongAnswer: `reversed ordering direction` },
  { kind: `wrapped-lower`, wrongAnswer: `wrong expression wrapper` },
] as const satisfies ReadonlyArray<{
  kind: GeneratedScenarioKind
  wrongAnswer: string
}>

type GeneratedExpressionIndexScenario = ExpressionIndexScenario & {
  kind: GeneratedScenarioKind
  expectedKeys: Array<string>
  expectedPlan: `search` | `ordered-scan`
}

type ExpressionIndexObservation = {
  indexSql: unknown
  indexValues?: Array<{ key: string; value: unknown }>
  adapterKeys: Array<string>
  directSqlKeys: Array<string>
  indexName: string
  plan: Array<QueryPlanRow>
  predicateQuery: CapturedQuery
  tableName: string
}

async function observeExpressionIndexScenario({
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
    await adapter.applyCommittedTx(collectionId, {
      txId: `seed-${label}`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: rows.map((row) => ({
        type: `insert` as const,
        key: row.key,
        value: row.value,
      })),
    })
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
      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [serializeIndexExpression(indexExpression)],
      })
    }

    const adapterRows = await adapter.loadSubset(collectionId, {
      ...(where ? { where } : {}),
      ...(orderBy ? { orderBy } : {}),
    })
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

function makeOverbroadEqualityMutation(query: CapturedQuery): CapturedQuery {
  if (!query.sql.includes(` WHERE `)) return query
  const sql = query.sql.replace(/ = \?/g, ` >= ?`)
  if (sql === query.sql) {
    throw new Error(`overbroad equality mutation did not reach the predicate`)
  }
  return { sql, params: query.params }
}

function makeLegacyPathBindingMutation(query: CapturedQuery): CapturedQuery {
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

function planUsesNamedIndexForOrdering(
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

const numericIndexCaseArbitrary = fc
  .tuple(legalPathArbitrary, fc.integer({ min: -10_000, max: 10_000 }))
  .map(([path, target]) => ({ path, target }))

const stringIndexCaseArbitrary = fc
  .tuple(legalPathArbitrary, fc.integer({ min: 0, max: 10_000 }))
  .map(([path, suffix]) => ({ path, target: `target-'${suffix}` }))

const generatedScenarioMatrixArbitrary = fc
  .tuple(
    stringIndexCaseArbitrary,
    numericIndexCaseArbitrary,
    numericIndexCaseArbitrary,
    numericIndexCaseArbitrary,
    stringIndexCaseArbitrary,
    numericIndexCaseArbitrary,
    stringIndexCaseArbitrary,
  )
  .map(
    ([
      eqCase,
      inCase,
      batchedCase,
      rangeCase,
      andCase,
      orderCase,
      lowerCase,
    ]) => {
      const eqRows = [
        {
          key: `eq-match-a`,
          value: createNestedRow(eqCase.path, eqCase.target),
        },
        {
          key: `eq-different`,
          value: createNestedRow(eqCase.path, `${eqCase.target}-other`),
        },
        {
          key: `eq-match-b`,
          value: createNestedRow(eqCase.path, eqCase.target),
        },
      ]
      const batchedValues = Array.from({ length: 901 }, (_unused, index) =>
        BigInt(batchedCase.target + index),
      )
      const lowerTarget = lowerCase.target.toLowerCase()

      return [
        {
          kind: `eq`,
          label: `generated-eq`,
          indexExpression: new IR.PropRef(eqCase.path),
          where: new IR.Func<boolean>(`eq`, [
            new IR.PropRef(eqCase.path),
            new IR.Value(eqCase.target),
          ]),
          rows: eqRows,
          expectedKeys: [`eq-match-a`, `eq-match-b`],
          expectedPlan: `search`,
        },
        {
          kind: `in`,
          label: `generated-in`,
          indexExpression: new IR.PropRef(inCase.path),
          where: new IR.Func<boolean>(`in`, [
            new IR.PropRef(inCase.path),
            new IR.Value([BigInt(inCase.target - 1), BigInt(inCase.target)]),
          ]),
          rows: [
            {
              key: `in-lower`,
              value: createNestedRow(inCase.path, BigInt(inCase.target - 1)),
            },
            {
              key: `in-match`,
              value: createNestedRow(inCase.path, BigInt(inCase.target)),
            },
            {
              key: `in-higher`,
              value: createNestedRow(inCase.path, BigInt(inCase.target + 1)),
            },
          ],
          expectedKeys: [`in-lower`, `in-match`],
          expectedPlan: `search`,
        },
        {
          kind: `batched-in`,
          label: `generated-batched-in`,
          indexExpression: new IR.PropRef(batchedCase.path),
          where: new IR.Func<boolean>(`in`, [
            new IR.PropRef(batchedCase.path),
            new IR.Value(batchedValues),
          ]),
          rows: [
            {
              key: `batch-first`,
              value: createNestedRow(
                batchedCase.path,
                BigInt(batchedCase.target),
              ),
            },
            {
              key: `batch-last`,
              value: createNestedRow(
                batchedCase.path,
                BigInt(batchedCase.target + 900),
              ),
            },
            {
              key: `batch-outside`,
              value: createNestedRow(
                batchedCase.path,
                BigInt(batchedCase.target - 1),
              ),
            },
          ],
          expectedKeys: [`batch-first`, `batch-last`],
          expectedPlan: `search`,
        },
        {
          kind: `range`,
          label: `generated-range`,
          indexExpression: new IR.PropRef(rangeCase.path),
          where: new IR.Func<boolean>(`gte`, [
            new IR.PropRef(rangeCase.path),
            new IR.Value(rangeCase.target),
          ]),
          rows: [
            {
              key: `range-lower`,
              value: createNestedRow(rangeCase.path, rangeCase.target - 1),
            },
            {
              key: `range-match`,
              value: createNestedRow(rangeCase.path, rangeCase.target),
            },
            {
              key: `range-higher`,
              value: createNestedRow(rangeCase.path, rangeCase.target + 1),
            },
          ],
          expectedKeys: [`range-higher`, `range-match`],
          expectedPlan: `search`,
        },
        {
          kind: `and`,
          label: `generated-and`,
          indexExpression: new IR.PropRef(andCase.path),
          where: new IR.Func<boolean>(`and`, [
            new IR.Func(`eq`, [
              new IR.PropRef(andCase.path),
              new IR.Value(andCase.target),
            ]),
            new IR.Func(`eq`, [
              new IR.PropRef([`status`]),
              new IR.Value(`active`),
            ]),
          ]),
          rows: [
            {
              key: `and-match`,
              value: {
                ...createNestedRow(andCase.path, andCase.target),
                status: `active`,
              },
            },
            {
              key: `and-inactive`,
              value: {
                ...createNestedRow(andCase.path, andCase.target),
                status: `inactive`,
              },
            },
            {
              key: `and-different`,
              value: {
                ...createNestedRow(andCase.path, `${andCase.target}-other`),
                status: `active`,
              },
            },
          ],
          expectedKeys: [`and-match`],
          expectedPlan: `search`,
        },
        {
          kind: `order-by`,
          label: `generated-order-by`,
          indexExpression: new IR.PropRef(orderCase.path),
          orderBy: [
            {
              expression: new IR.PropRef(orderCase.path),
              compareOptions: {
                direction: `asc`,
                nulls: `last`,
              },
            },
          ],
          preserveResultOrder: true,
          rows: [
            {
              key: `order-high`,
              value: createNestedRow(orderCase.path, orderCase.target + 1),
            },
            {
              key: `order-low`,
              value: createNestedRow(orderCase.path, orderCase.target - 1),
            },
            {
              key: `order-middle`,
              value: createNestedRow(orderCase.path, orderCase.target),
            },
          ],
          expectedKeys: [`order-low`, `order-middle`, `order-high`],
          expectedPlan: `ordered-scan`,
        },
        {
          kind: `wrapped-lower`,
          label: `generated-wrapped-lower`,
          indexExpression: new IR.Func(`lower`, [
            new IR.PropRef(lowerCase.path),
          ]),
          where: new IR.Func<boolean>(`eq`, [
            new IR.Func(`lower`, [new IR.PropRef(lowerCase.path)]),
            new IR.Value(lowerTarget),
          ]),
          rows: [
            {
              key: `lower-upper`,
              value: createNestedRow(
                lowerCase.path,
                lowerCase.target.toUpperCase(),
              ),
            },
            {
              key: `lower-lower`,
              value: createNestedRow(lowerCase.path, lowerTarget),
            },
            {
              key: `lower-other`,
              value: createNestedRow(lowerCase.path, `${lowerTarget}-other`),
            },
          ],
          expectedKeys: [`lower-lower`, `lower-upper`],
          expectedPlan: `search`,
        },
      ] satisfies Array<GeneratedExpressionIndexScenario>
    },
  )

function assertGeneratedScenarioGrammar(
  scenarios: ReadonlyArray<GeneratedExpressionIndexScenario>,
): void {
  const actualKinds = scenarios.map(({ kind }) => kind)
  const missingKinds = GENERATED_SCENARIO_KINDS.filter(
    (kind) => !actualKinds.includes(kind),
  )
  const unexpectedKinds = actualKinds.filter(
    (kind) => !GENERATED_SCENARIO_KINDS.includes(kind),
  )
  const duplicateKinds = actualKinds.filter(
    (kind, index) => actualKinds.indexOf(kind) !== index,
  )

  if (
    missingKinds.length > 0 ||
    unexpectedKinds.length > 0 ||
    duplicateKinds.length > 0
  ) {
    throw new Error(
      `generated scenario grammar mismatch: missing=${missingKinds.join(`,`) || `none`}; unexpected=${unexpectedKinds.join(`,`) || `none`}; duplicate=${duplicateKinds.join(`,`) || `none`}`,
    )
  }
}

function mutateGeneratedScenarioQuery(
  kind: GeneratedScenarioKind,
): QueryTransform {
  const unreached = (detail: string): never => {
    throw new Error(`${kind} SQL/compiler fault did not reach ${detail}`)
  }

  const numericInList = (
    query: CapturedQuery,
    length: number,
  ): Array<number> => {
    const boundList = query.params[0]
    if (
      !query.sql.includes(` IN (SELECT value FROM json_each(?))`) ||
      query.params.length !== 1 ||
      typeof boundList !== `string`
    ) {
      return unreached(`the ${length}-member IN list binding`)
    }
    let values: unknown
    try {
      values = JSON.parse(boundList) as unknown
    } catch {
      return unreached(`a JSON IN list binding`)
    }
    if (
      !Array.isArray(values) ||
      values.length !== length ||
      !values.every(
        (value: unknown) =>
          typeof value === `number` && Number.isSafeInteger(value),
      )
    ) {
      return unreached(`a ${length}-member numeric IN list binding`)
    }
    return values as Array<number>
  }

  switch (kind) {
    case `eq`:
      return (query) => {
        const sql = query.sql.replace(/ = \?/g, ` != ?`)
        if (sql === query.sql) return unreached(`the equality operator`)
        return { sql, params: query.params }
      }
    case `in`:
      return (query) => {
        const values = numericInList(query, 2)
        values[0] = values[0]! + 2
        return { sql: query.sql, params: [JSON.stringify(values)] }
      }
    case `batched-in`:
      return (query) => {
        const values = numericInList(query, 901)
        values[values.length - 1] = values[0]! - 1
        return { sql: query.sql, params: [JSON.stringify(values)] }
      }
    case `range`:
      return (query) => {
        const sql = query.sql.replace(/ >= \?/, ` > ?`)
        if (sql === query.sql) return unreached(`the inclusive range operator`)
        return { sql, params: query.params }
      }
    case `and`:
      return (query) => {
        const activeIndex = query.params.indexOf(`active`)
        if (activeIndex === -1) return unreached(`the conjunction binding`)
        const params = [...query.params]
        params[activeIndex] = `inactive`
        return { sql: query.sql, params }
      }
    case `order-by`:
      return (query) => {
        const sql = query.sql.replace(/\sASC\b/, ` DESC`)
        if (sql === query.sql) return unreached(`the ascending order clause`)
        return { sql, params: query.params }
      }
    case `wrapped-lower`:
      return (query) => {
        const sql = query.sql.replace(/\blower\(/gi, `upper(`)
        if (sql === query.sql) return unreached(`the lower wrapper`)
        return { sql, params: query.params }
      }
  }
}

function assertGeneratedScenarioObservation(
  scenario: GeneratedExpressionIndexScenario,
  observation: ExpressionIndexObservation,
): void {
  const diagnostic = JSON.stringify(
    {
      kind: scenario.kind,
      sql: observation.predicateQuery.sql,
      params: observation.predicateQuery.params,
      plan: observation.plan.map((row) => row.detail),
      adapterKeys: observation.adapterKeys,
      directSqlKeys: observation.directSqlKeys,
    },
    null,
    2,
  )

  expect(observation.adapterKeys, diagnostic).toEqual(scenario.expectedKeys)
  expect(observation.directSqlKeys, diagnostic).toEqual(scenario.expectedKeys)
  if (scenario.expectedPlan === `ordered-scan`) {
    expect(
      planUsesNamedIndexForOrdering(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
      diagnostic,
    ).toBe(true)
  } else {
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
      diagnostic,
    ).toBe(true)
    expect(
      planScansTable(observation.plan, observation.tableName),
      diagnostic,
    ).toBe(false)
  }
}

type GeneratedScenarioPropertyOptions = {
  ablateKind?: GeneratedScenarioKind
  faultKind?: GeneratedScenarioKind
  onScenario?: (kind: GeneratedScenarioKind) => void
}

function generatedScenarioProperty({
  ablateKind,
  faultKind,
  onScenario,
}: GeneratedScenarioPropertyOptions = {}) {
  return fc.asyncProperty(generatedScenarioMatrixArbitrary, async (matrix) => {
    const scenarios =
      ablateKind === undefined
        ? matrix
        : matrix.filter(({ kind }) => kind !== ablateKind)
    assertGeneratedScenarioGrammar(scenarios)

    for (const scenario of scenarios) {
      onScenario?.(scenario.kind)
      const observation = await observeExpressionIndexScenario({
        ...scenario,
        ...(faultKind === scenario.kind
          ? { transformQuery: mutateGeneratedScenarioQuery(scenario.kind) }
          : {}),
      })
      assertGeneratedScenarioObservation(scenario, observation)
    }
  })
}

async function runGeneratedScenarioProperty(
  campaign: GeneratedPropertyCampaign,
) {
  const reachedScenarios = new Set<GeneratedScenarioKind>()
  const details = await fc.check(
    generatedScenarioProperty({
      onScenario: (kind) => reachedScenarios.add(kind),
    }),
    generatedCampaignParameters(campaign),
  )

  if (details.failed) {
    throw new Error(
      fc.defaultReportMessage(details) ??
        `generated expression-index property failed without a report`,
    )
  }
  expect([...reachedScenarios].sort()).toEqual(
    [...GENERATED_SCENARIO_KINDS].sort(),
  )
  return details
}

async function assertExpressionIndexHistory(
  testCase: OracleCase,
  label: string,
): Promise<void> {
  const baseDriver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  const collectionId = `expression-index-${label}`
  const signature = `generated-ref`
  const tableName = createPersistedTableName(collectionId, `c`)
  let predicateQuery: CapturedQuery | undefined

  const observingDriver = createQueryObservingDriver(baseDriver, (query) => {
    if (
      query.sql.includes(`FROM "${tableName}"`) &&
      query.sql.includes(` WHERE `)
    ) {
      predicateQuery = query
    }
  })
  const adapter = createSQLiteCorePersistenceAdapter({
    driver: observingDriver,
  })
  const values = [
    testCase.target,
    testCase.distractors[0],
    testCase.target,
    testCase.distractors[1],
    testCase.distractors[0],
    testCase.target,
  ]
  const seededRows = values.map((value, index) => ({
    key: `row-${index}`,
    value: createNestedRow(testCase.path, value),
  }))

  await withFailurePreservingCleanup(async () => {
    await adapter.applyCommittedTx(collectionId, {
      txId: `seed-${label}`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: seededRows.map((row) => ({
        type: `insert` as const,
        key: row.key,
        value: row.value,
      })),
    })

    await adapter.ensureIndex(collectionId, signature, {
      expressionSql: [JSON.stringify({ type: `ref`, path: testCase.path })],
    })

    if (!adapter.scanRows) {
      throw new Error(`real SQLite adapter did not expose scanRows`)
    }
    const scannedRows = await adapter.scanRows(collectionId)
    const expectedKeys = expectedKeysFromScan(
      scannedRows,
      testCase.path,
      testCase.target,
    )
    const independentlySeededExpectedKeys = expectedKeysFromScan(
      seededRows,
      testCase.path,
      testCase.target,
    )

    expect(
      expectedKeys,
      `full-scan checkpoint must retain independently seeded values`,
    ).toEqual(independentlySeededExpectedKeys)
    expect(scannedRows).toHaveLength(seededRows.length)

    const indexedRows = await adapter.loadSubset(collectionId, {
      where: new IR.Func(`eq`, [
        new IR.PropRef(testCase.path),
        new IR.Value(testCase.target),
      ]),
    })
    const indexedKeys = indexedRows.map((row) => String(row.key)).sort()

    expect(
      indexedKeys,
      `indexed adapter results must equal the independent scan model`,
    ).toEqual(expectedKeys)

    if (!predicateQuery) {
      throw new Error(`predicate query checkpoint was not reached`)
    }
    expect(
      predicateQuery.params,
      `the filter value must remain a bound parameter`,
    ).toContain(sqliteScalarParameter(testCase.target))

    const directSqlKeys = (
      baseDriver
        .getDatabase()
        .prepare(predicateQuery.sql)
        .all(...predicateQuery.params) as Array<{ key: string }>
    )
      .map((row) => String(decodePersistedStorageKey(row.key)))
      .sort()
    expect(
      directSqlKeys,
      `captured SQL must produce the independent keys before in-memory filtering`,
    ).toEqual(expectedKeys)

    const registryRow = baseDriver
      .getDatabase()
      .prepare(
        `SELECT index_name FROM persisted_index_registry
           WHERE collection_id = ? AND signature = ?`,
      )
      .get(collectionId, signature) as { index_name: string } | undefined
    if (!registryRow) {
      throw new Error(`expression index registry checkpoint was not reached`)
    }

    const indexDefinition = baseDriver
      .getDatabase()
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
      )
      .get(registryRow.index_name) as { sql: string } | undefined
    if (!indexDefinition) {
      throw new Error(`expression index DDL checkpoint was not reached`)
    }

    const plan = baseDriver
      .getDatabase()
      .prepare(`EXPLAIN QUERY PLAN ${predicateQuery.sql}`)
      .all(...predicateQuery.params) as Array<QueryPlanRow>
    const checkpoint = {
      name: `predicate-explain`,
      path: sqliteJsonPath(testCase.path),
      expectedKeys,
      indexedKeys,
      subsetSql: predicateQuery.sql,
      subsetParams: predicateQuery.params,
      indexName: registryRow.index_name,
      indexSql: indexDefinition.sql,
      plan: plan.map((row) => row.detail),
      usedNamedExpressionIndex: planUsesNamedIndex(
        plan,
        tableName,
        registryRow.index_name,
      ),
      scannedCollectionTable: planScansTable(plan, tableName),
    }
    const checkpointMessage = `predicate checkpoint must use only the matching expression index:\n${JSON.stringify(checkpoint, null, 2)}`

    expect(checkpoint.usedNamedExpressionIndex, checkpointMessage).toBe(true)
    expect(checkpoint.scannedCollectionTable, checkpointMessage).toBe(false)
  }, [() => baseDriver.close()])
}

describe(`SQLite expression-index oracle`, () => {
  const it = requestedReplay === undefined ? vitestIt : vitestIt.skip

  it.each([
    {
      label: `empty seed`,
      environment: { TANSTACK_DB_WS5A_SEED: `` },
      message: `TANSTACK_DB_WS5A_SEED must be an integer`,
    },
    {
      label: `seed without path`,
      environment: { TANSTACK_DB_WS5A_SEED: `1659005` },
      message: `TANSTACK_DB_WS5A_SEED requires TANSTACK_DB_WS5A_PATH for exact replay`,
    },
    {
      label: `path without seed`,
      environment: { TANSTACK_DB_WS5A_PATH: `0` },
      message: `TANSTACK_DB_WS5A_PATH requires TANSTACK_DB_WS5A_SEED for exact replay`,
    },
    {
      label: `invalid shrink path`,
      environment: {
        TANSTACK_DB_WS5A_SEED: `1659005`,
        TANSTACK_DB_WS5A_PATH: `0:`,
      },
      message: `TANSTACK_DB_WS5A_PATH must contain colon-separated nonnegative integers`,
    },
  ])(`rejects a $label replay configuration`, ({ environment, message }) => {
    expect(() => oracleReplayConfiguration(environment)).toThrow(message)
  })

  it(`accepts only a checked seed and shrink-path replay pair`, () => {
    expect(
      oracleReplayConfiguration({
        TANSTACK_DB_WS5A_SEED: `-1659005`,
        TANSTACK_DB_WS5A_PATH: `0:1:2`,
      }),
    ).toEqual({ seed: -1659005, path: `0:1:2`, numRuns: 1 })
    expect(oracleReplayConfiguration({})).toBeUndefined()
  })

  it.each([
    {
      label: `coalesce-constant`,
      indexExpression: new IR.Func(`coalesce`, [
        new IR.PropRef([`nickname`]),
        new IR.Value(`none`),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`coalesce`, [
          new IR.PropRef([`nickname`]),
          new IR.Value(`none`),
        ]),
        new IR.Value(`none`),
      ]),
      rows: [
        { key: `missing`, value: { nickname: null } },
        { key: `present`, value: { nickname: `Ada` } },
      ],
      expectedKeys: [`missing`],
    },
    {
      label: `string-membership-constant`,
      indexExpression: new IR.Func(`in`, [
        new IR.PropRef([`nickname`]),
        new IR.Value([`Ada`, `Grace`]),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`in`, [
          new IR.PropRef([`nickname`]),
          new IR.Value([`Ada`, `Grace`]),
        ]),
        new IR.Value(true),
      ]),
      rows: [
        { key: `matching`, value: { nickname: `Ada` } },
        { key: `different`, value: { nickname: `Linus` } },
      ],
      expectedKeys: [`matching`],
    },
    {
      label: `strftime-constant`,
      indexExpression: new IR.Func(`strftime`, [
        new IR.Value(`%Y-%m-%d`),
        new IR.Func(`datetime`, [new IR.PropRef([`createdAt`])]),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`strftime`, [
          new IR.Value(`%Y-%m-%d`),
          new IR.Func(`datetime`, [new IR.PropRef([`createdAt`])]),
        ]),
        new IR.Value(`2026-04-05`),
      ]),
      rows: [
        { key: `current`, value: { createdAt: `2026-04-05T00:00:00.000Z` } },
        {
          key: `epoch-milliseconds`,
          value: { createdAt: new Date(`2026-04-05T00:00:00.000Z`).getTime() },
        },
        { key: `past`, value: { createdAt: `2025-04-05T00:00:00.000Z` } },
      ],
      expectedKeys: [`current`, `epoch-milliseconds`],
    },
    {
      label: `add-constant`,
      indexExpression: new IR.Func(`add`, [
        new IR.PropRef([`score`]),
        new IR.Value(1),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`add`, [new IR.PropRef([`score`]), new IR.Value(1)]),
        new IR.Value(`21`),
      ]),
      rows: [
        { key: `matching`, value: { score: `2` } },
        { key: `different`, value: { score: 4 } },
      ],
      expectedKeys: [`matching`],
    },
    {
      label: `bigint-coalesce-constant`,
      indexExpression: new IR.Func(`coalesce`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`coalesce`, [
          new IR.PropRef([`largeViewCount`]),
          new IR.Value(SQLITE_BIGINT_MIN),
        ]),
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      rows: [
        { key: `missing`, value: { largeViewCount: null } },
        { key: `minimum`, value: { largeViewCount: SQLITE_BIGINT_MIN } },
        { key: `zero`, value: { largeViewCount: 0n } },
      ],
      expectedKeys: [`minimum`, `missing`],
    },
  ])(
    `loads through a constant-bearing $label expression`,
    async ({ expectedKeys, ...scenario }) => {
      const observation = await observeExpressionIndexScenario(scenario)

      expect(observation.adapterKeys).toEqual(expectedKeys)
      if (
        scenario.label === `strftime-constant` ||
        scenario.label === `add-constant` ||
        scenario.label === `string-membership-constant`
      ) {
        expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
        expect(observation.directSqlKeys).toEqual(
          scenario.rows.map((row) => row.key).sort(),
        )
        expect(planScansTable(observation.plan, observation.tableName)).toBe(
          true,
        )
        return
      }
      expect(observation.directSqlKeys).toEqual(expectedKeys)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  // Literal positions and polarity come from the string contract, not SQL.
  it.each([`\u0000ab`, `a\u0000b`, `ab\u0000`])(
    `preserves ordinary NUL strings / %j`,
    async (target) => {
      const ref = new IR.PropRef([`stamp`])
      const literal = new IR.Value(target)
      const eq = new IR.Func<boolean>(`eq`, [ref, literal])
      for (const where of [
        eq,
        new IR.Func<boolean>(`eq`, [literal, ref]),
        new IR.Func<boolean>(`in`, [ref, new IR.Value([target, `other`])]),
        new IR.Func<boolean>(`and`, [eq, new IR.Value(true)]),
        new IR.Func<boolean>(`or`, [eq, new IR.Value(false)]),
      ]) {
        const result = await observeExpressionIndexScenario({
          label: `NUL`,
          indexExpression: ref,
          where,
          rows: [
            { key: `match`, value: { stamp: target } },
            { key: `different`, value: { stamp: `absent` } },
          ],
        })
        expect(result.adapterKeys).toEqual([`match`])
        expect(result.directSqlKeys).toEqual([`match`])
      }
    },
  )

  it(`keeps large string membership indexes within SQLite expression depth`, async () => {
    const membership = new IR.Func(`in`, [
      new IR.PropRef([`nickname`]),
      new IR.Value(Array.from({ length: 1025 }, (_, index) => `name-${index}`)),
    ])
    const observation = await observeExpressionIndexScenario({
      label: `large-string-membership`,
      indexExpression: membership,
      where: new IR.Func<boolean>(`eq`, [membership, new IR.Value(true)]),
      rows: [
        { key: `matching`, value: { nickname: `name-1024` } },
        { key: `different`, value: { nickname: `absent` } },
      ],
    })
    expect(observation.adapterKeys).toEqual([`matching`])
    // The DDL remains valid at large arity. The safe classifier deliberately
    // leaves eq(in(...), true) to residual filtering, as for other scalar functions.
    expect(observation.indexSql).toBeDefined()
    expect(observation.directSqlKeys).toEqual([`different`, `matching`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
  })

  it(`rebuilds a persisted BigInt-constant index when its normalized spec changes`, async () => {
    const indexExpression = new IR.Func(`coalesce`, [
      new IR.PropRef([`largeViewCount`]),
      new IR.Value(SQLITE_BIGINT_MIN),
    ])
    const observation = await observeExpressionIndexScenario({
      label: `bigint-constant-upgrade`,
      indexExpression,
      where: new IR.Func<boolean>(`eq`, [
        indexExpression,
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      rows: [
        { key: `missing`, value: { largeViewCount: null } },
        { key: `minimum`, value: { largeViewCount: SQLITE_BIGINT_MIN } },
        { key: `zero`, value: { largeViewCount: 0n } },
      ],
      preparePreviousIndex: async (adapter, collectionId, signature) => {
        await adapter.ensureIndex(collectionId, signature, {
          expressionSql: [
            JSON.stringify(indexExpression, (_key, value: unknown) =>
              typeof value === `bigint` ? value.toString() : value,
            ),
          ],
        })
      },
    })

    expect(observation.adapterKeys).toEqual([`minimum`, `missing`])
    expect(observation.directSqlKeys).toEqual([`minimum`, `missing`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it.each([
    {
      label: `bigint-field-range`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(BigInt(`9007199254740993`)),
      ]),
      rows: [
        {
          key: `lower`,
          value: { largeViewCount: BigInt(`9007199254740992`) },
        },
        {
          key: `higher`,
          value: { largeViewCount: BigInt(`9007199254740997`) },
        },
      ],
      expectedKeys: [`higher`],
      expectedCandidateKeys: [`higher`, `lower`],
      expectedQueryParams: [],
    },
    {
      label: `bigint-field-min-boundary`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      rows: [
        {
          key: `minimum`,
          value: { largeViewCount: SQLITE_BIGINT_MIN },
        },
        {
          key: `next`,
          value: { largeViewCount: SQLITE_BIGINT_MIN + 1n },
        },
      ],
      expectedKeys: [`minimum`],
      expectedQueryParams: [],
    },
    {
      label: `bigint-field-max-boundary`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MAX),
      ]),
      rows: [
        {
          key: `previous`,
          value: { largeViewCount: SQLITE_BIGINT_MAX - 1n },
        },
        {
          key: `maximum`,
          value: { largeViewCount: SQLITE_BIGINT_MAX },
        },
      ],
      expectedKeys: [`maximum`],
      expectedQueryParams: [],
    },
    {
      label: `date-field-range`,
      indexExpression: new IR.PropRef([`createdAt`]),
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`createdAt`]),
        new IR.Value(new Date(`2026-01-02T12:00:00.000Z`)),
      ]),
      rows: [
        {
          key: `earlier`,
          value: { createdAt: new Date(`2026-01-02T00:00:00.000Z`) },
        },
        {
          key: `later`,
          value: { createdAt: new Date(`2026-01-03T00:00:00.000Z`) },
        },
        {
          key: `numeric-later`,
          value: { createdAt: new Date(`2026-01-03T00:00:00.000Z`).getTime() },
        },
      ],
      expectedKeys: [`later`, `numeric-later`],
      expectedQueryParams: [],
    },
    {
      label: `bigint-field-in`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value([BigInt(`9007199254740992`), BigInt(`9007199254740997`)]),
      ]),
      rows: [
        {
          key: `included-low`,
          value: { largeViewCount: BigInt(`9007199254740992`) },
        },
        {
          key: `excluded`,
          value: { largeViewCount: BigInt(`9007199254740994`) },
        },
        {
          key: `included-high`,
          value: { largeViewCount: BigInt(`9007199254740997`) },
        },
      ],
      expectedKeys: [`included-high`, `included-low`],
      expectedQueryParams: [`[9007199254740992,9007199254740997]`],
    },
    {
      label: `bigint-field-batched-in`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(
          Array.from(
            { length: 901 },
            (_unused, index) => BigInt(`9007199254740992`) + BigInt(index),
          ),
        ),
      ]),
      rows: [
        {
          key: `included-first`,
          value: { largeViewCount: BigInt(`9007199254740992`) },
        },
        {
          key: `excluded`,
          value: { largeViewCount: BigInt(`9007199254740991`) },
        },
        {
          key: `included-last`,
          value: { largeViewCount: BigInt(`9007199254741892`) },
        },
      ],
      expectedKeys: [`included-first`, `included-last`],
      expectedQueryParams: [
        `[${Array.from({ length: 901 }, (_unused, index) =>
          (BigInt(`9007199254740992`) + BigInt(index)).toString(),
        ).join(`,`)}]`,
      ],
    },
  ])(
    `uses the raw $label field expression index`,
    async ({
      expectedKeys,
      expectedCandidateKeys,
      expectedQueryParams,
      ...scenario
    }) => {
      const observation = await observeExpressionIndexScenario(scenario)
      const diagnostic = JSON.stringify(
        {
          sql: observation.predicateQuery.sql,
          params: observation.predicateQuery.params,
          plan: observation.plan.map((row) => row.detail),
          adapterKeys: observation.adapterKeys,
          directSqlKeys: observation.directSqlKeys,
        },
        null,
        2,
      )

      expect(observation.adapterKeys, diagnostic).toEqual(expectedKeys)
      if (scenario.label === `date-field-range`) {
        expect(observation.predicateQuery.sql, diagnostic).not.toContain(
          ` WHERE `,
        )
        expect(observation.directSqlKeys, diagnostic).toEqual(
          scenario.rows.map((row) => row.key).sort(),
        )
        expect(planScansTable(observation.plan, observation.tableName)).toBe(
          true,
        )
        return
      }
      expect(observation.directSqlKeys, diagnostic).toEqual(
        expectedCandidateKeys ?? expectedKeys,
      )
      expect(observation.predicateQuery.params, diagnostic).toEqual(
        expectedQueryParams,
      )
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
        diagnostic,
      ).toBe(true)
    },
  )

  it(`uses the field expression index for a paired-surrogate string equality`, async () => {
    const field = new IR.PropRef([`name`])
    const observation = await observeExpressionIndexScenario({
      label: `paired-surrogate-equality`,
      indexExpression: field,
      where: new IR.Func<boolean>(`eq`, [field, new IR.Value(`😀`)]),
      rows: [
        { key: `matching`, value: { name: `😀` } },
        { key: `other`, value: { name: `other` } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`matching`])
    expect(observation.directSqlKeys).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it.each([
    { label: `field on the left`, reversed: false },
    { label: `field on the right`, reversed: true },
  ])(
    `keeps indexed lone-surrogate equality sound with $label`,
    async ({ reversed }) => {
      const field = new IR.PropRef([`name`])
      const value = new IR.Value(`\uD800`)
      const observation = await observeExpressionIndexScenario({
        label: `lone-surrogate-equality`,
        indexExpression: field,
        where: new IR.Func<boolean>(
          `eq`,
          reversed ? [value, field] : [field, value],
        ),
        rows: [
          { key: `matching`, value: { name: `\uD800` } },
          { key: `other-lone`, value: { name: `\uDC00` } },
          { key: `ordinary`, value: { name: `ordinary` } },
        ],
      })

      expect(observation.adapterKeys).toEqual([`matching`])
      // The binding and stored value must have the same SQLite byte sequence.
      expect(observation.directSqlKeys).toEqual([`matching`])
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it.each([
    { label: `BigInt equality`, value: 1n, expectedKeys: [`bigint`] },
    { label: `boolean equality`, value: true, expectedKeys: [`boolean`] },
  ])(
    `keeps indexed $label sound across stored scalar types`,
    async ({ value, expectedKeys }) => {
      const field = new IR.PropRef([`n`])
      const observation = await observeExpressionIndexScenario({
        label: `mixed-scalar-equality`,
        indexExpression: field,
        where: new IR.Func<boolean>(`eq`, [field, new IR.Value(value)]),
        rows: [
          { key: `bigint`, value: { n: 1n } },
          { key: `boolean`, value: { n: true } },
          { key: `number`, value: { n: 1 } },
          { key: `text`, value: { n: `1` } },
          { key: `nan`, value: { n: Number.NaN } },
          { key: `date`, value: { n: new Date(1) } },
          { key: `null`, value: { n: null } },
          { key: `missing`, value: {} },
        ],
      })

      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(observation.directSqlKeys).toEqual([`bigint`, `boolean`, `number`])
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it.each([`eq`, `in`] as const)(
    `keeps Date epoch matches when a numeric $operator predicate falls back`,
    async (operator) => {
      const field = new IR.PropRef([`n`])
      const observation = await observeExpressionIndexScenario({
        label: `numeric-${operator}-date-epoch`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [
          field,
          new IR.Value(operator === `eq` ? 1 : [1]),
        ]),
        rows: [
          { key: `date`, value: { n: new Date(1) } },
          { key: `number`, value: { n: 1 } },
          { key: `other`, value: { n: 2 } },
        ],
      })

      expect(observation.adapterKeys).toEqual([`date`, `number`])
      expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
      expect(observation.directSqlKeys).toEqual([`date`, `number`, `other`])
    },
  )

  it(`keeps a BigInt match through a lower-wrapped membership fallback`, async () => {
    const lower = new IR.Func(`lower`, [new IR.PropRef([`n`])])
    const observation = await observeExpressionIndexScenario({
      label: `bigint-lower-membership`,
      indexExpression: lower,
      where: new IR.Func<boolean>(`in`, [lower, new IR.Value([1n])]),
      rows: [
        { key: `bigint`, value: { n: 1n } },
        { key: `number`, value: { n: 1 } },
        { key: `text`, value: { n: `1` } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`bigint`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
    expect(observation.directSqlKeys).toEqual([`bigint`, `number`, `text`])
  })

  it(`keeps a missing field equal to a lone-surrogate coalesce fallback`, async () => {
    const fallback = `\uD800`
    const coalesce = new IR.Func(`coalesce`, [
      new IR.PropRef([`name`]),
      new IR.Value(fallback),
    ])
    const observation = await observeExpressionIndexScenario({
      label: `lone-surrogate-coalesce`,
      indexExpression: coalesce,
      where: new IR.Func<boolean>(`eq`, [coalesce, new IR.Value(fallback)]),
      rows: [
        { key: `missing`, value: {} },
        { key: `other`, value: { name: `other` } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`missing`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
    expect(observation.directSqlKeys).toEqual([`missing`, `other`])
  })

  it(`keeps indexed BigInt membership sound across stored scalar types`, async () => {
    const field = new IR.PropRef([`n`])
    const observation = await observeExpressionIndexScenario({
      label: `mixed-scalar-bigint-in`,
      indexExpression: field,
      where: new IR.Func<boolean>(`in`, [field, new IR.Value([1n, 2n])]),
      rows: [
        { key: `bigint-one`, value: { n: 1n } },
        { key: `bigint-two`, value: { n: 2n } },
        { key: `boolean`, value: { n: true } },
        { key: `number`, value: { n: 1 } },
        { key: `text`, value: { n: `1` } },
        { key: `nan`, value: { n: Number.NaN } },
        { key: `date`, value: { n: new Date(1) } },
        { key: `null`, value: { n: null } },
        { key: `missing`, value: {} },
      ],
    })

    expect(observation.adapterKeys).toEqual([`bigint-one`, `bigint-two`])
    expect(observation.directSqlKeys).toEqual([
      `bigint-one`,
      `bigint-two`,
      `boolean`,
      `number`,
    ])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it(`uses an indexed safe conjunct while leaving an unsafe range to the row evaluator`, async () => {
    const status = new IR.PropRef([`status`])
    const observation = await observeExpressionIndexScenario({
      label: `indexed-safe-conjunct`,
      indexExpression: status,
      where: new IR.Func<boolean>(`and`, [
        new IR.Func<boolean>(`eq`, [status, new IR.Value(`active`)]),
        new IR.Func<boolean>(`gt`, [new IR.PropRef([`n`]), new IR.Value(0)]),
      ]),
      rows: [
        { key: `active-nan`, value: { status: `active`, n: Number.NaN } },
        { key: `active-negative`, value: { status: `active`, n: -1 } },
        { key: `active-zero`, value: { status: `active`, n: 0 } },
        { key: `inactive-positive`, value: { status: `inactive`, n: 2 } },
        { key: `inactive-zero`, value: { status: `inactive`, n: 0 } },
        { key: `inactive-nan`, value: { status: `inactive`, n: Number.NaN } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`active-nan`])
    expect(observation.directSqlKeys).toEqual([`active-nan`, `active-zero`])
    expect(observation.predicateQuery.sql).toContain(` WHERE `)
    expect(observation.predicateQuery.sql).toContain(`$.n`)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(false)
  })

  it.each([
    {
      operator: `gt`,
      target: 1,
      expectedKeys: [
        `array`,
        `bigint-positive`,
        `date`,
        `infinity`,
        `nan`,
        `numeric-text`,
        `positive`,
      ],
    },
    {
      operator: `lt`,
      target: 2,
      expectedKeys: [
        `bigint-negative`,
        `negative`,
        `negative-infinity`,
        `negative-subnormal`,
        `negative-text`,
        `one`,
        `zero`,
      ],
    },
  ] as const)(
    `uses an indexed superset for a mixed scalar $operator range`,
    async ({ operator, target, expectedKeys }) => {
      const field = new IR.PropRef([`n`])
      const rows = [
        { key: `negative`, value: { n: -2 } },
        { key: `negative-subnormal`, value: { n: -Number.MIN_VALUE } },
        { key: `zero`, value: { n: 0 } },
        { key: `one`, value: { n: 1 } },
        { key: `positive`, value: { n: 3 } },
        { key: `nan`, value: { n: Number.NaN } },
        { key: `infinity`, value: { n: Number.POSITIVE_INFINITY } },
        { key: `negative-infinity`, value: { n: Number.NEGATIVE_INFINITY } },
        { key: `numeric-text`, value: { n: `3` } },
        { key: `negative-text`, value: { n: `-2` } },
        { key: `word`, value: { n: `abc` } },
        { key: `bigint-negative`, value: { n: -2n } },
        { key: `bigint-positive`, value: { n: 3n } },
        { key: `date`, value: { n: new Date(3) } },
        { key: `null`, value: { n: null } },
        { key: `missing`, value: {} },
        { key: `array`, value: { n: [3] } },
        { key: `object`, value: { n: { x: 3 } } },
      ]
      const observation = await observeExpressionIndexScenario({
        label: `mixed-scalar-${operator}-range`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [field, new IR.Value(target)]),
        rows,
      })

      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(observation.directSqlKeys).toEqual(
        expect.arrayContaining([...expectedKeys]),
      )
      expect(observation.directSqlKeys.length).toBeLessThan(rows.length)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
      expect(planScansTable(observation.plan, observation.tableName)).toBe(
        false,
      )
    },
  )

  it.each([
    {
      operator: `gt`,
      expectedKeys: [`above`, `date`, `nan`, `numeric-text`],
      expectedCandidates: 7,
    },
    {
      operator: `gte`,
      expectedKeys: [`above`, `date`, `equal`, `nan`, `numeric-text`],
      expectedCandidates: 7,
    },
    {
      operator: `lt`,
      expectedKeys: [`below`, `negative`],
      expectedCandidates: 8,
    },
    {
      operator: `lte`,
      expectedKeys: [`below`, `equal`, `negative`],
      expectedCandidates: 8,
    },
  ] as const)(
    `keeps matches adjacent to an indexed integer $operator bound`,
    async ({ operator, expectedKeys, expectedCandidates }) => {
      const field = new IR.PropRef([`n`])
      const rows = [
        { key: `negative`, value: { n: -1 } },
        { key: `below`, value: { n: 1 - Number.EPSILON / 2 } },
        { key: `equal`, value: { n: 1 } },
        { key: `above`, value: { n: 1 + Number.EPSILON } },
        { key: `nan`, value: { n: Number.NaN } },
        { key: `numeric-text`, value: { n: `2` } },
        { key: `date`, value: { n: new Date(2) } },
        { key: `null`, value: { n: null } },
        { key: `missing`, value: {} },
      ]
      const observation = await observeExpressionIndexScenario({
        label: `adjacent-integer-${operator}`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [field, new IR.Value(1)]),
        rows,
      })

      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(observation.directSqlKeys).toEqual(
        expect.arrayContaining([...expectedKeys]),
      )
      expect(observation.directSqlKeys).toHaveLength(expectedCandidates)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it(`keeps Unicode lowercase matches in an indexed candidate set`, async () => {
    const field = new IR.PropRef([`name`])
    const lower = new IR.Func(`lower`, [field])
    const rows = [
      { key: `ascii-lower`, value: { name: `ak` } },
      { key: `ascii-upper`, value: { name: `AK` } },
      { key: `kelvin-inside`, value: { name: `aK` } },
      { key: `ascii-other`, value: { name: `ak-more` } },
      { key: `unicode-other`, value: { name: `aé` } },
      { key: `ascii-before`, value: { name: `abc` } },
    ]
    const observation = await observeExpressionIndexScenario({
      label: `unicode-lower-candidates`,
      indexExpression: lower,
      where: new IR.Func<boolean>(`eq`, [lower, new IR.Value(`ak`)]),
      rows,
    })

    expect(observation.adapterKeys).toEqual([
      `ascii-lower`,
      `ascii-upper`,
      `kelvin-inside`,
    ])
    expect(observation.directSqlKeys).toEqual(
      expect.arrayContaining(observation.adapterKeys),
    )
    expect(observation.directSqlKeys).not.toContain(`ascii-other`)
    expect(observation.directSqlKeys).toHaveLength(4)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(false)
  })

  it.each([
    {
      label: `large Number and BigInt bound`,
      value: { n: 1000000000000000100 },
      indexExpression: new IR.PropRef([`n`]),
      predicate: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`n`]),
        new IR.Value(1000000000000000120n),
      ]),
    },
    {
      label: `numeric object key`,
      value: { part: { '0': `match` } },
      indexExpression: new IR.PropRef([`part`, `0`]),
      predicate: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`part`, `0`]),
        new IR.Value(`match`),
      ]),
    },
    {
      label: `Unicode lowercase after NUL`,
      value: { name: `a\u0000K` },
      indexExpression: new IR.Func(`lower`, [new IR.PropRef([`name`])]),
      predicate: new IR.Func<boolean>(`eq`, [
        new IR.Func(`lower`, [new IR.PropRef([`name`])]),
        new IR.Value(`a\u0000k`),
      ]),
    },
  ])(`keeps $label through a unary SQL candidate`, async (testCase) => {
    for (const wrapper of [`and`, `or`] as const) {
      const observation = await observeExpressionIndexScenario({
        label: `candidate-${testCase.label}-${wrapper}`,
        indexExpression: testCase.indexExpression,
        where: new IR.Func<boolean>(wrapper, [testCase.predicate]),
        rows: [{ key: `match`, value: testCase.value }],
      })

      // The JavaScript predicate matches each row by the public contract.
      // Every matching key must survive SQLite before that evaluator runs.
      expect(observation.adapterKeys).toEqual([`match`])
      expect(observation.directSqlKeys).toContain(`match`)
    }
  })

  it(`keeps large Number matches across BigInt range directions and boolean wrappers`, async () => {
    const field = new IR.PropRef([`n`])
    const cases = [
      {
        name: `positive`,
        number: 1000000000000000100,
        bound: 1000000000000000120n,
      },
      {
        name: `negative`,
        number: -1000000000000000100,
        bound: -1000000000000000120n,
      },
    ] as const
    const operators = [`gt`, `gte`, `lt`, `lte`] as const
    const matches = (
      operator: (typeof operators)[number],
      left: number | bigint,
      right: number | bigint,
    ): boolean => {
      switch (operator) {
        case `gt`:
          return left > right
        case `gte`:
          return left >= right
        case `lt`:
          return left < right
        case `lte`:
          return left <= right
      }
    }

    for (const testCase of cases) {
      const rows = [
        { key: `rounded-number`, value: { n: testCase.number } },
        { key: `exact-bigint`, value: { n: testCase.bound } },
      ]
      for (const operator of operators) {
        for (const fieldOnLeft of [true, false]) {
          const literal = new IR.Value(testCase.bound)
          const predicate = new IR.Func<boolean>(
            operator,
            fieldOnLeft ? [field, literal] : [literal, field],
          )
          const expectedKeys = rows
            .filter(({ value }) =>
              fieldOnLeft
                ? matches(operator, value.n, testCase.bound)
                : matches(operator, testCase.bound, value.n),
            )
            .map(({ key }) => key)
            .sort()
          for (const wrapper of [`direct`, `and`, `or`] as const) {
            const observation = await observeExpressionIndexScenario({
              label: `rounded-${testCase.name}-${operator}-${fieldOnLeft}-${wrapper}`,
              indexExpression: field,
              where:
                wrapper === `direct`
                  ? predicate
                  : new IR.Func<boolean>(wrapper, [predicate]),
              rows,
            })
            expect(observation.adapterKeys).toEqual(expectedKeys)
            expect(observation.directSqlKeys).toEqual(
              expect.arrayContaining(expectedKeys),
            )
            const greaterSide = fieldOnLeft
              ? operator === `gt` || operator === `gte`
              : operator === `lt` || operator === `lte`
            if (greaterSide) {
              expect(
                planUsesNamedIndex(
                  observation.plan,
                  observation.tableName,
                  observation.indexName,
                ),
                `${testCase.name}-${operator}-${fieldOnLeft}-${wrapper}: ${observation.plan.map((row) => row.detail).join(`; `)}`,
              ).toBe(true)
            }
          }
        }
      }
    }
  })

  it(`keeps numeric-key object and array matches across candidate kinds`, async () => {
    const variants = [
      {
        name: `equality`,
        match: `match`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      },
      {
        name: `coalesce`,
        match: `match`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`eq`, [
            new IR.Func(`coalesce`, [ref, new IR.Value(`fallback`)]),
            new IR.Value(`match`),
          ]),
      },
      {
        name: `membership`,
        match: 1n,
        other: 2n,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`in`, [ref, new IR.Value([1n])]),
      },
      {
        name: `prefix`,
        match: `match`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`like`, [ref, new IR.Value(`mat%`)]),
      },
      {
        name: `lowercase`,
        match: `MATCH`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`eq`, [
            new IR.Func(`lower`, [ref]),
            new IR.Value(`match`),
          ]),
      },
    ]
    for (const segment of [`0`, `1`]) {
      const wrapArray = (value: unknown) => {
        const items: Array<unknown> = []
        items[Number(segment)] = value
        return { part: items }
      }
      for (const variant of variants) {
        const ref = new IR.PropRef([`part`, segment])
        const rows = [
          {
            key: `array-match`,
            value: wrapArray(variant.match),
          },
          {
            key: `object-match`,
            value: { part: { [segment]: variant.match } },
          },
          {
            key: `array-other`,
            value: wrapArray(variant.other),
          },
          {
            key: `object-other`,
            value: { part: { [segment]: variant.other } },
          },
        ]
        const predicate = variant.predicate(ref)
        for (const wrapper of [`direct`, `and`, `or`] as const) {
          const observation = await observeExpressionIndexScenario({
            label: `numeric-key-${segment}-${variant.name}-${wrapper}`,
            indexExpression: ref,
            where:
              wrapper === `direct`
                ? predicate
                : new IR.Func<boolean>(wrapper, [predicate]),
            rows,
          })
          const expectedKeys = [`array-match`, `object-match`]
          expect(observation.adapterKeys).toEqual(expectedKeys)
          expect(observation.directSqlKeys).toEqual(
            expect.arrayContaining(expectedKeys),
          )
          if (variant.name === `equality`) {
            expect(
              planUsesNamedIndex(
                observation.plan,
                observation.tableName,
                observation.indexName,
              ),
            ).toBe(true)
          }
        }
      }
    }
  })

  it(`indexes mixed array and object numeric paths`, async () => {
    const ref = new IR.PropRef([`part`, `0`, `0`])
    const observation = await observeExpressionIndexScenario({
      label: `mixed-numeric-carriers`,
      indexExpression: ref,
      where: new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      rows: [
        { key: `array-array`, value: { part: [[`match`]] } },
        { key: `array-object`, value: { part: [{ '0': `match` }] } },
        { key: `object-array`, value: { part: { '0': [`match`] } } },
        { key: `object-object`, value: { part: { '0': { '0': `match` } } } },
      ],
    })
    const expectedKeys = [
      `array-array`,
      `array-object`,
      `object-array`,
      `object-object`,
    ]
    expect(observation.adapterKeys).toEqual(expectedKeys)
    expect(observation.directSqlKeys).toEqual(expectedKeys)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it(`indexes every three-segment numeric carrier combination`, async () => {
    const ref = new IR.PropRef([`part`, `0`, `0`, `0`])
    const rows = Array.from({ length: 8 }, (_unused, mask) => {
      let nested: unknown = `match`
      for (let bit = 0; bit < 3; bit++) {
        nested = mask & (1 << bit) ? [nested] : { '0': nested }
      }
      return { key: `carrier-${mask}`, value: { part: nested } }
    })
    const observation = await observeExpressionIndexScenario({
      label: `three-numeric-carriers`,
      indexExpression: ref,
      where: new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      rows,
    })
    const expectedKeys = rows.map(({ key }) => key)
    expect(observation.adapterKeys).toEqual(expectedKeys)
    expect(observation.directSqlKeys).toEqual(expectedKeys)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it(`keeps deep numeric paths in the unbounded candidate set`, async () => {
    const ref = new IR.PropRef([`part`, `0`, `0`, `0`, `0`])
    const observation = await observeExpressionIndexScenario({
      label: `deep-numeric-carriers`,
      indexExpression: ref,
      where: new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      rows: [
        {
          key: `match`,
          value: { part: { '0': { '0': { '0': { '0': `match` } } } } },
        },
      ],
    })
    expect(observation.adapterKeys).toEqual([`match`])
    expect(observation.directSqlKeys).toEqual([`match`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
  })

  it(`keeps Unicode lowercase matches across NUL placement and equality direction`, async () => {
    const spellings = [
      { name: `NUL before fold`, source: `a\u0000K`, target: `a\u0000k` },
      { name: `NUL after fold`, source: `K\u0000a`, target: `k\u0000a` },
      { name: `NUL after prefix`, source: `aK\u0000b`, target: `ak\u0000b` },
      { name: `no NUL`, source: `aK`, target: `ak` },
    ]
    const field = new IR.PropRef([`name`])
    const lower = new IR.Func(`lower`, [field])
    for (const spelling of spellings) {
      expect(spelling.source.toLowerCase()).toBe(spelling.target)
      const rows = [
        { key: `ascii`, value: { name: spelling.target } },
        { key: `unicode`, value: { name: spelling.source } },
        { key: `other`, value: { name: `different` } },
      ]
      for (const lowerOnLeft of [true, false]) {
        const literal = new IR.Value(spelling.target)
        const predicate = new IR.Func<boolean>(
          `eq`,
          lowerOnLeft ? [lower, literal] : [literal, lower],
        )
        for (const wrapper of [`direct`, `and`, `or`] as const) {
          const observation = await observeExpressionIndexScenario({
            label: `nul-lower-${spelling.name}-${lowerOnLeft}-${wrapper}`,
            indexExpression: lower,
            where:
              wrapper === `direct`
                ? predicate
                : new IR.Func<boolean>(wrapper, [predicate]),
            rows,
          })
          const expectedKeys = [`ascii`, `unicode`]
          expect(observation.adapterKeys).toEqual(expectedKeys)
          expect(observation.directSqlKeys).toEqual(
            expect.arrayContaining(expectedKeys),
          )
        }
      }
    }
  })

  it.each([
    {
      label: `greater than zero`,
      operator: `gt`,
      target: 0,
      expectedKeys: [`infinity`, `nan`, `numeric-text`, `positive`],
    },
    {
      label: `less than two`,
      operator: `lt`,
      target: 2,
      expectedKeys: [`negative`, `negative-infinity`, `positive`],
    },
  ] as const)(
    `keeps indexed numeric comparison matches for $label`,
    async ({ label, operator, target, expectedKeys }) => {
      const field = new IR.PropRef([`n`])
      const observation = await observeExpressionIndexScenario({
        label: `numeric-domain-${label}`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [field, new IR.Value(target)]),
        rows: [
          { key: `negative`, value: { n: -1 } },
          { key: `positive`, value: { n: 1 } },
          { key: `nan`, value: { n: Number.NaN } },
          { key: `infinity`, value: { n: Number.POSITIVE_INFINITY } },
          { key: `negative-infinity`, value: { n: Number.NEGATIVE_INFINITY } },
          { key: `missing`, value: {} },
          { key: `null`, value: { n: null } },
          { key: `numeric-text`, value: { n: `2` } },
          { key: `text`, value: { n: `abc` } },
        ],
      })

      // Public rows are exact. SQL may admit extra candidates for the row
      // evaluator when SQLite and TanStack DB order stored values differently.
      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it.each([
    {
      label: `nested row value`,
      tx: {
        txId: `out-of-range-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `row`,
            value: { profile: { count: SQLITE_BIGINT_MAX + 1n } },
          },
        ],
      } satisfies PersistedTx,
    },
    {
      label: `row metadata`,
      tx: {
        txId: `out-of-range-row-metadata`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `row`,
            value: { count: SQLITE_BIGINT_MIN - 1n },
          },
        ],
      } satisfies PersistedTx,
    },
    {
      label: `collection metadata`,
      tx: {
        txId: `out-of-range-collection-metadata`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
        collectionMetadataMutations: [
          {
            type: `set`,
            key: `checkpoint`,
            value: { count: SQLITE_BIGINT_MAX + 1n },
          },
        ],
      } satisfies PersistedTx,
    },
  ])(`rejects an out-of-range BigInt in a persisted $label`, async ({ tx }) => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver })

    await withFailurePreservingCleanup(async () => {
      await expect(
        adapter.applyCommittedTx(`bigint-write-range`, tx),
      ).rejects.toThrow(
        /SQLite BigInt value .* outside the signed 64-bit range/,
      )

      if (adapter.scanRows) {
        expect(await adapter.scanRows(`bigint-write-range`)).toEqual([])
      }
    }, [() => driver.close()])
  })

  it(`reads a legacy persisted BigInt beyond the new write range`, async () => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver })
    const collectionId = `legacy-bigint-read`
    const tableName = createPersistedTableName(collectionId, `c`)
    const legacyValue = 10n ** 30n

    await withFailurePreservingCleanup(async () => {
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-legacy-bigint-read`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          { type: `insert`, key: `legacy`, value: { id: `legacy`, count: 1n } },
        ],
      })
      driver
        .getDatabase()
        .prepare(`UPDATE "${tableName}" SET value = ?`)
        .run(
          JSON.stringify({
            id: `legacy`,
            count: {
              [PERSISTED_TYPE_TAG]: `bigint`,
              [PERSISTED_VALUE_TAG]: legacyValue.toString(),
            },
          }),
        )

      if (!adapter.scanRows) {
        throw new Error(`real SQLite adapter did not expose scanRows`)
      }
      const scanned = await adapter.scanRows(collectionId)
      expect(scanned.map((row) => row.value)).toEqual([
        { id: `legacy`, count: legacyValue },
      ])

      const subset = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`id`]),
          new IR.Value(`legacy`),
        ]),
      })
      expect(subset.map((row) => row.value)).toEqual([
        { id: `legacy`, count: legacyValue },
      ])
    }, [() => driver.close()])
  })

  it.each([
    {
      label: `scalar comparison`,
      rejectedValue: SQLITE_BIGINT_MAX + 1n,
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MAX + 1n),
      ]),
    },
    {
      label: `ordinary IN`,
      rejectedValue: SQLITE_BIGINT_MIN - 1n,
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value([0n, SQLITE_BIGINT_MIN - 1n]),
      ]),
    },
    {
      label: `batched IN`,
      rejectedValue: SQLITE_BIGINT_MAX + 1n,
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value([
          ...Array.from({ length: 900 }, (_unused, index) => BigInt(index)),
          SQLITE_BIGINT_MAX + 1n,
        ]),
      ]),
    },
  ])(
    `rejects an out-of-range BigInt in a $label before SQLite comparison`,
    async ({ rejectedValue, where }) => {
      const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
      const adapter = createSQLiteCorePersistenceAdapter({ driver })
      const collectionId = `bigint-query-range`

      await withFailurePreservingCleanup(async () => {
        await adapter.applyCommittedTx(collectionId, {
          txId: `seed-bigint-query-range`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `zero`,
              value: { largeViewCount: 0n },
            },
          ],
        })

        await expect(
          adapter.loadSubset(collectionId, { where }),
        ).rejects.toThrow(bigintRangeError(rejectedValue))
      }, [() => driver.close()])
    },
  )

  it(`rejects a hostile serialized out-of-range BigInt index constant`, async () => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver })
    const value = SQLITE_BIGINT_MAX + 1n

    await withFailurePreservingCleanup(async () => {
      await expect(
        adapter.ensureIndex(`bigint-index-range`, `out-of-range`, {
          expressionSql: [
            serializeIndexExpression(
              new IR.Func(`add`, [
                new IR.PropRef([`largeViewCount`]),
                new IR.Value(value),
              ]),
            ),
          ],
        }),
      ).rejects.toThrow(bigintRangeError(value))
    }, [() => driver.close()])
  })

  const generatedBigIntRoundTripTest =
    requestedReplay === undefined ||
    requestedReplayProperty === `bigint-roundtrip`
      ? vitestIt
      : vitestIt.skip

  generatedBigIntRoundTripTest.each(generatedPropertyCampaigns)(
    `round-trips generated signed-64-bit BigInts through the real adapter in the $name campaign`,
    async (campaign) => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: SQLITE_BIGINT_MIN, max: SQLITE_BIGINT_MAX }),
          async (value) => {
            const driver = new BetterSqlite3SQLiteDriver({
              filename: `:memory:`,
            })
            const adapter = createSQLiteCorePersistenceAdapter({ driver })
            const collectionId = `generated-bigint-in-range`

            await withFailurePreservingCleanup(async () => {
              await adapter.applyCommittedTx(collectionId, {
                txId: `seed-${value}`,
                term: 1,
                seq: 1,
                rowVersion: 1,
                mutations: [
                  {
                    type: `insert`,
                    key: `match`,
                    value: { nested: { count: value } },
                  },
                ],
              })

              const rows = await adapter.loadSubset(collectionId, {
                where: new IR.Func(`eq`, [
                  new IR.PropRef([`nested`, `count`]),
                  new IR.Value(value),
                ]),
              })
              expect(rows.map((row) => row.key)).toEqual([`match`])
              expect(rows[0]?.value).toEqual({ nested: { count: value } })
            }, [() => driver.close()])
          },
        ),
        generatedCampaignParameters(campaign),
      )
    },
  )

  const generatedBigIntRejectionTest =
    requestedReplay === undefined ||
    requestedReplayProperty === `bigint-rejection`
      ? vitestIt
      : vitestIt.skip

  generatedBigIntRejectionTest.each(generatedPropertyCampaigns)(
    `rejects generated BigInts immediately outside the signed range in the $name campaign`,
    async (campaign) => {
      const outOfRangeBigIntArbitrary = fc.oneof(
        fc
          .bigInt({ min: 1n, max: 1_000n })
          .map((distance) => SQLITE_BIGINT_MIN - distance),
        fc
          .bigInt({ min: 1n, max: 1_000n })
          .map((distance) => SQLITE_BIGINT_MAX + distance),
      )

      await fc.assert(
        fc.asyncProperty(outOfRangeBigIntArbitrary, async (value) => {
          const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
          const adapter = createSQLiteCorePersistenceAdapter({ driver })

          await withFailurePreservingCleanup(async () => {
            await expect(
              adapter.applyCommittedTx(`generated-bigint-out-of-range`, {
                txId: `reject-${value}`,
                term: 1,
                seq: 1,
                rowVersion: 1,
                mutations: [
                  {
                    type: `insert`,
                    key: `rejected`,
                    value: { nested: { count: value } },
                  },
                ],
              }),
            ).rejects.toThrow(bigintRangeError(value))
          }, [() => driver.close()])
        }),
        generatedCampaignParameters(campaign),
      )
    },
  )

  it(`does not confuse an alias-qualified field ref with a nested JSON path`, async () => {
    const observation = await observeExpressionIndexScenario({
      label: `alias-qualified-field`,
      indexExpression: new IR.PropRef([`score`]),
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`todos`, `score`], `todos`),
        new IR.Value(1),
      ]),
      rows: [
        { key: `matching`, value: { score: 2 } },
        { key: `different`, value: { score: 0 } },
      ],
    })
    const diagnostic = JSON.stringify(
      {
        sql: observation.predicateQuery.sql,
        params: observation.predicateQuery.params,
        plan: observation.plan.map((row) => row.detail),
        adapterKeys: observation.adapterKeys,
        directSqlKeys: observation.directSqlKeys,
      },
      null,
      2,
    )

    expect(observation.adapterKeys, diagnostic).toEqual([`matching`])
    expect(observation.directSqlKeys, diagnostic).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
      diagnostic,
    ).toBe(true)
  })

  it(`does not guess that a legacy nested path is an alias`, async () => {
    const baseDriver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver: baseDriver })
    const collectionId = `legacy-nested-path`

    await withFailurePreservingCleanup(async () => {
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-legacy-nested-path`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `nested-match`,
            value: {
              profile: { [`meta-field`]: `alpha` },
              [`meta-field`]: `flat-other`,
            },
          },
          {
            type: `insert`,
            key: `flat-only`,
            value: { [`meta-field`]: `alpha` },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`profile`, `meta-field`]),
          new IR.Value(`alpha`),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`nested-match`])
    }, [() => baseDriver.close()])
  })

  it(`exposes an overbroad indexed predicate hidden by in-memory re-filtering`, async () => {
    const observation = await observeExpressionIndexScenario({
      label: `overbroad-indexed-predicate`,
      indexExpression: new IR.PropRef([`score`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`score`]),
        new IR.Value(`2`),
      ]),
      rows: [
        { key: `lower`, value: { score: `1` } },
        { key: `matching`, value: { score: `2` } },
        { key: `higher`, value: { score: `3` } },
      ],
      transformQuery: makeOverbroadEqualityMutation,
    })

    expect(observation.adapterKeys).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(false)
    expect(observation.directSqlKeys).toEqual([`higher`, `matching`])
  })

  it(`kills the former path-binding compiler behavior at the driver boundary`, async () => {
    const observation = await observeExpressionIndexScenario({
      label: `legacy-path-binding`,
      indexExpression: new IR.PropRef([`score`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`score`]),
        new IR.Value(`2`),
      ]),
      rows: [
        { key: `matching`, value: { score: `2` } },
        { key: `different`, value: { score: `3` } },
      ],
      transformQuery: makeLegacyPathBindingMutation,
    })

    expect(observation.adapterKeys).toEqual([`matching`])
    expect(observation.directSqlKeys).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(false)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(true)
  })

  it(`recognizes equivalent SQLite plan identifier formats without prefix collisions`, () => {
    const tableName = `rows`
    const indexName = `literal_ddl`

    for (const detail of [
      `SEARCH rows USING INDEX literal_ddl (<expr>=?)`,
      `SEARCH TABLE rows USING INDEX literal_ddl (<expr>=?)`,
      `SEARCH "rows" USING INDEX "literal_ddl" (<expr>=?)`,
      `SEARCH TABLE "rows" USING INDEX "literal_ddl" (<expr>=?)`,
    ]) {
      expect(planUsesNamedIndex([{ detail }], tableName, indexName)).toBe(true)
    }

    for (const detail of [`SCAN rows`, `SCAN TABLE rows`, `SCAN "rows"`]) {
      expect(planScansTable([{ detail }], tableName)).toBe(true)
    }

    expect(
      planUsesNamedIndex(
        [
          {
            detail: `SEARCH rows_archive USING INDEX literal_ddl_backup (<expr>=?)`,
          },
        ],
        tableName,
        indexName,
      ),
    ).toBe(false)
    expect(planScansTable([{ detail: `SCAN rows_archive` }], tableName)).toBe(
      false,
    )
  })

  it(`distinguishes rejected DDL path binding from correct predicate rows without index use`, async () => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const database = driver.getDatabase()
    const jsonPath = `$.payload.threadId`
    const target = `thread-'1`

    await withFailurePreservingCleanup(() => {
      database.exec(
        `CREATE TABLE rows (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      )
      const insert = database.prepare(
        `INSERT INTO rows (key, value) VALUES (?, ?)`,
      )
      insert.run(`matching`, JSON.stringify({ payload: { threadId: target } }))
      insert.run(
        `different`,
        JSON.stringify({ payload: { threadId: `thread-2` } }),
      )

      // SQLite rejects a DDL-path binding before an index can exist. This is
      // a setup-rejection control only, not the production oracle's RED.
      expect(() =>
        database
          .prepare(`CREATE INDEX bound_ddl ON rows (json_extract(value, ?))`)
          .run(jsonPath),
      ).toThrow(/parameters prohibited in index expressions/i)

      database.exec(
        `CREATE INDEX literal_ddl ON rows (json_extract(value, ${sqliteLiteral(jsonPath)}))`,
      )
      const literalPredicate = `SELECT key FROM rows WHERE json_extract(value, ${sqliteLiteral(jsonPath)}) = ?`
      const boundPredicate = `SELECT key FROM rows WHERE json_extract(value, ?) = ?`
      const literalRows = database.prepare(literalPredicate).all(target)
      const boundRows = database.prepare(boundPredicate).all(jsonPath, target)
      const literalPlan = database
        .prepare(`EXPLAIN QUERY PLAN ${literalPredicate}`)
        .all(target) as Array<QueryPlanRow>
      const boundPlan = database
        .prepare(`EXPLAIN QUERY PLAN ${boundPredicate}`)
        .all(jsonPath, target) as Array<QueryPlanRow>

      // Same correct rows, different plan: a row-only assertion is
      // false-green. This predicate-plan mismatch kills the hostile mutant.
      expect(boundRows).toEqual(literalRows)
      expect(planUsesNamedIndex(literalPlan, `rows`, `literal_ddl`)).toBe(true)
      expect(planScansTable(literalPlan, `rows`)).toBe(false)
      expect(planUsesNamedIndex(boundPlan, `rows`, `literal_ddl`)).toBe(false)
      expect(planScansTable(boundPlan, `rows`)).toBe(true)
    }, [() => driver.close()])
  })

  it(`uses the expression index for the fixed filter witness`, async () => {
    await assertExpressionIndexHistory(
      {
        path: [`threadId`],
        target: `thread-'1`,
        distractors: [`thread-2`, `thread-3`],
      },
      `fixed-thread-filter`,
    )
  })

  const generatedExpressionIndexTest =
    requestedReplay === undefined ||
    requestedReplayProperty === `expression-index`
      ? vitestIt
      : vitestIt.skip

  generatedExpressionIndexTest.each(generatedPropertyCampaigns)(
    `reaches every declared generated expression-index scenario in the $name campaign`,
    async (campaign) => {
      const details = await runGeneratedScenarioProperty(campaign)
      const parameters = generatedCampaignParameters(campaign)

      expect(details.numRuns).toBe(campaign.numRuns)
      expect(`seed` in parameters).toBe(campaign.seed !== undefined)
      expect(`path` in parameters).toBe(campaign.path !== undefined)
      if (campaign.seed !== undefined) {
        expect(details.seed).toBe(campaign.seed)
      }
      if (campaign.path !== undefined) {
        expect(details.runConfiguration.path).toBe(campaign.path)
      }
      expect(details.seed).toEqual(expect.any(Number))
    },
  )

  const generatedControlTest =
    requestedReplay === undefined ? vitestIt : vitestIt.skip

  generatedControlTest.each(GENERATED_SCENARIO_KINDS)(
    `rejects the generated grammar when the %s axis is ablated`,
    async (kind) => {
      const details = await fc.check(
        generatedScenarioProperty({ ablateKind: kind }),
        {
          seed: DEFAULT_ORACLE_SEED,
          numRuns: 1,
          verbose: 2,
        },
      )
      const evidence = JSON.stringify({
        seed: details.seed,
        path: details.counterexamplePath,
        error: details.error,
      })

      expect(details.failed, evidence).toBe(true)
      expect(details.seed, evidence).toBe(DEFAULT_ORACLE_SEED)
      expect(details.counterexamplePath, evidence).not.toBeNull()
      expect(details.error, evidence).toContain(`missing=${kind}`)
    },
  )

  generatedControlTest(
    `reconstructs the retained generated grammar and rejects a nearby duplicate axis`,
    () => {
      const [matrix] = fc.sample(generatedScenarioMatrixArbitrary, {
        seed: DEFAULT_ORACLE_SEED,
        numRuns: 1,
      })
      if (!matrix) throw new Error(`fixed grammar witness was not generated`)
      assertGeneratedScenarioGrammar(matrix)
      expect(GENERATED_SCENARIO_FAULTS.map(({ kind }) => kind)).toEqual(
        GENERATED_SCENARIO_KINDS,
      )
      const equalityScenario = matrix[0]
      if (!equalityScenario) {
        throw new Error(`fixed grammar witness omitted equality`)
      }
      expect(() =>
        assertGeneratedScenarioGrammar([...matrix, equalityScenario]),
      ).toThrow(`duplicate=eq`)
    },
  )

  generatedControlTest.each(GENERATED_SCENARIO_FAULTS)(
    `rejects the plausible $wrongAnswer for the $kind axis`,
    async ({ kind }) => {
      const details = await fc.check(
        generatedScenarioProperty({ faultKind: kind }),
        {
          seed: DEFAULT_ORACLE_SEED,
          numRuns: 1,
          verbose: 2,
        },
      )
      const evidence = JSON.stringify({
        seed: details.seed,
        path: details.counterexamplePath,
        error: details.error,
      })

      expect(details.failed, evidence).toBe(true)
      expect(details.seed, evidence).toBe(DEFAULT_ORACLE_SEED)
      expect(details.counterexamplePath, evidence).not.toBeNull()
      expect(details.error ?? ``, evidence).not.toContain(`did not reach`)
      expect(details.error, evidence).toContain(`"kind": "${kind}"`)

      const replayPath = details.counterexamplePath
      if (replayPath === null) {
        throw new Error(`${kind} wrong-answer control did not shrink to a path`)
      }
      const replay = await fc.check(
        generatedScenarioProperty({ faultKind: kind }),
        {
          seed: details.seed,
          path: replayPath,
          numRuns: 1,
          verbose: 2,
        },
      )
      const replayEvidence = JSON.stringify({
        seed: replay.seed,
        requestedPath: replayPath,
        replayPath: replay.counterexamplePath,
        error: replay.error,
      })
      expect(replay.failed, replayEvidence).toBe(true)
      expect(replay.error ?? ``, replayEvidence).not.toContain(`did not reach`)
      expect(replay.error, replayEvidence).toContain(`"kind": "${kind}"`)
    },
  )
})

// Native values add a bounded rank/text dimension to this SQL/plan owner.
// The common model is independent; this driver observes real SQL before cleanup.
describe(`Temporal expression-index refinement`, () => {
  const it = requestedReplay === undefined ? vitestIt : vitestIt.skip
  it.each(temporalFamilies)(
    `uses native keys and identity for $kind / $name`,
    async (family) => {
      vi.stubGlobal(`Temporal`, Temporal)
      try {
        for (const query of temporalQueryCases(family)) {
          const result = await observeExpressionIndexScenario({
            label: `${family.name}-${query.name}`,
            indexExpression: new IR.PropRef([`stamp`]),
            where: query.where,
            rows: family.texts.map((_, i) => ({
              key: `row-${i}`,
              value: {
                stamp: temporalValue(family, i),
                target: temporalValue(family, 1),
              },
            })),
          })
          expect(result.adapterKeys, query.name).toEqual(query.expectedKeys)
          expect(result.directSqlKeys, query.name).toEqual(query.expectedKeys)
          if (query.name === `in` || query.name === `batched-in`)
            expect(result.predicateQuery.params).toHaveLength(1)
          if (
            [
              `eq`,
              `in`,
              `batched-in`,
              `gt`,
              `gte`,
              `lt`,
              `lte`,
              `and`,
            ].includes(query.name)
          ) {
            expect(
              planUsesNamedIndex(
                result.plan,
                result.tableName,
                result.indexName,
              ),
              query.name,
            ).toBe(true)
            expect(
              planScansTable(result.plan, result.tableName),
              query.name,
            ).toBe(false)
          }
        }
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it.each(temporalFamilies)(
    `preserves wrapper-created native coalesce literals / $name`,
    async (family) => {
      vi.stubGlobal(`Temporal`, Temporal)
      try {
        const expression = new IR.Func(`coalesce`, [
          new IR.PropRef([`stamp`]),
          new IR.Value(temporalValue(family, 1)),
        ])
        const result = await observeExpressionIndexScenario({
          label: `wrapper-${family.name}`,
          viaWrapper: true,
          indexExpression: expression,
          where: new IR.Func<boolean>(`eq`, [
            expression,
            new IR.Value(temporalValue(family, 1)),
          ]),
          rows: family.texts.map((_, i) => ({
            key: `row-${i}`,
            value: {
              id: `row-${i}`,
              stamp: i === 1 ? null : temporalValue(family, i),
            },
          })),
        })
        expect(result.adapterKeys).toEqual([`row-1`])
        expect(result.directSqlKeys).toEqual([`row-1`])
        expect(
          planUsesNamedIndex(result.plan, result.tableName, result.indexName),
          JSON.stringify(result),
        ).toBe(true)
        expect(planScansTable(result.plan, result.tableName)).toBe(false)
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )
  // Independent fixture rank/text rules also judge mixed-domain candidates.
  // SQL may retain extras, but NOT must never invert an approximate prefilter.
  it.each(temporalFamilies)(
    `retains mixed-domain matches under native predicate polarity / $name`,
    async (family) => {
      vi.stubGlobal(`Temporal`, Temporal)
      try {
        const ref = new IR.PropRef([`stamp`])
        const literal = new IR.Value(temporalValue(family, 1))
        const nativeRows = family.texts.map((_, i) => ({
          key: `row-${i}`,
          value: { stamp: temporalValue(family, i) },
        }))
        const nullableRows = [
          ...nativeRows,
          { key: `nan`, value: { stamp: NaN } },
          { key: `null`, value: { stamp: null } },
          { key: `missing`, value: {} },
        ]
        for (const operator of [`gt`, `gte`, `lt`, `lte`] as const) {
          for (const reverse of [false, true]) {
            for (const negate of [false, true]) {
              const comparison = new IR.Func<boolean>(
                operator,
                reverse ? [literal, ref] : [ref, literal],
              )
              const where = negate
                ? new IR.Func<boolean>(`not`, [comparison])
                : comparison
              const expectedKeys = nullableRows
                .flatMap((row) => {
                  if (row.key === `null` || row.key === `missing`) return []
                  const rank =
                    row.key === `nan`
                      ? Infinity
                      : family.ranks[Number(row.key.slice(4))]!
                  const a = reverse ? family.ranks[1] : rank
                  const b = reverse ? rank : family.ranks[1]
                  const match =
                    operator === `gt`
                      ? a > b
                      : operator === `gte`
                        ? a >= b
                        : operator === `lt`
                          ? a < b
                          : a <= b
                  return match !== negate ? [row.key] : []
                })
                .sort()
              const result = await observeExpressionIndexScenario({
                label: `native-polarity`,
                indexExpression: ref,
                where,
                rows: nullableRows,
              })
              expect(
                result.adapterKeys,
                `${operator}/${reverse}/${negate}`,
              ).toEqual(expectedKeys)
              expect(result.directSqlKeys).toEqual(
                expect.arrayContaining(expectedKeys),
              )
            }
          }
        }
        const otherKind =
          family.kind === `Instant`
            ? Temporal.PlainDate.from(`2026-01-02`)
            : Temporal.Instant.from(`2026-01-02T00:00:00Z`)
        const rows = [
          ...nullableRows,
          ...[
            otherKind,
            0,
            false,
            new Date(0),
            `10000000000000000000001`,
            `${family.kind === `Instant` ? `Temporal.Instant` : `Temporal.PlainDate`}:${family.texts[1]}`,
            `\u0000tanstack-db:temporal:Temporal.${family.kind}:${family.texts[1]}`,
          ].map((stamp, i) => ({ key: `other-${i}`, value: { stamp } })),
        ]
        for (const operator of [`eq`, `in`] as const) {
          const comparison = new IR.Func<boolean>(operator, [
            ref,
            operator === `eq`
              ? literal
              : new IR.Value([temporalValue(family, 1)]),
          ])
          for (const negate of [false, true]) {
            const where = negate
              ? new IR.Func<boolean>(`not`, [comparison])
              : comparison
            const expectedKeys = rows
              .filter(
                (row) =>
                  ![`null`, `missing`].includes(row.key) &&
                  (row.key === `row-1`) !== negate,
              )
              .map((row) => row.key)
              .sort()
            const result = await observeExpressionIndexScenario({
              label: `native-equality-polarity`,
              indexExpression: ref,
              where,
              rows,
            })
            expect(result.adapterKeys).toEqual(expectedKeys)
            expect(result.directSqlKeys).toEqual(
              expect.arrayContaining(expectedKeys),
            )
          }
        }
        // A string can equal a native SQL order key without equaling the native
        // value. The scalar candidate uses one binding and residual cleanup owns
        // that distinction; persisted Boolean expressions still retain identity.
        const orderKey = `10000000000000000000001`
        const stringEquality = new IR.Func<boolean>(`eq`, [
          ref,
          new IR.Value(orderKey),
        ])
        const scalar = await observeExpressionIndexScenario({
          label: `string-native-order-key`,
          indexExpression: stringEquality,
          where: stringEquality,
          rows,
          observeIndexValues: true,
        })
        expect(scalar.adapterKeys).toEqual([`other-4`])
        expect(scalar.directSqlKeys).toEqual(
          expect.arrayContaining([`other-4`]),
        )
        expect(scalar.predicateQuery.params).toEqual([orderKey])
        expect(
          scalar.indexValues
            ?.filter((row) => row.value === 1)
            .map((row) => row.key),
        ).toEqual([`other-4`])

        const selected = new IR.Func(`coalesce`, [ref, literal])
        const equality = new IR.Func<boolean>(`eq`, [selected, literal])
        const fallback = await observeExpressionIndexScenario({
          label: `native-coalesce-negation`,
          indexExpression: selected,
          where: new IR.Func<boolean>(`not`, [equality]),
          rows: nullableRows,
        })
        expect(fallback.adapterKeys).toEqual([`nan`, `row-0`, `row-2`])
        expect(fallback.predicateQuery.sql).not.toContain(` WHERE `)
        const paired = await observeExpressionIndexScenario({
          label: `native-field-pairs`,
          indexExpression: ref,
          where: new IR.Func<boolean>(`eq`, [ref, new IR.PropRef([`target`])]),
          rows: [
            {
              key: `native`,
              value: {
                stamp: temporalValue(family, 1),
                target: temporalValue(family, 1),
              },
            },
            {
              key: `different`,
              value: {
                stamp: temporalValue(family, 0),
                target: temporalValue(family, 1),
              },
            },
            { key: `date-number`, value: { stamp: new Date(0), target: 0 } },
          ],
        })
        expect(paired.adapterKeys).toEqual([`date-number`, `native`])
        expect(paired.directSqlKeys).toEqual(
          expect.arrayContaining(paired.adapterKeys),
        )
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it.each(temporalFamilies)(
    `retains native identity through numeric array and object paths / $name`,
    async (family) => {
      vi.stubGlobal(`Temporal`, Temporal)
      try {
        const ref = new IR.PropRef([`dates`, `0`])
        for (const carrier of [`array`, `object`] as const) {
          const rows = family.texts.map((_, i) => ({
            key: `row-${i}`,
            value: {
              dates:
                carrier === `array`
                  ? [temporalValue(family, i)]
                  : { 0: temporalValue(family, i) },
            },
          }))
          for (const operator of [`eq`, `in`] as const) {
            const expression = new IR.Func<boolean>(operator, [
              ref,
              new IR.Value(
                operator === `eq`
                  ? temporalValue(family, 1)
                  : [temporalValue(family, 1)],
              ),
            ])
            const result = await observeExpressionIndexScenario({
              label: `${family.name}-${carrier}-${operator}`,
              indexExpression: expression,
              where: expression,
              rows,
              observeIndexValues: true,
            })
            expect(result.adapterKeys).toEqual([`row-1`])
            expect(result.directSqlKeys).toEqual([`row-1`])
            expect(result.indexValues).toEqual(
              family.texts.map((_, i) => ({
                key: `row-${i}`,
                value: i === 1 ? 1 : 0,
              })),
            )
          }
        }
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it(`preserves the primary failure and still closes SQLite`, async () => {
    const { CollectionImpl } = await import('../../db/src/collection/index')
    const primary = new Error(`primary metadata failure`)
    const cleanup = new Error(`secondary cleanup failure`)
    const cleanupOriginal = CollectionImpl.prototype.cleanup
    const execOriginal = BetterSqlite3SQLiteDriver.prototype.exec
    let driver: BetterSqlite3SQLiteDriver | undefined
    const execSpy = vi
      .spyOn(BetterSqlite3SQLiteDriver.prototype, `exec`)
      .mockImplementation(function (this: BetterSqlite3SQLiteDriver, sql) {
        driver = this
        return execOriginal.call(this, sql)
      })
    const closeSpy = vi.spyOn(BetterSqlite3SQLiteDriver.prototype, `close`)
    const cleanupSpy = vi
      .spyOn(CollectionImpl.prototype, `cleanup`)
      .mockImplementation(async function (
        this: InstanceType<typeof CollectionImpl>,
      ) {
        await cleanupOriginal.call(this)
        throw cleanup
      })
    const metadataSpy = vi
      .spyOn(CollectionImpl.prototype, `getIndexMetadata`)
      .mockImplementation(() => {
        throw primary
      })
    vi.stubGlobal(`Temporal`, Temporal)
    try {
      const result = await observeExpressionIndexScenario({
        label: `prep-cleanup`,
        viaWrapper: true,
        indexExpression: new IR.Func(`coalesce`, [
          new IR.PropRef([`stamp`]),
          new IR.Value(Temporal.Instant.from(`2026-01-01T00:00:00Z`)),
        ]),
        rows: [],
      }).then(
        () => undefined,
        (error) => error,
      )
      expect.soft(result).toBeInstanceOf(AggregateError)
      expect.soft(result?.errors).toEqual([primary, cleanup])
      expect.soft(closeSpy).toHaveBeenCalledTimes(1)
    } finally {
      metadataSpy.mockRestore()
      cleanupSpy.mockRestore()
      closeSpy.mockRestore()
      execSpy.mockRestore()
      driver?.close()
      vi.unstubAllGlobals()
    }
  })
})
