import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, PropRef, Value } from '../../../src/query/ir.js'
import { oraclePropertyOptions, oracleRuns } from '../../oracle-config.js'

/**
 * # Which values does `in` find in a list?
 *
 * Transfer law: The public `inArray` API describes array membership. A
 * compiled expression holding a caller-owned array reads that array's current
 * members whenever it evaluates, including entries replaced since compilation.
 * Mutating a Date or byte-array item in place is outside this law. The current
 * evaluator returns UNKNOWN (`null`)
 * for a null or undefined value and FALSE for a list that is not an array.
 * Otherwise the result is TRUE when some list item equals the value under the
 * evaluator's equality, and FALSE when none does. A null or undefined item
 * never equals a value under that membership interpretation. The public
 * guide's broad SQL null statement leaves this last rule open for a separate
 * product decision. The equality is the one `eq` documents in
 * `src/query/compiler/evaluators.ts`:
 *
 * - `NaN` and an invalid Date equal each other and nothing else.
 * - A native Date from either realm equals its millisecond timestamp, and
 *   another Date with the same timestamp.
 * - Two ordinary Uint8Arrays (Buffers included) are equal when their bytes are
 *   equal.
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
 * Model: `referenceIn` walks present indices through the length captured at
 * the start of evaluation and applies `referenceEqual`, which restates the
 * rules above. It imports no production comparison or normalization helper.
 *
 * Domain: values and items come from a pool that contains the boundaries
 * of each rule: equal and unequal strings, a string that begins with the
 * internal normalization prefix, booleans, `0`, `-0`, `1`, `NaN`, `1n`, a
 * local and foreign valid Dates and their timestamps, local and foreign
 * invalid Dates, equal and unequal byte arrays, a Buffer, and native bytes
 * from another realm with equal and unequal content. Temporal
 * values include ZonedDateTime zone aliases, unequal values within each
 * modeled Temporal kind, reference ISO year/day
 * differences hidden by default display, and Duration carry forms with equal
 * display but distinct fields, one shared object and a structurally equal
 * copy, `null` and `undefined`. Lists have zero to six
 * items and may repeat. The list is a constant `Value`, the shape that join
 * demand builds, or a row field. A fixed immutable primitive list checks the
 * compiled constant-list path against the same independent membership model.
 * Fixed histories also compile a caller-owned list, then replace a scalar,
 * Date, or byte-array slot before reevaluating.
 *
 * Production driver: compile `in` with the public IR and evaluate it for
 * each row, as a WHERE clause does.
 *
 * Refinement check: production and the model return the same value for every
 * case at each evaluation checkpoint, including after a list edit. Each
 * property runs a fixed campaign and a random or replayed campaign.
 * A calibration test feeds the checker an evaluator that compares raw values
 * without normalization and requires the checker to reject it.
 *
 * Limits: this owner checks the boolean result of `in` for ordinary values
 * from one Temporal polyfill copy. It does not claim mixed Temporal
 * implementations, caller-modified built-ins, malformed Temporal lookalikes,
 * deliberately shadowed Temporal members, or replaced genuine prototypes. WHERE
 * publication, indexes, and subset loading have other owners.
 */

