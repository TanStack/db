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
 * comparisons with tagged values, null, missing, and text controls. Fixed
 * filters include safe-integer equality on a top-level field, whose candidate
 * also admits a Date's ISO text. The number-equality property below generates
 * that law: its own section states the grammar. Fractional and nested
 * numeric equality, lower-wrapped BigInt IN, lone-surrogate coalesce, Date
 * ranges, strftime, and add keep full reads where SQLite could exclude a
 * JavaScript match.
 * Integer threshold checks include adjacent fractional values.
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
 * Fixed scenarios whose expectations are literal, the replay-configuration and
 * plan-classifier self-tests, and the cleanup self-test are ordinary unit tests in
 * expression-index.test.ts, with the observer in expression-index-support.ts.
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
 * Copy the complete printed Replay: coordinates for a generated path, including
 * TANSTACK_DB_ORACLE_UNIT. A path replay sets TANSTACK_DB_ORACLE_PATH, TANSTACK_DB_ORACLE_SEED, and
 * TANSTACK_DB_ORACLE_PROPERTY to one of sqlite-persistence.expression-index,
 * sqlite-persistence.bigint-roundtrip, or sqlite-persistence.bigint-rejection.
 * That property's random campaign replays only its recorded history; the fixed
 * campaigns and the other properties stand aside. A seed alone reseeds the
 * random campaigns. A matrix that lacks an axis fails every history's grammar
 * check (assertGeneratedScenarioGrammar, run by the driver); a per-axis
 * grammar calibration ablates each axis from the fixed matrix and requires
 * that check to name it. The grammar and its check live in
 * expression-index-grammar-oracle.ts, and their calibrations, which run no
 * production, in expression-index-grammar.test.ts. Each axis's plausible wrong SQL answer is a native
 * calibration that the unchanged comparison must reject at that axis: the
 * check names the compared axis in the law (`sqlite-persistence.expression-index:
 * <kind> axis`). Seed, run and path configuration, and the shrinking
 * and same-path replay of a failure, belong to the @tanstack/oracles
 * self-oracle, which owns those laws for every oracleProperty. The
 * retained fixed campaign reconstructs the known valid matrix. The bounds
 * above state its range; exact grammar checks reject missing, duplicate, and
 * unexpected axes as nearby invalid matrices. The focused overbroad and former
 * path-binding controls remain independent. In-memory SQLite teardown
 * retains the semantic failure if cleanup also fails.
 *
 * Native registration retains the data tuple before resolving its IR objects.
 * The existing independent helpers and their authored comparison cuts remain
 * unchanged; the assertion adapter passes their judgment to oracleProperty.
 * Product campaigns use the native fixed/random/replay runner, and the SQL
 * wrong answers are its calibrations. The raw fast-check controls that once
 * checked SQL-fault shrinking, same-path replay and seed/run/path
 * configuration are gone: the framework's self-oracle enforces them. Grammar
 * ablation stays as a grammar calibration without fast-check campaigns.
 */
import fc from 'fast-check'
import { describe, expect, vi } from 'vitest'
import { IR } from '@tanstack/db'
import {
  createPersistedTableName,
  createSQLiteCorePersistenceAdapter,
  decodePersistedStorageKey,
} from '@tanstack/db-sqlite-persistence-core'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import {
  Temporal,
  temporalFamilies,
  temporalQueryCases,
  temporalValue,
} from '../../db-sqlite-persistence-core/tests/temporal-value-oracle'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import {
  SQLITE_BIGINT_MAX,
  SQLITE_BIGINT_MIN,
  bigintRangeError,
  createNestedRow,
  createQueryObservingDriver,
  observeExpressionIndexScenario,
  planScansTable,
  planUsesNamedIndex,
  planUsesNamedIndexForOrdering,
  readPath,
  sqliteJsonPath,
  sqliteScalarParameter,
  withFailurePreservingCleanup,
} from './expression-index-support'
import {
  DEFAULT_ORACLE_SEED,
  GENERATED_SCENARIO_FAULTS,
  GENERATED_SCENARIO_KINDS,
  assertGeneratedScenarioGrammar,
  generatedScenarioMatrixArbitrary,
  resolveGeneratedScenarioMatrix,
} from './expression-index-grammar-oracle'
import type {
  GeneratedExpressionIndexScenario,
  GeneratedScenarioKind,
} from './expression-index-grammar-oracle'
import type { Observation, Verdict } from '../../db/tests/oracle-config.js'
import type { TemporalFamily } from '../../db-sqlite-persistence-core/tests/temporal-value-oracle'
import type {
  CapturedQuery,
  ExpressionIndexObservation,
  OracleScalar,
  QueryPlanRow,
  QueryTransform,
  ScanRow,
} from './expression-index-support'

const DEFAULT_ORACLE_RUNS = 8

