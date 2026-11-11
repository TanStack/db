import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { expect, it } from 'vitest'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, PropRef, Value } from '../../../src/query/ir.js'
import {
  differs,
  oracleProperty,
  oracleReplayTest,
  oracleRoute,
  pass,
  violation,
} from '../../oracle-config.js'
import { declareOracle } from '../../oracle-declaration.js'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../oracle-config.js'

/**
 * # Which values does `in` find in a list?
 *
 * Contract: `in(value, list)` is SQL `IN` under three-valued logic. A null or
 * undefined value is UNKNOWN (`null`). A list that is not an array is FALSE.
 * Otherwise the result is TRUE when some list item equals the value under the
 * evaluator's equality, and FALSE when none does. A null or undefined item
 * never equals a value. The equality is the one `eq` documents in
 * `src/query/compiler/evaluators.ts`:
 *
 * - `NaN` and an invalid Date equal each other and nothing else.
 * - A valid Date equals its millisecond timestamp, and another Date with the
 *   same timestamp.
 * - Two Uint8Arrays (Buffers included) are equal when their bytes are equal.
 * - A Temporal value equals one of the same kind and string, except Duration:
 *   its ten fields determine equality even when two forms display alike.
 * - Every other pair compares with `===`, so `-0` equals `0`, `1n` does not
 *   equal `1`, and objects compare by reference.
 *
 * Model: `referenceIn` walks the list and applies `referenceEqual`, which
 * restates the rules above. It imports no production comparison or
 * normalization helper.
 *
 * Domain: values and items come from a pool that contains the boundaries
 * of each rule: equal and unequal strings, a string that begins with the
 * internal normalization prefix, booleans, `0`, `-0`, `1`, `NaN`, `1n`, a
 * valid Date and its timestamp, an invalid Date, equal and unequal byte
 * arrays, a Buffer, Temporal values, one shared object and a structurally
 * equal copy, `null` and `undefined`. Lists have zero to six items and may
 * repeat items. The list is a constant `Value`, the shape that join demand
 * builds, or a row field, so a list that changes between rows is also checked.
 *
 * Production driver: compile `in` with the public IR and evaluate it for
 * each row, as a WHERE clause does.
 *
 * Refinement check: production and the model return the same value for every
 * case. Each property runs a fixed campaign and a random or replayed campaign.
 * A calibration test feeds the checker an evaluator that compares raw values
 * without normalization and requires the checker to reject it.
 *
 * Limits: this owner checks the boolean result of `in` only. WHERE
 * publication, indexes, and subset loading have other owners.
 */

const PREFIX = `\u0000tanstack-db:binary:`
const shared = { id: 1 }
const originalPool: ReadonlyArray<unknown> = [
  `a`,
  `b`,
  PREFIX,
  true,
  false,
  0,
  -0,
  1,
  Number.NaN,
  1n,
  new Date(1000),
  new Date(1000),
  1000,
  new Date(Number.NaN),
  new Uint8Array([1, 2]),
  new Uint8Array([1, 2]),
  new Uint8Array([1, 3]),
  Buffer.from([1, 2]),
  Temporal.PlainDate.from(`2024-01-01`),
  Temporal.PlainDate.from(`2024-01-01`),
  Temporal.PlainTime.from(`10:00`),
  Temporal.Duration.from({ seconds: 1 }),
  Temporal.Duration.from({ seconds: 1 }),
  Temporal.Duration.from({ milliseconds: 1000 }),
  shared,
  { id: 1 },
  null,
  undefined,
]

// A Buffer from another realm, such as Node's under jsdom, is not an
// `instanceof Uint8Array` here, so check the view's tag instead.
function isBytes(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === `[object Uint8Array]`
  )
}

function isTemporalValue(value: unknown): value is { toString: () => string } {
  return (
    typeof value === `object` &&
    value !== null &&
    typeof (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] ===
      `string` &&
    (value as { [Symbol.toStringTag]: string })[Symbol.toStringTag].startsWith(
      `Temporal.`,
    )
  )
}

function isNotANumber(value: unknown): boolean {
  return (
    (typeof value === `number` && Number.isNaN(value)) ||
    (value instanceof Date && Number.isNaN(value.getTime()))
  )
}

function asComparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value
}

const durationFields = [
  `years`,
  `months`,
  `weeks`,
  `days`,
  `hours`,
  `minutes`,
  `seconds`,
  `milliseconds`,
  `microseconds`,
  `nanoseconds`,
] as const

