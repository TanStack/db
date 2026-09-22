import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fc } from '@fast-check/vitest'
import { afterEach, expect, it } from 'vitest'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import { InvalidPersistedCollectionConfigError } from '../../db-sqlite-persistence-core/src'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import type { OpSQLiteDatabaseLike } from '../src/op-sqlite-driver'
import type { SQLiteDriverContractHarnessFactory } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'

const activeCleanupFns: Array<() => void | Promise<void>> = []

afterEach(async () => {
  const cleanupErrors: Array<unknown> = []
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    try {
      await Promise.resolve(cleanupFn?.())
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length === 1) {
    throw cleanupErrors[0]
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, `op-sqlite test cleanup failed`, {
      cause: cleanupErrors[0],
    })
  }
})

function createTempSqlitePath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-rn-op-sqlite-test-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

type ColumnarDriverHarness = {
  driver: OpSQLiteDriver
  queryExecutions: () => number
}

async function withColumnarDriver<T>(
  fn: (harness: ColumnarDriverHarness) => Promise<T>,
): Promise<T> {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-rn-op-sqlite-alias-contract-`),
  )
  let database: ReturnType<typeof createOpSQLiteTestDatabase> | undefined
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    database = createOpSQLiteTestDatabase({
      filename: join(tempDirectory, `state.sqlite`),
      resultShape: `execute-async-columnar`,
    })
    const queryExecutions = trackQueryExecutions(database)
    const driver = new OpSQLiteDriver({ database })
    outcome = {
      ok: true,
      value: await fn({ driver, queryExecutions }),
    }
  } catch (error) {
    outcome = { ok: false, error }
  }

  const cleanupErrors: Array<unknown> = []
  if (database) {
    try {
      await Promise.resolve(database.close())
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    rmSync(tempDirectory, { recursive: true, force: true })
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (!outcome.ok) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [outcome.error, ...cleanupErrors],
        `op-sqlite alias law and cleanup failed`,
        { cause: outcome.error },
      )
    }
    throw outcome.error
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, `op-sqlite alias cleanup failed`, {
      cause: cleanupErrors[0],
    })
  }
  return outcome.value
}

/**
 * Law: SQLiteDriver.query returns the complete ordered object rows supplied by
 * the database after exec/run writes. SQL aliases remain row data even when
 * their names match envelope fields, including direct rows made only of write
 * marker aliases. When OP-SQLite supplies object rows and raw columnar rows
 * together, the already-decoded object rows are authoritative. Malformed or
 * undocumented result carriers reject.
 * Source: SQLiteDriver's public query contract and op-sqlite's documented
 * execute `{ rows, columnNames }` and executeAsync
 * `{ rawRows, columnNames, rowsAffected }` envelopes.
 * Domain: deterministic object-row wrappers and columnar rows, including
 * empty, asymmetric/reordered multirow, legal reserved-looking SQL aliases,
 * and malformed or conflicting envelopes.
 * Reference/history grammar: `aliasQueryCase` builds two ordered object rows
 * directly from unique legal aliases and distinct scalar values. Histories
 * choose wrapper shape or columnar aliases, execute real writes or one SELECT,
 * and then either return the exact rows or reject an invalid envelope; the
 * reference never calls the production decoder.
 * Path/checkpoint: OpSQLiteDriver over a real better-sqlite3 shim, observed
 * when each query Promise settles. Exact row values, keys, order, and count are
 * compared.
 * Refinement evidence: query execution counts prove the SELECT reached the
 * adapter. Empty, reordered, duplicated, missing-key, and swapped-value mutants
 * challenge the checker; the alias property records a seed and shrink path and
 * verifies replay of the same exact-row violation.
 * Limit: this shim establishes adapter normalization, not native device/host
 * execution; native op-sqlite v14 still needs a separate runtime receipt.
 */
it.each([
  `rows-array`,
  `rows-object`,
  `rows-list`,
  `statement-array`,
  `execute-rows-with-column-names`,
  `execute-async-columnar`,
] as const)(`reads query rows across result shape: %s`, async (resultShape) => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({
    filename: dbPath,
    resultShape,
  })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, score INTEGER NOT NULL)`,
  )
  await driver.run(`INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`, [
    `1`,
    `Lower score`,
    7,
  ])
  await driver.run(`INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`, [
    `2`,
    `Higher score`,
    41,
  ])

  const rows = await driver.query<{
    id: string
    title: string
    score: number
  }>(`SELECT title, score, id FROM todos ORDER BY score DESC`)
  expectExactRows(rows, [
    {
      title: `Higher score`,
      score: 41,
      id: `2`,
    },
    {
      title: `Lower score`,
      score: 7,
      id: `1`,
    },
  ])
})

