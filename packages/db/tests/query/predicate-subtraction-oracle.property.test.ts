import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { minusWherePredicates } from '../../src/query/predicate-utils'
import { Func, PropRef, Value } from '../../src/query/ir'
import { oraclePropertyOptions } from '../oracle-config'
import type { BasicExpression } from '../../src/query/ir'

type PredicateSpec =
  | { kind: `eq`; value: number | null }
  | { kind: `range`; operator: `gt` | `gte` | `lt` | `lte`; value: number }
  | { kind: `in`; values: Array<number | null> }
  | { kind: `not`; predicate: AtomicPredicateSpec }
  | {
      kind: `or`
      left: AtomicPredicateSpec
      right: AtomicPredicateSpec
    }

type AtomicPredicateSpec = Exclude<PredicateSpec, { kind: `not` | `or` }>

type Association = `flat` | `left` | `right`

interface DifferenceScenario {
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

const scalarArbitrary = fc.oneof(
  fc.integer({ min: -2, max: 2 }),
  fc.constant(null),
)

const atomicPredicateArbitrary: fc.Arbitrary<AtomicPredicateSpec> = fc.oneof(
  scalarArbitrary.map((scalar) => ({ kind: `eq` as const, value: scalar })),
  fc.record({
    kind: fc.constant(`range` as const),
    operator: fc.constantFrom(`gt`, `gte`, `lt`, `lte`),
    value: fc.integer({ min: -2, max: 2 }),
  }),
  fc
    .uniqueArray(scalarArbitrary, { minLength: 1, maxLength: 4 })
    .map((values) => ({ kind: `in` as const, values })),
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

const scenarioArbitrary: fc.Arbitrary<DifferenceScenario> = fc.record({
  shared: fc.array(predicateArbitrary, { minLength: 1, maxLength: 3 }),
  fromResidual: atomicPredicateArbitrary,
  subtractResidual: atomicPredicateArbitrary,
  fromAssociation: fc.constantFrom(`flat`, `left`, `right`),
  subtractAssociation: fc.constantFrom(`flat`, `left`, `right`),
  reverseFrom: fc.boolean(),
  reverseSubtract: fc.boolean(),
  duplicateFrom: fc.boolean(),
  duplicateSubtract: fc.boolean(),
})

const score = new PropRef([`score`])

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
  if (spec.kind === `in`) {
    return call(`in`, score, value(spec.values))
  }
  if (spec.kind === `range`) {
    return call(spec.operator, score, value(spec.value))
  }
  return call(`eq`, score, value(spec.value))
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

const finiteDomain = [-3, -2, -1, 0, 1, 2, 3, null]

function evaluatePredicate(
  expression: BasicExpression,
  row: { score: number | null },
): unknown {
  if (expression.type === `val`) return expression.value
  if (expression.type === `ref`) return row.score

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

function assertSemanticDifference(scenario: DifferenceScenario): void {
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

  const result = minusWherePredicates(requested, loaded)
  if (result === null) return

  for (const candidate of finiteDomain) {
    const row = { score: candidate }
    const expected =
      evaluatePredicate(requested, row) === true &&
      evaluatePredicate(loaded, row) !== true
    expect(evaluatePredicate(result, row) === true).toBe(expected)
  }
}

describe(`predicate subtraction oracle`, () => {
  fcTest.prop([scenarioArbitrary], { numRuns: 250, seed: 1777 })(
    `preserves finite-world subtraction for a fixed replay corpus`,
    assertSemanticDifference,
  )

  fcTest.prop([scenarioArbitrary], oraclePropertyOptions(250))(
    `preserves finite-world subtraction for a random or replayed seed`,
    assertSemanticDifference,
  )
})