function referenceEqual(left: unknown, right: unknown): boolean {
  if (isNotANumber(left) || isNotANumber(right)) {
    return isNotANumber(left) && isNotANumber(right)
  }
  if (isBytes(left) || isBytes(right)) {
    return (
      isBytes(left) &&
      isBytes(right) &&
      left.length === right.length &&
      Array.from(left).every((byte, index) => byte === right[index])
    )
  }
  if (left instanceof Temporal.Duration || right instanceof Temporal.Duration) {
    return (
      left instanceof Temporal.Duration &&
      right instanceof Temporal.Duration &&
      durationFields.every((field) => left[field] === right[field])
    )
  }
  if (isTemporalValue(left) || isTemporalValue(right)) {
    return (
      isTemporalValue(left) &&
      isTemporalValue(right) &&
      (left as Record<symbol, unknown>)[Symbol.toStringTag] ===
        (right as Record<symbol, unknown>)[Symbol.toStringTag] &&
      left.toString() === right.toString()
    )
  }
  return asComparable(left) === asComparable(right)
}

function referenceIn(value: unknown, list: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(list)) return false
  return list.some(
    (item) =>
      item !== null && item !== undefined && referenceEqual(item, value),
  )
}

type InCase = { value: unknown; list: Array<unknown>; listFromRow: boolean }

// These are the ten original fixed inputs, without separate expected answers.
// Their values also enter the pool so each fixed history belongs to the grammar.
const fixedInInputs: ReadonlyArray<{
  name: string
  input: InCase
  excludesMatch?: boolean
}> = [
  {
    name: `a Date and its timestamp`,
    input: { value: 1000, list: [new Date(1000)], listFromRow: false },
  },
  {
    name: `NaN and an invalid Date`,
    input: {
      value: Number.NaN,
      list: [new Date(Number.NaN)],
      listFromRow: false,
    },
  },
  { name: `signed zero`, input: { value: -0, list: [0], listFromRow: false } },
  {
    name: `a BigInt and a Number`,
    input: { value: 1n, list: [1], listFromRow: false },
    excludesMatch: true,
  },
  {
    name: `equal bytes`,
    input: {
      value: Buffer.from([1, 2]),
      list: [new Uint8Array([1, 2])],
      listFromRow: false,
    },
  },
  {
    name: `bytes and their internal key`,
    input: { value: PREFIX, list: [new Uint8Array([])], listFromRow: false },
    excludesMatch: true,
  },
  {
    name: `a structural copy`,
    input: { value: { id: 1 }, list: [shared], listFromRow: false },
    excludesMatch: true,
  },
  {
    name: `equal Duration fields`,
    input: {
      value: Temporal.Duration.from({ seconds: 1 }),
      list: [Temporal.Duration.from({ seconds: 1 })],
      listFromRow: false,
    },
  },
  {
    name: `equivalent Duration forms with different fields`,
    input: {
      value: Temporal.Duration.from({ seconds: 1 }),
      list: [Temporal.Duration.from({ milliseconds: 1000 })],
      listFromRow: false,
    },
    excludesMatch: true,
  },
  {
    name: `an empty list`,
    input: { value: `a`, list: [], listFromRow: false },
  },
]
const pool: ReadonlyArray<unknown> = [
  ...originalPool,
  ...fixedInInputs.flatMap(({ input }) => [input.value, ...input.list]),
]

// History indices denote exact pool references, including distinct Date,
// Duration, byte-array and object instances. This is a test-only abstraction.
// Resolution supplies the actual public values to both model and driver.
// Indices keep Temporal instances out of the framework's serializable history
// domain without replacing the reference-identity cases with copied objects.
type InHistory = { value: number; list: Array<number>; listFromRow: boolean }
type InPlan = InCase & { requiredStates: ReadonlyArray<string> }
const item = fc.integer({ min: 0, max: pool.length - 1 })
const inCase: fc.Arbitrary<InHistory> = fc.record({
  value: item,
  list: fc.array(item, { maxLength: 6 }),
  listFromRow: fc.boolean(),
})
const indexOf = (value: unknown): number => {
  const index = pool.findIndex((entry) => Object.is(entry, value))
  if (index < 0) throw new Error(`fixed IN value is outside the declared pool`)
  return index
}
const fixedHistories = fixedInInputs.map(({ name, input }) => ({
  name,
  history: {
    value: indexOf(input.value),
    list: input.list.map(indexOf),
    listFromRow: input.listFromRow,
  },
}))