async function queryInjectedResult<T = unknown>(
  result: unknown,
): Promise<ReadonlyArray<T>> {
  return new OpSQLiteDriver({
    database: {
      executeAsync: () => Promise.resolve(result),
    },
  }).query<T>(`SELECT * FROM injected_result`)
}

it(`reads op-sqlite execute rows when columnNames metadata is also present`, async () => {
  await expect(
    queryInjectedResult({
      rowsAffected: 0,
      rows: [{ id: `node-or-web-row` }],
      columnNames: [`id`],
    }),
  ).resolves.toEqual([{ id: `node-or-web-row` }])
})

it(`prefers object rows when op-sqlite also supplies raw columnar rows`, async () => {
  await expect(
    queryInjectedResult({
      rowsAffected: 0,
      rows: [{ id: `object-row` }],
      rawRows: [[`raw-row`]],
      columnNames: [`id`],
    }),
  ).resolves.toEqual([{ id: `object-row` }])
})

it.each([
  `rows`,
  `resultRows`,
  `rawRows`,
  `columnNames`,
  `results`,
  `res`,
] as const)(
  `preserves a direct data row with non-scalar %s alias`,
  async (alias) => {
    const row = {
      [alias]: [`nested`, `value`],
      ...(alias === `rowsAffected` ? {} : { rowsAffected: 17 }),
      ordinary_name: `ordinary-value`,
    }
    await expect(queryInjectedResult([row])).resolves.toEqual([row])
  },
)

it(`decodes legal duplicate SQLite column names with the last-value law`, async () => {
  await withColumnarDriver(async ({ driver }) => {
    await expect(
      driver.query(`SELECT 'left-id' AS id, 'right-id' AS id`),
    ).resolves.toEqual([{ id: `right-id` }])
  })
})

it(`reads object and structural statement-array write envelopes as empty`, async () => {
  const writeResult = { rowsAffected: 1, insertId: 17 }
  await expect(queryInjectedResult(writeResult)).resolves.toEqual([])
  await expect(
    queryInjectedResult([{ ...writeResult, rows: [] }]),
  ).resolves.toEqual([])
})

it.each([
  {
    name: `one row with a rowsAffected alias`,
    rows: [{ rowsAffected: 42 }],
  },
  {
    name: `multiple rows with a changes alias`,
    rows: [{ changes: 1 }, { changes: 2 }],
  },
])(
  `preserves direct data rows containing only write aliases: $name`,
  async ({ rows }) => {
    await expect(queryInjectedResult(rows)).resolves.toEqual(rows)
  },
)

