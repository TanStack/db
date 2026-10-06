import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, PropRef, Value } from '../../../src/query/ir.js'
import { oraclePropertyOptions, oracleRuns } from '../../oracle-config.js'

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
 * - A Temporal value equals a Temporal value of the same kind and string.
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

const PROPERTY = `evaluators.in`
const PREFIX = `\u0000tanstack-db:binary:`
const shared = { id: 1 }
const pool: ReadonlyArray<unknown> = [
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

const item = fc.constantFrom(...pool)
const inCase: fc.Arbitrary<InCase> = fc.record({
  value: item,
  list: fc.array(item, { maxLength: 6 }),
  listFromRow: fc.boolean(),
})

type Evaluate = (testCase: InCase) => unknown

function evaluateWithProduction(testCase: InCase): unknown {
  const listExpression = testCase.listFromRow
    ? new PropRef([`row`, `list`])
    : new Value(testCase.list)
  const evaluate = compileExpression(
    new Func(`in`, [new PropRef([`row`, `value`]), listExpression]),
  )
  // Evaluate twice for other rows first, so an evaluator that caches the list
  // between rows is checked against a list it must not reuse.
  evaluate({ row: { value: `a`, list: [`a`] } })
  return evaluate({ row: { value: testCase.value, list: testCase.list } })
}

function check(evaluate: Evaluate, testCase: InCase): void {
  const expected = referenceIn(testCase.value, testCase.list)
  const actual = evaluate(testCase)
  if (actual !== expected) {
    throw new Error(
      `in mismatch: expected ${String(expected)}, got ${String(actual)} for ${describeCase(testCase)}`,
    )
  }
}

function describeCase(testCase: InCase): string {
  const show = (value: unknown): string =>
    typeof value === `bigint`
      ? `${value}n`
      : Object.is(value, -0)
        ? `-0`
        : value instanceof Date
          ? `Date(${value.getTime()})`
          : isBytes(value)
            ? `bytes[${[...value].join(`,`)}]`
            : value === shared
              ? `shared`
              : typeof value === `object` && value !== null
                ? String(value)
                : typeof value === `string`
                  ? JSON.stringify(value)
                  : String(value)
  return `value=${show(testCase.value)} list=[${testCase.list.map(show).join(`, `)}] listFromRow=${testCase.listFromRow}`
}

describe(`in evaluator`, () => {
  const property = fc.property(inCase, (testCase) =>
    check(evaluateWithProduction, testCase),
  )

  it(`agrees with the reference over a fixed campaign`, () => {
    fc.assert(property, { numRuns: oracleRuns(2000), seed: 0x2029 })
  })

  it(`agrees with the reference over a random or replayed campaign`, () => {
    fc.assert(property, oraclePropertyOptions(2000, PROPERTY))
  })

  it.each([
    [`a Date and its timestamp`, 1000, [new Date(1000)], true],
    [`NaN and an invalid Date`, Number.NaN, [new Date(Number.NaN)], true],
    [`-0 and 0`, -0, [0], true],
    [`a BigInt and a Number`, 1n, [1], false],
    [`equal bytes`, Buffer.from([1, 2]), [new Uint8Array([1, 2])], true],
    [`bytes and their internal key`, PREFIX, [new Uint8Array([])], false],
    [`a structural copy`, { id: 1 }, [shared], false],
    [`an empty list`, `a`, [], false],
  ] as const)(`pins %s`, (_name, value, list, expected) => {
    const testCase = { value, list: [...list], listFromRow: false }
    expect(referenceIn(value, testCase.list)).toBe(expected)
    check(evaluateWithProduction, testCase)
  })

  it(`rejects an evaluator that compares raw values`, () => {
    // Calibration: without normalization a Date never equals its timestamp
    // and equal byte arrays are different objects.
    const raw: Evaluate = ({ value, list }) =>
      value === null || value === undefined
        ? null
        : list.some((entry) => entry === value)
    expect(() =>
      fc.assert(
        fc.property(inCase, (testCase) => check(raw, testCase)),
        { numRuns: 500, seed: 0x2029 },
      ),
    ).toThrow(/in mismatch/)
  })
})