const constructionRequirements = new WeakMap<InHistory, ReadonlyArray<string>>()
function constructed(
  builders: ReadonlyArray<ConstructedHistory<InHistory>>,
): ReadonlyArray<ConstructedHistory<InHistory>> {
  return builders.map((builder) => ({
    ...builder,
    build: (history) => {
      const result = { ...builder.build(history) }
      constructionRequirements.set(result, [...builder.enters])
      return result
    },
  }))
}
function resolveIn(history: InHistory): InPlan {
  return {
    value: pool[history.value],
    list: history.list.map((index) => pool[index]),
    listFromRow: history.listFromRow,
    requiredStates: constructionRequirements.get(history) ?? [],
  }
}
function modelIn(plan: InPlan) {
  return {
    result: referenceIn(plan.value, plan.list),
    requiredStates: plan.requiredStates,
  }
}

// A state names a public input premise after its real evaluation returned.
// Negative pair premises exclude another matching tail item. Constructed
// prefixes retain a generated tail and the generated constant/row-list mode.
function recordInReach(
  plan: InCase,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  observe(`reach`, plan.listFromRow ? `row list` : `constant list`)
  if (plan.value == null) observe(`reach`, `unknown operand`)
  if (plan.listFromRow && (plan.list.length !== 1 || plan.list[0] !== `a`))
    observe(`reach`, `changed row list`)
  for (const witness of fixedInInputs) {
    const sameValue = Object.is(plan.value, witness.input.value)
    const containsPrefix = witness.input.list.every((entry, index) =>
      Object.is(plan.list[index], entry),
    )
    const empty = witness.input.list.length === 0
    if (
      sameValue &&
      containsPrefix &&
      (!empty || plan.list.length === 0) &&
      (!witness.excludesMatch ||
        !plan.list.some((entry) => referenceEqual(entry, plan.value)))
    )
      observe(`reach`, witness.name)
  }
}

// Compile the public IN expression. Warm another row first, then record the
// requested row's raw result so stale row-list caches remain distinguishable.
function driveIn(
  plan: InPlan,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  const list = plan.listFromRow
    ? new PropRef([`row`, `list`])
    : new Value(plan.list)
  const evaluate = compileExpression(
    new Func(`in`, [new PropRef([`row`, `value`]), list]),
  )
  evaluate({ row: { value: `a`, list: [`a`] } })
  observe(
    `evaluation returned`,
    evaluate({ row: { value: plan.value, list: plan.list } }),
  )
  recordInReach(plan, observe)
}
function checkIn(
  _plan: InPlan,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelIn>,
): Verdict {
  const returned = trace.find(
    ({ checkpoint }) => checkpoint === `evaluation returned`,
  )
  if (returned === undefined)
    return violation(
      `evaluation returned`,
      `the evaluator did not return`,
      `IN result`,
    )
  const mismatch = differs(
    `evaluation returned`,
    `IN result`,
    returned.value,
    expected.result,
  )
  if (mismatch !== undefined) return mismatch
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  const missing = expected.requiredStates.filter((state) => !reached.has(state))
  return missing.length === 0
    ? pass
    : violation(
        `constructed states`,
        `constructed history did not enter ${missing.join(`, `)}`,
        `constructed reach`,
      )
}

declareOracle({
  model: [referenceIn, modelIn],
  grammar: [inCase],
  check: [checkIn],
})

