import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, PropRef, Value } from '../../../src/query/ir.js'
import { oraclePropertyOptions, oracleRuns } from '../../oracle-config.js'

/**
 * # Which values does `in` find in a list?
 *
 * Contract: TanStack DB's `inArray(value, list)` returns UNKNOWN (`null`) for a
 * null or undefined value. A list that is not an array is FALSE.
 * Otherwise the result is TRUE when some list item equals the value under the
 * evaluator's equality, and FALSE when none does. A null or undefined item
 * never equals a value. The equality is the one `eq` documents in
 * `src/query/compiler/evaluators.ts`:
 *
 * - `NaN` and an invalid Date equal each other and nothing else.
 * - A valid Date equals its millisecond timestamp, and another Date with the
 *   same timestamp.
 * - Two Uint8Arrays (Buffers included) are equal when their bytes are equal.
 * - Temporal kinds with an intrinsic `.equals()` use that relation. This
 *   includes equivalent time-zone aliases for ZonedDateTime, but excludes a
 *   distinct fixed-offset zone. PlainMonthDay and PlainYearMonth also retain
 *   their reference ISO year and day, even when default display omits them.
 *   Duration has no `.equals()`; its ten fields must match, so PT1H and PT60M
 *   are distinct. Changelog #1519 explicitly preserves that distinction for
 *   equivalent Duration forms under `eq`.
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
 * arrays, a Buffer, Temporal values including ZonedDateTime zone aliases,
 * a forged tag, a borrowed prototype, shadowed display and field members,
 * reference ISO year/day differences hidden by default display, and Duration carry
 * forms with equal display but distinct fields, one shared object and a
 * structurally equal copy, `null` and `undefined`. Lists have zero to six
 * items and may repeat. The list is a constant `Value`, the shape that join
 * demand builds, or a row field, so changing lists are also checked.
 *
 * Production driver: compile `in` with the public IR and evaluate it for
 * each row, as a WHERE clause does.
 *
 * Refinement check: production and the model return the same value for every
 * case. Each property runs a fixed campaign and a random or replayed campaign.
 * A calibration test feeds the checker an evaluator that compares raw values
 * without normalization and requires the checker to reject it.
 *
 * Limits: this owner checks the boolean result of `in` for ordinary values
 * from one Temporal polyfill copy and the listed display shadows. It does not
 * claim mixed Temporal implementations, replaced genuine prototypes, or
 * arbitrary custom prototypes that imitate Temporal intrinsics. The byte
 * classifier also excludes genuine Uint8Arrays with an own display-tag
 * shadow. WHERE
 * publication, indexes, and subset loading have other owners.
 */

