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
 * Transfer law: The public `inArray` API describes array membership. The
 * current evaluator returns UNKNOWN (`null`) for a null or undefined value
 * and FALSE for a list that is not an array.
 * Otherwise the result is TRUE when some list item equals the value under the
 * evaluator's equality, and FALSE when none does. A null or undefined item
 * never equals a value under that membership interpretation. The public
 * guide's broad SQL null statement leaves this last rule open for a separate
 * product decision. The equality is the one `eq` documents in
 * `src/query/compiler/evaluators.ts`:
 *
 * - `NaN` and an invalid Date equal each other and nothing else.
 * - A native Date from either realm equals its millisecond timestamp, and
 *   another Date with the same timestamp. A borrowed Date prototype does not
 *   give an ordinary object native Date identity.
 * - Two Uint8Arrays (Buffers included) are equal when their native bytes are
 *   equal. Own `length` or `byteLength` properties cannot change that result.
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
 * local and foreign valid Dates and their timestamps, local and foreign
 * invalid Dates, borrowed Date prototypes, equal and unequal byte
 * arrays, a Buffer, native bytes from another realm with equal and unequal
 * content, genuine local and foreign bytes with own display-tag shadows, bytes
 * with own `length` or `byteLength` shadows, and a wide typed array with a
 * spoofed byte tag. A fixed control also shadows byte iteration. Temporal
 * values include ZonedDateTime zone aliases, a forged tag, a borrowed
 * prototype, shadowed display and field members, unequal values within each
 * modeled Temporal kind, reference ISO year/day
 * differences hidden by default display, and Duration carry forms with equal
 * display but distinct fields, one shared object and a structurally equal
 * copy, `null` and `undefined`. Lists have zero to six
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
 * arbitrary custom prototypes that imitate Temporal intrinsics. WHERE
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
const borrowedDate = Object.create(Date.prototype) as object
const otherBorrowedDate = Object.create(Date.prototype) as object
const shadowedTagBytes = new Uint8Array([1, 2])
Object.defineProperty(shadowedTagBytes, Symbol.toStringTag, {
  value: `ordinary`,
})
const foreignBytes = runInNewContext(`new Uint8Array([1, 2])`) as Uint8Array
const unequalForeignBytes = runInNewContext(
  `new Uint8Array([1, 3])`,
) as Uint8Array
const shadowedForeignBytes = runInNewContext(
  `Object.defineProperty(new Uint8Array([1, 2]), Symbol.toStringTag, { value: 'ordinary' })`,
) as Uint8Array
const byteLengthShadowedForeignBytes = Object.defineProperty(
  runInNewContext(`new Uint8Array([1, 2])`) as Uint8Array,
  `byteLength`,
  { value: 0 },
)
function shadowByteCount(
  bytes: ReadonlyArray<number>,
  field: `length` | `byteLength`,
): Uint8Array {
  return Object.defineProperty(Uint8Array.from(bytes), field, { value: 0 })
}
const byteLengthShadowed = shadowByteCount([1, 2], `byteLength`)
const equalByteLengthShadowed = shadowByteCount([1, 2], `byteLength`)
const unequalByteLengthShadowed = shadowByteCount([9, 9], `byteLength`)
const lengthShadowed = shadowByteCount([1, 2], `length`)
const equalLengthShadowed = shadowByteCount([1, 2], `length`)
const unequalLengthShadowed = shadowByteCount([9, 9], `length`)
const spoofedWideBytes = new Uint16Array([1, 2])
Object.defineProperty(spoofedWideBytes, Symbol.toStringTag, {
  value: `Uint8Array`,
})
const otherSpoofedWideBytes = new Uint16Array([1, 2])
Object.defineProperty(otherSpoofedWideBytes, Symbol.toStringTag, {
  value: `Uint8Array`,
})
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
  localDate,
  new Date(1000),
  foreignDate,
  laterForeignDate,
  1000,
  localInvalidDate,
  foreignInvalidDate,
  borrowedDate,
  otherBorrowedDate,
  new Uint8Array([1, 2]),
  new Uint8Array([1, 2]),
  new Uint8Array([1, 3]),
  Buffer.from([1, 2]),
  shadowedTagBytes,
  foreignBytes,
  unequalForeignBytes,
  shadowedForeignBytes,
  byteLengthShadowedForeignBytes,
  byteLengthShadowed,
  equalByteLengthShadowed,
  unequalByteLengthShadowed,
  lengthShadowed,
  equalLengthShadowed,
  unequalLengthShadowed,
  spoofedWideBytes,
  otherSpoofedWideBytes,
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