oracleProperty({
  id: `evaluators.in`,
  law: {
    statement: `IN returns the independent three-valued membership result for each constant or changing row list, with normalized value equality and exact reference leaves.`,
    authority: `The IN and equality contracts in evaluators.ts, stated at the start of this owner.`,
    limits: `The original finite value pool and retained fixed values, arrays of zero to six items, constant or row-field lists. No non-array-list, WHERE publication, index, or subset-loading claim.`,
  },
  owns: [`src/query/compiler/evaluators.ts#compileExpression`],
  histories: {
    arbitrary: inCase,
    runs: 2000,
    fixedSeeds: [0x2029],
    fixed: fixedHistories,
    states: [
      `constant list`,
      `row list`,
      `unknown operand`,
      `changed row list`,
      ...fixedInInputs.map(({ name }) => name),
    ],
    constructed: constructed([
      ...([false, true] as const).map((listFromRow) => ({
        name: listFromRow ? `row list` : `constant list`,
        enters: [listFromRow ? `row list` : `constant list`],
        build: (history: InHistory) => ({ ...history, listFromRow }),
      })),
      {
        name: `unknown operand with a generated list`,
        enters: [`unknown operand`],
        build: (history) => ({
          ...history,
          value: indexOf(history.listFromRow ? null : undefined),
        }),
      },
      {
        name: `row list differs from warmup`,
        enters: [`row list`, `changed row list`],
        build: (history) => ({
          ...history,
          listFromRow: true,
          list: [indexOf(null), ...history.list.slice(0, 5)],
        }),
      },
      ...fixedInInputs.map((witness, index) => ({
        name: `generated tail around ${witness.name}`,
        enters: [witness.name],
        build: (history: InHistory): InHistory => {
          const fixed = fixedHistories[index]!.history
          const tail =
            witness.input.list.length === 0
              ? []
              : history.list
                  .filter(
                    (poolIndex) =>
                      !witness.excludesMatch ||
                      !referenceEqual(pool[poolIndex], witness.input.value),
                  )
                  .slice(0, 6 - fixed.list.length)
          return {
            ...history,
            value: fixed.value,
            list: [...fixed.list, ...tail],
          }
        },
      })),
    ]),
  },
  resolve: resolveIn,
  model: modelIn,
  driver: driveIn,
  check: checkIn,
  calibrations: [
    {
      name: `raw equality omits normalization`,
      law: `IN result`,
      corrupt: (trace, plan) => {
        const raw =
          plan.value == null
            ? null
            : plan.list.some((entry) => entry === plan.value)
        if (raw === referenceIn(plan.value, plan.list)) return undefined
        return trace.map((entry) =>
          entry.checkpoint === `evaluation returned`
            ? { ...entry, value: raw }
            : entry,
        )
      },
    },
    {
      name: `Duration display text erases field differences`,
      law: `IN result`,
      corrupt: (trace, plan) => {
        if (!(plan.value instanceof Temporal.Duration)) return undefined
        const textual = plan.list.some(
          (entry) => String(entry) === String(plan.value),
        )
        if (textual === referenceIn(plan.value, plan.list)) return undefined
        return trace.map((entry) =>
          entry.checkpoint === `evaluation returned`
            ? { ...entry, value: textual }
            : entry,
        )
      },
    },
    {
      name: `omits a constructed state`,
      law: `constructed reach`,
      corrupt: (trace, plan) => {
        const state = plan.requiredStates[0]
        return state === undefined
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `reach` || entry.value !== state,
            )
      },
    },
  ],
})

// Retain the original calibration's seed and 500-candidate ceiling. This
// searches the original 28-value pool with its original arbitrary, rather than
// the enlarged product grammar. The search stops at its first rejection, as
// the old fc.check did. Both clean and raw observations use the shared law.
oracleReplayTest(it)(
  `rejects raw equality within the original calibration search`,
  () => {
    oracleRoute(`calibration`)
    const calibrationItem = fc.constantFrom(...originalPool)
    const calibrationCase: fc.Arbitrary<InCase> = fc.record({
      value: calibrationItem,
      list: fc.array(calibrationItem, { maxLength: 6 }),
      listFromRow: fc.boolean(),
    })
    const candidates = fc.sample(calibrationCase, {
      seed: 0x2029,
      numRuns: 500,
    })
    for (const [index, candidate] of candidates.entries()) {
      // Resolution restores the same exact pool references, including opaque
      // values and distinct objects. It does not serialize or copy those leaves.
      const plan = resolveIn({
        value: indexOf(candidate.value),
        list: candidate.list.map(indexOf),
        listFromRow: candidate.listFromRow,
      })
      const trace: Array<Observation> = []
      driveIn(plan, (checkpoint, value) => trace.push({ checkpoint, value }))
      const expected = modelIn(plan)
      expect(checkIn(plan, trace, expected)).toEqual(pass)
      const raw =
        plan.value == null
          ? null
          : plan.list.some((entry) => entry === plan.value)
      const wrong = checkIn(
        plan,
        trace.map((entry) =>
          entry.checkpoint === `evaluation returned`
            ? { ...entry, value: raw }
            : entry,
        ),
        expected,
      )
      if (
        wrong.kind === `violation` &&
        wrong.law === `IN result` &&
        wrong.checkpoint === `evaluation returned`
      ) {
        process.stdout.write(
          `IN raw-equality calibration rejected candidate ${index + 1} of 500 at seed 8233\n`,
        )
        return
      }
    }
    throw new Error(
      `the shared IN check accepted every raw-equality candidate within the original 500-candidate search`,
    )
  },
)
