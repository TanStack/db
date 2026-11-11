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
 * A path replay sets TANSTACK_DB_ORACLE_PATH, TANSTACK_DB_ORACLE_SEED, and
 * TANSTACK_DB_ORACLE_PROPERTY to one of sqlite-persistence.expression-index,
 * sqlite-persistence.bigint-roundtrip, or sqlite-persistence.bigint-rejection.
 * That property's random campaign replays only its recorded history; the fixed
 * campaigns and the other properties stand aside. A seed alone reseeds the
 * random campaigns. Per-axis grammar ablations and same-path SQL/compiler faults must
 * fail the expression-index property. The
 * retained fixed campaign reconstructs the known valid matrix. The bounds
 * above state its range; exact grammar checks reject missing, duplicate, and
 * unexpected axes as nearby invalid matrices. The focused overbroad and former
 * path-binding controls remain independent. In-memory SQLite teardown
 * retains the semantic failure if cleanup also fails.
 *
 * Native registration retains the data tuple before resolving its IR objects.
 * The existing independent helpers and their authored comparison cuts remain
 * unchanged; the assertion adapter passes their judgment to oracleProperty.
 * Product campaigns use the native fixed/random/replay runner. The retained
 * fast-check controls test grammar ablation, SQL-fault shrinking and same-path
 * replay, plus seed/run/path configuration without additional SQLite work.
 */