// The intrinsic typed-array tag reads the internal class across realms. An
// instance's own display tag cannot hide genuine bytes or forge wide bytes.
const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)!.get!
const typedArrayLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  `length`,
)!.get!
const typedArrayValues = Uint8Array.prototype.values

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
    // Captured native length and value iteration ignore own properties. The
    // model materializes the two byte sequences before comparing them;
    // production walks indexes directly.
    const leftLength = Reflect.apply(typedArrayLength, left, []) as number
    const rightLength = Reflect.apply(typedArrayLength, right, []) as number
    const leftBytes = Array.from(
      Reflect.apply(typedArrayValues, left, []) as Iterable<number>,
    )
    const rightBytes = Array.from(
      Reflect.apply(typedArrayValues, right, []) as Iterable<number>,
    )
    return (
      leftLength === rightLength &&
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
    if (value === forgedPlainDate) return `forged PlainDate tag`
    if (value === borrowedPlainDate) return `borrowed PlainDate prototype`
    if (value === shadowedTagPlainDate) return `PlainDate with shadowed tag`
    if (value === shadowedTextPlainDate) return `PlainDate with shadowed text`
    if (value === shadowedHourDuration) return `Duration with shadowed text`
    if (value === forgedHourDuration) return `forged Duration tag`
    if (value === borrowedDate) return `borrowed Date prototype`
    if (value === otherBorrowedDate) return `other borrowed Date prototype`
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
  const property = fc.asyncProperty(inCase, (testCase) =>
    Promise.resolve().then(() => check(evaluateWithProduction, testCase)),
  )

  it(`agrees with the reference over a fixed campaign`, async () => {
    await fc.assert(property, { numRuns: oracleRuns(2000), seed: 0x2029 })
  })

  it(`agrees with the reference over a random or replayed campaign`, async () => {
    await fc.assert(property, oraclePropertyOptions(2000, PROPERTY))
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

  it(`uses intrinsic byte class when a typed array shadows its display tag`, () => {
    expect(Object.prototype.toString.call(shadowedTagBytes)).toBe(
      `[object ordinary]`,
    )
    expect(Object.prototype.toString.call(spoofedWideBytes)).toBe(
      `[object Uint8Array]`,
    )
    expect(isBytes(shadowedTagBytes)).toBe(true)
    expect(isBytes(spoofedWideBytes)).toBe(false)
    checkEqualityPaths(shadowedTagBytes, new Uint8Array([1, 2]), true)
    checkEqualityPaths(spoofedWideBytes, otherSpoofedWideBytes, false)
  })

  it(`compares native bytes from another realm by content in every compiled equality path`, () => {
    // The independent model's captured typed-array intrinsic accepts a native
    // view across realms. An own display tag does not change its byte class.
    expect(foreignBytes instanceof Uint8Array).toBe(false)
    expect(ArrayBuffer.isView(foreignBytes)).toBe(true)
    expect(Object.prototype.toString.call(shadowedForeignBytes)).toBe(
      `[object ordinary]`,
    )
    expect(isBytes(foreignBytes)).toBe(true)
    expect(isBytes(shadowedForeignBytes)).toBe(true)
    expect(isBytes(spoofedWideBytes)).toBe(false)
    checkEqualityPaths(foreignBytes, new Uint8Array([1, 2]), true)
    checkEqualityPaths(shadowedForeignBytes, shadowedTagBytes, true)
    checkEqualityPaths(unequalForeignBytes, new Uint8Array([1, 2]), false)
    checkEqualityPaths(foreignBytes, spoofedWideBytes, false)
  })

  it(`compares foreign native Dates by timestamp and excludes borrowed prototypes in every compiled equality path`, () => {
    expect(foreignDate instanceof Date).toBe(false)
    expect(foreignInvalidDate instanceof Date).toBe(false)
    expect(borrowedDate instanceof Date).toBe(true)
    expect(nativeDateTimestamp(foreignDate)).toBe(1000)
    expect(Number.isNaN(nativeDateTimestamp(foreignInvalidDate))).toBe(true)
    expect(nativeDateTimestamp(borrowedDate)).toBeUndefined()
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
    checkEqualityPaths(borrowedDate, localDate, false)
    checkEqualityPaths(borrowedDate, 1000, false)
    checkEqualityPaths(borrowedDate, borrowedDate, true)
    checkEqualityPaths(borrowedDate, otherBorrowedDate, false)
  })

  it(`ignores own byte-count shadows in every compiled equality path`, () => {
    // Both shadowed arrays still hold two native bytes. Pairing two zero
    // shadows catches a comparison that stops before reading their content;
    // pairing one with an unshadowed array catches a false inequality.
    expect(byteLengthShadowed.byteLength).toBe(0)
    expect(lengthShadowed.length).toBe(0)
    expect(Reflect.apply(typedArrayLength, byteLengthShadowed, [])).toBe(2)
    expect(Reflect.apply(typedArrayLength, lengthShadowed, [])).toBe(2)
    expect(byteLengthShadowedForeignBytes instanceof Uint8Array).toBe(false)
    expect(byteLengthShadowedForeignBytes.byteLength).toBe(0)
    checkEqualityPaths(byteLengthShadowed, new Uint8Array([1, 2]), true)
    checkEqualityPaths(byteLengthShadowed, equalByteLengthShadowed, true)
    checkEqualityPaths(byteLengthShadowed, unequalByteLengthShadowed, false)
    checkEqualityPaths(byteLengthShadowedForeignBytes, byteLengthShadowed, true)
    checkEqualityPaths(
      byteLengthShadowedForeignBytes,
      unequalByteLengthShadowed,
      false,
    )
    checkEqualityPaths(lengthShadowed, new Uint8Array([1, 2]), true)
    checkEqualityPaths(lengthShadowed, equalLengthShadowed, true)
    checkEqualityPaths(lengthShadowed, unequalLengthShadowed, false)
  })

  it(`reads native byte values when an array shadows its iterator`, () => {
    const bytes = new Uint8Array([1, 2])
    Object.defineProperty(bytes, Symbol.iterator, {
      value: function* () {
        yield 9
        yield 9
      },
    })
    expect(Array.from(bytes)).toEqual([9, 9])
    checkEqualityPaths(bytes, new Uint8Array([1, 2]), true)
    checkEqualityPaths(bytes, new Uint8Array([9, 9]), false)
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
      [plainDate, shadowedTagPlainDate, otherPlainDate],
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
      [plainDate, shadowedTagPlainDate, otherPlainDate],
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