const PROPERTY = `evaluators.in`
const PREFIX = `\u0000tanstack-db:binary:`
const shared = { id: 1 }
const plainDate = Temporal.PlainDate.from(`2024-01-01`)
const forgedPlainDate = {
  [Symbol.toStringTag]: `Temporal.PlainDate`,
  toString: () => `2024-01-01`,
}
const borrowedPlainDate = Object.assign(
  Object.create(Temporal.PlainDate.prototype) as object,
  { toString: () => `2024-01-01` },
)
const shadowedTagPlainDate = Temporal.PlainDate.from(`2024-01-01`)
Object.defineProperty(shadowedTagPlainDate, Symbol.toStringTag, {
  value: `ordinary`,
})
const shadowedTextPlainDate = Temporal.PlainDate.from(`2024-01-01`)
Object.defineProperty(shadowedTextPlainDate, `toString`, {
  value: () => `unrelated text`,
})
const leapMonthDay = new Temporal.PlainMonthDay(2, 29, `iso8601`, 1972)
const sameLeapMonthDay = new Temporal.PlainMonthDay(2, 29, `iso8601`, 1972)
const otherReferenceMonthDay = new Temporal.PlainMonthDay(
  2,
  29,
  `iso8601`,
  2004,
)
const firstYearMonth = new Temporal.PlainYearMonth(2024, 2, `iso8601`, 1)
const sameFirstYearMonth = new Temporal.PlainYearMonth(2024, 2, `iso8601`, 1)
const otherReferenceYearMonth = new Temporal.PlainYearMonth(
  2024,
  2,
  `iso8601`,
  20,
)
const hourDuration = Temporal.Duration.from(`PT1H`)
const sameHourDuration = Temporal.Duration.from(`PT1H`)
const sixtyMinuteDuration = Temporal.Duration.from(`PT60M`)
const secondDuration = Temporal.Duration.from({ seconds: 1 })
const sameSecondDuration = Temporal.Duration.from({ seconds: 1 })
const shadowedSecondDuration = Temporal.Duration.from({ seconds: 1 })
Object.defineProperty(shadowedSecondDuration, `seconds`, { value: 2 })
const thousandMillisecondDuration = Temporal.Duration.from({
  milliseconds: 1000,
})
const sameThousandMillisecondDuration = Temporal.Duration.from({
  milliseconds: 1000,
})
const millionMicrosecondDuration = Temporal.Duration.from({
  microseconds: 1_000_000,
})
const shadowedHourDuration = Temporal.Duration.from(`PT1H`)
Object.defineProperty(shadowedHourDuration, `toString`, {
  value: () => `PT2H`,
})
const forgedHourDuration = {
  [Symbol.toStringTag]: `Temporal.Duration`,
  toString: () => `PT1H`,
}
const utcZoned = Temporal.ZonedDateTime.from(`2024-01-15T09:00:00+00:00[UTC]`)
const aliasZoned = Temporal.ZonedDateTime.from(
  `2024-01-15T09:00:00+00:00[Etc/UTC]`,
)
const offsetZoned = Temporal.ZonedDateTime.from(
  `2024-01-15T09:00:00+00:00[+00:00]`,
)
const shadowedOffsetZoned = Temporal.ZonedDateTime.from(
  `2024-01-15T09:00:00+00:00[+00:00]`,
)
Object.defineProperty(shadowedOffsetZoned, `timeZoneId`, { value: `UTC` })
const forgedZoned = {
  [Symbol.toStringTag]: `Temporal.ZonedDateTime`,
  epochNanoseconds: utcZoned.epochNanoseconds,
  timeZoneId: `UTC`,
  calendarId: `iso8601`,
  toString: () => `unrelated plain object`,
}
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
  plainDate,
  Temporal.PlainDate.from(`2024-01-01`),
  Temporal.PlainTime.from(`10:00`),
  forgedPlainDate,
  borrowedPlainDate,
  shadowedTagPlainDate,
  shadowedTextPlainDate,
  leapMonthDay,
  sameLeapMonthDay,
  otherReferenceMonthDay,
  firstYearMonth,
  sameFirstYearMonth,
  otherReferenceYearMonth,
  hourDuration,
  sameHourDuration,
  sixtyMinuteDuration,
  secondDuration,
  sameSecondDuration,
  shadowedSecondDuration,
  thousandMillisecondDuration,
  sameThousandMillisecondDuration,
  millionMicrosecondDuration,
  shadowedHourDuration,
  forgedHourDuration,
  utcZoned,
  aliasZoned,
  offsetZoned,
  shadowedOffsetZoned,
  forgedZoned,
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

// The trusted polyfill methods inspect Temporal's internal slots. A user can
// shadow an instance's tag, equals, or toString, and can borrow its prototype;
// none of those visible properties establishes the brand. The bounded model
// tests the trusted methods directly and never imports production's classifier.
const temporalEqualities = [
  [`Instant`, Temporal.Instant.prototype.equals],
  [`PlainDate`, Temporal.PlainDate.prototype.equals],
  [`PlainDateTime`, Temporal.PlainDateTime.prototype.equals],
  [`PlainMonthDay`, Temporal.PlainMonthDay.prototype.equals],
  [`PlainTime`, Temporal.PlainTime.prototype.equals],
  [`PlainYearMonth`, Temporal.PlainYearMonth.prototype.equals],
  [`ZonedDateTime`, Temporal.ZonedDateTime.prototype.equals],
] as const

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
const durationGetters = durationFields.map(
  (field) =>
    Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, field)!.get!,
)

type TemporalBrand =
  | { kind: string; equals: (other: unknown) => boolean }
  | { kind: `Duration`; fields: ReadonlyArray<number> }

