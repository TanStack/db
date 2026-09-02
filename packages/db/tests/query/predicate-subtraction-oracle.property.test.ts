import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { minusWherePredicates } from '../../src/query/predicate-utils'
import { Func, PropRef, Value } from '../../src/query/ir'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config'
import type { BasicExpression } from '../../src/query/ir'

type Field = `score` | `rank`

type PredicateSpec =
  | { kind: `eq`; field: Field; value: number | null }
  | {
      kind: `range`
      field: Field
      operator: `gt` | `gte` | `lt` | `lte`
      value: number
    }
  | { kind: `in`; field: Field; values: Array<number | null> }
  | { kind: `not`; predicate: AtomicPredicateSpec }
  | {
      kind: `or`
      left: AtomicPredicateSpec
      right: AtomicPredicateSpec
    }

type AtomicPredicateSpec = Exclude<PredicateSpec, { kind: `not` | `or` }>

type Association = `flat` | `left` | `right`
type ScenarioFamily =
  | `general residuals`
  | `ordered range overlap`
  | `set overlap`

interface DifferenceScenario {
  family: ScenarioFamily
  shared: Array<PredicateSpec>
  fromResidual: AtomicPredicateSpec
  subtractResidual: AtomicPredicateSpec
  fromAssociation: Association
  subtractAssociation: Association
  reverseFrom: boolean
  reverseSubtract: boolean
  duplicateFrom: boolean
  duplicateSubtract: boolean
}

type DifferenceOutcome =
  | `successful narrowing`
  | `unchanged fallback`
  | `conservative bailout`

type DifferenceObservation = `${ScenarioFamily} / ${DifferenceOutcome}`

const finiteWorldProperty = `predicate-subtraction.finite-world`
const unboundedProperty = `predicate-subtraction.unbounded`
const duplicateProperty = `predicate-subtraction.duplicate-terms`

const scalarArbitrary = fc.oneof(
  fc.integer({ min: -2, max: 2 }),
  fc.constant(null),
)
const fieldArbitrary = fc.constantFrom<Field>(`score`, `rank`)

const atomicPredicateArbitrary: fc.Arbitrary<AtomicPredicateSpec> = fc.oneof(
  fc.record({
    kind: fc.constant(`eq` as const),
    field: fieldArbitrary,
    value: scalarArbitrary,
  }),
  fc.record({
    kind: fc.constant(`range` as const),
    field: fieldArbitrary,
    operator: fc.constantFrom<`gt` | `gte` | `lt` | `lte`>(
      `gt`,
      `gte`,
      `lt`,
      `lte`,
    ),
    value: fc.integer({ min: -2, max: 2 }),
  }),
  fc.record({
    kind: fc.constant(`in` as const),
    field: fieldArbitrary,
    values: fc.uniqueArray(scalarArbitrary, { minLength: 1, maxLength: 4 }),
  }),
)

const predicateArbitrary: fc.Arbitrary<PredicateSpec> = fc.oneof(
  atomicPredicateArbitrary,
  atomicPredicateArbitrary.map((predicate) => ({
    kind: `not` as const,
    predicate,
  })),
  fc
    .tuple(atomicPredicateArbitrary, atomicPredicateArbitrary)
    .map(([left, right]) => ({ kind: `or` as const, left, right })),
)

const residualPairArbitrary = fc.oneof(
  fc
    .tuple(atomicPredicateArbitrary, atomicPredicateArbitrary)
    .map(([fromResidual, subtractResidual]) => ({
      family: `general residuals` as const,
      fromResidual,
      subtractResidual,
    })),
  fc
    .tuple(fieldArbitrary, fc.integer({ min: -2, max: 1 }))
    .map(([field, boundary]) => ({
      family: `ordered range overlap` as const,
      fromResidual: {
        kind: `range` as const,
        field,
        operator: `gt` as const,
        value: boundary,
      },
      subtractResidual: {
        kind: `range` as const,
        field,
        operator: `gt` as const,
        value: boundary + 1,
      },
    })),
  fc
    .tuple(
      fieldArbitrary,
      fc.uniqueArray(fc.integer({ min: -2, max: 2 }), {
        minLength: 2,
        maxLength: 4,
      }),
    )
    .map(([field, values]) => ({
      family: `set overlap` as const,
      fromResidual: { kind: `in` as const, field, values },
      subtractResidual: {
        kind: `in` as const,
        field,
        values: values.slice(1),
      },
    })),
)

const scenarioShapeArbitrary = fc.record({
  shared: fc.array(predicateArbitrary, { minLength: 1, maxLength: 3 }),
  fromAssociation: fc.constantFrom<Association>(`flat`, `left`, `right`),
  subtractAssociation: fc.constantFrom<Association>(`flat`, `left`, `right`),
  reverseFrom: fc.boolean(),
  reverseSubtract: fc.boolean(),
  duplicateFrom: fc.boolean(),
  duplicateSubtract: fc.boolean(),
})

