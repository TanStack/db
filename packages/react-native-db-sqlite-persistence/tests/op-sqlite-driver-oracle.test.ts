import { fc } from '@fast-check/vitest'
import { afterEach, expect, it } from 'vitest'
import {
  declareOracle,
  oracleRandomParameters,
  oracleReplayTest,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import {
  activeCleanupFns,
  createColumnarDriverHarness,
  createTempSqlitePath,
  expectExactAliasRows,
  queryInjectedResult,
  readAliasOracleRuns,
  runActiveCleanupFns,
  statementResultAliasNames,
  statementResultFieldNames,
  withColumnarDriver,
  writeResultFieldNames,
} from './op-sqlite-driver-support'

afterEach(runActiveCleanupFns)

/**
 * Law: SQLiteDriver.query returns the complete ordered object rows supplied by
 * the database after exec/run writes. SQL aliases remain row data even when
 * their names match envelope fields, including direct rows made only of write
 * marker aliases. When OP-SQLite supplies object rows and raw columnar rows
 * together, the already-decoded object rows are authoritative. Malformed or
 * incomplete result carriers reject. A bare array whose first entry can be
 * both a row and a statement envelope has no self-describing interpretation;
 * its driver must declare `rows` or `statement-results` mode. The declared
 * mode, rather than reserved field names, decides markerless `{ rows }`
 * wrappers.
 * Source: SQLiteDriver's public query contract and op-sqlite's documented
 * required `QueryResult.rows`, execute `{ rows, columnNames }`, and executeAsync
 * `{ rawRows, columnNames, rowsAffected }` envelopes.
 * Domain: deterministic object-row wrappers and columnar rows, including
 * empty, asymmetric/reordered multirow, legal reserved-looking SQL aliases,
 * and malformed or conflicting envelopes.
 * Reference/history grammar: `aliasQueryCase` builds two ordered object rows
 * directly from unique legal aliases and distinct scalar values. Histories
 * choose wrapper shape, explicit mode for ambiguous arrays, or columnar
 * aliases, execute real writes or one SELECT, and then either return the exact
 * rows or reject an invalid envelope; the reference never calls the production
 * decoder.
 * Path/checkpoint: OpSQLiteDriver over a real better-sqlite3 shim, observed
 * when each query Promise settles. Exact row values, keys, order, and count are
 * compared.
 * Refinement evidence: query execution counts prove the SELECT reached the
 * adapter. Named empty, reordered, duplicated, missing-key, and swapped-value
 * wrong answers challenge the checker. Normal execution runs the same alias
 * properties and budgets in retained fixed-seed and seedless-random lanes.
 * TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH, and TANSTACK_DB_ORACLE_PROPERTY
 * select one exact replay.
 * Real-provider refinement: frozen receipts from the published 15.2.7 Native
 * and Node sources, plus forward receipts from 18.2.1 Native, Node, and browser
 * sources, prove the shim's accepted envelopes match provider output.
 * The frozen receipts, envelope-decoding cases, transaction tests, and
 * malformed-envelope tables are ordinary unit tests in op-sqlite-driver.test.ts;
 * they compare with fixed values, so they are not part of this law's coverage.
 * Known omissions: frozen provider values establish result-shape conformance,
 * not native device/host execution. A real runtime campaign still owns JSI,
 * worker, and platform delivery.
 */

type AliasOracleProperty =
  | `op-sqlite.write-marker-aliases`
  | `op-sqlite.result-carrier-equivalence`
  | `op-sqlite.columnar-sql-aliases`
type AliasOracleParameters = {
  numRuns: number
  seed?: number
  path?: string
}

const FIXED_ALIAS_ORACLE_SEED = 165903

const aliasOracleRuns = readAliasOracleRuns()
// Replay coordinates come from the shared TANSTACK_DB_ORACLE_* variables.
const aliasOracleReplay = readOracleRunConfig()

/**
 * Registers a property's two campaigns. The fixed campaign pins its seed and
 * stands aside on every path replay. The random campaign runs in ordinary and
 * seed-only runs, and as the replay of its property, where the shared helper
 * returns the recorded path.
 */
function registerAliasOracle(
  property: AliasOracleProperty,
  title: string,
  check: (parameters: AliasOracleParameters) => Promise<void>,
): void {
  const randomParameters = oracleRandomParameters(
    aliasOracleRuns,
    aliasOracleReplay,
    property,
  )
  oracleReplayTest(it)(`${title} [fixed]`, () =>
    check({ numRuns: aliasOracleRuns, seed: FIXED_ALIAS_ORACLE_SEED }),
  )
  oracleReplayTest(it, property)(`${title} [random]`, () =>
    check(randomParameters),
  )
}

const writeResultAliasesArbitrary = fc.uniqueArray(
  fc.constantFrom(...writeResultFieldNames),
  {
    minLength: 1,
    maxLength: writeResultFieldNames.length,
  },
)
const statementResultAliasesArbitrary = fc.uniqueArray(
  fc.constantFrom(...statementResultAliasNames),
  {
    minLength: 1,
    maxLength: statementResultAliasNames.length,
  },
)

function isLegalAliasSequence(
  aliases: ReadonlyArray<string>,
  allowedAliases: ReadonlyArray<string>,
): boolean {
  const allowed = new Set(allowedAliases)
  return (
    aliases.length >= 1 &&
    aliases.length <= allowedAliases.length &&
    new Set(aliases).size === aliases.length &&
    aliases.every((alias) => allowed.has(alias))
  )
}

function expectAliasGrammar<TAlias extends string>(
  arbitrary: fc.Arbitrary<Array<TAlias>>,
  allowedAliases: ReadonlyArray<TAlias>,
): void {
  // Singletons ablate every other alias. Full and reversed witnesses exercise
  // both length boundaries and order without changing the legal domain.
  const witnesses = [
    ...allowedAliases.map((alias) => [alias]),
    [...allowedAliases],
    [...allowedAliases].reverse(),
  ]
  const observed = new Set<string>()

  fc.assert(
    fc.property(arbitrary, (aliases) => {
      expect(isLegalAliasSequence(aliases, allowedAliases)).toBe(true)
      observed.add(JSON.stringify(aliases))
    }),
    {
      seed: FIXED_ALIAS_ORACLE_SEED,
      numRuns: 50,
      examples: witnesses.map((aliases) => [aliases]),
    },
  )

  witnesses.forEach((aliases) => {
    expect(observed).toContain(JSON.stringify(aliases))
  })
  expect(isLegalAliasSequence([], allowedAliases)).toBe(false)
  expect(
    isLegalAliasSequence(
      [allowedAliases[0]!, allowedAliases[0]!],
      allowedAliases,
    ),
  ).toBe(false)
  expect(isLegalAliasSequence([`not-an-op-sqlite-alias`], allowedAliases)).toBe(
    false,
  )
}

it(`controls alias grammar reconstruction, ablation, range, and exclusion`, () => {
  expectAliasGrammar(writeResultAliasesArbitrary, writeResultFieldNames)
  expectAliasGrammar(statementResultAliasesArbitrary, statementResultAliasNames)
})

registerAliasOracle(
  `op-sqlite.write-marker-aliases`,
  `preserves generated single-row write-marker aliases in direct row arrays`,
  async (parameters) => {
    await fc.assert(
      fc.asyncProperty(writeResultAliasesArbitrary, async (aliases) => {
        const row = Object.fromEntries(
          aliases.map((alias, index) => [alias, `${index}:${alias}`]),
        )
        const actual = await queryInjectedResult<Record<string, unknown>>([row])
        expectExactAliasRows(actual, [row])
      }),
      {
        ...parameters,
        ...(parameters.path === undefined
          ? { examples: [[[`rowsAffected`]], [[...writeResultFieldNames]]] }
          : { endOnFailure: true }),
      },
    )
  },
)

registerAliasOracle(
  `op-sqlite.result-carrier-equivalence`,
  `returns the same rows across equivalent documented result carriers`,
  async (parameters) => {
    await fc.assert(
      fc.asyncProperty(statementResultAliasesArbitrary, async (aliases) => {
        const { expected } = aliasQueryCase(aliases)
        const rawRows = expected.map((row) =>
          aliases.map((alias) => row[alias]),
        )
        const equivalentResults: ReadonlyArray<{
          result: unknown
          arrayResultMode?: `rows` | `statement-results`
        }> = [
          { result: expected, arrayResultMode: `rows` },
          { result: { rows: expected } },
          { result: { resultRows: expected } },
          {
            result: [{ rowsAffected: 0, rows: expected }],
            arrayResultMode: `statement-results`,
          },
          {
            result: {
              rowsAffected: 0,
              rows: expected,
              columnNames: aliases,
            },
          },
          { result: { rowsAffected: 0, rawRows, columnNames: aliases } },
          {
            result: {
              rowsAffected: 0,
              rows: expected,
              rawRows,
              columnNames: aliases,
            },
          },
          { result: { results: [{ rows: expected }] } },
        ]

        for (const { result, arrayResultMode } of equivalentResults) {
          const actual = await queryInjectedResult<Record<string, unknown>>(
            result,
            arrayResultMode,
          )
          expectExactAliasRows(actual, expected)
        }
      }),
      {
        ...parameters,
        ...(parameters.path === undefined
          ? {
              examples: [
                [[`rowsAffected`]],
                [[`rows`, `rawRows`, `columnNames`, `ordinary_name`]],
              ],
            }
          : { endOnFailure: true }),
      },
    )
  },
)

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

registerAliasOracle(
  `op-sqlite.columnar-sql-aliases`,
  `preserves generated legal SQL aliases through v14 columnar rows`,
  async (parameters) => {
    await withColumnarDriver(async ({ driver, queryExecutions }) => {
      await fc.assert(
        fc.asyncProperty(statementResultAliasesArbitrary, async (aliases) => {
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
        }),
        {
          ...parameters,
          ...(parameters.path === undefined
            ? { examples: [[[...statementResultFieldNames]]] }
            : { endOnFailure: true }),
        },
      )
    })
  },
)

// The reference rows for a SQL alias case come from the alias list alone: no
// production decoder runs here. Each row maps every alias to its own scalar.
declareOracle({
  model: [aliasQueryCase],
  grammar: [writeResultAliasesArbitrary, statementResultAliasesArbitrary],
})

const reservedAliasWrongAnswers = (() => {
  const aliases = [`rows`, `rowsAffected`, `ordinary_name`]
  const { expected } = aliasQueryCase(aliases)
  const first = expected[0]!
  const second = expected[1]!
  return [
    { name: `silently empty result`, actual: [] },
    {
      name: `missing reserved alias`,
      actual: [
        Object.fromEntries(
          Object.entries(first).filter(([alias]) => alias !== `rowsAffected`),
        ),
        second,
      ],
    },
    {
      name: `swapped reserved values`,
      actual: [
        { ...first, rows: first.rowsAffected, rowsAffected: first.rows },
        second,
      ],
    },
    { name: `duplicated first row`, actual: [first, first] },
  ]
})()

it.each(reservedAliasWrongAnswers)(
  `reserved-alias checker rejects wrong answer: $name`,
  ({ actual }) => {
    const { expected } = aliasQueryCase([
      `rows`,
      `rowsAffected`,
      `ordinary_name`,
    ])
    expect(() => expectExactAliasRows(actual, expected)).toThrow(
      `op-sqlite reserved-alias exact-row law violated`,
    )
  },
)

it(`reserved-alias checker accepts the independent reference rows`, () => {
  const { expected } = aliasQueryCase([`rows`, `rowsAffected`, `ordinary_name`])
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

runSQLiteDriverContractSuite(
  `op-sqlite executeAsync columnar driver`,
  createColumnarDriverHarness,
)