import fc from 'fast-check'
import { describe, expect, vi, it as vitestIt } from 'vitest'
import { IR } from '@tanstack/db'
import {
  createPersistedTableName,
  createSQLiteCorePersistenceAdapter,
  decodePersistedStorageKey,
} from '@tanstack/db-sqlite-persistence-core'
import {
  oracleFixedSeed,
  oracleProperty,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
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
import type { TemporalFamily } from '../../db-sqlite-persistence-core/tests/temporal-value-oracle'
import type {
  CapturedQuery,
  ExpressionIndexObservation,
  ExpressionIndexScenario,
  OracleScalar,
  QueryPlanRow,
  QueryTransform,
  ScanRow,
} from './expression-index-support'

const DEFAULT_ORACLE_SEED = 1_659_005
const DEFAULT_ORACLE_RUNS = 8

type OracleCase = {
  path: Array<string>
  target: OracleScalar
  distractors: [OracleScalar, OracleScalar]
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

type GeneratedPropertyCampaign = {
  name: `fixed` | `random`
  parameters: ReturnType<typeof oraclePropertyOptions>
}

// The fixed campaign fixes its campaign seed and stands aside on every path replay. The
// random campaign runs in ordinary and reseeded campaigns, and as the replay of
// its property, where oraclePropertyOptions returns the recorded path.
const fixedGeneratedCampaign: GeneratedPropertyCampaign = {
  name: `fixed`,
  parameters: oracleFixedSeed(DEFAULT_ORACLE_SEED, {
    numRuns: oracleRuns(DEFAULT_ORACLE_RUNS),
  }),
}

function randomGeneratedCampaign(property: string): GeneratedPropertyCampaign {
  return {
    name: `random`,
    parameters: oraclePropertyOptions(DEFAULT_ORACLE_RUNS, property),
  }
}

function generatedCampaignParameters(campaign: GeneratedPropertyCampaign) {
  return { verbose: 2 as const, ...campaign.parameters }
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

const numericIndexCaseArbitrary = fc
  .tuple(legalPathArbitrary, fc.integer({ min: -10_000, max: 10_000 }))
  .map(([path, target]) => ({ path, target }))

const stringIndexCaseArbitrary = fc
  .tuple(legalPathArbitrary, fc.integer({ min: 0, max: 10_000 }))
  .map(([path, suffix]) => ({ path, target: `target-'${suffix}` }))

const generatedScenarioMatrixArbitrary = fc.tuple(
  stringIndexCaseArbitrary,
  numericIndexCaseArbitrary,
  numericIndexCaseArbitrary,
  numericIndexCaseArbitrary,
  stringIndexCaseArbitrary,
  numericIndexCaseArbitrary,
  stringIndexCaseArbitrary,
)

type GeneratedMatrixHistory =
  typeof generatedScenarioMatrixArbitrary extends fc.Arbitrary<infer H>
    ? H
    : never

function resolveGeneratedScenarioMatrix([
  eqCase,
  inCase,
  batchedCase,
  rangeCase,
  andCase,
  orderCase,
  lowerCase,
]: GeneratedMatrixHistory) {
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
          value: createNestedRow(batchedCase.path, BigInt(batchedCase.target)),
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
        new IR.Func(`eq`, [new IR.PropRef([`status`]), new IR.Value(`active`)]),
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
      indexExpression: new IR.Func(`lower`, [new IR.PropRef(lowerCase.path)]),
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
}

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
  return fc.asyncProperty(
    generatedScenarioMatrixArbitrary.map(resolveGeneratedScenarioMatrix),
    async (matrix) => {
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
    },
  )
}

// Each original matrix contains every scenario kind. Retain its exact query
// comparisons and record the existing all-kinds reach check for each matrix.
async function runGeneratedScenarioMatrix(
  matrix: Array<GeneratedExpressionIndexScenario>,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const reachedScenarios = new Set<GeneratedScenarioKind>()
  assertGeneratedScenarioGrammar(matrix)
  for (const scenario of matrix) {
    reachedScenarios.add(scenario.kind)
    const observation = await observeExpressionIndexScenario(scenario)
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

declareOracle({
  owns: [`src/node-driver.ts`],
  check: [assertExpressionIndexHistory],
  model: [expectedKeysFromScan, expectedRangeKeys, expectedNativePolarityKeys],
  grammar: [generatedScenarioMatrixArbitrary],
})

describe(`SQLite expression-index oracle`, () => {
  oracleProperty({
    id: `sqlite-persistence.expression-index.large-number`,
    law: {
      statement: `SQLite candidates retain JavaScript Number/BigInt range matches across operand directions and unary wrappers, with named-index use on the existing selective orientation.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
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
    histories: [
      {
        path: [`threadId`],
        target: `thread-'1`,
        distractors: [`thread-2`, `thread-3`],
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

  oracleProperty({
    id: `sqlite-persistence.expression-index`,
    law: {
      statement: `Every generated matrix retains all seven query axes, their exact candidate and public keys, promised ordering, and required named-index plans.`,
      authority: `RFC #1659 invariant 8, SQLite expression-index matching, and the existing native-value contract recorded beside this owner.`,
      limits: `The unchanged generated bounds, finite fixtures, and real BetterSqlite3 adapter checkpoints described above; no added product or coverage claim.`,
    },
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
    check: forwardAssertionJudgment,
  })

  // Retain the existing shrinking and same-path replay self-checks. Native
  // calibrations judge wrong answers but do not expose their shrink paths.
  async function checkGeneratedCampaignCoordinates(
    campaign: GeneratedPropertyCampaign,
  ) {
    oracleRoute(campaign.name === `fixed` ? `fixed seed` : `random seed`)
    // These assertions check fast-check's configuration result, separately from
    // the native product campaign above. Drawing the same tuple needs no SQLite.
    const details = await fc.check(
      fc.asyncProperty(generatedScenarioMatrixArbitrary, async () => {}),
      generatedCampaignParameters(campaign),
    )
    const parameters = generatedCampaignParameters(campaign)

    oracleAssertion(
      `expect(details.numRuns).toBe(campaign.parameters.numRuns)`,
      () => expect(details.numRuns).toBe(campaign.parameters.numRuns),
    )
    oracleAssertion(
      `expect('seed' in parameters).toBe(campaign.parameters.seed !== undefined)`,
      () =>
        expect(`seed` in parameters).toBe(
          campaign.parameters.seed !== undefined,
        ),
    )
    oracleAssertion(
      `expect('path' in parameters).toBe(campaign.parameters.path !== undefined)`,
      () =>
        expect(`path` in parameters).toBe(
          campaign.parameters.path !== undefined,
        ),
    )
    if (campaign.parameters.seed !== undefined) {
      oracleAssertion(
        `expect(details.seed).toBe(campaign.parameters.seed)`,
        () => expect(details.seed).toBe(campaign.parameters.seed),
      )
    }
    if (campaign.parameters.path !== undefined) {
      oracleAssertion(
        `expect(details.runConfiguration.path).toBe(campaign.parameters.path)`,
        () =>
          expect(details.runConfiguration.path).toBe(campaign.parameters.path),
      )
    }
    oracleAssertion(`expect(details.seed).toEqual(expect.any(Number))`, () =>
      expect(details.seed).toEqual(expect.any(Number)),
    )
  }
  oracleReplayTest(vitestIt).each([fixedGeneratedCampaign])(
    `preserves generated campaign coordinates in the $name campaign`,
    checkGeneratedCampaignCoordinates,
  )
  oracleReplayTest(vitestIt, `sqlite-persistence.expression-index`).each([
    randomGeneratedCampaign(`sqlite-persistence.expression-index`),
  ])(
    `preserves generated campaign coordinates in the $name campaign`,
    checkGeneratedCampaignCoordinates,
  )

  const generatedControlTest = oracleReplayTest(vitestIt)

  generatedControlTest.each(GENERATED_SCENARIO_KINDS)(
    `rejects the generated grammar when the %s axis is ablated`,
    async (kind) => {
      oracleRoute(`calibration`)
      const details = await fc.check(
        generatedScenarioProperty({ ablateKind: kind }),
        oracleFixedSeed(DEFAULT_ORACLE_SEED, { numRuns: 1, verbose: 2 }),
      )
      const evidence = JSON.stringify({
        seed: details.seed,
        path: details.counterexamplePath,
        error: String(details.errorInstance),
      })

      oracleAssertion(evidence, () =>
        expect(details.failed, evidence).toBe(true),
      )
      oracleAssertion(evidence, () =>
        expect(details.seed, evidence).toBe(DEFAULT_ORACLE_SEED),
      )
      oracleAssertion(evidence, () =>
        expect(details.counterexamplePath, evidence).not.toBeNull(),
      )
      oracleAssertion(evidence, () =>
        expect(String(details.errorInstance), evidence).toContain(
          `missing=${kind}`,
        ),
      )
    },
  )

  generatedControlTest(
    `reconstructs the retained generated grammar and rejects a nearby duplicate axis`,
    () => {
      oracleRoute(`calibration`)
      const [matrix] = fc.sample(
        generatedScenarioMatrixArbitrary.map(resolveGeneratedScenarioMatrix),
        oracleFixedSeed(DEFAULT_ORACLE_SEED, { numRuns: 1 }),
      )
      if (!matrix) throw new Error(`fixed grammar witness was not generated`)
      assertGeneratedScenarioGrammar(matrix)
      oracleAssertion(
        `expect(GENERATED_SCENARIO_FAULTS.map(({ kind }) => kind)).toEqual( GENERATED_SCENARIO_KINDS, )`,
        () =>
          expect(GENERATED_SCENARIO_FAULTS.map(({ kind }) => kind)).toEqual(
            GENERATED_SCENARIO_KINDS,
          ),
      )
      const equalityScenario = matrix[0]
      if (!equalityScenario) {
        throw new Error(`fixed grammar witness omitted equality`)
      }
      oracleAssertion(
        `expect(() => assertGeneratedScenarioGrammar([...matrix, equalityScenario]), ).toThrow('duplicate=eq'`,
        () =>
          expect(() =>
            assertGeneratedScenarioGrammar([...matrix, equalityScenario]),
          ).toThrow(`duplicate=eq`),
      )
    },
  )

  generatedControlTest.each(GENERATED_SCENARIO_FAULTS)(
    `rejects the plausible $wrongAnswer for the $kind axis`,
    async ({ kind }) => {
      oracleRoute(`calibration`)
      const details = await fc.check(
        generatedScenarioProperty({ faultKind: kind }),
        oracleFixedSeed(DEFAULT_ORACLE_SEED, { numRuns: 1, verbose: 2 }),
      )
      const evidence = JSON.stringify({
        seed: details.seed,
        path: details.counterexamplePath,
        error: String(details.errorInstance),
      })

      oracleAssertion(evidence, () =>
        expect(details.failed, evidence).toBe(true),
      )
      oracleAssertion(evidence, () =>
        expect(details.seed, evidence).toBe(DEFAULT_ORACLE_SEED),
      )
      oracleAssertion(evidence, () =>
        expect(details.counterexamplePath, evidence).not.toBeNull(),
      )
      oracleAssertion(evidence, () =>
        expect(String(details.errorInstance ?? ``), evidence).not.toContain(
          `did not reach`,
        ),
      )
      oracleAssertion(evidence, () =>
        expect(String(details.errorInstance), evidence).toContain(
          `"kind": "${kind}"`,
        ),
      )

      if (details.counterexamplePath === null) {
        throw new Error(`${kind} wrong-answer control did not shrink to a path`)
      }
      const replay = await fc.check(
        generatedScenarioProperty({ faultKind: kind }),
        {
          seed: details.seed,
          path: details.counterexamplePath,
          numRuns: 1,
          verbose: 2,
        },
      )
      const replayEvidence = JSON.stringify({
        seed: replay.seed,
        requestedPath: details.counterexamplePath,
        replayPath: replay.counterexamplePath,
        error: String(replay.errorInstance),
      })
      oracleAssertion(replayEvidence, () =>
        expect(replay.failed, replayEvidence).toBe(true),
      )
      oracleAssertion(replayEvidence, () =>
        expect(
          String(replay.errorInstance ?? ``),
          replayEvidence,
        ).not.toContain(`did not reach`),
      )
      oracleAssertion(replayEvidence, () =>
        expect(String(replay.errorInstance), replayEvidence).toContain(
          `"kind": "${kind}"`,
        ),
      )
    },
  )
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