function temporalBrand(value: unknown): TemporalBrand | undefined {
  if (typeof value !== `object` || value === null) return undefined
  for (const [kind, equals] of temporalEqualities) {
    try {
      if (Reflect.apply(equals, value, [value]) === true) {
        return {
          kind,
          equals: (other) => Reflect.apply(equals, value, [other]),
        }
      }
    } catch {
      // A borrowed or forged prototype has no Temporal internal slots.
    }
  }
  try {
    return {
      kind: `Duration`,
      fields: durationGetters.map((get) => Reflect.apply(get, value, [])),
    }
  } catch {
    return undefined
  }
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
  const leftTemporal = temporalBrand(left)
  const rightTemporal = temporalBrand(right)
  if (leftTemporal || rightTemporal) {
    if (
      !leftTemporal ||
      !rightTemporal ||
      leftTemporal.kind !== rightTemporal.kind
    ) {
      return false
    }
    if (`fields` in leftTemporal && `fields` in rightTemporal) {
      return leftTemporal.fields.every(
        (field, index) => field === rightTemporal.fields[index],
      )
    }
    return `equals` in leftTemporal && leftTemporal.equals(right)
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

type InCase = { value: unknown; list: unknown; listFromRow: boolean }

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

// The same normalized equality also feeds compiled `eq`. Check its public
// result alongside both `in` paths so a repaired list key cannot mask a
// remaining direct-predicate collision.
function evaluateEqWithProduction(left: unknown, right: unknown): unknown {
  const evaluate = compileExpression(
    new Func(`eq`, [
      new PropRef([`row`, `value`]),
      new PropRef([`row`, `other`]),
    ]),
  )
  return evaluate({ row: { value: left, other: right } })
}

function checkEqualityPaths(
  left: unknown,
  right: unknown,
  expected: boolean,
): void {
  expect(referenceEqual(left, right)).toBe(expected)
  for (const [direction, value, other] of [
    [`forward`, left, right],
    [`reverse`, right, left],
  ] as const) {
    expect
      .soft(evaluateEqWithProduction(value, other), `eq ${direction}`)
      .toBe(expected)
    for (const listFromRow of [false, true]) {
      const testCase = { value, list: [other], listFromRow }
      expect(referenceIn(value, testCase.list)).toBe(expected)
      expect
        .soft(
          evaluateWithProduction(testCase),
          `in ${listFromRow ? `row-supplied` : `constant`} ${direction}`,
        )
        .toBe(expected)
    }
  }
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
  const show = (value: unknown): string => {
    if (value === forgedPlainDate) return `forged PlainDate tag`
    if (value === borrowedPlainDate) return `borrowed PlainDate prototype`
    if (value === shadowedTagPlainDate) return `PlainDate with shadowed tag`
    if (value === shadowedTextPlainDate) return `PlainDate with shadowed text`
    if (value === shadowedHourDuration) return `Duration with shadowed text`
    if (value === forgedHourDuration) return `forged Duration tag`
    return typeof value === `bigint`
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
                ? (() => {
                    try {
                      return String(value)
                    } catch {
                      return `object with borrowed Temporal prototype`
                    }
                  })()
                : typeof value === `string`
                  ? JSON.stringify(value)
                  : String(value)
  }
  const list = Array.isArray(testCase.list)
    ? `[${testCase.list.map(show).join(`, `)}]`
    : show(testCase.list)
  return `value=${show(testCase.value)} list=${list} listFromRow=${testCase.listFromRow}`
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

  it.each([false, true])(
    `returns false for a non-array %s list`,
    (listFromRow) => {
      check(evaluateWithProduction, { value: `a`, list: `a`, listFromRow })
    },
  )

  it.each([false, true])(
    `matches equivalent zone aliases in a %s list and rejects a distinct zone`,
    (listFromRow) => {
      // Temporal's own equality is the external semantic base, while the
      // model below keeps the two expected outcomes explicit.
      expect(utcZoned.equals(aliasZoned)).toBe(true)
      expect(offsetZoned.equals(aliasZoned)).toBe(false)
      check(evaluateWithProduction, {
        value: aliasZoned,
        list: [utcZoned],
        listFromRow,
      })
      check(evaluateWithProduction, {
        value: offsetZoned,
        list: [utcZoned],
        listFromRow,
      })
    },
  )

  it.each([false, true])(
    `rejects a forged tag and a shadowed zone in a %s list`,
    (listFromRow) => {
      expect(utcZoned.equals(shadowedOffsetZoned)).toBe(false)
      for (const value of [forgedZoned, shadowedOffsetZoned]) {
        check(evaluateWithProduction, {
          value,
          list: [utcZoned],
          listFromRow,
        })
      }
    },
  )

  it.each(
    [false, true].flatMap((listFromRow) =>
      [
        [`forged own tag`, forgedPlainDate],
        [`borrowed prototype`, borrowedPlainDate],
        [`shadowed own tag`, shadowedTagPlainDate],
        [`shadowed toString`, shadowedTextPlainDate],
      ].map(([name, value]) => ({ name, value, listFromRow })),
    ),
  )(
    `uses the native brand for $name with listFromRow=$listFromRow`,
    ({ value, listFromRow }) => {
      check(evaluateWithProduction, {
        value,
        list: [plainDate],
        listFromRow,
      })
    },
  )

  it.each([false, true])(
    `matches Duration fields, while keeping equivalent representations distinct in a %s list`,
    (listFromRow) => {
      check(evaluateWithProduction, {
        value: sameHourDuration,
        list: [hourDuration],
        listFromRow,
      })
      check(evaluateWithProduction, {
        value: sixtyMinuteDuration,
        list: [hourDuration],
        listFromRow,
      })
      check(evaluateWithProduction, {
        value: shadowedHourDuration,
        list: [hourDuration],
        listFromRow,
      })
      check(evaluateWithProduction, {
        value: forgedHourDuration,
        list: [hourDuration],
        listFromRow,
      })
    },
  )

  it(`keeps reference ISO fields in PlainMonthDay and PlainYearMonth equality`, () => {
    // Native equals, not default display, is the independent semantic base.
    // Both pairs have equal display text but different reference ISO fields.
    expect(leapMonthDay.toString()).toBe(otherReferenceMonthDay.toString())
    expect(leapMonthDay.equals(sameLeapMonthDay)).toBe(true)
    expect(leapMonthDay.equals(otherReferenceMonthDay)).toBe(false)
    expect(firstYearMonth.toString()).toBe(otherReferenceYearMonth.toString())
    expect(firstYearMonth.equals(sameFirstYearMonth)).toBe(true)
    expect(firstYearMonth.equals(otherReferenceYearMonth)).toBe(false)
    for (const value of [
      leapMonthDay,
      sameLeapMonthDay,
      otherReferenceMonthDay,
      firstYearMonth,
      sameFirstYearMonth,
      otherReferenceYearMonth,
    ]) {
      expect(pool).toContain(value)
    }

    checkEqualityPaths(leapMonthDay, sameLeapMonthDay, true)
    checkEqualityPaths(leapMonthDay, otherReferenceMonthDay, false)
    checkEqualityPaths(firstYearMonth, sameFirstYearMonth, true)
    checkEqualityPaths(firstYearMonth, otherReferenceYearMonth, false)
  })

  it(`keeps Duration fields distinct across second and subsecond carries`, () => {
    // Changelog #1519 promises that equivalent Duration representations stay
    // unequal under `eq`. The captured intrinsic field getters in the model
    // preserve that difference while their default display text collides.
    expect(secondDuration.toString()).toBe(
      thousandMillisecondDuration.toString(),
    )
    expect(thousandMillisecondDuration.toString()).toBe(
      millionMicrosecondDuration.toString(),
    )
    for (const value of [
      secondDuration,
      sameSecondDuration,
      shadowedSecondDuration,
      thousandMillisecondDuration,
      sameThousandMillisecondDuration,
      millionMicrosecondDuration,
    ]) {
      expect(pool).toContain(value)
    }

    checkEqualityPaths(secondDuration, sameSecondDuration, true)
    // An own getter shadow cannot change the intrinsic Duration fields.
    expect(shadowedSecondDuration.seconds).toBe(2)
    checkEqualityPaths(secondDuration, shadowedSecondDuration, true)
    checkEqualityPaths(
      thousandMillisecondDuration,
      sameThousandMillisecondDuration,
      true,
    )
    checkEqualityPaths(secondDuration, thousandMillisecondDuration, false)
    checkEqualityPaths(
      thousandMillisecondDuration,
      millionMicrosecondDuration,
      false,
    )
  })

  it(`rejects display-string equality for equivalent zone aliases`, () => {
    const lexical: Evaluate = ({ value, list }) =>
      Array.isArray(list) &&
      list.some((candidate) => String(candidate) === String(value))
    expect(() =>
      check(lexical, {
        value: aliasZoned,
        list: [utcZoned],
        listFromRow: false,
      }),
    ).toThrow(/in mismatch/)
  })

  it(`rejects an evaluator that compares raw values`, () => {
    // Calibration: without normalization a Date never equals its timestamp
    // and equal byte arrays are different objects.
    const raw: Evaluate = ({ value, list }) =>
      value === null || value === undefined
        ? null
        : Array.isArray(list) && list.some((entry) => entry === value)
    expect(() =>
      fc.assert(
        fc.property(inCase, (testCase) => check(raw, testCase)),
        { numRuns: 500, seed: 0x2029 },
      ),
    ).toThrow(/in mismatch/)
  })
})