const scenarioArbitrary: fc.Arbitrary<DifferenceScenario> = fc
  .tuple(scenarioShapeArbitrary, residualPairArbitrary)
  .map(([shape, residuals]) => ({ ...shape, ...residuals }))

const refs: Record<Field, PropRef> = {
  score: new PropRef([`score`]),
  rank: new PropRef([`rank`]),
}

function value(input: unknown): Value {
  return new Value(input)
}

function call(
  name: string,
  ...args: Array<BasicExpression>
): BasicExpression<boolean> {
  return new Func(name, args) as BasicExpression<boolean>
}

function buildAtomic(spec: AtomicPredicateSpec): BasicExpression<boolean> {
  const ref = refs[spec.field]
  if (spec.kind === `in`) {
    return call(`in`, ref, value(spec.values))
  }
  if (spec.kind === `range`) {
    return call(spec.operator, ref, value(spec.value))
  }
  return call(`eq`, ref, value(spec.value))
}

function buildPredicate(spec: PredicateSpec): BasicExpression<boolean> {
  if (spec.kind === `not`) {
    return call(`not`, buildAtomic(spec.predicate))
  }
  if (spec.kind === `or`) {
    return call(`or`, buildAtomic(spec.left), buildAtomic(spec.right))
  }
  return buildAtomic(spec)
}

function predicateFields(spec: PredicateSpec): Array<Field> {
  if (spec.kind === `not`) return [spec.predicate.field]
  if (spec.kind === `or`) return [spec.left.field, spec.right.field]
  return [spec.field]
}

function scenarioFields(scenario: DifferenceScenario): Array<Field> {
  return [
    ...scenario.shared.flatMap(predicateFields),
    scenario.fromResidual.field,
    scenario.subtractResidual.field,
  ]
}

function associateAnd(
  terms: Array<BasicExpression<boolean>>,
  association: Association,
): BasicExpression<boolean> {
  if (terms.length === 1) return terms[0]!
  if (association === `flat`) return call(`and`, ...terms)

  if (association === `left`) {
    return terms
      .slice(1)
      .reduce((left, right) => call(`and`, left, right), terms[0]!)
  }

  return terms
    .slice(0, -1)
    .reduceRight((right, left) => call(`and`, left, right), terms.at(-1)!)
}

function buildOperand(
  sharedSpecs: Array<PredicateSpec>,
  residualSpec: AtomicPredicateSpec,
  association: Association,
  reverse: boolean,
  duplicate: boolean,
): BasicExpression<boolean> {
  const shared = sharedSpecs.map(buildPredicate)
  const residual = buildAtomic(residualSpec)
  const terms = reverse ? [residual, ...shared] : [...shared, residual]
  if (duplicate) terms.splice(1, 0, terms[0]!)
  return associateAnd(terms, association)
}

const finiteValues = [-3, -2, -1, 0, 1, 2, 3, null]
const finiteRows = finiteValues.flatMap((score) =>
  finiteValues.map((rank) => ({ score, rank })),
)

function evaluatePredicate(
  expression: BasicExpression,
  row: Record<Field, number | null>,
): unknown {
  if (expression.type === `val`) return expression.value
  if (expression.type === `ref`) {
    const [field, ...remainingPath] = expression.path
    if (remainingPath.length > 0 || (field !== `score` && field !== `rank`)) {
      throw new Error(`Unsupported reference path ${expression.path.join(`.`)}`)
    }
    return row[field]
  }

  const args = expression.args.map((argument) =>
    evaluatePredicate(argument, row),
  )
  const isUnknown = (candidate: unknown) =>
    candidate === null || candidate === undefined
  switch (expression.name) {
    case `and`:
      return args.includes(false) ? false : args.some(isUnknown) ? null : true
    case `or`:
      return args.includes(true) ? true : args.some(isUnknown) ? null : false
    case `not`:
      return isUnknown(args[0]) ? null : !args[0]
    case `eq`:
      return isUnknown(args[0]) || isUnknown(args[1])
        ? null
        : args[0] === args[1]
    case `gt`:
    case `gte`:
    case `lt`:
    case `lte`: {
      if (isUnknown(args[0]) || isUnknown(args[1])) return null
      const left = args[0] as number
      const right = args[1] as number
      if (expression.name === `gt`) return left > right
      if (expression.name === `gte`) return left >= right
      if (expression.name === `lt`) return left < right
      return left <= right
    }
    case `in`:
      if (isUnknown(args[0])) return null
      return Array.isArray(args[1]) && args[1].includes(args[0])
    default:
      throw new Error(`Unsupported predicate ${expression.name}`)
  }
}