function expectExactRows<T>(
  actual: ReadonlyArray<T>,
  expected: ReadonlyArray<T>,
): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((row, rowIndex) => {
    if (isRecord(row)) {
      const actualRow = actual[rowIndex]
      expect(Object.keys(isRecord(actualRow) ? actualRow : {})).toEqual(
        Object.keys(row),
      )
    }
    expect(actual[rowIndex]).toEqual(row)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

function expectExactAliasRows(
  actual: ReadonlyArray<Record<string, unknown>>,
  expected: ReadonlyArray<Record<string, unknown>>,
): void {
  try {
    expect(actual).toHaveLength(expected.length)
    expected.forEach((row, rowIndex) => {
      expect(Object.keys(actual[rowIndex] ?? {})).toEqual(Object.keys(row))
      expect(actual[rowIndex]).toEqual(row)
    })
  } catch (cause) {
    throw new Error(`op-sqlite reserved-alias exact-row law violated`, {
      cause,
    })
  }
}

const statementResultFieldNames = [
  `rows`,
  `resultRows`,
  `rawRows`,
  `columnNames`,
  `results`,
  `rowsAffected`,
  `changes`,
  `insertId`,
  `lastInsertRowId`,
  `res`,
] as const

const statementResultAliasNames = [
  ...statementResultFieldNames,
  `ordinary_name`,
  `another_value`,
] as const

const writeResultFieldNames = [
  `rowsAffected`,
  `changes`,
  `insertId`,
  `lastInsertRowId`,
] as const

const aliasOracleSeed = Number(
  process.env.TANSTACK_DB_OP_SQLITE_ORACLE_SEED ?? 165903,
)
const aliasOracleRuns = Number(
  process.env.TANSTACK_DB_OP_SQLITE_ORACLE_RUNS ?? 50,
)
const aliasOraclePath = process.env.TANSTACK_DB_OP_SQLITE_ORACLE_PATH
if (!Number.isSafeInteger(aliasOracleSeed)) {
  throw new Error(`Invalid TANSTACK_DB_OP_SQLITE_ORACLE_SEED`)
}
if (!Number.isSafeInteger(aliasOracleRuns) || aliasOracleRuns < 1) {
  throw new Error(`Invalid TANSTACK_DB_OP_SQLITE_ORACLE_RUNS`)
}
if (aliasOraclePath !== undefined && !/^\d+(?::\d+)*$/.test(aliasOraclePath)) {
  throw new Error(
    `TANSTACK_DB_OP_SQLITE_ORACLE_PATH requires a numeric shrink path`,
  )
}

it(`preserves generated single-row write-marker aliases in direct row arrays`, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.constantFrom(...writeResultFieldNames), {
        minLength: 1,
        maxLength: writeResultFieldNames.length,
      }),
      async (aliases) => {
        const row = Object.fromEntries(
          aliases.map((alias, index) => [alias, `${index}:${alias}`]),
        )
        const actual = await queryInjectedResult<Record<string, unknown>>([row])
        expectExactAliasRows(actual, [row])
      },
    ),
    {
      seed: aliasOracleSeed,
      numRuns: aliasOracleRuns,
      examples: [[[`rowsAffected`]], [[...writeResultFieldNames]]],
    },
  )
})

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`
}

function aliasValue(
  alias: string,
  rowIndex: number,
  columnIndex: number,
): string {
  return `${rowIndex === 0 ? `left` : `right`}:${columnIndex}:${alias}`
}

function aliasQueryCase(aliases: ReadonlyArray<string>): {
  sql: string
  params: Array<unknown>
  expected: Array<Record<string, unknown>>
} {
  const rowValues = [0, 1].map((rowIndex) =>
    aliases.map((alias, columnIndex) =>
      aliasValue(alias, rowIndex, columnIndex),
    ),
  )
  const selectList = aliases
    .map((alias) => `? AS ${quoteIdentifier(alias)}`)
    .join(`, `)
  return {
    sql: `SELECT ${selectList} UNION ALL SELECT ${selectList}`,
    params: [...rowValues[0]!, ...rowValues[1]!],
    expected: rowValues.map((values) =>
      Object.fromEntries(aliases.map((alias, index) => [alias, values[index]])),
    ),
  }
}

function trackQueryExecutions(
  database: ReturnType<typeof createOpSQLiteTestDatabase>,
): () => number {
  const executeAsync = database.executeAsync
  if (!executeAsync) {
    throw new Error(`columnar fixture must expose executeAsync`)
  }
  let queryExecutions = 0
  database.executeAsync = (sql, params) => {
    if (/^\s*SELECT\b/i.test(sql)) queryExecutions++
    return executeAsync.call(database, sql, params)
  }
  return () => queryExecutions
}

it(`preserves every statement-result field name when used as a SQL alias`, async () => {
  await withColumnarDriver(async ({ driver, queryExecutions }) => {
    const aliases = statementResultFieldNames
    const { sql, params, expected } = aliasQueryCase(aliases)

    const actual = await driver.query<Record<string, unknown>>(sql, params)
    expect(queryExecutions()).toBe(1)
    expectExactAliasRows(actual, expected)
  })
})

it(`preserves statement-result field names in direct row arrays`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({
    filename: dbPath,
    resultShape: `rows-array`,
  })
  activeCleanupFns.push(() => Promise.resolve(database.close()))
  const aliases = statementResultFieldNames
  const { sql, params, expected } = aliasQueryCase(aliases)

  expectExactAliasRows(
    await new OpSQLiteDriver({ database }).query<Record<string, unknown>>(
      sql,
      params,
    ),
    expected,
  )
})

it(`preserves generated legal SQL aliases through v14 columnar rows`, async () => {
  await withColumnarDriver(async ({ driver, queryExecutions }) => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom(...statementResultAliasNames), {
          minLength: 1,
          maxLength: statementResultAliasNames.length,
        }),
        async (aliases) => {
          const executionsBefore = queryExecutions()
          const { sql, params, expected } = aliasQueryCase(aliases)
          let actual: ReadonlyArray<Record<string, unknown>>
          try {
            actual = await driver.query<Record<string, unknown>>(sql, params)
          } catch (error) {
            expect(queryExecutions()).toBe(executionsBefore + 1)
            throw error
          }
          expect(queryExecutions()).toBe(executionsBefore + 1)
          expectExactAliasRows(actual, expected)
        },
      ),
      {
        seed: aliasOracleSeed,
        numRuns: aliasOracleRuns,
        ...(aliasOraclePath ? { path: aliasOraclePath } : {}),
        examples: [[[...statementResultFieldNames]]],
      },
    )
  })
})

it(`returns an exact empty row set for an empty columnar SELECT`, async () => {
  await withColumnarDriver(async ({ driver, queryExecutions }) => {
    await driver.exec(`CREATE TABLE empty_rows (id TEXT PRIMARY KEY)`)

    expectExactRows(
      await driver.query<{ id: string }>(`SELECT id FROM empty_rows`),
      [],
    )
    expect(queryExecutions()).toBe(1)
  })
})

const malformedColumnarResults: ReadonlyArray<{
  name: string
  result: unknown
}> = [
  {
    name: `null result`,
    result: null,
  },
  {
    name: `undefined result`,
    result: undefined,
  },
  {
    name: `empty object`,
    result: {},
  },
  {
    name: `primitive result`,
    result: 42,
  },
  {
    name: `rawRows without columnNames`,
    result: { rowsAffected: 0, rawRows: [[`1`]] },
  },
  {
    name: `columnNames without rawRows`,
    result: { rowsAffected: 0, columnNames: [`id`] },
  },
  {
    name: `wrapped rawRows without columnNames`,
    result: [{ rowsAffected: 0, rawRows: [[`1`]] }],
  },
  {
    name: `wrapped columnNames without rawRows`,
    result: [{ rowsAffected: 0, columnNames: [`id`] }],
  },
  {
    name: `row shorter than columnNames`,
    result: {
      rowsAffected: 0,
      rawRows: [[`1`]],
      columnNames: [`id`, `title`],
    },
  },
  {
    name: `row wider than columnNames`,
    result: {
      rowsAffected: 0,
      rawRows: [[`1`, `extra`]],
      columnNames: [`id`],
    },
  },
  {
    name: `non-array raw row`,
    result: {
      rowsAffected: 0,
      rawRows: [{ id: `1` }],
      columnNames: [`id`],
    },
  },
  {
    name: `nonempty rawRows with no column names`,
    result: {
      rowsAffected: 0,
      rawRows: [[]],
      columnNames: [],
    },
  },
  {
    name: `unknown row carrier beside a write marker`,
    result: { rowsAffected: 0, mysteryRows: [[`1`]] },
  },
  {
    name: `unknown envelope without a write marker`,
    result: { mysteryRows: [[`1`]] },
  },
  {
    name: `undocumented res carrier`,
    result: { rowsAffected: 0, res: [{ id: `legacy` }] },
  },
  {
    name: `columnar rows with a conflicting resultRows carrier`,
    result: {
      rowsAffected: 0,
      rawRows: [[`columnar`]],
      columnNames: [`id`],
      resultRows: [{ id: `conflict` }],
    },
  },
  {
    name: `columnar rows with a conflicting nested results carrier`,
    result: {
      rowsAffected: 0,
      rawRows: [[`columnar`]],
      columnNames: [`id`],
      results: [{ rows: [{ id: `conflict` }] }],
    },
  },
]

function expectMalformedQueryRejected(
  outcome: PromiseSettledResult<ReadonlyArray<unknown>>,
): void {
  expect(outcome.status).toBe(`rejected`)
  if (outcome.status === `rejected`) {
    expect(outcome.reason).toBeInstanceOf(InvalidPersistedCollectionConfigError)
  }
}

it.each(malformedColumnarResults)(
  `throws for malformed or unknown SELECT result: $name`,
  async ({ result }) => {
    let queryExecutions = 0
    const database: OpSQLiteDatabaseLike = {
      executeAsync: () => {
        queryExecutions++
        return Promise.resolve(result)
      },
    }
    const driver = new OpSQLiteDriver({ database })

    const [outcome] = await Promise.allSettled([
      driver.query(`SELECT id FROM malformed_result`),
    ])
    expect(queryExecutions).toBe(1)
    expectMalformedQueryRejected(outcome)
  },
)

it(`supports exactly one results wrapper`, async () => {
  let queryExecutions = 0
  const database: OpSQLiteDatabaseLike = {
    executeAsync: () => {
      queryExecutions++
      return Promise.resolve({
        results: [{ rows: [{ id: `one-level` }] }],
      })
    },
  }

  await expect(
    new OpSQLiteDriver({ database }).query(`SELECT id FROM wrapped_result`),
  ).resolves.toEqual([{ id: `one-level` }])
  expect(queryExecutions).toBe(1)
})

it.each([
  {
    name: `second results wrapper`,
    createResult: () => ({
      results: [{ results: [{ rows: [{ id: `too-deep` }] }] }],
    }),
  },
  {
    name: `cyclic second-level results wrapper`,
    createResult: () => {
      const cyclicResult: Record<string, unknown> = {}
      cyclicResult.results = [cyclicResult]
      return cyclicResult
    },
  },
])(`rejects unsupported results depth: $name`, async ({ createResult }) => {
  let queryExecutions = 0
  const database: OpSQLiteDatabaseLike = {
    executeAsync: () => {
      queryExecutions++
      return Promise.resolve(createResult())
    },
  }
  const [outcome] = await Promise.allSettled([
    new OpSQLiteDriver({ database }).query(
      `SELECT id FROM unsupported_results_depth`,
    ),
  ])

  expect(queryExecutions).toBe(1)
  expectMalformedQueryRejected(outcome)
})

it(`reserved-alias checker rejects exact-row mutants`, () => {
  const aliases = [`rows`, `rowsAffected`, `ordinary_name`]
  const { expected } = aliasQueryCase(aliases)
  const first = expected[0]!
  const second = expected[1]!
  const mutants: Array<Array<Record<string, unknown>>> = [
    [],
    [
      Object.fromEntries(
        Object.entries(first).filter(([alias]) => alias !== `rowsAffected`),
      ),
      second,
    ],
    [{ ...first, rows: first.rowsAffected, rowsAffected: first.rows }, second],
    [first, first],
  ]

  mutants.forEach((mutant) => {
    expect(() => expectExactAliasRows(mutant, expected)).toThrow(
      `op-sqlite reserved-alias exact-row law violated`,
    )
  })
  expectExactAliasRows(expected, expected)
})

it(`reserved-alias checker shrinks and replays the same row-law violation`, () => {
  const challenge = (aliases: ReadonlyArray<string>) => {
    const { expected } = aliasQueryCase(aliases)
    expectExactAliasRows([], expected)
  }
  const originalAliases = statementResultFieldNames
  expect(() => challenge(originalAliases)).toThrow(
    `op-sqlite reserved-alias exact-row law violated`,
  )

  const property = fc.property(
    fc.uniqueArray(fc.constantFrom(...statementResultAliasNames), {
      minLength: 1,
      maxLength: statementResultAliasNames.length,
    }),
    challenge,
  )
  const original = fc.check(property, {
    seed: 165903,
    numRuns: 20,
  })
  expect(original.failed).toBe(true)
  expect(original.error).toContain(
    `op-sqlite reserved-alias exact-row law violated`,
  )
  if (original.counterexamplePath === null) {
    throw new Error(`Missing reserved-alias calibration replay path`)
  }
  const reduced = fc.check(property, {
    seed: original.seed,
    path: original.counterexamplePath,
    numRuns: 1,
    endOnFailure: true,
  })
  expect(reduced.failed).toBe(true)
  expect(reduced.error).toContain(
    `op-sqlite reserved-alias exact-row law violated`,
  )
  expect(reduced.counterexample).toEqual(original.counterexample)
  expect(reduced.counterexample?.[0].length).toBeLessThan(
    originalAliases.length,
  )
})

it(`malformed-envelope checker rejects an accepted conflicting carrier`, () => {
  expect(() =>
    expectMalformedQueryRejected({
      status: `fulfilled`,
      value: [{ id: `conflict` }],
    }),
  ).toThrow()
  expectMalformedQueryRejected({
    status: `rejected`,
    reason: new InvalidPersistedCollectionConfigError(`invalid result`),
  })
})

it.each([
  {
    name: `silently empty`,
    actual: [],
  },
  {
    name: `rows swapped`,
    actual: [
      { title: `Lower score`, score: 7, id: `1` },
      { title: `Higher score`, score: 41, id: `2` },
    ],
  },
  {
    name: `first row copied into the second`,
    actual: [
      { title: `Higher score`, score: 41, id: `2` },
      { title: `Higher score`, score: 41, id: `2` },
    ],
  },
])(`exact-row oracle rejects hostile output: $name`, ({ actual }) => {
  const expected = [
    { title: `Higher score`, score: 41, id: `2` },
    { title: `Lower score`, score: 7, id: `1` },
  ]
  expect(() => expectExactRows(actual, expected)).toThrow()
  expectExactRows(expected, expected)
})

it(`rolls back transaction on failure`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE tx_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  await expect(
    driver.transactionWithDriver(async (transactionDriver) => {
      await transactionDriver.run(
        `INSERT INTO tx_test (id, title) VALUES (?, ?)`,
        [`1`, `First`],
      )
      await transactionDriver.run(
        `INSERT INTO tx_test (missing_column) VALUES (?)`,
        [`x`],
      )
    }),
  ).rejects.toThrow()

  const rows = await driver.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM tx_test`,
  )
  expect(rows[0]?.count).toBe(0)
})

