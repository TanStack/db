/**
 * The independent model, history grammar, and named histories of
 * `where-predicate-publication-oracle.property.test.ts`, moved unchanged so
 * that its model calibration in `where-predicate-publication-model.test.ts`
 * can read them. That oracle file states the law and its authority. This
 * module registers no tests.
 */
import fc from 'fast-check'
import { MISSING, fieldEq } from './where-predicate-support.js'
import type {
  FieldValue,
  Operand,
  Predicate,
} from './where-predicate-support.js'

// A string whose content equals an internal normalized-key prefix must still
// compare as an ordinary string.
export const PREFIXED = `\u0000tanstack-db:string:a`
// A valid Date equals the number of its timestamp.
export const DATE_ONE = new Date(1)

export type Truth = boolean | null

export const fieldValues: ReadonlyArray<FieldValue> = [
  `a`,
  `b`,
  PREFIXED,
  true,
  false,
  1,
  2,
  Number.NaN,
  DATE_ONE,
  null,
  MISSING,
]
export const literalValues: ReadonlyArray<FieldValue> = [
  `a`,
  PREFIXED,
  true,
  false,
  1,
  Number.NaN,
  null,
]

export type SeedRow = { v: FieldValue; optimistic: boolean }
export type Operation =
  | { type: `insert`; v: FieldValue; reuse?: number }
  | { type: `update`; target: number; v: FieldValue }
  | { type: `delete`; target: number }
export type History =
  | { kind: `snapshot`; rows: Array<SeedRow>; predicate: Predicate }
  | {
      kind: `changes`
      rows: Array<FieldValue>
      predicate: Predicate
      transactions: Array<Array<Operation>>
    }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ModelRow = {
  id: string
  v: FieldValue
  $hasPendingWrites: boolean
  $origin: `local` | `remote`
  $key: string
}

export function operandValue(operand: Operand, row: ModelRow): unknown {
  switch (operand.kind) {
    case `field`:
      return row.v === MISSING ? undefined : row.v
    case `literal`:
      return operand.value === MISSING ? undefined : operand.value
    case `virtual`:
      return row[operand.name]
  }
}

// SQL equality: nullish is UNKNOWN, NaN equals NaN, a Date compares as its
// timestamp, and other values compare by type and value.
export function expectedEquality(a: unknown, b: unknown): Truth {
  if (a === null || a === undefined || b === null || b === undefined) {
    return null
  }
  const left = a instanceof Date ? a.getTime() : a
  const right = b instanceof Date ? b.getTime() : b
  if (Number.isNaN(left) && Number.isNaN(right)) return true
  return typeof left === typeof right && left === right
}

// Kleene logic: FALSE dominates AND, TRUE dominates OR, NOT keeps UNKNOWN.
export function expectedTruth(predicate: Predicate, row: ModelRow): Truth {
  switch (predicate.kind) {
    case `eq`:
      return expectedEquality(
        operandValue(predicate.left, row),
        operandValue(predicate.right, row),
      )
    case `not`: {
      const value = expectedTruth(predicate.arg, row)
      return value === null ? null : !value
    }
    case `and`: {
      const values = predicate.args.map((arg) => expectedTruth(arg, row))
      if (values.includes(false)) return false
      return values.includes(null) ? null : true
    }
    case `or`: {
      const values = predicate.args.map((arg) => expectedTruth(arg, row))
      if (values.includes(true)) return true
      return values.includes(null) ? null : false
    }
  }
}

// A subscriber without initial state sees a TRUE row only after a later
// insert or update touches it.
export function expectedVisible(
  predicate: Predicate,
  rows: ReadonlyMap<string, ModelRow>,
  touched?: ReadonlySet<string>,
): Array<string> {
  return [...rows.values()]
    .filter(
      (row) =>
        expectedTruth(predicate, row) === true &&
        (touched === undefined || touched.has(row.id)),
    )
    .map((row) => row.id)
    .sort()
}

// Updates between these values are no-ops outside this grammar.
export function equivalentFieldValues(a: FieldValue, b: FieldValue): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  return Object.is(a, b)
}