function assertSemanticDifference(
  scenario: DifferenceScenario,
  override?: { result: BasicExpression<boolean> | null },
): void {
  const difference = evaluateDifference(scenario)
  const { requested, loaded } = difference
  const result = override === undefined ? difference.result : override.result

  assertExpressionDifference(requested, loaded, result)
}

function assertExpressionDifference(
  requested: BasicExpression<boolean>,
  loaded: BasicExpression<boolean>,
  result: BasicExpression<boolean> | null,
): void {
  if (result === null) return

  for (const row of finiteRows) {
    const expected =
      evaluatePredicate(requested, row) === true &&
      evaluatePredicate(loaded, row) !== true
    expect(evaluatePredicate(result, row) === true).toBe(expected)
  }
}

function assertUnboundedDifference(spec: PredicateSpec): void {
  const loaded = buildPredicate(spec)
  const result = minusWherePredicates(undefined, loaded)
  assertExpressionDifference(
    value(true) as BasicExpression<boolean>,
    loaded,
    result,
  )
}

function assertDuplicateTermDifference(field: Field, boundary: number): void {
  const shared = buildAtomic({
    kind: `range`,
    field,
    operator: `gt`,
    value: boundary,
  })
  const nullableChoice = call(
    `or`,
    buildAtomic({ kind: `eq`, field, value: null }),
    buildAtomic({ kind: `eq`, field, value: boundary + 1 }),
  )
  const membership = buildAtomic({
    kind: `in`,
    field,
    values: [boundary + 1, boundary],
  })
  const requested = call(
    `and`,
    shared,
    nullableChoice,
    membership,
    buildAtomic({
      kind: `range`,
      field,
      operator: `gt`,
      value: boundary - 1,
    }),
  )
  const loaded = call(`and`, shared, nullableChoice, membership, shared)
  const result = minusWherePredicates(requested, loaded)

  assertExpressionDifference(requested, loaded, result)
}

function evaluateDifference(scenario: DifferenceScenario): {
  requested: BasicExpression<boolean>
  loaded: BasicExpression<boolean>
  result: BasicExpression<boolean> | null
} {
  const requested = buildOperand(
    scenario.shared,
    scenario.fromResidual,
    scenario.fromAssociation,
    scenario.reverseFrom,
    scenario.duplicateFrom,
  )
  const loaded = buildOperand(
    scenario.shared,
    scenario.subtractResidual,
    scenario.subtractAssociation,
    scenario.reverseSubtract,
    scenario.duplicateSubtract,
  )

  return {
    requested,
    loaded,
    result: minusWherePredicates(requested, loaded),
  }
}

function classifyDifferenceOutcome(
  scenario: DifferenceScenario,
): DifferenceOutcome {
  const { requested, result } = evaluateDifference(scenario)
  if (result === null) return `conservative bailout`

  for (const row of finiteRows) {
    if (
      (evaluatePredicate(requested, row) === true) !==
      (evaluatePredicate(result, row) === true)
    ) {
      return `successful narrowing`
    }
  }

  return `unchanged fallback`
}

function expectEveryDifferenceOutcome(parameters: {
  numRuns: number
  seed: number
}): void {
  const counts = new Map<DifferenceObservation, number>()

  for (const scenario of fc.sample(scenarioArbitrary, parameters)) {
    const observation: DifferenceObservation = `${scenario.family} / ${classifyDifferenceOutcome(scenario)}`
    counts.set(observation, (counts.get(observation) ?? 0) + 1)
  }

  const requiredObservations: Array<DifferenceObservation> = [
    `general residuals / unchanged fallback`,
    `general residuals / conservative bailout`,
    `ordered range overlap / successful narrowing`,
    `set overlap / successful narrowing`,
  ]
  const diagnostics = `seed=${parameters.seed} counts=${JSON.stringify(Object.fromEntries(counts))}`

  for (const observation of requiredObservations) {
    expect(counts.get(observation) ?? 0, diagnostics).toBeGreaterThanOrEqual(10)
  }
}

function calibrationScenario(
  fromResidual: AtomicPredicateSpec,
  subtractResidual: AtomicPredicateSpec,
): DifferenceScenario {
  return {
    family: `general residuals`,
    shared: [],
    fromResidual,
    subtractResidual,
    fromAssociation: `flat`,
    subtractAssociation: `flat`,
    reverseFrom: false,
    reverseSubtract: false,
    duplicateFrom: false,
    duplicateSubtract: false,
  }
}

