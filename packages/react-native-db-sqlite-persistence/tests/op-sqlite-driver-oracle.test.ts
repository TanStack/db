import { afterEach, beforeEach } from 'vitest'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import {
  activeCleanupFns,
  createColumnarDriverHarness,
  createTempSqlitePath,
  queryInjectedResult,
  readAliasOracleRuns,
  runActiveCleanupFns,
  statementResultAliasNames,
  statementResultFieldNames,
  trackQueryExecutions,
  writeResultFieldNames,
} from './op-sqlite-driver-support'
import {
  QUERY_LAW,
  ROW_LAW,
  aliasQueryCase,
  aliasRowsObservation,
  checkAliasGrammar,
  checkAliasRows,
  statementResultAliasesArbitrary,
  writeResultAliasesArbitrary,
} from './op-sqlite-alias-oracle'
import type {
  Calibration,
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../db/tests/oracle-property.js'
import type { AliasRows, AliasRowsObservation } from './op-sqlite-alias-oracle'

afterEach(runActiveCleanupFns)

// One pair of read-only SQLite connections per registered test avoids creating
// a native connection for every history and calibration attempt. Each query
// still executes, and its own execution-count delta is recorded.
let columnar: ReturnType<typeof createColumnarDriverHarness> | undefined
let columnarExecutions: (() => number) | undefined
let directRows: ReturnType<typeof createOpSQLiteTestDatabase> | undefined
beforeEach(() => {
  columnar = undefined
  columnarExecutions = undefined
  directRows = undefined
})
// Closed SQLite statements retain only their JavaScript wrappers here. Keep
// those wrappers until the test worker ends: Node 24's addon cleanup-hook
// removal aborts when Vitest triggers their weak finalizers in its VM context.
const statementWrappers: Array<unknown> = []
function retainStatementWrappers(
  database: ReturnType<typeof createOpSQLiteTestDatabase>,
): void {
  const native = database.getNativeDatabase?.()
  if (!native) return
  const prepare = native.prepare.bind(native)
  native.prepare = ((...args: Parameters<typeof native.prepare>) => {
    const statement = prepare(...args)
    statementWrappers.push(statement)
    return statement
  }) as typeof native.prepare
}
function columnarDriver() {
  if (!columnar) {
    columnar = createColumnarDriverHarness((options) => {
      const database = createOpSQLiteTestDatabase(options)
      retainStatementWrappers(database)
      columnarExecutions = trackQueryExecutions(database)
      return database
    })
    activeCleanupFns.push(columnar.cleanup)
  }
  return { driver: columnar.driver, queryExecutions: columnarExecutions! }
}
function directRowDriver() {
  if (!directRows) {
    directRows = createOpSQLiteTestDatabase({
      filename: createTempSqlitePath(),
      resultShape: `rows-array`,
    })
    const database = directRows
    retainStatementWrappers(database)
    activeCleanupFns.push(() => Promise.resolve(database.close()))
  }
  return new OpSQLiteDriver({ database: directRows })
}

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
 * Reference/history grammar: `aliasQueryCase` in op-sqlite-alias-oracle.ts builds two ordered object rows
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
 * wrong answers challenge the same named-law check. Normal execution runs the same alias
 * properties and budgets in retained fixed-seed and seedless-random campaigns.
 * Copy the complete printed Replay: coordinates: TANSTACK_DB_ORACLE_SEED,
 * TANSTACK_DB_ORACLE_PATH, TANSTACK_DB_ORACLE_PROPERTY, and
 * TANSTACK_DB_ORACLE_UNIT select one exact generated-unit replay.
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

const FIXED_ALIAS_ORACLE_SEED = 165903
// oracleProperty scales the base run budget once. Ask the existing run-count
// reader for its base count so the default multiplier is not applied twice.
const aliasOracleRuns = readAliasOracleRuns(process.env, { scale: false })

type Aliases = Array<string>
type Expected = {
  observations: ReadonlyArray<Observation>
  requiredStates: ReadonlyArray<string>
}
// The pinned framework remembers only seeded constructor outputs. This map
// records every fresh alias-array construction, including generated/shrunk ones.
// It stores promised states; query settlement supplies the actual observations.
const constructionStates = new WeakMap<Aliases, ReadonlyArray<string>>()
function constructedAliases(
  aliases: Aliases,
  states: ReadonlyArray<string>,
): Aliases {
  constructionStates.set(aliases, states)
  return aliases
}
function expectedAliases(
  aliases: Aliases,
  observations: ReadonlyArray<Observation>,
): Expected {
  return { observations, requiredStates: constructionStates.get(aliases) ?? [] }
}
const constructionReachCalibration: Calibration<Aliases, Aliases> = {
  name: `omits constructed-state observations`,
  law: `constructed reach`,
  corrupt: (trace, aliases) =>
    constructionStates.has(aliases)
      ? trace.filter(({ checkpoint }) => checkpoint !== `reach`)
      : undefined,
}
const law = {
  statement: `SQLite query preserves every alias, row, value, key order, and row order across documented object and columnar result carriers, including rows made only of write marker aliases.`,
  authority: `SQLiteDriver.query contract; published OP-SQLite rows and rawRows/columnNames result envelopes; the explicit bare-array result mode contract.`,
  limits: `Controlled object-envelope results and a real better-sqlite3 shim for columnar and direct-row SQL results; unique aliases from the declared bounded field-name lists and two asymmetric scalar rows. Frozen provider receipts and device/JSI/worker delivery remain separate receiving evidence. Malformed envelopes and transactions remain in the ordinary driver suite.`,
}

// The exact keys are observed separately: the framework's data comparison
// ignores insertion order of object keys, while the existing alias law owes it.
function recordRows(
  observe: (checkpoint: string, value: unknown) => void,
  checkpoint: string,
  rows: AliasRows,
): void {
  observe(checkpoint, aliasRowsObservation(rows))
}

function judge(
  aliases: Aliases,
  trace: ReadonlyArray<Observation>,
  expected: Expected,
  kind: `write` | `statement`,
): Verdict {
  const grammar =
    kind === `write`
      ? checkAliasGrammar(
          aliases,
          writeResultAliasesArbitrary,
          writeResultFieldNames,
        )
      : checkAliasGrammar(
          aliases,
          statementResultAliasesArbitrary,
          statementResultAliasNames,
        )
  if (grammar.kind === `violation`) return grammar
  const recorded = trace.filter((entry) => entry.checkpoint !== `reach`)
  for (const [index, wanted] of expected.observations.entries()) {
    const actual = recorded[index]
    if (actual?.checkpoint !== wanted.checkpoint) {
      return violation(
        wanted.checkpoint,
        `the promised query observation is missing or reordered`,
        ROW_LAW,
        { actual, expected: wanted },
      )
    }
    const verdict = wanted.checkpoint.endsWith(`query count`)
      ? (differs(wanted.checkpoint, QUERY_LAW, actual.value, wanted.value) ??
        pass)
      : checkAliasRows(
          wanted.checkpoint,
          actual.value,
          wanted.value as AliasRowsObservation,
        )
    if (verdict.kind === `violation`) return verdict
  }
  const unexpected = differs(
    `query settled`,
    ROW_LAW,
    recorded.length,
    expected.observations.length,
    `each query records exactly one result and, where promised, one execution count`,
  )
  if (unexpected) return unexpected
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  for (const state of expected.requiredStates)
    if (!reached.has(state))
      return violation(
        `query settled`,
        `the constructed aliases did not enter ${state}`,
        `constructed reach`,
      )
  return pass
}

// Each construction keeps the generated aliases and forces one named alias.
// Retained fixed singletons also prevent another alias from supplying a
// redundant carrier signal. Required class reach keeps the other aliases random.
function aliasConstructions(
  allowed: ReadonlyArray<string>,
): Array<ConstructedHistory<Aliases>> {
  return allowed.map((alias) => ({
    name: `includes alias ${alias}`,
    enters: [`alias:${alias}`],
    build: (generated) =>
      constructedAliases(
        [alias, ...generated.filter((other) => other !== alias)],
        [`alias:${alias}`],
      ),
  }))
}
function recordAliasReach(
  aliases: Aliases,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  for (const alias of aliases) observe(`reach`, `alias:${alias}`)
}
function fixedAliases(allowed: ReadonlyArray<string>) {
  return [
    ...allowed.map((alias) => [alias]),
    [...allowed],
    [...allowed].reverse(),
  ].map((history, index) => ({
    name: `retained grammar witness ${index}: ${history.join(`, `)}`,
    history,
  }))
}

// Mutants corrupt a captured result; every calibration uses the same check as
// both campaigns, fixed histories, and receiving SQL paths.
function corruptRows(
  change: (rows: AliasRows) => AliasRows | undefined,
): (
  trace: ReadonlyArray<Observation>,
  plan: Aliases,
) => ReadonlyArray<Observation> | undefined {
  return (trace) => {
    for (const [index, entry] of trace.entries()) {
      if (
        entry.checkpoint === `reach` ||
        entry.checkpoint.endsWith(`query count`)
      )
        continue
      const rows = change(
        (entry.value as AliasRowsObservation).rows as AliasRows,
      )
      if (rows === undefined) continue
      return trace.map((value, at) =>
        at === index ? { ...entry, value: aliasRowsObservation(rows) } : value,
      )
    }
    return undefined
  }
}
const calibrations: Array<Calibration<Aliases, Aliases>> = [
  {
    name: `silently empty result`,
    law: ROW_LAW,
    corrupt: corruptRows(() => []),
  },
  {
    name: `missing reserved alias`,
    law: ROW_LAW,
    corrupt: corruptRows((rows) => {
      const first = rows[0]
      if (!first || !Object.hasOwn(first, `rowsAffected`)) return undefined
      return [
        Object.fromEntries(
          Object.entries(first).filter(([alias]) => alias !== `rowsAffected`),
        ),
        ...rows.slice(1),
      ]
    }),
  },
  {
    name: `swapped reserved values`,
    law: ROW_LAW,
    corrupt: corruptRows((rows) => {
      const first = rows[0]
      if (
        !first ||
        !Object.hasOwn(first, `rows`) ||
        !Object.hasOwn(first, `rowsAffected`)
      )
        return undefined
      return [
        { ...first, rows: first.rowsAffected, rowsAffected: first.rows },
        ...rows.slice(1),
      ]
    }),
  },
  {
    name: `duplicated first row`,
    law: ROW_LAW,
    corrupt: corruptRows((rows) =>
      rows.length < 2 ? undefined : [rows[0]!, rows[0]!, ...rows.slice(2)],
    ),
  },
  {
    name: `reversed rows`,
    law: ROW_LAW,
    corrupt: corruptRows((rows) =>
      rows.length < 2 ? undefined : [...rows].reverse(),
    ),
  },
]

oracleProperty<Aliases, Expected>({
  id: `op-sqlite.write-marker-aliases`,
  law,
  owns: [`src/op-sqlite-driver.ts`],
  histories: {
    arbitrary: writeResultAliasesArbitrary,
    runs: aliasOracleRuns,
    fixedSeeds: [FIXED_ALIAS_ORACLE_SEED],
    states: writeResultFieldNames.map((alias) => `alias:${alias}`),
    constructed: aliasConstructions(writeResultFieldNames),
    fixed: fixedAliases(writeResultFieldNames),
  },
  model: (aliases) =>
    expectedAliases(aliases, [
      {
        checkpoint: `direct rows`,
        value: aliasRowsObservation([
          Object.fromEntries(
            aliases.map((alias, index) => [alias, `${index}:${alias}`]),
          ),
        ]),
      },
    ]),
  driver: async (aliases, observe) => {
    const row = Object.fromEntries(
      aliases.map((alias, index) => [alias, `${index}:${alias}`]),
    )
    const actual = await queryInjectedResult<Record<string, unknown>>([row])
    recordRows(observe, `direct rows`, actual)
    recordAliasReach(aliases, observe)
  },
  check: (aliases, trace, expected) => judge(aliases, trace, expected, `write`),
  calibrations: [
    ...calibrations.filter(
      (calibration) =>
        calibration.name === `silently empty result` ||
        calibration.name === `missing reserved alias`,
    ),
    constructionReachCalibration,
  ],
})

const carriers = [
  `direct rows`,
  `rows`,
  `resultRows`,
  `statement results`,
  `rows and columns`,
  `raw rows`,
  `rows and raw rows`,
  `nested results`,
] as const
function equivalentResults(aliases: Aliases): ReadonlyArray<{
  result: unknown
  arrayResultMode?: `rows` | `statement-results`
}> {
  const { expected } = aliasQueryCase(aliases)
  const rawRows = expected.map((row) => aliases.map((alias) => row[alias]))
  return [
    { result: expected, arrayResultMode: `rows` },
    { result: { rows: expected } },
    { result: { resultRows: expected } },
    {
      result: [{ rowsAffected: 0, rows: expected }],
      arrayResultMode: `statement-results`,
    },
    { result: { rowsAffected: 0, rows: expected, columnNames: aliases } },
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
}
oracleProperty<Aliases, Expected>({
  id: `op-sqlite.result-carrier-equivalence`,
  law,
  owns: [`src/op-sqlite-driver.ts`],
  histories: {
    arbitrary: statementResultAliasesArbitrary,
    runs: aliasOracleRuns,
    fixedSeeds: [FIXED_ALIAS_ORACLE_SEED],
    states: [
      ...statementResultAliasNames.map((alias) => `alias:${alias}`),
      ...carriers.map((carrier) => `carrier:${carrier}`),
    ],
    constructed: [
      ...aliasConstructions(statementResultAliasNames),
      {
        name: `all documented carriers`,
        enters: carriers.map((carrier) => `carrier:${carrier}`),
        build: (generated) =>
          constructedAliases(
            [...generated],
            carriers.map((carrier) => `carrier:${carrier}`),
          ),
      },
    ],
    fixed: [
      ...fixedAliases(statementResultAliasNames),
      {
        name: `retained overlapping carrier aliases`,
        history: [`rows`, `rawRows`, `columnNames`, `ordinary_name`],
      },
    ],
  },
  model: (aliases) =>
    expectedAliases(
      aliases,
      carriers.map((checkpoint) => ({
        checkpoint,
        value: aliasRowsObservation(aliasQueryCase(aliases).expected),
      })),
    ),
  driver: async (aliases, observe) => {
    for (const [index, { result, arrayResultMode }] of equivalentResults(
      aliases,
    ).entries()) {
      const actual = await queryInjectedResult<Record<string, unknown>>(
        result,
        arrayResultMode,
      )
      recordRows(observe, carriers[index]!, actual)
      observe(`reach`, `carrier:${carriers[index]!}`)
    }
    recordAliasReach(aliases, observe)
  },
  check: (aliases, trace, expected) =>
    judge(aliases, trace, expected, `statement`),
  calibrations: [...calibrations, constructionReachCalibration],
})

// Both retained SQL witnesses share the reference and exact comparison. The
// columnar path counts the SELECT even when query rejects. The direct-row path
// still runs the real SQLite shim, rather than only an injected row envelope.
oracleProperty<Aliases, Expected>({
  id: `op-sqlite.columnar-sql-aliases`,
  law,
  owns: [`src/op-sqlite-driver.ts`],
  histories: {
    arbitrary: statementResultAliasesArbitrary,
    runs: aliasOracleRuns,
    fixedSeeds: [FIXED_ALIAS_ORACLE_SEED],
    states: [
      ...statementResultAliasNames.map((alias) => `alias:${alias}`),
      `SQL columnar`,
      `SQL direct rows`,
    ],
    constructed: [
      ...aliasConstructions(statementResultAliasNames),
      {
        name: `both SQLite result paths`,
        enters: [`SQL columnar`, `SQL direct rows`],
        build: (generated) =>
          constructedAliases(
            [...generated],
            [`SQL columnar`, `SQL direct rows`],
          ),
      },
    ],
    fixed: [
      ...fixedAliases(statementResultAliasNames),
      {
        name: `retained every statement-result field through SQL`,
        history: [...statementResultFieldNames],
      },
    ],
  },
  model: (aliases) =>
    expectedAliases(aliases, [
      { checkpoint: `columnar query count`, value: 1 },
      {
        checkpoint: `columnar rows`,
        value: aliasRowsObservation(aliasQueryCase(aliases).expected),
      },
      {
        checkpoint: `direct rows rows`,
        value: aliasRowsObservation(aliasQueryCase(aliases).expected),
      },
    ]),
  driver: async (aliases, observe) => {
    const { sql, params } = aliasQueryCase(aliases)
    const { driver, queryExecutions } = columnarDriver()
    const before = queryExecutions()
    let actual: AliasRows
    try {
      actual = await driver.query<Record<string, unknown>>(sql, params)
    } finally {
      observe(`columnar query count`, queryExecutions() - before)
    }
    recordRows(observe, `columnar rows`, actual)
    observe(`reach`, `SQL columnar`)
    const direct = await directRowDriver().query<Record<string, unknown>>(
      sql,
      params,
    )
    recordRows(observe, `direct rows rows`, direct)
    observe(`reach`, `SQL direct rows`)
    recordAliasReach(aliases, observe)
  },
  check: (aliases, trace, expected) =>
    judge(aliases, trace, expected, `statement`),
  calibrations: [...calibrations, constructionReachCalibration],
})