const PROPERTY = `evaluators.in`
const PREFIX = `\u0000tanstack-db:binary:`
const shared = { id: 1 }
const plainDate = Temporal.PlainDate.from(`2024-01-01`)
const otherPlainDate = Temporal.PlainDate.from(`2024-01-02`)
const instant = Temporal.Instant.from(`2024-01-01T00:00:00Z`)
const sameInstant = Temporal.Instant.from(`2024-01-01T00:00:00Z`)
const otherInstant = Temporal.Instant.from(`2024-01-02T00:00:00Z`)
const plainDateTime = Temporal.PlainDateTime.from(`2024-01-01T10:00`)
const samePlainDateTime = Temporal.PlainDateTime.from(`2024-01-01T10:00`)
const otherPlainDateTime = Temporal.PlainDateTime.from(`2024-01-01T11:00`)
const plainTime = Temporal.PlainTime.from(`10:00`)
const samePlainTime = Temporal.PlainTime.from(`10:00`)
const otherPlainTime = Temporal.PlainTime.from(`11:00`)
const localDate = new Date(1000)
const foreignDate = runInNewContext(`new Date(1000)`) as Date
const laterForeignDate = runInNewContext(`new Date(1001)`) as Date
const localInvalidDate = new Date(Number.NaN)
const foreignInvalidDate = runInNewContext(`new Date(NaN)`) as Date
const foreignBytes = runInNewContext(`new Uint8Array([1, 2])`) as Uint8Array
const unequalForeignBytes = runInNewContext(
  `new Uint8Array([1, 3])`,
) as Uint8Array
const samePlainDate = Temporal.PlainDate.from(`2024-01-01`)
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
const thousandMillisecondDuration = Temporal.Duration.from({
  milliseconds: 1000,
})
const sameThousandMillisecondDuration = Temporal.Duration.from({
  milliseconds: 1000,
})
const millionMicrosecondDuration = Temporal.Duration.from({
  microseconds: 1_000_000,
})
const utcZoned = Temporal.ZonedDateTime.from(`2024-01-15T09:00:00+00:00[UTC]`)
const aliasZoned = Temporal.ZonedDateTime.from(
  `2024-01-15T09:00:00+00:00[Etc/UTC]`,
)
const offsetZoned = Temporal.ZonedDateTime.from(
  `2024-01-15T09:00:00+00:00[+00:00]`,
)
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
  localDate,
  new Date(1000),
  foreignDate,
  laterForeignDate,
  1000,
  localInvalidDate,
  foreignInvalidDate,
  new Uint8Array([1, 2]),
  new Uint8Array([1, 2]),
  new Uint8Array([1, 3]),
  Buffer.from([1, 2]),
  foreignBytes,
  unequalForeignBytes,
  plainDate,
  Temporal.PlainDate.from(`2024-01-01`),
  otherPlainDate,
  instant,
  sameInstant,
  otherInstant,
  plainDateTime,
  samePlainDateTime,
  otherPlainDateTime,
  plainTime,
  samePlainTime,
  otherPlainTime,
  samePlainDate,
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
  thousandMillisecondDuration,
  sameThousandMillisecondDuration,
  millionMicrosecondDuration,
  utcZoned,
  aliasZoned,
  offsetZoned,
  shared,
  { id: 1 },
  null,
  undefined,
]

// The intrinsic typed-array tag reads ordinary byte-view classes across realms.
const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)!.get!

// Date's native method reads the internal timestamp in either realm and
// rejects an object that only borrows the prototype. The reference captures
// that intrinsic directly; it does not import the production Date classifier.
const nativeDateGetTime = Date.prototype.getTime

function nativeDateTimestamp(value: unknown): number | undefined {
  if (typeof value !== `object` || value === null) return undefined
  try {
    return Reflect.apply(nativeDateGetTime, value, [])
  } catch {
    return undefined
  }
}

function isBytes(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Reflect.apply(typedArrayTag, value, []) === `Uint8Array`
  )
}

// The polyfill methods supply the reference equality relation for the
// supported Temporal values. The model never imports production's classifier.
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
      // Ordinary non-Temporal objects fail these intrinsic calls.
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
    Number.isNaN(nativeDateTimestamp(value))
  )
}

function asComparable(value: unknown): unknown {
  return nativeDateTimestamp(value) ?? value
}