export function settledModelRow(id: string, v: FieldValue): ModelRow {
  return { id, v, $hasPendingWrites: false, $origin: `remote`, $key: id }
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

export const fieldValueArbitrary = fc.constantFrom(...fieldValues)
export const operandArbitrary: fc.Arbitrary<Operand> = fc.oneof(
  { weight: 4, arbitrary: fc.constant({ kind: `field` as const }) },
  {
    weight: 4,
    arbitrary: fc
      .constantFrom(...literalValues)
      .map((value): Operand => ({ kind: `literal`, value })),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(
        `$hasPendingWrites` as const,
        `$origin` as const,
        `$key` as const,
      )
      .map((name): Operand => ({ kind: `virtual`, name })),
  },
)
export const leafArbitrary: fc.Arbitrary<Predicate> = fc
  .tuple(operandArbitrary, operandArbitrary)
  .map(([left, right]) => ({ kind: `eq` as const, left, right }))

export const predicateArbitrary: fc.Arbitrary<Predicate> = fc.letrec<{
  predicate: Predicate
}>((tie) => ({
  predicate: fc.oneof(
    { depthSize: `small`, maxDepth: 3 },
    leafArbitrary,
    tie(`predicate`).map((arg) => ({ kind: `not` as const, arg })),
    fc
      .tuple(
        fc.constantFrom(`and` as const, `or` as const),
        tie(`predicate`),
        tie(`predicate`),
      )
      .map(([kind, left, right]) => ({
        kind,
        args: [left, right] as [Predicate, Predicate],
      })),
  ),
})).predicate

// A top-level `eq(v, string | boolean)` conjunct lets a subscription skip
// batches that cannot match and lets an unindexed snapshot reject stored rows
// before copying them. Histories favor that shape so generated histories
// exercise both shortcuts, not only the full filter.
export const prefilterablePredicateArbitrary: fc.Arbitrary<Predicate> = fc
  .tuple(
    fc.constantFrom<FieldValue>(`a`, PREFIXED, true),
    fc.option(predicateArbitrary, { nil: undefined }),
  )
  .map(([value, rest]): Predicate => {
    const conjunct: Predicate = {
      kind: `eq`,
      left: { kind: `field` },
      right: { kind: `literal`, value },
    }
    return rest === undefined
      ? conjunct
      : { kind: `and`, args: [conjunct, rest] }
  })

// Histories favor one matching and one non-matching string so rows cross the
// predicate boundary often; the full domain stays reachable.
export const changeValueArbitrary = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom<FieldValue>(`a`, `b`) },
  fieldValueArbitrary,
)

export const operationArbitrary: fc.Arbitrary<Operation> = fc.oneof(
  fc
    .tuple(
      changeValueArbitrary,
      fc.option(fc.nat({ max: 7 }), { nil: undefined }),
    )
    .map(([v, reuse]): Operation =>
      reuse === undefined
        ? { type: `insert`, v }
        : { type: `insert`, v, reuse },
    ),
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.nat({ max: 7 }), changeValueArbitrary)
      .map(([target, v]): Operation => ({ type: `update`, target, v })),
  },
  fc.nat({ max: 7 }).map((target): Operation => ({ type: `delete`, target })),
)

export const historyArbitrary: fc.Arbitrary<History> = fc.oneof(
  fc.record({
    kind: fc.constant(`snapshot` as const),
    rows: fc.array(
      fc.record({ v: changeValueArbitrary, optimistic: fc.boolean() }),
      { minLength: 1, maxLength: 6 },
    ),
    predicate: fc.oneof(predicateArbitrary, prefilterablePredicateArbitrary),
  }),
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant(`changes` as const),
      rows: fc.array(changeValueArbitrary, { maxLength: 5 }),
      predicate: fc.oneof(predicateArbitrary, {
        weight: 2,
        arbitrary: prefilterablePredicateArbitrary,
      }),
      transactions: fc.array(
        fc.array(operationArbitrary, { minLength: 1, maxLength: 3 }),
        { minLength: 1, maxLength: 6 },
      ),
    }),
  },
)