const outcomeCalibrations: Record<DifferenceOutcome, DifferenceScenario> = {
  'successful narrowing': calibrationScenario(
    { kind: `range`, field: `score`, operator: `gt`, value: -1 },
    { kind: `range`, field: `score`, operator: `gt`, value: 0 },
  ),
  'unchanged fallback': calibrationScenario(
    { kind: `eq`, field: `score`, value: 0 },
    { kind: `eq`, field: `score`, value: 1 },
  ),
  'conservative bailout': calibrationScenario(
    { kind: `eq`, field: `score`, value: 0 },
    { kind: `eq`, field: `rank`, value: 0 },
  ),
}

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    scenarioArbitrary,
    (scenario) => `${scenario.family} / ${classifyDifferenceOutcome(scenario)}`,
    oraclePropertyOptions(1_000, finiteWorldProperty),
  )
}

describe(`predicate subtraction oracle`, () => {
  it(`resolves each generated reference path independently`, () => {
    const row = { score: 1, rank: 2 }

    expect(evaluatePredicate(refs.score, row)).toBe(1)
    expect(evaluatePredicate(refs.rank, row)).toBe(2)
  })

  it(`evaluates the Cartesian product of reference values`, () => {
    const encodedRows = new Set(
      finiteRows.map(({ score, rank }) => `${String(score)}:${String(rank)}`),
    )

    expect(finiteRows).toHaveLength(finiteValues.length ** 2)
    expect(encodedRows).toHaveLength(finiteValues.length ** 2)
    expect(finiteRows).toContainEqual({ score: -3, rank: null })
    expect(finiteRows).toContainEqual({ score: null, rank: -3 })
  })

  it(`covers both reference paths in the fixed replay corpus`, () => {
    const fields = new Set(
      fc
        .sample(scenarioArbitrary, {
          numRuns: oracleRuns(250),
          seed: 1777,
        })
        .flatMap(scenarioFields),
    )

    expect(fields).toEqual(new Set<Field>([`score`, `rank`]))
  })

  it(`calibrates every subtraction outcome label`, () => {
    for (const [expected, scenario] of Object.entries(
      outcomeCalibrations,
    ) as Array<[DifferenceOutcome, DifferenceScenario]>) {
      expect(classifyDifferenceOutcome(scenario)).toBe(expected)
      assertSemanticDifference(scenario)
    }
  })

  it(`rejects a subtraction result with the wrong finite-world meaning`, () => {
    const scenario = outcomeCalibrations[`successful narrowing`]
    const { requested } = evaluateDifference(scenario)

    expect(() =>
      assertSemanticDifference(scenario, { result: requested }),
    ).toThrow()
  })

  it(`calibrates runtime IN null semantics under NOT and OR`, () => {
    const membership = buildAtomic({
      kind: `in`,
      field: `score`,
      values: [null, 1],
    })
    const negated = call(`not`, membership)
    const disjunction = call(
      `or`,
      negated,
      buildAtomic({ kind: `eq`, field: `rank`, value: 2 }),
    )

    expect(evaluatePredicate(membership, { score: null, rank: 0 })).toBeNull()
    expect(evaluatePredicate(membership, { score: 0, rank: 0 })).toBe(false)
    expect(evaluatePredicate(negated, { score: 0, rank: 0 })).toBe(true)
    expect(evaluatePredicate(disjunction, { score: null, rank: 0 })).toBeNull()
    expect(evaluatePredicate(disjunction, { score: null, rank: 2 })).toBe(true)
  })

  fcTest.prop([scenarioArbitrary], { numRuns: oracleRuns(250), seed: 1777 })(
    `preserves finite-world subtraction for a fixed replay corpus`,
    assertSemanticDifference,
  )

  fcTest.prop(
    [scenarioArbitrary],
    oraclePropertyOptions(250, finiteWorldProperty),
  )(
    `preserves finite-world subtraction for a random or replayed seed`,
    assertSemanticDifference,
  )

  fcTest.prop([predicateArbitrary], { numRuns: oracleRuns(100), seed: 1778 })(
    `preserves unbounded subtraction across UNKNOWN rows for a fixed replay corpus`,
    assertUnboundedDifference,
  )

  fcTest.prop(
    [predicateArbitrary],
    oraclePropertyOptions(100, unboundedProperty),
  )(
    `preserves unbounded subtraction across UNKNOWN rows for a random or replayed seed`,
    assertUnboundedDifference,
  )

  fcTest.prop([fieldArbitrary, fc.integer({ min: -2, max: 2 })], {
    numRuns: oracleRuns(100),
    seed: 1779,
  })(
    `preserves duplicate common terms for a fixed replay corpus`,
    assertDuplicateTermDifference,
  )

  fcTest.prop(
    [fieldArbitrary, fc.integer({ min: -2, max: 2 })],
    oraclePropertyOptions(100, duplicateProperty),
  )(
    `preserves duplicate common terms for a random or replayed seed`,
    assertDuplicateTermDifference,
  )

  it(`covers every difference outcome in the fixed replay corpus`, () => {
    expectEveryDifferenceOutcome({
      numRuns: oracleRuns(1_000),
      seed: 1777,
    })
  })
})
