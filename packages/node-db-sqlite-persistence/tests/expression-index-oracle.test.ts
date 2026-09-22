/**
 * # When does SQLite use a persisted expression index?
 *
 * Contract and source: RFC #1659 invariant 8 requires persisted index DDL and
 * the indexed runtime predicate to have the same SQLite expression shape.
 * SQLite requires syntactically matching expressions before an expression
 * index can satisfy a predicate.
 *
 * History grammar and domain: constructively generated object-rooted SQLite
 * JSON paths have a one-to-six-character identifier root and up to three
 * identifier/array-index tail segments. Identifiers start with a/m/p/t/x and
 * continue with a/b/e/i/n/r/s/0/1; array indices are 0..3. Independent
 * equality values are
 * integer targets -10_000..10_000 with adjacent distractors,
 * `target-'${suffix}` strings with `before-${suffix}`/`after-${suffix}`
 * distractors for suffixes 0..10_000, or booleans with duplicated opposite
 * distractors. Legal `_root`/`Upper_2` paths, fractional numbers, and empty
 * strings are omitted from the generated campaign; their same-path audit probes
 * are GREEN, so they are not a permanent matrix. Null and persisted tagged
 * values remain outside this query-planning law because their operators or
 * coercions can change the indexed expression. Each generated history inserts
 * rows, creates the serialized ref index, scans, and loads the subset.
 *
 * Independent model: a full adapter scan followed by a small path walker and
 * strict scalar equality. It does not call the SQL compiler or reuse its path
 * logic.
 *
 * Production path and checkpoint: the public SQLite-core adapter factory with
 * the real BetterSqlite3SQLiteDriver. The exact SQL and bindings passed to the
 * driver's predicate query are captured, then replayed through EXPLAIN QUERY
 * PLAN before cleanup. Result keys and the named expression index in the plan
 * are separate observations; result order is outside this law.
 *
 * Reach, challenge, replay, and cleanup: every production case proves the
 * index exists, the full-scan row count and target classification match the
 * seed, the filter value stays bound, and indexed results equal the independent
 * scan classification. Direct SQLite fault controls show that binding the DDL
 * path is rejected and binding the predicate path returns the same rows but
 * loses the index search. Replay a generated failure with TANSTACK_DB_WS5A_SEED
 * and TANSTACK_DB_WS5A_PATH. Teardown retains the semantic failure as
 * AggregateError.cause if cleanup also fails.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import {
  createPersistedTableName,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persistence-core'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import type { SQLiteDriver } from '@tanstack/db-sqlite-persistence-core'

const DEFAULT_ORACLE_SEED = 1_659_005
const DEFAULT_ORACLE_RUNS = 24

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

function createQueryObservingDriver(
  inner: SQLiteDriver,
  observe: (query: CapturedQuery) => void,
): SQLiteDriver {
  const wrap = (driver: SQLiteDriver): SQLiteDriver => ({
    exec: (sql) => driver.exec(sql),
    query: async <T>(sql: string, params: ReadonlyArray<unknown> = []) => {
      observe({ sql, params: [...params] })
      return driver.query<T>(sql, params)
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

async function assertExpressionIndexHistory(
  testCase: OracleCase,
  label: string,
): Promise<void> {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-expression-index-`))
  const databasePath = join(tempDirectory, `state.sqlite`)
  const baseDriver = new BetterSqlite3SQLiteDriver({ filename: databasePath })
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

    expect(
      checkpoint.usedNamedExpressionIndex,
      `predicate checkpoint must use the matching expression index:\n${JSON.stringify(checkpoint, null, 2)}`,
    ).toBe(true)
    expect(
      checkpoint.scannedCollectionTable,
      `predicate checkpoint must not scan the collection table:\n${JSON.stringify(checkpoint, null, 2)}`,
    ).toBe(false)
  }, [
    () => baseDriver.close(),
    () => rmSync(tempDirectory, { recursive: true, force: true }),
  ])
}

describe(`SQLite expression-index oracle`, () => {
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
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-index-controls-`))
    const databasePath = join(tempDirectory, `state.sqlite`)
    const driver = new BetterSqlite3SQLiteDriver({ filename: databasePath })
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
    }, [
      () => driver.close(),
      () => rmSync(tempDirectory, { recursive: true, force: true }),
    ])
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

  it(`uses matching expression indexes for generated legal paths and values`, async () => {
    await fc.assert(
      fc.asyncProperty(expressionIndexCaseArbitrary, async (testCase) => {
        await assertExpressionIndexHistory(testCase, `generated`)
      }),
      {
        ...oracleRunConfiguration(),
        verbose: 2,
      },
    )
  })
})