// Kleene and two-valued logic disagree on each snapshot history. The first is
// the negated nullish comparison that a FALSE-for-UNKNOWN fast path misses.
export const fixedHistories: ReadonlyArray<History> = [
  {
    kind: `snapshot`,
    rows: [
      { v: `a`, optimistic: false },
      { v: `b`, optimistic: false },
      { v: null, optimistic: false },
      { v: MISSING, optimistic: false },
    ],
    predicate: { kind: `not`, arg: fieldEq(`a`) },
  },
  {
    kind: `snapshot`,
    rows: [
      { v: `a`, optimistic: true },
      { v: null, optimistic: false },
      { v: Number.NaN, optimistic: false },
      { v: PREFIXED, optimistic: true },
    ],
    predicate: {
      kind: `or`,
      args: [
        {
          kind: `not`,
          arg: {
            kind: `eq`,
            left: { kind: `literal`, value: true },
            right: { kind: `field` },
          },
        },
        {
          kind: `eq`,
          left: { kind: `virtual`, name: `$hasPendingWrites` },
          right: { kind: `literal`, value: true },
        },
      ],
    },
  },
  {
    kind: `snapshot`,
    rows: [
      { v: PREFIXED, optimistic: false },
      { v: `a`, optimistic: false },
      { v: Number.NaN, optimistic: false },
      { v: 1, optimistic: false },
      { v: MISSING, optimistic: false },
    ],
    predicate: {
      kind: `and`,
      args: [
        { kind: `not`, arg: fieldEq(PREFIXED) },
        { kind: `not`, arg: fieldEq(Number.NaN) },
      ],
    },
  },
]

// An unindexed snapshot may reject stored rows by one field before copying
// them. A pending optimistic row is visible although it is not yet synced.
export const fixedPrefilteredSnapshot: History = {
  kind: `snapshot`,
  rows: [
    { v: `a`, optimistic: true },
    { v: `a`, optimistic: false },
    { v: `b`, optimistic: true },
  ],
  predicate: fieldEq(`a`),
}

// Each change history moves rows across a predicate whose equality operand a
// skip-if-no-match shortcut can misread.
export const fixedChangeHistories: ReadonlyArray<History> = [
  {
    // `or` operands are alternatives, not conjuncts.
    kind: `changes`,
    rows: [`b`, `a`],
    predicate: { kind: `or`, args: [fieldEq(`a`), fieldEq(true)] },
    transactions: [
      [{ type: `update`, target: 0, v: true }],
      [
        { type: `update`, target: 1, v: false },
        { type: `insert`, v: true },
      ],
    ],
  },
  {
    // A valid Date equals its timestamp, so a number literal cannot prefilter
    // by identity.
    kind: `changes`,
    rows: [2, 2],
    predicate: fieldEq(1),
    transactions: [
      [{ type: `update`, target: 0, v: DATE_ONE }],
      [
        { type: `update`, target: 0, v: 2 },
        { type: `update`, target: 1, v: 1 },
      ],
    ],
  },
  {
    // NaN equals NaN, although NaN is not identical to itself.
    kind: `changes`,
    rows: [2],
    predicate: fieldEq(Number.NaN),
    transactions: [[{ type: `update`, target: 0, v: Number.NaN }]],
  },
  {
    // A subscriber without initial state never saw the dropped `b` row.
    // Deleting it and reinserting its key with a matching value must publish
    // the new row, not treat it as a duplicate insert.
    kind: `changes`,
    rows: [],
    predicate: fieldEq(`a`),
    transactions: [
      [
        { type: `insert`, v: `a` },
        { type: `insert`, v: `b` },
      ],
      [{ type: `delete`, target: 1 }],
      [{ type: `insert`, v: `a`, reuse: 0 }],
    ],
  },
  {
    // A row that moves out must be retracted, including inside one batch.
    kind: `changes`,
    rows: [`a`, `a`, `b`],
    predicate: {
      kind: `and`,
      args: [fieldEq(`a`), { kind: `not`, arg: fieldEq(PREFIXED) }],
    },
    transactions: [
      [
        { type: `update`, target: 0, v: `b` },
        { type: `update`, target: 2, v: `a` },
      ],
      [
        { type: `delete`, target: 1 },
        { type: `insert`, v: `a` },
        { type: `update`, target: 0, v: `a` },
      ],
    ],
  },
]