it(`supports nested savepoint rollback without losing outer transaction`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE nested_tx_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  await driver.transactionWithDriver(async (outerTransactionDriver) => {
    await outerTransactionDriver.run(
      `INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`,
      [`1`, `Outer before`],
    )

    await expect(
      outerTransactionDriver.transaction(async (innerTransactionDriver) => {
        await innerTransactionDriver.run(
          `INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`,
          [`2`, `Inner failing`],
        )
        throw new Error(`nested-failure`)
      }),
    ).rejects.toThrow(`nested-failure`)

    await outerTransactionDriver.run(
      `INSERT INTO nested_tx_test (id, title) VALUES (?, ?)`,
      [`3`, `Outer after`],
    )
  })

  const rows = await driver.query<{ id: string; title: string }>(
    `SELECT id, title FROM nested_tx_test ORDER BY id ASC`,
  )
  expect(rows).toEqual([
    { id: `1`, title: `Outer before` },
    { id: `3`, title: `Outer after` },
  ])
})

it(`supports transaction callbacks that use provided transaction driver`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(`CREATE TABLE closure_tx_test (value INTEGER NOT NULL)`)

  let resolveHold: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    resolveHold = resolve
  })
  let resolveEntered: (() => void) | undefined
  const entered = new Promise<void>((resolve) => {
    resolveEntered = resolve
  })

  const txPromise = driver.transaction(async (transactionDriver) => {
    if (!resolveEntered) {
      throw new Error(`transaction entry signal missing`)
    }
    resolveEntered()
    await transactionDriver.run(
      `INSERT INTO closure_tx_test (value) VALUES (?)`,
      [1],
    )
    await hold
    await transactionDriver.run(
      `INSERT INTO closure_tx_test (value) VALUES (?)`,
      [2],
    )
  })

  await entered

  let outsideResolved = false
  const outsidePromise = driver
    .run(`INSERT INTO closure_tx_test (value) VALUES (?)`, [3])
    .then(() => {
      outsideResolved = true
    })

  await Promise.resolve()
  expect(outsideResolved).toBe(false)

  if (!resolveHold) {
    throw new Error(`transaction hold signal missing`)
  }
  resolveHold()

  await Promise.all([txPromise, outsidePromise])

  const rows = await driver.query<{ value: number }>(
    `SELECT value FROM closure_tx_test ORDER BY value ASC`,
  )
  expect(rows.map((row) => row.value)).toEqual([1, 2, 3])
})

