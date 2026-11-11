/**
 * The generated scenario-matrix grammar of the SQLite expression-index oracle
 * in expression-index-oracle.test.ts: the seven query axes, their plausible
 * wrong answers, the matrix arbitrary and its resolution into scenarios, and
 * the grammar check that every matrix holds each axis exactly once. Owns
 * nothing: the oracle test drives production with it, and
 * expression-index-grammar.test.ts calibrates the grammar check.
 */
import fc from 'fast-check'
import { IR } from '@tanstack/db'
import { createNestedRow } from './expression-index-support'
import type { ExpressionIndexScenario } from './expression-index-support'

export const DEFAULT_ORACLE_SEED = 1_659_005

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

export const GENERATED_SCENARIO_KINDS = [
  `eq`,
  `in`,
  `batched-in`,
  `range`,
  `and`,
  `order-by`,
  `wrapped-lower`,
] as const

export type GeneratedScenarioKind = (typeof GENERATED_SCENARIO_KINDS)[number]

export const GENERATED_SCENARIO_FAULTS = [
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

export type GeneratedExpressionIndexScenario = ExpressionIndexScenario & {
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

export const generatedScenarioMatrixArbitrary = fc.tuple(
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

export function resolveGeneratedScenarioMatrix([
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

export function assertGeneratedScenarioGrammar(
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