type OracleCase = {
  path: Array<string>
  target: OracleScalar
  distractors: [OracleScalar, OracleScalar]
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

  oracleAssertion(diagnostic, () =>
    expect(observation.adapterKeys, diagnostic).toEqual(scenario.expectedKeys),
  )
  oracleAssertion(diagnostic, () =>
    expect(observation.directSqlKeys, diagnostic).toEqual(
      scenario.expectedKeys,
    ),
  )
  if (scenario.expectedPlan === `ordered-scan`) {
    oracleAssertion(diagnostic, () =>
      expect(
        planUsesNamedIndexForOrdering(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
        diagnostic,
      ).toBe(true),
    )
  } else {
    oracleAssertion(diagnostic, () =>
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
        diagnostic,
      ).toBe(true),
    )
    oracleAssertion(diagnostic, () =>
      expect(
        planScansTable(observation.plan, observation.tableName),
        diagnostic,
      ).toBe(false),
    )
  }
}

// Each original matrix contains every scenario kind. Retain its exact query
// comparisons and record the existing all-kinds reach check for each matrix.
// A calibration names `faultKind`: that axis's SQL is replaced by its plausible
// wrong answer (GENERATED_SCENARIO_FAULTS) before the driver executes it.
async function runGeneratedScenarioMatrix(
  matrix: Array<GeneratedExpressionIndexScenario>,
  observe: (checkpoint: string, value: unknown) => void,
  faultKind?: GeneratedScenarioKind,
) {
  const reachedScenarios = new Set<GeneratedScenarioKind>()
  assertGeneratedScenarioGrammar(matrix)
  for (const scenario of matrix) {
    reachedScenarios.add(scenario.kind)
    const observation = await observeExpressionIndexScenario({
      ...scenario,
      ...(faultKind === scenario.kind
        ? { transformQuery: mutateGeneratedScenarioQuery(scenario.kind) }
        : {}),
    })
    assertGeneratedScenarioObservation(scenario, observation)
    observe(`reach`, scenario.kind)
  }
  oracleAssertion(
    `expect([...reachedScenarios].sort()).toEqual([...GENERATED_SCENARIO_KINDS].sort())`,
    () =>
      expect([...reachedScenarios].sort()).toEqual(
        [...GENERATED_SCENARIO_KINDS].sort(),
      ),
  )
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
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      {
        txId: `seed-${label}`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: seededRows.map((row) => ({
          type: `insert` as const,
          key: row.key,
          value: row.value,
        })),
      },
    )

    await adapter.ensureIndex(
      { kind: `eager`, collectionId: collectionId },
      signature,
      {
        expressionSql: [JSON.stringify({ type: `ref`, path: testCase.path })],
      },
    )

    if (!adapter.scanRows) {
      throw new Error(`real SQLite adapter did not expose scanRows`)
    }
    const scannedRows = await adapter.scanRows({
      kind: `eager`,
      collectionId: collectionId,
    })
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

    oracleAssertion(
      `full-scan checkpoint must retain independently seeded values`,
      () =>
        expect(
          expectedKeys,
          `full-scan checkpoint must retain independently seeded values`,
        ).toEqual(independentlySeededExpectedKeys),
    )
    oracleAssertion(`expect(scannedRows).toHaveLength(seededRows.length)`, () =>
      expect(scannedRows).toHaveLength(seededRows.length),
    )

    const indexedRows = await adapter.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {
        where: new IR.Func(`eq`, [
          new IR.PropRef(testCase.path),
          new IR.Value(testCase.target),
        ]),
      },
    )
    const indexedKeys = indexedRows.map((row) => String(row.key)).sort()

    oracleAssertion(
      `indexed adapter results must equal the independent scan model`,
      () =>
        expect(
          indexedKeys,
          `indexed adapter results must equal the independent scan model`,
        ).toEqual(expectedKeys),
    )

    if (!predicateQuery) {
      throw new Error(`predicate query checkpoint was not reached`)
    }
    const predicateParams = predicateQuery.params
    oracleAssertion(`the filter value must remain a bound parameter`, () =>
      expect(
        predicateParams,
        `the filter value must remain a bound parameter`,
      ).toContain(sqliteScalarParameter(testCase.target)),
    )

    const directSqlKeys = (
      baseDriver
        .getDatabase()
        .prepare(predicateQuery.sql)
        .all(...predicateQuery.params) as Array<{ key: string }>
    )
      .map((row) => String(decodePersistedStorageKey(row.key)))
      .sort()
    oracleAssertion(
      `captured SQL must produce the independent keys before in-memory filtering`,
      () =>
        expect(
          directSqlKeys,
          `captured SQL must produce the independent keys before in-memory filtering`,
        ).toEqual(expectedKeys),
    )

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

    oracleAssertion(checkpointMessage, () =>
      expect(checkpoint.usedNamedExpressionIndex, checkpointMessage).toBe(true),
    )
    oracleAssertion(checkpointMessage, () =>
      expect(checkpoint.scannedCollectionTable, checkpointMessage).toBe(false),
    )
  }, [() => baseDriver.close()])
}