function referenceEqual(left: unknown, right: unknown): boolean {
  if (isNotANumber(left) || isNotANumber(right)) {
    return isNotANumber(left) && isNotANumber(right)
  }
  if (isBytes(left) || isBytes(right)) {
    if (!isBytes(left) || !isBytes(right)) return false
    // Materialize the ordinary byte sequences for an independent comparison;
    // production walks indexed elements directly.
    const leftBytes = Array.from(left)
    const rightBytes = Array.from(right)
    return (
      leftBytes.length === rightBytes.length &&
      leftBytes.every((byte, index) => byte === rightBytes[index])
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
  const length = list.length
  for (let index = 0; index < length; index++) {
    if (!(index in list)) continue
    const item = list[index]
    if (item !== null && item !== undefined && referenceEqual(item, value))
      return true
  }
  return false
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

// A kind-only Temporal list key is a plausible wrong normalization: it finds
// an equal copy, but also finds a different value of the same kind. Feed that
// answer through the same comparison used by the generated campaigns.
function evaluateWithKindOnlyTemporalKey(testCase: InCase): boolean | null {
  const kind = temporalBrand(testCase.value)?.kind
  if (
    kind !== undefined &&
    Array.isArray(testCase.list) &&
    testCase.list.some((candidate) => temporalBrand(candidate)?.kind === kind)
  ) {
    return true
  }
  return referenceIn(testCase.value, testCase.list)
}

function describeCase(testCase: InCase): string {
  const show = (value: unknown): string => {
    const dateTime = nativeDateTimestamp(value)
    return typeof value === `bigint`
      ? `${value}n`
      : Object.is(value, -0)
        ? `-0`
        : dateTime !== undefined
          ? `Date(${dateTime})`
          : isBytes(value)
            ? `bytes[${[...value].join(`,`)}]`
            : value === shared
              ? `shared`
              : typeof value === `object` && value !== null
                ? (() => {
                    try {
                      return String(value)
                    } catch {
                      return `object`
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
  const property = fc.asyncProperty(inCase, (testCase) =>
    Promise.resolve().then(() => check(evaluateWithProduction, testCase)),
  )

  it(`agrees with the reference over a fixed campaign`, async () => {
    await fc.assert(property, { numRuns: oracleRuns(2000), seed: 0x2029 })
  })

  it(`agrees with the reference over a random or replayed campaign`, async () => {
    await fc.assert(property, oraclePropertyOptions(2000, PROPERTY))
  })

  it(`reads replaced scalar list members after compilation`, () => {
    const list: Array<unknown> = [1]
    const evaluate = compileExpression(
      new Func(`in`, [new PropRef([`row`, `value`]), new Value(list)]),
    )
    const checkCurrent = (value: unknown) =>
      expect(evaluate({ row: { value } })).toBe(referenceIn(value, list))

    checkCurrent(1)
    list[0] = 2
    checkCurrent(1)
    checkCurrent(2)
    list.push(3)
    checkCurrent(3)
    list.splice(0, 1)
    checkCurrent(2)
  })

  it(`skips sparse holes and nullish items while retaining present members`, () => {
    const list = Array<unknown>(4)
    list[1] = null
    list[2] = undefined
    list[3] = 2
    expect(0 in list).toBe(false)
    const evaluate = compileExpression(
      new Func(`in`, [new PropRef([`row`, `value`]), new Value(list)]),
    )
    for (const value of [1, 2, null, undefined]) {
      expect(evaluate({ row: { value } })).toBe(referenceIn(value, list))
    }
  })

  it(`reads a replaced Date member after compilation`, () => {
    const list = [new Date(1)]
    const evaluate = compileExpression(
      new Func(`in`, [new PropRef([`row`, `value`]), new Value(list)]),
    )
    const checkCurrent = (value: unknown) =>
      expect(evaluate({ row: { value } })).toBe(referenceIn(value, list))

    checkCurrent(1)
    list[0] = new Date(2)
    checkCurrent(1)
    checkCurrent(2)
  })

  it(`reads a replaced byte-array member after compilation`, () => {
    const list = [new Uint8Array([1, 2])]
    const evaluate = compileExpression(
      new Func(`in`, [new PropRef([`row`, `value`]), new Value(list)]),
    )
    const checkCurrent = (value: unknown) =>
      expect(evaluate({ row: { value } })).toBe(referenceIn(value, list))

    checkCurrent(new Uint8Array([1, 2]))
    list[0] = new Uint8Array([1, 3])
    checkCurrent(new Uint8Array([1, 2]))
    checkCurrent(new Uint8Array([1, 3]))
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

  it(`keeps frozen primitive constants in the same membership classes`, () => {
    const lists: ReadonlyArray<ReadonlyArray<unknown>> = [
      Object.freeze([]),
      Object.freeze([0, Number.NaN, 1n, `a`, PREFIX, null, undefined]),
    ]
    const values = [
      0,
      -0,
      Number.NaN,
      new Date(0),
      runInNewContext(`new Date(0)`) as Date,
      new Date(Number.NaN),
      1n,
      1,
      `a`,
      PREFIX,
      `b`,
      null,
      undefined,
      new Uint8Array([0]),
    ]
    for (const list of lists) {
      const evaluate = compileExpression(
        new Func(`in`, [new PropRef([`row`, `value`]), new Value(list)]),
      )
      for (const value of values) {
        expect(evaluate({ row: { value } })).toBe(referenceIn(value, list))
      }
    }
  })

  it(`compares native bytes from another realm by content in every compiled equality path`, () => {
    // The independent model's typed-array intrinsic accepts an ordinary
    // native view across realms.
    expect(foreignBytes instanceof Uint8Array).toBe(false)
    expect(ArrayBuffer.isView(foreignBytes)).toBe(true)
    expect(isBytes(foreignBytes)).toBe(true)
    checkEqualityPaths(foreignBytes, new Uint8Array([1, 2]), true)
    checkEqualityPaths(unequalForeignBytes, new Uint8Array([1, 2]), false)
  })

  it(`compares foreign native Dates by timestamp in every compiled equality path`, () => {
    expect(foreignDate instanceof Date).toBe(false)
    expect(foreignInvalidDate instanceof Date).toBe(false)
    expect(nativeDateTimestamp(foreignDate)).toBe(1000)
    expect(Number.isNaN(nativeDateTimestamp(foreignInvalidDate))).toBe(true)
    checkEqualityPaths(foreignDate, localDate, true)
    checkEqualityPaths(foreignDate, 1000, true)
    checkEqualityPaths(laterForeignDate, localDate, false)
    checkEqualityPaths(laterForeignDate, 1000, false)
    // This Date comes from a second vm context. Its own timestamp must also
    // match, so a classifier restricted to the first foreign prototype fails.
    checkEqualityPaths(laterForeignDate, 1001, true)
    checkEqualityPaths(foreignInvalidDate, localInvalidDate, true)
    checkEqualityPaths(foreignInvalidDate, Number.NaN, true)
    checkEqualityPaths(foreignInvalidDate, localDate, false)
  })

  it(`distinguishes unequal intrinsic values within each Temporal kind`, () => {
    // Native equals supplies each kind's expected identity relation. The
    // public compiler must reject a kind-only equality key in all three paths.
    expect(plainDate.equals(otherPlainDate)).toBe(false)
    expect(instant.equals(sameInstant)).toBe(true)
    expect(instant.equals(otherInstant)).toBe(false)
    expect(plainDateTime.equals(samePlainDateTime)).toBe(true)
    expect(plainDateTime.equals(otherPlainDateTime)).toBe(false)
    expect(plainTime.equals(samePlainTime)).toBe(true)
    expect(plainTime.equals(otherPlainTime)).toBe(false)
    for (const [left, equal, other] of [
      [plainDate, samePlainDate, otherPlainDate],
      [instant, sameInstant, otherInstant],
      [plainDateTime, samePlainDateTime, otherPlainDateTime],
      [plainTime, samePlainTime, otherPlainTime],
    ] as const) {
      expect(pool).toContain(left)
      expect(pool).toContain(equal)
      expect(pool).toContain(other)
      checkEqualityPaths(left, equal, true)
      checkEqualityPaths(left, other, false)
    }
  })

  it(`rejects a kind-only Temporal list key at the membership comparison`, () => {
    for (const [value, equal, unequal] of [
      [plainDate, samePlainDate, otherPlainDate],
      [instant, sameInstant, otherInstant],
      [plainDateTime, samePlainDateTime, otherPlainDateTime],
      [plainTime, samePlainTime, otherPlainTime],
    ] as const) {
      for (const listFromRow of [false, true]) {
        expect(
          evaluateWithKindOnlyTemporalKey({
            value,
            list: [equal],
            listFromRow,
          }),
        ).toBe(true)
        expect(() =>
          check(evaluateWithKindOnlyTemporalKey, {
            value,
            list: [unequal],
            listFromRow,
          }),
        ).toThrow(/in mismatch: expected false, got true/)
      }
    }
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
      thousandMillisecondDuration,
      sameThousandMillisecondDuration,
      millionMicrosecondDuration,
    ]) {
      expect(pool).toContain(value)
    }

    checkEqualityPaths(secondDuration, sameSecondDuration, true)
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

  it(`reads years, months, weeks, days, and nanoseconds in Duration equality`, () => {
    const variedFields = [
      `years`,
      `months`,
      `weeks`,
      `days`,
      `nanoseconds`,
    ] as const
    const fields = {
      years: 1,
      months: 1,
      weeks: 1,
      days: 1,
      nanoseconds: 1,
    }
    const baseline = Temporal.Duration.from(fields)
    const equalCopy = Temporal.Duration.from(fields)
    checkEqualityPaths(baseline, equalCopy, true)

    // Every variant differs in one intrinsic field. A comparator that drops
    // that field predicts a false match, which the referenceIn check rejects.
    for (const omitted of variedFields) {
      const variant = Temporal.Duration.from({ ...fields, [omitted]: 2 })
      const equalWithoutField = (
        left: Temporal.Duration,
        right: Temporal.Duration,
      ) =>
        durationFields.every(
          (field, index) =>
            field === omitted ||
            Reflect.apply(durationGetters[index]!, left, []) ===
              Reflect.apply(durationGetters[index]!, right, []),
        )
      expect(equalWithoutField(baseline, variant)).toBe(true)
      const wrong: Evaluate = ({ value, list }) =>
        Array.isArray(list) &&
        value instanceof Temporal.Duration &&
        list.some(
          (candidate) =>
            candidate instanceof Temporal.Duration &&
            equalWithoutField(value, candidate),
        )
      expect(() =>
        check(wrong, { value: variant, list: [baseline], listFromRow: false }),
      ).toThrow(/in mismatch/)
      checkEqualityPaths(baseline, variant, false)
    }
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