it(`throws when transaction callback omits transaction driver argument`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })

  await expect(
    driver.transaction((() => Promise.resolve()) as never),
  ).rejects.toThrow(`transaction driver argument`)
})

it(`serializes unrelated operations behind an active transaction`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const driver = new OpSQLiteDriver({ database })
  await driver.exec(
    `CREATE TABLE tx_scope_test (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  )

  let resolveOuterTransaction: (() => void) | undefined
  const outerTransactionGate = new Promise<void>((resolve) => {
    resolveOuterTransaction = resolve
  })

  let signalOuterInsertComplete: (() => void) | undefined
  const outerInsertComplete = new Promise<void>((resolve) => {
    signalOuterInsertComplete = resolve
  })

  const outerTransaction = driver.transactionWithDriver(
    async (transactionDriver) => {
      await transactionDriver.run(
        `INSERT INTO tx_scope_test (id, title) VALUES (?, ?)`,
        [`outer`, `Inside transaction`],
      )
      signalOuterInsertComplete?.()
      await outerTransactionGate
      throw new Error(`rollback-outer-transaction`)
    },
  )

  await outerInsertComplete

  let unrelatedWriteCompleted = false
  const unrelatedWrite = driver
    .run(`INSERT INTO tx_scope_test (id, title) VALUES (?, ?)`, [
      `outside`,
      `Outside transaction`,
    ])
    .then(() => {
      unrelatedWriteCompleted = true
    })
  await Promise.resolve()
  expect(unrelatedWriteCompleted).toBe(false)

  resolveOuterTransaction?.()

  await expect(outerTransaction).rejects.toThrow(`rollback-outer-transaction`)
  await unrelatedWrite

  const rows = await driver.query<{ id: string; title: string }>(
    `SELECT id, title FROM tx_scope_test ORDER BY id ASC`,
  )
  expect(rows).toEqual([{ id: `outside`, title: `Outside transaction` }])
})

it(`throws config error when db execute methods are missing`, () => {
  expect(() => new OpSQLiteDriver({ database: {} as never })).toThrowError(
    InvalidPersistedCollectionConfigError,
  )
})

function createColumnarDriverHarness(
  createDatabase: typeof createOpSQLiteTestDatabase = createOpSQLiteTestDatabase,
): ReturnType<SQLiteDriverContractHarnessFactory> {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-rn-op-sqlite-contract-`))
  let database: ReturnType<typeof createOpSQLiteTestDatabase> | undefined
  try {
    database = createDatabase({
      filename: join(tempDirectory, `state.sqlite`),
      resultShape: `execute-async-columnar`,
    })
    const driver = new OpSQLiteDriver({ database })

    return {
      driver,
      cleanup: async () => {
        const cleanupErrors: Array<unknown> = []
        try {
          await Promise.resolve(database.close())
        } catch (error) {
          cleanupErrors.push(error)
        }
        try {
          rmSync(tempDirectory, { recursive: true, force: true })
        } catch (error) {
          cleanupErrors.push(error)
        }
        if (cleanupErrors.length === 1) throw cleanupErrors[0]
        if (cleanupErrors.length > 1) {
          throw new AggregateError(
            cleanupErrors,
            `op-sqlite contract cleanup failed`,
            { cause: cleanupErrors[0] },
          )
        }
      },
    }
  } catch (error) {
    const cleanupErrors: Array<unknown> = []
    try {
      database?.close()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    try {
      rmSync(tempDirectory, { recursive: true, force: true })
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        `op-sqlite contract construction and cleanup failed`,
        { cause: error },
      )
    }
    throw error
  }
}

it(`removes the contract directory when database construction fails`, () => {
  let tempDirectory: string | undefined
  expect(() =>
    createColumnarDriverHarness(({ filename }) => {
      const directory = dirname(filename)
      tempDirectory = directory
      activeCleanupFns.push(() => {
        rmSync(directory, { recursive: true, force: true })
      })
      throw new Error(`construction failed`)
    }),
  ).toThrow(`construction failed`)
  expect(tempDirectory).toBeDefined()
  expect(existsSync(tempDirectory!)).toBe(false)
})

it(`closes the database and removes the contract directory when driver construction fails`, () => {
  let tempDirectory: string | undefined
  let closed = false
  expect(() =>
    createColumnarDriverHarness(({ filename }) => {
      tempDirectory = dirname(filename)
      return {
        close: () => {
          closed = true
        },
      }
    }),
  ).toThrow(`execute/executeAsync/executeRaw/execAsync`)
  expect(closed).toBe(true)
  expect(tempDirectory).toBeDefined()
  expect(existsSync(tempDirectory!)).toBe(false)
})

runSQLiteDriverContractSuite(
  `op-sqlite executeAsync columnar driver`,
  createColumnarDriverHarness,
)
