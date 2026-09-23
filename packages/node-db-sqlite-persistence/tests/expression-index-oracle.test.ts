/**
 * # When does SQLite use a persisted expression index?
 *
 * Contract and source: RFC #1659 invariant 8 requires persisted index DDL and
 * the indexed runtime predicate to have the same SQLite expression shape.
 * SQLite requires syntactically matching expressions before an expression
 * index can satisfy a predicate.
 *
 * History grammar and domain: every generated matrix reaches equality,
 * ordinary and 901-value batched IN, range, conjunction, ordering, and
 * lower(ref) indexes. Paths have a one-to-six-character identifier root and up
 * to three identifier/0..3 tail segments. Numeric targets are
 * -10_000..10_000. String and boolean equality values keep independent
 * distractors. Fixed cases cover constant-bearing coalesce/strftime/add,
 * persisted Date ranges, and BigInt ranges/IN within SQLite's signed-integer
 * domain. Explicitly qualified refs lower to the same JSON field expression
 * without reinterpreting legacy nested paths. Known omissions: null, arbitrary
 * raw SQL, native-host planning, and BigInts outside SQLite's signed range.
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
 * Reach, challenge, replay, and cleanup: the property records and asserts every
 * declared regime. An overbroad indexed-predicate mutant proves adapter
 * re-filtering cannot hide wrong SQL. A production-driver-boundary mutant
 * restores the old four path bindings and must lose the named-index search.
 * Replay with TANSTACK_DB_WS5A_SEED and TANSTACK_DB_WS5A_PATH. In-memory SQLite
 * teardown retains the semantic failure if cleanup also fails.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import {
  createPersistedTableName,
  createSQLiteCorePersistenceAdapter,
  decodePersistedStorageKey,
} from '@tanstack/db-sqlite-persistence-core'
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

const independentValuesArbitrary = fc.oneof(
  fc.integer({ min: -10_000, max: 10_000 }).map((target) => ({
    target,
    distractors: [target - 1, target + 1] as [number, number],
  })),
  fc.integer({ min: 0, max: 10_000 }).map((suffix) => ({
    target: `target-'${suffix}`,
    distractors: [`before-${suffix}`, `after-${suffix}`] as [string, string],
  })),
  fc.boolean().map((target) => ({
    target,
    distractors: [!target, !target] as [boolean, boolean],
  })),
)

// Path structure and scalar values come from separate arbitraries so neither
// can derive or restrict the other.
const expressionIndexCaseArbitrary = fc
  .tuple(legalPathArbitrary, independentValuesArbitrary)
  .map(([path, values]): OracleCase => ({ path, ...values }))

function oracleRunConfiguration(): {
  seed: number
  path?: string
  numRuns: number
} {
  const seedText = process.env.TANSTACK_DB_WS5A_SEED
  const path = process.env.TANSTACK_DB_WS5A_PATH
  if (seedText !== undefined && !/^-?\d+$/.test(seedText)) {
    throw new Error(`TANSTACK_DB_WS5A_SEED must be an integer`)
  }
  const seed = seedText === undefined ? DEFAULT_ORACLE_SEED : Number(seedText)

  if (!Number.isSafeInteger(seed)) {
    throw new Error(`TANSTACK_DB_WS5A_SEED must be an integer`)
  }
  if (path !== undefined && !/^\d+(?::\d+)*$/.test(path)) {
    throw new Error(
      `TANSTACK_DB_WS5A_PATH must contain colon-separated nonnegative integers`,
    )
  }

  return {
    seed,
    ...(path === undefined ? {} : { path }),
    numRuns: path === undefined ? DEFAULT_ORACLE_RUNS : 1,
  }
}

function createNestedRow(
  path: ReadonlyArray<string>,
  value: OracleScalar,
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
  return JSON.stringify(expression, (_key, value: unknown) =>
    typeof value === `bigint`
      ? {
          [PERSISTED_TYPE_TAG]: `bigint`,
          [PERSISTED_VALUE_TAG]: value.toString(),
        }
      : value,
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

async function withFailurePreservingCleanup(
  body: () => void | Promise<void>,
  cleanups: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  let primary: { error: unknown } | undefined
  try {
    await body()
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

type GeneratedExpressionIndexScenario = ExpressionIndexScenario & {
  kind: GeneratedScenarioKind
  expectedKeys: Array<string>
  expectedPlan: `search` | `ordered-scan`
}

type ExpressionIndexObservation = {
  adapterKeys: Array<string>
  directSqlKeys: Array<string>
  indexName: string
  plan: Array<QueryPlanRow>
  predicateQuery: CapturedQuery
  tableName: string
}

async function observeExpressionIndexScenario({
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
  const signature = `generated-expression`
  const tableName = createPersistedTableName(collectionId, `c`)
  let predicateQuery: CapturedQuery | undefined

  const observingDriver = createQueryObservingDriver(
    baseDriver,
    (query) => {
      if (
        query.sql.includes(`SELECT key, value, metadata, row_version`) &&
        query.sql.includes(`FROM "${tableName}"`) &&
        (query.sql.includes(` WHERE `) || query.sql.includes(` ORDER BY `))
      ) {
        predicateQuery = query
      }
    },
    transformQuery
      ? (query) =>
          query.sql.includes(`SELECT key, value, metadata, row_version`) &&
          query.sql.includes(`FROM "${tableName}"`) &&
          (query.sql.includes(` WHERE `) || query.sql.includes(` ORDER BY `))
            ? transformQuery(query)
            : query
      : undefined,
  )
  const adapter = createSQLiteCorePersistenceAdapter({
    driver: observingDriver,
  })

  try {
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
    await adapter.ensureIndex(collectionId, signature, {
      expressionSql: [serializeIndexExpression(indexExpression)],
    })

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
        `SELECT index_name FROM persisted_index_registry
           WHERE collection_id = ? AND signature = ?`,
      )
      .get(collectionId, signature) as { index_name: string } | undefined
    if (!registryRow) {
      throw new Error(`expression index registry checkpoint was not reached`)
    }

    const plan = baseDriver
      .getDatabase()
      .prepare(`EXPLAIN QUERY PLAN ${predicateQuery.sql}`)
      .all(...predicateQuery.params) as Array<QueryPlanRow>

    const normalizeKeys = (keys: Array<string>): Array<string> =>
      preserveResultOrder ? keys : keys.sort()

    return {
      adapterKeys: normalizeKeys(adapterRows.map((row) => String(row.key))),
      directSqlKeys: normalizeKeys(
        directSqlRows.map((row) => String(decodePersistedStorageKey(row.key))),
      ),
      indexName: registryRow.index_name,
      plan,
      predicateQuery,
      tableName,
    }
  } finally {
    baseDriver.close()
  }
}

function makeOverbroadEqualityMutation(query: CapturedQuery): CapturedQuery {
  if (!query.sql.includes(` WHERE `)) return query
  const sql = query.sql.replace(/ = \?\)$/, ` >= ?)`)
  if (sql === query.sql) {
    throw new Error(`overbroad equality mutation did not reach the predicate`)
  }
  return { sql, params: query.params }
}

function makeLegacyPathBindingMutation(query: CapturedQuery): CapturedQuery {
  if (!query.sql.includes(` WHERE `)) return query

  const pathParams: Array<string> = []
  const sql = query.sql.replace(
    /json_extract\(value, ('(?:''|[^'])+')\)/g,
    (_match, literal: string) => {
      pathParams.push(literal.slice(1, -1).replace(/''/g, `'`))
      return `json_extract(value, ?)`
    },
  )
  if (pathParams.length !== 4) {
    throw new Error(
      `legacy path-binding mutation expected four ref paths, got ${pathParams.length}`,
    )
  }
  return { sql, params: [...pathParams, ...query.params] }
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
    expressionIndexCaseArbitrary,
    numericIndexCaseArbitrary,
    numericIndexCaseArbitrary,
    numericIndexCaseArbitrary,
    numericIndexCaseArbitrary,
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
          value: createNestedRow(eqCase.path, eqCase.distractors[0]),
        },
        {
          key: `eq-match-b`,
          value: createNestedRow(eqCase.path, eqCase.target),
        },
      ]
      const batchedValues = Array.from(
        { length: 901 },
        (_unused, index) => batchedCase.target + index,
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
            new IR.Value([inCase.target - 1, inCase.target]),
          ]),
          rows: [
            {
              key: `in-lower`,
              value: createNestedRow(inCase.path, inCase.target - 1),
            },
            {
              key: `in-match`,
              value: createNestedRow(inCase.path, inCase.target),
            },
            {
              key: `in-higher`,
              value: createNestedRow(inCase.path, inCase.target + 1),
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
              value: createNestedRow(batchedCase.path, batchedCase.target),
            },
            {
              key: `batch-last`,
              value: createNestedRow(
                batchedCase.path,
                batchedCase.target + 900,
              ),
            },
            {
              key: `batch-outside`,
              value: createNestedRow(batchedCase.path, batchedCase.target - 1),
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
                ...createNestedRow(andCase.path, andCase.target + 1),
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
  it(`rejects an explicitly empty replay seed`, () => {
    const previousSeed = process.env.TANSTACK_DB_WS5A_SEED
    try {
      process.env.TANSTACK_DB_WS5A_SEED = ``
      expect(() => oracleRunConfiguration()).toThrow(
        `TANSTACK_DB_WS5A_SEED must be an integer`,
      )
    } finally {
      if (previousSeed === undefined) {
        delete process.env.TANSTACK_DB_WS5A_SEED
      } else {
        process.env.TANSTACK_DB_WS5A_SEED = previousSeed
      }
    }
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
        { key: `past`, value: { createdAt: `2025-04-05T00:00:00.000Z` } },
      ],
      expectedKeys: [`current`],
    },
    {
      label: `add-constant`,
      indexExpression: new IR.Func(`add`, [
        new IR.PropRef([`score`]),
        new IR.Value(1),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`add`, [new IR.PropRef([`score`]), new IR.Value(1)]),
        new IR.Value(3),
      ]),
      rows: [
        { key: `matching`, value: { score: 2 } },
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
    `uses a constant-bearing $label expression index`,
    async ({ expectedKeys, ...scenario }) => {
      const observation = await observeExpressionIndexScenario(scenario)

      expect(observation.adapterKeys).toEqual(expectedKeys)
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
      ],
      expectedKeys: [`later`],
      expectedQueryParams: [`2026-01-02T12:00:00.000Z`],
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
      expectedQueryParams: [`9007199254740992`, `9007199254740997`],
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
      expectedQueryParams: Array.from({ length: 901 }, (_unused, index) =>
        (BigInt(`9007199254740992`) + BigInt(index)).toString(),
      ),
    },
  ])(
    `uses the raw $label field expression index`,
    async ({ expectedKeys, expectedQueryParams, ...scenario }) => {
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
      expect(observation.directSqlKeys, diagnostic).toEqual(expectedKeys)
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

  it(`round-trips generated signed-64-bit BigInts through the real adapter`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: SQLITE_BIGINT_MIN, max: SQLITE_BIGINT_MAX }),
        async (value) => {
          const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
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
      oracleRunConfiguration(),
    )
  })

  it(`rejects generated BigInts immediately outside the signed range`, async () => {
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
      oracleRunConfiguration(),
    )
  })

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
        new IR.Value(2),
      ]),
      rows: [
        { key: `lower`, value: { score: 1 } },
        { key: `matching`, value: { score: 2 } },
        { key: `higher`, value: { score: 3 } },
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
        new IR.Value(2),
      ]),
      rows: [
        { key: `matching`, value: { score: 2 } },
        { key: `different`, value: { score: 3 } },
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

  it(`reaches every declared generated expression-index scenario`, async () => {
    const reachedScenarios = new Set<GeneratedScenarioKind>()

    await fc.assert(
      fc.asyncProperty(generatedScenarioMatrixArbitrary, async (scenarios) => {
        for (const {
          kind,
          expectedKeys,
          expectedPlan,
          ...scenario
        } of scenarios) {
          reachedScenarios.add(kind)
          const observation = await observeExpressionIndexScenario(scenario)
          const diagnostic = JSON.stringify(
            {
              kind,
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
          expect(observation.directSqlKeys, diagnostic).toEqual(expectedKeys)
          if (expectedPlan === `ordered-scan`) {
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
      }),
      {
        ...oracleRunConfiguration(),
        verbose: 2,
      },
    )

    expect([...reachedScenarios].sort()).toEqual(
      [...GENERATED_SCENARIO_KINDS].sort(),
    )
  })
})