// Pure JavaScript comparisons state which public rows satisfy a Number or
// BigInt range predicate. The model is independent of SQLite and of the
// adapter, so the SQL candidate set is judged against these keys.
function expectedRangeKeys(
  rows: ReadonlyArray<{ key: string; value: { n: number | bigint } }>,
  operator: `gt` | `gte` | `lt` | `lte`,
  fieldOnLeft: boolean,
  bound: bigint,
): Array<string> {
  const matches = (
    op: `gt` | `gte` | `lt` | `lte`,
    left: number | bigint,
    right: number | bigint,
  ): boolean => {
    switch (op) {
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
  return rows
    .filter(({ value }) =>
      fieldOnLeft
        ? matches(operator, value.n, bound)
        : matches(operator, bound, value.n),
    )
    .map(({ key }) => key)
    .sort()
}

// Fixture ranks give the semantic order of native values, and their kind and
// canonical text give equality. Null and missing stamps match no ordering
// predicate. This model is independent of SQLite, so SQL may keep extra
// candidates that the row evaluator then removes.
function expectedNativePolarityKeys(
  family: TemporalFamily,
  nullableRows: ReadonlyArray<{ key: string }>,
  operator: `gt` | `gte` | `lt` | `lte`,
  reverse: boolean,
  negate: boolean,
): Array<string> {
  return nullableRows
    .flatMap((row) => {
      if (row.key === `null` || row.key === `missing`) return []
      const rank =
        row.key === `nan` ? Infinity : family.ranks[Number(row.key.slice(4))]!
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
}

// A generated-matrix comparison names its scenario's axis in its checkpoint
// (the diagnostic JSON's `kind`). The check carries that axis into the law,
// so a violation, and each wrong-answer calibration, names the faulted axis.
const generatedMatrixLaw = `sqlite-persistence.expression-index`
const generatedAxisLaw = (kind: GeneratedScenarioKind) =>
  `${generatedMatrixLaw}: ${kind} axis`
function comparedAxis(checkpoint: string): GeneratedScenarioKind | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(checkpoint)
  } catch {
    return undefined
  }
  const kind =
    typeof parsed === `object` && parsed !== null && `kind` in parsed
      ? parsed.kind
      : undefined
  return GENERATED_SCENARIO_KINDS.find((axis) => axis === kind)
}
function checkGeneratedMatrix(
  plan: unknown,
  trace: ReadonlyArray<Observation>,
  judgment: Verdict,
): Verdict {
  const verdict = forwardAssertionJudgment(plan, trace, judgment)
  if (verdict.kind !== `violation`) return verdict
  const axis = comparedAxis(verdict.checkpoint)
  return axis === undefined
    ? verdict
    : { ...verdict, law: generatedAxisLaw(axis) }
}

describe(`SQLite expression-index oracle`, () => {
  oracleProperty({
    id: `sqlite-persistence.expression-index.large-number`,
    law: {
      statement: `SQLite candidates retain JavaScript Number/BigInt range matches across operand directions and unary wrappers, with named-index use on the existing selective orientation.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
    owns: [`src/node-driver.ts`],
    histories: [{ name: `large Number range directions and wrappers` }],

    driver: (plan, observe) =>
      recordAssertionJudgment(
        `sqlite-persistence.expression-index.large-number`,
        plan,
        observe,
        () =>
          (async () => {
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
                  const expectedKeys = expectedRangeKeys(
                    rows,
                    operator,
                    fieldOnLeft,
                    testCase.bound,
                  )
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
                    oracleAssertion(
                      `expect(observation.adapterKeys).toEqual(expectedKeys)`,
                      () =>
                        expect(observation.adapterKeys).toEqual(expectedKeys),
                    )
                    oracleAssertion(
                      `expect(observation.directSqlKeys).toEqual( expect.arrayContaining(expectedKeys), )`,
                      () =>
                        expect(observation.directSqlKeys).toEqual(
                          expect.arrayContaining(expectedKeys),
                        ),
                    )
                    const greaterSide = fieldOnLeft
                      ? operator === `gt` || operator === `gte`
                      : operator === `lt` || operator === `lte`
                    if (greaterSide) {
                      oracleAssertion(
                        `${testCase.name}-${operator}-${fieldOnLeft}-${wrapper}: ${observation.plan.map((row) => row.detail).join(`; `)}`,
                        () =>
                          expect(
                            planUsesNamedIndex(
                              observation.plan,
                              observation.tableName,
                              observation.indexName,
                            ),
                            `${testCase.name}-${operator}-${fieldOnLeft}-${wrapper}: ${observation.plan.map((row) => row.detail).join(`; `)}`,
                          ).toBe(true),
                      )
                    }
                  }
                }
              }
            }
          })(),
      ),
    model: recordedAssertionJudgment,
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `sqlite-persistence.bigint-roundtrip`,
    law: {
      statement: `Signed-64-bit BigInts round-trip through the real adapter and equality reads preserve their exact stored value and matching key.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
    owns: [`src/node-driver.ts`],
    histories: {
      arbitrary: fc.bigInt({ min: SQLITE_BIGINT_MIN, max: SQLITE_BIGINT_MAX }),
      runs: DEFAULT_ORACLE_RUNS,
      fixedSeeds: [DEFAULT_ORACLE_SEED],
    },
    resolve: (value) => ({ value }),

    driver: (plan, observe) =>
      recordAssertionJudgment(
        `sqlite-persistence.bigint-roundtrip`,
        plan,
        observe,
        () =>
          (async () => {
            const { value } = plan
            const driver = new BetterSqlite3SQLiteDriver({
              filename: `:memory:`,
            })
            const adapter = createSQLiteCorePersistenceAdapter({ driver })
            const collectionId = `generated-bigint-in-range`

            await withFailurePreservingCleanup(async () => {
              await adapter.applyCommittedTx(
                { kind: `eager`, collectionId: collectionId },
                {
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
                },
              )

              const rows = await adapter.loadSubset(
                { kind: `eager`, collectionId: collectionId },
                {
                  where: new IR.Func(`eq`, [
                    new IR.PropRef([`nested`, `count`]),
                    new IR.Value(value),
                  ]),
                },
              )
              oracleAssertion(
                `expect(rows.map((row) => row.key)).toEqual(['match'])`,
                () => expect(rows.map((row) => row.key)).toEqual([`match`]),
              )
              oracleAssertion(
                `expect(rows[0]?.value).toEqual({ nested: { count: value } })`,
                () =>
                  expect(rows[0]?.value).toEqual({ nested: { count: value } }),
              )
            }, [() => driver.close()])
          })(),
      ),
    model: recordedAssertionJudgment,
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `sqlite-persistence.bigint-rejection`,
    law: {
      statement: `BigInts immediately outside the signed SQLite integer range reject with the documented range error.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
    owns: [`src/node-driver.ts`],
    histories: {
      arbitrary: fc.oneof(
        fc
          .bigInt({ min: 1n, max: 1_000n })
          .map((distance) => SQLITE_BIGINT_MIN - distance),
        fc
          .bigInt({ min: 1n, max: 1_000n })
          .map((distance) => SQLITE_BIGINT_MAX + distance),
      ),
      runs: DEFAULT_ORACLE_RUNS,
      fixedSeeds: [DEFAULT_ORACLE_SEED],
    },
    resolve: (value) => ({ value }),

    driver: (plan, observe) =>
      recordAssertionJudgment(
        `sqlite-persistence.bigint-rejection`,
        plan,
        observe,
        () =>
          (async () => {
            const { value } = plan
            const driver = new BetterSqlite3SQLiteDriver({
              filename: `:memory:`,
            })
            const adapter = createSQLiteCorePersistenceAdapter({ driver })

            await withFailurePreservingCleanup(async () => {
              await oracleAssertion(
                `expect( adapter.applyCommittedTx( { kind: 'eager', collectionId: 'generated-bigint-out-of-range', },`,
                () =>
                  expect(
                    adapter.applyCommittedTx(
                      {
                        kind: `eager`,
                        collectionId: `generated-bigint-out-of-range`,
                      },
                      {
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
                      },
                    ),
                  ).rejects.toThrow(bigintRangeError(value)),
              )
            }, [() => driver.close()])
          })(),
      ),
    model: recordedAssertionJudgment,
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `sqlite-persistence.expression-index.fixed-filter`,
    law: {
      statement: `Indexed equality agrees with the independent full-scan model, binds the filter value, and uses the matching named expression index.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
    owns: [`src/node-driver.ts`],
    histories: [
      {
        path: [`threadId`],
        target: `thread-'1`,
        distractors: [`thread-2`, `thread-3`],
      } satisfies OracleCase,
      {
        path: [`priority`],
        target: 7,
        distractors: [8, 70],
      } satisfies OracleCase,
    ],

    driver: (plan: OracleCase, observe) =>
      recordAssertionJudgment(
        `sqlite-persistence.expression-index.fixed-filter`,
        plan,
        observe,
        () => assertExpressionIndexHistory(plan, `fixed-thread-filter`),
      ),
    model: recordedAssertionJudgment,
    check: forwardAssertionJudgment,
  })

  /**
   * Safe-integer equality and membership on an indexed top-level field.
   *
   * Law: the row evaluator equates a Date with its epoch milliseconds and any
   * other value only with an identical one, while SQLite stores a Date as its
   * ISO text. An `eq` or `in` of safe integers on an indexed top-level field
   * returns the rows that the evaluator keeps, its SQL candidate holds exactly
   * those rows, and SQLite answers it by a search of the named expression
   * index. A nested ref keeps a full read, because it can read a JavaScript
   * property that the stored JSON lacks, such as an array's `length`; the
   * core ordered-page oracle owns that law.
   *
   * Model: `numberMatches` walks each stored row's path with `readPath` and
   * applies that equality. It does not call the SQL compiler or the
   * evaluator.
   *
   * Grammar: a top-level field named by an identifier, a target in
   * -10,000..10,000, `eq` or `in` (the target and the
   * target plus two), and a target stored as a number, a Date, or both. Every
   * history also stores the target plus one as a number and a Date, the
   * target plus two, and the target as text, which neither law nor candidate
   * may keep. Declared states: a Date equals an `eq` literal, and a Date equals
   * an `in` literal. One constructed history per state sets the operator and
   * stores a Date at the target, keeping the generated field, target and
   * whether the number is stored too.
   *
   * Driver and checkpoint: the real adapter over BetterSqlite3 captures the
   * Collection SELECT, runs its SQL and bindings directly, and explains its
   * plan, at `loadSubset` return.
   *
   * Calibration: a driver that binds the number in place of the Date's ISO
   * text loses the Date match, and trace mutants drop it from the candidate,
   * scan the table, or omit a constructed state.
   */
  type NumberEqualityHistory = {
    root: string
    target: number
    operator: `eq` | `in`
    stored: `number` | `date` | `both`
  }
  type NumberEqualityPlan = {
    history: NumberEqualityHistory
    path: Array<string>
    literals: Array<number>
    rows: Array<{ key: string; value: Record<string, unknown> }>
    requiredStates: ReadonlyArray<string>
  }
  type NumberEqualityRead = {
    adapterKeys: Array<string>
    directSqlKeys: Array<string>
    searchesNamedIndex: boolean
    scansTable: boolean
  }
  const numberEqualityStates = [
    `a Date equals an eq literal`,
    `a Date equals an in literal`,
  ]
  const numberConstructionStates = new WeakMap<
    NumberEqualityHistory,
    ReadonlyArray<string>
  >()
  const numberEqualityArbitrary: fc.Arbitrary<NumberEqualityHistory> =
    fc.record({
      root: fc.constantFrom(`a`, `meta`, `priority`, `t0`, `xb1`),
      target: fc.integer({ min: -10_000, max: 10_000 }),
      operator: fc.constantFrom(`eq` as const, `in` as const),
      stored: fc.constantFrom(
        `number` as const,
        `date` as const,
        `both` as const,
      ),
    })

  function resolveNumberEquality(
    history: NumberEqualityHistory,
  ): NumberEqualityPlan {
    const path = [history.root]
    const { target } = history
    const stored: Array<[string, unknown]> = [
      ...(history.stored === `date`
        ? []
        : [[`number-target`, target] as [string, unknown]]),
      ...(history.stored === `number`
        ? []
        : [[`date-target`, new Date(target)] as [string, unknown]]),
      [`number-next`, target + 1],
      [`date-next`, new Date(target + 1)],
      [`number-second`, target + 2],
      [`text-target`, String(target)],
    ]
    return {
      history,
      path,
      literals: history.operator === `eq` ? [target] : [target, target + 2],
      rows: stored.map(([key, value]) => ({
        key,
        value: createNestedRow(path, value as OracleScalar),
      })),
      requiredStates: numberConstructionStates.get(history) ?? [],
    }
  }

  function numberMatches(plan: NumberEqualityPlan): Array<string> {
    return plan.rows
      .filter((row) => {
        const value = readPath(row.value, plan.path)
        return plan.literals.some((literal) =>
          value instanceof Date
            ? value.getTime() === literal
            : value === literal,
        )
      })
      .map((row) => row.key)
      .sort()
  }

  const numberEqualityStatesOf = (plan: NumberEqualityPlan) =>
    numberMatches(plan).some((key) => key.startsWith(`date-`))
      ? [`a Date equals an ${plan.history.operator} literal`]
      : []

  async function driveNumberEquality(
    plan: NumberEqualityPlan,
    observe: (checkpoint: string, value: unknown) => void,
    transformQuery?: QueryTransform,
  ) {
    const field = new IR.PropRef(plan.path)
    const observation = await observeExpressionIndexScenario({
      label: `number-${plan.history.operator}`,
      indexExpression: field,
      where:
        plan.history.operator === `eq`
          ? new IR.Func<boolean>(`eq`, [field, new IR.Value(plan.literals[0])])
          : new IR.Func<boolean>(`in`, [field, new IR.Value(plan.literals)]),
      rows: plan.rows,
      transformQuery,
    })
    observe(`loadSubset`, {
      adapterKeys: [...observation.adapterKeys].sort(),
      directSqlKeys: [...observation.directSqlKeys].sort(),
      searchesNamedIndex: planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
      scansTable: planScansTable(observation.plan, observation.tableName),
    } satisfies NumberEqualityRead)
    for (const state of numberEqualityStatesOf(plan)) observe(`reach`, state)
  }

  function checkNumberEquality(
    plan: NumberEqualityPlan,
    trace: ReadonlyArray<Observation>,
    expected: { keys: Array<string>; requiredStates: ReadonlyArray<string> },
  ): Verdict {
    const read = trace.find(({ checkpoint }) => checkpoint === `loadSubset`)
      ?.value as NumberEqualityRead | undefined
    if (!read)
      return violation(`loadSubset`, `the driver recorded no load`, `trace`)
    const missing = expected.requiredStates.filter(
      (state) =>
        !trace.some(
          ({ checkpoint, value }) => checkpoint === `reach` && value === state,
        ),
    )
    return (
      differs(
        `loadSubset`,
        `public rows`,
        read.adapterKeys,
        expected.keys,
        `the adapter kept other rows than the model's equality`,
      ) ??
      differs(
        `predicate query`,
        `exact candidate`,
        read.directSqlKeys,
        expected.keys,
        `the SQL candidate holds other rows than the model's equality`,
      ) ??
      differs(
        `query plan`,
        `named index`,
        {
          searchesNamedIndex: read.searchesNamedIndex,
          scansTable: read.scansTable,
        },
        { searchesNamedIndex: true, scansTable: false },
        `SQLite does not answer the candidate from the named index`,
      ) ??
      (missing.length > 0
        ? violation(
            `constructed states`,
            `the constructed history did not enter ${missing.join(`, `)}`,
            `constructed reach`,
          )
        : pass)
    )
  }

  // Binds the number again where the candidate binds the Date's ISO text.
  const numberInPlaceOfDate: QueryTransform = (query) => {
    const json = query.params.find(
      (param): param is string =>
        typeof param === `string` && param.startsWith(`[`),
    )
    if (json !== undefined)
      return {
        sql: query.sql,
        params: query.params.map((param) =>
          param === json
            ? JSON.stringify(
                (JSON.parse(json) as Array<unknown>).filter(
                  (value) => typeof value === `number`,
                ),
              )
            : param,
        ),
      }
    const number = query.params.find((param) => typeof param === `number`)
    return {
      sql: query.sql,
      params: query.params.map((param) =>
        typeof param === `string` && /^-?\d{4,6}-/.test(param) ? number : param,
      ),
    }
  }

  const mapLoad = (
    trace: ReadonlyArray<Observation>,
    change: (read: NumberEqualityRead) => NumberEqualityRead,
  ) =>
    trace.map((entry) =>
      entry.checkpoint === `loadSubset`
        ? { ...entry, value: change(entry.value as NumberEqualityRead) }
        : entry,
    )

  oracleProperty({
    id: `sqlite-persistence.expression-index.number-equality`,
    law: {
      statement: `An eq or in of safe integers on an indexed top-level field returns the rows whose value equals a literal, a Date equal to its epoch milliseconds; the SQL candidate holds exactly those rows, and SQLite searches the named expression index for it.`,
      authority: `RFC #1659 invariant 8 and SQLite expression-index matching; the row evaluator's equality, which equates a Date with its epoch milliseconds (PR #1997).`,
      limits: `Top-level fields, targets in -10,000..10,000, and the real BetterSqlite3 adapter in one process; fractional and unsafe numbers keep a full read and are outside this law.`,
    },
    owns: [`src/node-driver.ts`],
    histories: {
      arbitrary: numberEqualityArbitrary,
      runs: DEFAULT_ORACLE_RUNS,
      fixedSeeds: [DEFAULT_ORACLE_SEED],
      states: numberEqualityStates,
      constructed: ([`eq`, `in`] as const).map((operator) => {
        const state = `a Date equals an ${operator} literal`
        return {
          name: state,
          enters: [state],
          build: (generated: NumberEqualityHistory) => {
            const history: NumberEqualityHistory = {
              ...generated,
              operator,
              stored: generated.stored === `number` ? `both` : generated.stored,
            }
            numberConstructionStates.set(history, [state])
            return history
          },
        }
      }),
    },
    resolve: resolveNumberEquality,
    model: (plan) => ({
      keys: numberMatches(plan),
      requiredStates: plan.requiredStates,
    }),
    driver: (plan, observe) => driveNumberEquality(plan, observe),
    check: checkNumberEquality,
    calibrations: [
      {
        name: `the candidate binds the number in place of the Date's ISO text`,
        law: `public rows`,
        history: { constructed: `a Date equals an eq literal` },
        driver: (plan, observe) =>
          driveNumberEquality(plan, observe, numberInPlaceOfDate),
      },
      {
        name: `the membership candidate drops the Dates' ISO text`,
        law: `public rows`,
        history: { constructed: `a Date equals an in literal` },
        driver: (plan, observe) =>
          driveNumberEquality(plan, observe, numberInPlaceOfDate),
      },
      {
        name: `the candidate drops the Date match`,
        law: `exact candidate`,
        history: { constructed: `a Date equals an eq literal` },
        corrupt: (trace) =>
          mapLoad(trace, (read) => ({
            ...read,
            directSqlKeys: read.directSqlKeys.filter(
              (key) => !key.startsWith(`date-`),
            ),
          })),
      },
      {
        name: `SQLite scans the table`,
        law: `named index`,
        history: { constructed: `a Date equals an in literal` },
        corrupt: (trace) =>
          mapLoad(trace, (read) => ({ ...read, scansTable: true })),
      },
      ...numberEqualityStates.map((state) => ({
        name: `a construction omits ${state}`,
        law: `constructed reach`,
        history: { constructed: state },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter(
            ({ checkpoint, value }) =>
              checkpoint !== `reach` || value !== state,
          ),
      })),
    ],
  })

  oracleProperty({
    id: `sqlite-persistence.expression-index`,
    law: {
      statement: `Every generated matrix retains all seven query axes, their exact candidate and public keys, promised ordering, and required named-index plans.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
    owns: [`src/node-driver.ts`],
    histories: {
      arbitrary: generatedScenarioMatrixArbitrary,
      runs: DEFAULT_ORACLE_RUNS,
      fixedSeeds: [DEFAULT_ORACLE_SEED],
      measured: GENERATED_SCENARIO_KINDS,
    },
    resolve: resolveGeneratedScenarioMatrix,

    driver: (plan, observe) =>
      recordAssertionJudgment(
        `sqlite-persistence.expression-index`,
        plan,
        observe,
        () => runGeneratedScenarioMatrix(plan, observe),
      ),
    model: recordedAssertionJudgment,
    check: checkGeneratedMatrix,
    // Each axis's plausible wrong SQL answer must fail the unchanged
    // comparison at that axis (moved from the raw wrong-answer control, which
    // also required the failure to name the faulted kind; the framework's
    // self-oracle owns the shrink-and-replay fidelity that control checked).
    calibrations: GENERATED_SCENARIO_FAULTS.map(({ kind, wrongAnswer }) => ({
      name: `${kind}: ${wrongAnswer}`,
      law: generatedAxisLaw(kind),
      driver: (
        plan: Array<GeneratedExpressionIndexScenario>,
        observe: (checkpoint: string, value: unknown) => void,
      ) =>
        recordAssertionJudgment(
          `sqlite-persistence.expression-index`,
          plan,
          observe,
          () => runGeneratedScenarioMatrix(plan, observe, kind),
        ),
    })),
  })
})

// Native values add a bounded rank/text dimension to this SQL/plan owner.
// The common model is independent; this driver observes real SQL before cleanup.
describe(`Temporal expression-index refinement`, () => {
  oracleProperty({
    id: `sqlite-persistence.expression-index.native-identity`,
    law: {
      statement: `Native rank and identity fixtures retain their exact candidate and public keys and their supported named-index plans.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
    owns: [`src/node-driver.ts`],
    histories: temporalFamilies,

    label: (family) => `${family.kind}/${family.name}`,
    driver: (plan: TemporalFamily, observe) =>
      recordAssertionJudgment(
        `sqlite-persistence.expression-index.native-identity`,
        plan,
        observe,
        () =>
          (async () => {
            vi.stubGlobal(`Temporal`, Temporal)
            try {
              for (const query of temporalQueryCases(plan)) {
                const result = await observeExpressionIndexScenario({
                  label: `${plan.name}-${query.name}`,
                  indexExpression: new IR.PropRef([`stamp`]),
                  where: query.where,
                  rows: plan.texts.map((_, i) => ({
                    key: `row-${i}`,
                    value: {
                      stamp: temporalValue(plan, i),
                      target: temporalValue(plan, 1),
                    },
                  })),
                })
                oracleAssertion(query.name, () =>
                  expect(result.adapterKeys, query.name).toEqual(
                    query.expectedKeys,
                  ),
                )
                oracleAssertion(query.name, () =>
                  expect(result.directSqlKeys, query.name).toEqual(
                    query.expectedKeys,
                  ),
                )
                if (query.name === `in` || query.name === `batched-in`)
                  oracleAssertion(
                    `expect(result.predicateQuery.params).toHaveLength(1)`,
                    () => expect(result.predicateQuery.params).toHaveLength(1),
                  )
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
                  oracleAssertion(query.name, () =>
                    expect(
                      planUsesNamedIndex(
                        result.plan,
                        result.tableName,
                        result.indexName,
                      ),
                      query.name,
                    ).toBe(true),
                  )
                  oracleAssertion(query.name, () =>
                    expect(
                      planScansTable(result.plan, result.tableName),
                      query.name,
                    ).toBe(false),
                  )
                }
              }
            } finally {
              vi.unstubAllGlobals()
            }
          })(),
      ),
    model: recordedAssertionJudgment,
    check: forwardAssertionJudgment,
  })

  // Independent fixture rank/text rules also judge mixed-domain candidates.
  // SQL may retain extras, but NOT must never invert an approximate prefilter.
  oracleProperty({
    id: `sqlite-persistence.expression-index.native-polarity`,
    law: {
      statement: `Native predicates retain the independent mixed-domain matches and preserve residual filtering, fallback, scalar identity and field-pair behavior.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
    owns: [`src/node-driver.ts`],
    histories: temporalFamilies,

    label: (family) => `${family.kind}/${family.name}`,
    driver: (plan: TemporalFamily, observe) =>
      recordAssertionJudgment(
        `sqlite-persistence.expression-index.native-polarity`,
        plan,
        observe,
        () =>
          (async () => {
            vi.stubGlobal(`Temporal`, Temporal)
            try {
              const ref = new IR.PropRef([`stamp`])
              const literal = new IR.Value(temporalValue(plan, 1))
              const nativeRows = plan.texts.map((_, i) => ({
                key: `row-${i}`,
                value: { stamp: temporalValue(plan, i) },
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
                    const expectedKeys = expectedNativePolarityKeys(
                      plan,
                      nullableRows,
                      operator,
                      reverse,
                      negate,
                    )
                    const result = await observeExpressionIndexScenario({
                      label: `native-polarity`,
                      indexExpression: ref,
                      where,
                      rows: nullableRows,
                    })
                    oracleAssertion(`${operator}/${reverse}/${negate}`, () =>
                      expect(
                        result.adapterKeys,
                        `${operator}/${reverse}/${negate}`,
                      ).toEqual(expectedKeys),
                    )
                    oracleAssertion(
                      `expect(result.directSqlKeys).toEqual( expect.arrayContaining(expectedKeys), )`,
                      () =>
                        expect(result.directSqlKeys).toEqual(
                          expect.arrayContaining(expectedKeys),
                        ),
                    )
                  }
                }
              }
              const otherKind =
                plan.kind === `Instant`
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
                  `${plan.kind === `Instant` ? `Temporal.Instant` : `Temporal.PlainDate`}:${plan.texts[1]}`,
                  `\u0000tanstack-db:temporal:Temporal.${plan.kind}:${plan.texts[1]}`,
                ].map((stamp, i) => ({ key: `other-${i}`, value: { stamp } })),
              ]
              for (const operator of [`eq`, `in`] as const) {
                const comparison = new IR.Func<boolean>(operator, [
                  ref,
                  operator === `eq`
                    ? literal
                    : new IR.Value([temporalValue(plan, 1)]),
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
                  oracleAssertion(
                    `expect(result.adapterKeys).toEqual(expectedKeys)`,
                    () => expect(result.adapterKeys).toEqual(expectedKeys),
                  )
                  oracleAssertion(
                    `expect(result.directSqlKeys).toEqual( expect.arrayContaining(expectedKeys), )`,
                    () =>
                      expect(result.directSqlKeys).toEqual(
                        expect.arrayContaining(expectedKeys),
                      ),
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
              oracleAssertion(
                `expect(scalar.adapterKeys).toEqual(['other-4'])`,
                () => expect(scalar.adapterKeys).toEqual([`other-4`]),
              )
              oracleAssertion(
                `expect(scalar.directSqlKeys).toEqual( expect.arrayContaining(['other-4']), )`,
                () =>
                  expect(scalar.directSqlKeys).toEqual(
                    expect.arrayContaining([`other-4`]),
                  ),
              )
              oracleAssertion(
                `expect(scalar.predicateQuery.params).toEqual([orderKey])`,
                () => expect(scalar.predicateQuery.params).toEqual([orderKey]),
              )
              oracleAssertion(
                `expect( scalar.indexValues ?.filter((row) => row.value === 1) .map((row) => row.key), ).toEqual(['ot`,
                () =>
                  expect(
                    scalar.indexValues
                      ?.filter((row) => row.value === 1)
                      .map((row) => row.key),
                  ).toEqual([`other-4`]),
              )

              const selected = new IR.Func(`coalesce`, [ref, literal])
              const equality = new IR.Func<boolean>(`eq`, [selected, literal])
              const fallback = await observeExpressionIndexScenario({
                label: `native-coalesce-negation`,
                indexExpression: selected,
                where: new IR.Func<boolean>(`not`, [equality]),
                rows: nullableRows,
              })
              oracleAssertion(
                `expect(fallback.adapterKeys).toEqual(['nan', 'row-0', 'row-2'])`,
                () =>
                  expect(fallback.adapterKeys).toEqual([
                    `nan`,
                    `row-0`,
                    `row-2`,
                  ]),
              )
              oracleAssertion(
                `expect(fallback.predicateQuery.sql).not.toContain(' WHERE ')`,
                () =>
                  expect(fallback.predicateQuery.sql).not.toContain(` WHERE `),
              )
              const paired = await observeExpressionIndexScenario({
                label: `native-field-pairs`,
                indexExpression: ref,
                where: new IR.Func<boolean>(`eq`, [
                  ref,
                  new IR.PropRef([`target`]),
                ]),
                rows: [
                  {
                    key: `native`,
                    value: {
                      stamp: temporalValue(plan, 1),
                      target: temporalValue(plan, 1),
                    },
                  },
                  {
                    key: `different`,
                    value: {
                      stamp: temporalValue(plan, 0),
                      target: temporalValue(plan, 1),
                    },
                  },
                  {
                    key: `date-number`,
                    value: { stamp: new Date(0), target: 0 },
                  },
                ],
              })
              oracleAssertion(
                `expect(paired.adapterKeys).toEqual(['date-number', 'native'])`,
                () =>
                  expect(paired.adapterKeys).toEqual([`date-number`, `native`]),
              )
              oracleAssertion(
                `expect(paired.directSqlKeys).toEqual( expect.arrayContaining(paired.adapterKeys), )`,
                () =>
                  expect(paired.directSqlKeys).toEqual(
                    expect.arrayContaining(paired.adapterKeys),
                  ),
              )
            } finally {
              vi.unstubAllGlobals()
            }
          })(),
      ),
    model: recordedAssertionJudgment,
    check: forwardAssertionJudgment,
  })
})
