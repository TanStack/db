import { Buffer } from 'node:buffer'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index'
import { createLiveQueryCollection } from '../src/query/live-query-collection'
import {
  areValuesEqual,
  ascComparator,
  compareValues,
  defaultComparator,
  descComparator,
  isUnorderable,
  makeComparator,
  normalizeValue,
} from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'
import { withOracleCleanup } from './utils'
import type { CompareOptions } from '../src/query/builder/types'

/**
 * Comparison defines the order and equality domains used by queries and
 * indexes. The laws are reflexivity, deterministic sign, antisymmetry, and
 * transitivity under one resolved option set. Null placement, direction, and
 * lexical/locale string modes are independent axes. In the bounded default
 * ascending domain below, NaN and invalid Dates share one non-finite order
 * position and follow finite values; null remains first. The published NaN
 * ordering change in `packages/db/CHANGELOG.md` (#1582) and the live-query
 * guide establish that law for Dates with native prototypes regardless of
 * their JavaScript realm.
 *
 * Authority: `OrderByOptions` and `CompareOptions` in the query builder's
 * option types declare these modes. The index comparator contract accepts
 * numeric signs, including signed infinity, and rejects NaN or non-numbers.
 *
 * The model uses direct primitive, Date, array, and byte comparisons from the
 * declared domain. It excludes unrelated object identities because production
 * intentionally assigns those a creation-order ID. The non-finite model uses
 * input tags and finite epoch-day values, rather than the production
 * unorderable classifier. It covers number-only and Date-only sorts with
 * optional null. A separate realm-tagged Date model below checks native Date
 * timestamps and invalidity across realms, plus one public ordered scan. A
 * fixed Date-subclass witness covers an inherited native `getTime` beyond the
 * generated plain-Date grammar.
 * Neither lane claims mixed-type order or every query/index path. Equality laws separately
 * cover the normalized value classes and changed-byte controls. Comparator
 * signs reject NaN and non-number results before reduction. Signed infinity
 * is a valid comparator result, including for custom string collation.
 *
 * Binary normalization has a narrower, established contract: equal byte
 * contents produce one Map key, different contents remain distinct, and a
 * user string cannot alias that key. This follows the binary-ID equality fix
 * recorded in `packages/db/CHANGELOG.md` (#779). The bounded key-size and
 * indexed-byte checks retain the regression contract introduced with #1797;
 * they constrain this internal utility, not a public serialized format or a
 * universal performance bound. Own `length` and `byteLength` properties do
 * not change native byte content. The 32-character margin is the existing
 * constant-overhead budget for the sampled 0..200-byte keys. Changed-byte
 * equality and key histories cover lengths 1..200. Fixed changes at byte 64
 * of a 129-byte view and the last byte of a 200-byte view pin positions that
 * a short generated campaign need not sample.
 *
 * The proposed native-byte ORDER BY law compares genuine Uint8Arrays and
 * Buffers by unsigned byte content, with a shorter equal prefix first. Equal
 * contents compare at one position. Genuine foreign-realm views and own
 * length shadows retain their native bytes. The mixed-object witness checks
 * total-order transitivity without choosing which kind comes first. This
 * bounded direct-return witness does not claim relational WHERE comparison,
 * other typed-array classes, arbitrary object order, or mutation.
 */

const defaultOpts: CompareOptions = {
  direction: `asc`,
  nulls: `first`,
  stringSort: `locale`,
}

const lexicalOpts: CompareOptions = {
  direction: `asc`,
  nulls: `first`,
  stringSort: `lexical`,
}

const nullsLastOpts: CompareOptions = {
  direction: `asc`,
  nulls: `last`,
  stringSort: `locale`,
}

// These properties judge immediate comparator and normalization results; there
// is no mutable history or cleanup. Each function return is its observation cut.
// The fixed campaign preserves one sample set, while the random campaign explores
// new values. Set all three variables to replay one property directly, for
// example COMPARISON_ORACLE_PROPERTY=1 COMPARISON_ORACLE_SEED=123
// COMPARISON_ORACLE_PATH='0:0' pnpm --filter @tanstack/db exec vitest run
// --configLoader runner tests/comparison-oracle.property.test.ts.
const fixedSeed = 20260911
const campaignRuns = 100
const requestedProperty = process.env.COMPARISON_ORACLE_PROPERTY
const replaySeed = process.env.COMPARISON_ORACLE_SEED
const replayPath = process.env.COMPARISON_ORACLE_PATH
let nextPropertyId = 0

type ComparisonFailure = { checkpoint: string; error: unknown }

function failureCheckpoint(error: unknown): string {
  if (error instanceof Error) {
    // The first frame in this file locates the failed assertion or the call
    // into a throwing comparator. Unlike a matcher message, it is unchanged
    // when fast-check shrinks the input values.
    const site = error.stack?.match(
      /comparison-oracle\.property\.test\.ts:(\d+):(\d+)/,
    )
    if (site) return `comparison-oracle.property.test.ts:${site[1]}:${site[2]}`
    return `${error.name}: ${error.message.split(`\n`)[0]}`
  }
  return `non-Error throw: ${String(error)}`
}

function checkWithOriginalFailure<T>(
  arbitrary: fc.Arbitrary<T>,
  check: (value: T) => void,
  options: Parameters<typeof fc.check>[1],
) {
  let original: ComparisonFailure | undefined
  let reduced: ComparisonFailure | undefined
  const property = fc.property(arbitrary, (value) => {
    try {
      check(value)
    } catch (error) {
      const failure = { checkpoint: failureCheckpoint(error), error }
      original ??= failure
      // A different assertion can fail on a smaller input. It is not a
      // reproduction of the original violation, so do not shrink into it.
      if (failure.checkpoint !== original.checkpoint) return
      reduced = failure
      throw error
    }
  })
  const result = fc.check(property, options)
  return { result, original, reduced }
}

function assertComparisonProperty<T>(
  label: string,
  arbitrary: fc.Arbitrary<T>,
  check: (value: T) => void,
  options: Parameters<typeof fc.check>[1],
): void {
  const { result, original, reduced } = checkWithOriginalFailure(
    arbitrary,
    check,
    options,
  )
  if (!result.failed) return
  if (!original || !reduced || result.counterexamplePath === null) {
    throw new Error(`${label}: failing run lost its primary comparison failure`)
  }
  const replay = checkWithOriginalFailure(arbitrary, check, {
    seed: result.seed,
    path: result.counterexamplePath,
    numRuns: 1,
    endOnFailure: true,
    examples: options?.examples,
  })
  const reproduced =
    replay.result.failed &&
    replay.original?.checkpoint === original.checkpoint &&
    replay.reduced?.checkpoint === original.checkpoint
  throw new Error(
    `${label}: ${original.checkpoint} failed at the function-return checkpoint; ` +
      `reduction ${reduced.checkpoint === original.checkpoint ? `kept` : `changed`} the original violation; ` +
      `seed ${result.seed}, path ${result.counterexamplePath}; ` +
      `direct replay ${reproduced ? `reproduced` : `did not reproduce`} that violation.\n${result.error}`,
    { cause: original.error },
  )
}

function comparisonProperty<
  Ts extends [unknown, ...Array<unknown>],
>(arbitraries: { [K in keyof Ts]: fc.Arbitrary<Ts[K]> }): (
  name: string,
  check: (...values: Ts) => void,
) => void {
  return (name: string, check: (...values: Ts) => void): void => {
    const id = String(++nextPropertyId)
    const label = `${id}: ${name}`
    const arbitrary = fc.tuple<Ts>(...arbitraries)
    const checkValues = (values: Ts) => {
      check(...values)
    }

    if (requestedProperty !== undefined) {
      if (requestedProperty !== id) {
        it.skip(`${label} replay not selected`, () => {})
        return
      }
      if (replaySeed === undefined || replayPath === undefined) {
        throw new Error(`comparison oracle replay needs a seed and shrink path`)
      }
      const seed = Number(replaySeed)
      if (replaySeed.trim() === `` || !Number.isSafeInteger(seed)) {
        throw new Error(`comparison oracle replay seed must be an integer`)
      }
      it(`${label} replay`, () => {
        assertComparisonProperty(label, arbitrary, checkValues, {
          seed,
          path: replayPath,
          numRuns: campaignRuns,
        })
      })
      return
    }

    it(`${label} fixed`, () => {
      assertComparisonProperty(label, arbitrary, checkValues, {
        seed: fixedSeed,
        numRuns: campaignRuns,
      })
    })
    it(`${label} random`, () => {
      assertComparisonProperty(label, arbitrary, checkValues, {
        numRuns: campaignRuns,
      })
    })
  }
}

// Input grammar: finite numbers, strings, booleans, valid Dates, and bounded
// arrays of those primitives; same-type pairs/triples isolate order laws.
// Null placement, direction, and string mode are separate option axes. Removing
// any one loses its paired opposite-order witness below. The fixed null,
// locale/lexical, and custom-collation cases reconstruct those boundaries.
// Array length 0/1 and binary length 0/1/128/129 are marginal cases. Plain
// objects are outside this order model because their IDs depend on creation
// order. Mixed-type order is outside this bounded grammar. A separate tagged
// grammar below admits NaN and invalid Date inputs; an invalid comparator
// result is rejected by the control below.
const arbitraryComparablePrimitive = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
)

const arbitraryDate = fc.date({ noInvalidDate: true })

type NonFiniteFamily = `number` | `date`
type NonFiniteInput = {
  family: NonFiniteFamily
  finiteDays: Array<number>
  unorderedCount: number
  includeNull: boolean
}
type TaggedOrderValue = {
  id: string
  value: number | Date | null
  category: `null` | `finite` | `unordered`
  order: number
}

// The generator's tags are reference facts: finite epoch days have ordinary
// numeric order, null precedes them, and the family's non-finite values follow
// them. Constructing expected signs from these tags avoids asking production
// whether a Date or number is unorderable. Distinct IDs preserve duplicate
// NaNs/invalid Dates in the sorted observation.
function taggedOrderValues(input: NonFiniteInput): Array<TaggedOrderValue> {
  const unordered = () =>
    input.family === `number` ? Number.NaN : new Date(Number.NaN)
  const finite = input.finiteDays.map((day, index) => ({
    id: `finite:${index}`,
    value: input.family === `number` ? day : new Date(day * 86_400_000),
    category: `finite` as const,
    order: day,
  }))
  const rows: Array<TaggedOrderValue> = [
    finite[0]!,
    { id: `unordered:0`, value: unordered(), category: `unordered`, order: 0 },
    ...finite.slice(1),
    ...Array.from({ length: input.unorderedCount - 1 }, (_, index) => ({
      id: `unordered:${index + 1}`,
      value: unordered(),
      category: `unordered` as const,
      order: 0,
    })),
  ]
  if (input.includeNull) {
    rows.splice(2, 0, { id: `null`, value: null, category: `null`, order: 0 })
  }
  return rows
}

function taggedOrderSign(a: TaggedOrderValue, b: TaggedOrderValue): -1 | 0 | 1 {
  const rank = { null: 0, finite: 1, unordered: 2 }
  const difference = rank[a.category] - rank[b.category]
  const valueDifference =
    difference || (a.category === `finite` ? a.order - b.order : 0)
  return valueDifference < 0 ? -1 : valueDifference > 0 ? 1 : 0
}

// Production observes direct comparator returns and the order of a stable
// JavaScript sort using the exported default comparator. The comparison runs
// immediately after each call, so it detects wrong signs and lost or reordered
// duplicate non-finite rows at the exact sort checkpoint.
function assertNonFiniteOrder(
  input: NonFiniteInput,
  compare: (a: number | Date | null, b: number | Date | null) => number = (
    a,
    b,
  ) => ascComparator(a, b, DEFAULT_COMPARE_OPTIONS),
  sortCompare: (
    a: number | Date | null,
    b: number | Date | null,
  ) => number = defaultComparator,
): void {
  const rows = taggedOrderValues(input)
  for (const a of rows) {
    for (const b of rows) {
      const result = compare(a.value, b.value)
      expect(sign(result)).toBe(taggedOrderSign(a, b))
      // Preserve the legacy exact-zero assertion for NaN/NaN, including its
      // distinction between positive and negative zero in Vitest.
      if (a.category === `unordered` && b.category === `unordered`) {
        expect(result).toBe(0)
      }
    }
  }
  const actual = [...rows].sort((a, b) => sortCompare(a.value, b.value))
  const expected = [...rows].sort(taggedOrderSign)
  expect(actual.map((row) => row.id)).toEqual(expected.map((row) => row.id))
}

// Legal inputs contain 1..5 distinct finite numbers or valid epoch-day Dates,
// one or two NaNs/invalid Dates, and optional null. A singleton finite value,
// duplicate non-finite values, negative days, and null presence are margins.
// Removing the family axis misses invalid Dates; removing the duplicate count
// misses equal non-finite rows; removing null misses its default placement.
// Mixed families, Temporal values, symbols, and invalid option objects are not
// generated. The fixed examples below reconstruct the legacy sort histories.
const arbitraryNonFiniteInput: fc.Arbitrary<NonFiniteInput> = fc.record({
  family: fc.constantFrom(`number` as const, `date` as const),
  finiteDays: fc.uniqueArray(fc.integer({ min: -20_000, max: 20_000 }), {
    minLength: 1,
    maxLength: 5,
  }),
  unorderedCount: fc.integer({ min: 1, max: 2 }),
  includeNull: fc.boolean(),
})

type RealmDateSample = {
  leftTime: number | null
  rightTime: number | null
  leftForeign: boolean
  rightForeign: boolean
  leftOwnTag?: boolean
  rightOwnTag?: boolean
}

function dateInRealm(
  time: number | null,
  foreign: boolean,
  ownTag = false,
): Date {
  const timestamp = time ?? Number.NaN
  const date = foreign
    ? (runInNewContext(`new Date(timestamp)`, { timestamp }) as Date)
    : new Date(timestamp)
  if (ownTag) {
    Object.defineProperty(date, Symbol.toStringTag, { value: `Other` })
  }
  return date
}

// `null` is a model-only invalid-Date tag; production receives a real Date
// whose timestamp is NaN. Two valid tags compare by their supplied timestamp,
// while an invalid tag follows every valid tag. The model never asks the
// production Date detector, normalizer, or comparator for an expected sign.
function modelDateSign(left: number | null, right: number | null): -1 | 0 | 1 {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return left < right ? -1 : left > right ? 1 : 0
}

function assertRealmDateOrder(sample: RealmDateSample): void {
  const left = dateInRealm(
    sample.leftTime,
    sample.leftForeign,
    sample.leftOwnTag,
  )
  const right = dateInRealm(
    sample.rightTime,
    sample.rightForeign,
    sample.rightOwnTag,
  )
  const expected = modelDateSign(sample.leftTime, sample.rightTime)
  const reverseExpected = expected === 0 ? 0 : -expected
  expect(isUnorderable(left)).toBe(sample.leftTime === null)
  expect(isUnorderable(right)).toBe(sample.rightTime === null)
  expect(sign(ascComparator(left, right, DEFAULT_COMPARE_OPTIONS))).toBe(
    expected,
  )
  expect(sign(ascComparator(right, left, DEFAULT_COMPARE_OPTIONS))).toBe(
    reverseExpected,
  )
  // Index equality keys use a Date's timestamp. This separate observation
  // prevents a correct direct order from masking reference-key normalization.
  expect(normalizeValue(left)).toBe(sample.leftTime ?? Number.NaN)
  expect(normalizeValue(right)).toBe(sample.rightTime ?? Number.NaN)
}

// Legal pairs cross local and foreign native Dates, valid epoch milliseconds
// in -1e12..1e12 and invalid Dates. The fixed witnesses below force the
// foreign-valid and foreign-invalid paths; generated pairs add equal times,
// both operand orders, both invalid values, and Dates with an own display tag.
// A display tag cannot change native Date identity. Proxies, non-Date objects,
// and user-defined Date subclasses are outside this generated grammar. The
// fixed witness below covers local and foreign subclasses with an own tag.
const arbitraryDateTime = fc.oneof(
  fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }),
  fc.constant(null),
)
const arbitraryRealmDateSample: fc.Arbitrary<RealmDateSample> = fc.oneof(
  fc.record({
    leftTime: arbitraryDateTime,
    rightTime: arbitraryDateTime,
    leftForeign: fc.boolean(),
    rightForeign: fc.boolean(),
    leftOwnTag: fc.boolean(),
    rightOwnTag: fc.boolean(),
  }),
  fc
    .record({
      time: arbitraryDateTime,
      leftForeign: fc.boolean(),
      rightForeign: fc.boolean(),
      leftOwnTag: fc.boolean(),
      rightOwnTag: fc.boolean(),
    })
    .map(({ time, leftForeign, rightForeign, leftOwnTag, rightOwnTag }) => ({
      leftTime: time,
      rightTime: time,
      leftForeign,
      rightForeign,
      leftOwnTag,
      rightOwnTag,
    })),
)

const arbitraryComparableArray = fc.array(arbitraryComparablePrimitive, {
  maxLength: 5,
})

function assertValidComparison(result: unknown): asserts result is number {
  expect(
    typeof result === `number` && !Number.isNaN(result),
    `comparator result must be a number other than NaN`,
  ).toBe(true)
}

// Validate before reducing: NaN and non-number results must not appear equal.
const sign = (n: unknown): -1 | 0 | 1 => {
  assertValidComparison(n)
  if (n < 0) return -1
  if (n > 0) return 1
  return 0
}

/**
 * Check antisymmetry property: sign(compare(a, b)) === -sign(compare(b, a))
 * This handles the +0/-0 JavaScript edge case where -0 !== 0 in Object.is
 */
const checkAntisymmetry = (ab: unknown, ba: unknown): boolean => {
  const signAB = sign(ab)
  const signBA = sign(ba)
  // Both zero, or opposite signs
  return (signAB === 0 && signBA === 0) || signAB === -signBA
}

// Same-type arbitraries for comparator tests (cross-type comparison is not guaranteed to be total ordering)
const arbitrarySameTypeString = fc.tuple(fc.string(), fc.string())
const arbitrarySameTypeInt = fc.tuple(fc.integer(), fc.integer())
const arbitrarySameTypeDouble = fc.tuple(
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
)
const arbitrarySameTypeBool = fc.tuple(fc.boolean(), fc.boolean())
const arbitrarySameTypeDate = fc.tuple(
  fc.date({ noInvalidDate: true }),
  fc.date({ noInvalidDate: true }),
)
const arbitrarySameTypeArray = fc.tuple(
  fc.array(fc.integer(), { maxLength: 5 }),
  fc.array(fc.integer(), { maxLength: 5 }),
)

// Pair of same-type comparable values
const arbitrarySameTypePair = fc.oneof(
  arbitrarySameTypeString,
  arbitrarySameTypeInt,
  arbitrarySameTypeDouble,
  arbitrarySameTypeBool,
  arbitrarySameTypeDate,
  arbitrarySameTypeArray,
)

// Triple of same-type values for transitivity
const arbitrarySameTypeTriple = fc.oneof(
  fc.tuple(fc.integer(), fc.integer(), fc.integer()),
  fc.tuple(fc.string(), fc.string(), fc.string()),
  fc.tuple(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  ),
)

// A legal changed-byte input retains length and all but one indexed byte.
// The 1..200 range spans both sides of the 128-byte key-size boundary; the
// empty input has no byte to change and is checked by the size-margin witness.
const arbitraryChangedBytes = fc
  .tuple(
    fc.uint8Array({ minLength: 1, maxLength: 200 }),
    fc.integer({ min: 0, max: 199 }),
    fc.integer({ min: 1, max: 255 }),
  )
  .map(([bytes, indexHint, delta]) => {
    const index = indexHint % bytes.length
    const changed = new Uint8Array(bytes)
    changed[index] = (bytes[index]! + delta) % 256
    return { bytes, changed, index }
  })

function assertChangedBytes(
  {
    bytes,
    changed,
    index,
  }: { bytes: Uint8Array; changed: Uint8Array; index: number },
  equal: (a: Uint8Array, b: Uint8Array) => boolean,
): void {
  expect(index).toBeLessThan(bytes.length)
  expect(changed).toHaveLength(bytes.length)
  expect(changed[index]).not.toBe(bytes[index])
  expect(equal(bytes, new Uint8Array(bytes)), `byte copy must be equal`).toBe(
    true,
  )
  expect(equal(bytes, changed), `changed byte must be unequal`).toBe(false)
  expect(equal(changed, bytes), `changed byte must be unequal`).toBe(false)
}

function assertTransitive(ab: number, bc: number, ac: number): void {
  for (const result of [ab, bc, ac]) assertValidComparison(result)
  if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0)
}

describe(`comparison law controls`, () => {
  fcTest(
    `shrinking retains the first violated law and replays its checkpoint`,
    () => {
      let reachedOtherLaw = false
      const arbitrary = fc.integer({ min: 0, max: 10 })
      const check = (value: number) => {
        if (value > 0) expect(value, `positive-value law`).toBe(0)
        reachedOtherLaw = true
        expect(value, `zero-value law`).toBe(1)
      }
      const originalRun = checkWithOriginalFailure(arbitrary, check, {
        seed: 20260911,
        numRuns: 1,
        examples: [[5]],
      })
      expect(originalRun.result.failed).toBe(true)
      expect(reachedOtherLaw).toBe(true)
      expect(originalRun.result.counterexample).toEqual([1])
      expect(originalRun.original?.checkpoint).toBe(
        originalRun.reduced?.checkpoint,
      )
      if (originalRun.result.counterexamplePath === null) {
        throw new Error(`stable failure did not produce a replay path`)
      }
      const replay = checkWithOriginalFailure(arbitrary, check, {
        seed: originalRun.result.seed,
        path: originalRun.result.counterexamplePath,
        numRuns: 1,
        endOnFailure: true,
        examples: [[5]],
      })
      expect(replay.result.failed).toBe(true)
      expect(replay.original?.checkpoint).toBe(originalRun.original?.checkpoint)
      expect(replay.result.counterexample).toEqual(
        originalRun.result.counterexample,
      )

      let reported: unknown
      try {
        assertComparisonProperty(
          `synthetic two-law control`,
          arbitrary,
          check,
          {
            seed: 20260911,
            numRuns: 1,
            examples: [[5]],
          },
        )
      } catch (error) {
        reported = error
      }
      expect(reported).toBeInstanceOf(Error)
      expect((reported as Error).message).toContain(
        `direct replay reproduced that violation`,
      )
      expect((reported as Error).message).toContain(
        originalRun.original?.checkpoint,
      )
      expect((reported as Error).cause).toBeInstanceOf(Error)
      expect(failureCheckpoint((reported as Error).cause)).toBe(
        originalRun.original?.checkpoint,
      )
    },
  )

  fcTest(`rejects invalid results and accepts signed infinity`, () => {
    for (const invalid of [NaN, `invalid`, undefined]) {
      expect(() => checkAntisymmetry(invalid, 0)).toThrow(
        `comparator result must be a number other than NaN`,
      )
    }
    // An earlier finite-only check rejected this legal custom comparator sign.
    expect(checkAntisymmetry(-Infinity, Infinity)).toBe(true)
    expect(checkAntisymmetry(Infinity, -Infinity)).toBe(true)
    expect(checkAntisymmetry(0, -0)).toBe(true)
    expect(checkAntisymmetry(-12, 12)).toBe(true)
    expect(checkAntisymmetry(-12, -12)).toBe(false)
  })

  fcTest(
    `rejects and replays a comparator returning NaN only for unequal pairs`,
    () => {
      const mutant = (a: number, b: number): number => (a === b ? 0 : NaN)
      const property = fc.property(fc.integer({ min: -100, max: 100 }), (a) => {
        expect(mutant(a, a)).toBe(0)
        expect(checkAntisymmetry(mutant(a, a + 1), mutant(a + 1, a))).toBe(true)
      })
      const failure = fc.check(property, { seed: 20260911, numRuns: 20 })
      expect(failure.failed).toBe(true)
      expect(failure.error).toContain(
        `comparator result must be a number other than NaN`,
      )
      expect(failure.counterexample).toEqual([0])
      if (failure.counterexamplePath === null) {
        throw new Error(`mutant did not produce a replay path`)
      }
      const replay = fc.check(property, {
        seed: failure.seed,
        path: failure.counterexamplePath,
        numRuns: 1,
        endOnFailure: true,
      })
      expect(replay.failed).toBe(true)
      expect(replay.error).toContain(
        `comparator result must be a number other than NaN`,
      )
      expect(replay.counterexample).toEqual(failure.counterexample)
    },
  )

  fcTest(
    `changed-byte law rejects length-only equality and accepts indexed equality`,
    () => {
      const sample = {
        bytes: new Uint8Array([255]),
        changed: new Uint8Array([0]),
        index: 0,
      }
      expect(() =>
        assertChangedBytes(sample, (a, b) => a.length === b.length),
      ).toThrow(`changed byte must be unequal`)
      assertChangedBytes(
        sample,
        (a, b) =>
          a.length === b.length && a.every((byte, index) => byte === b[index]),
      )
    },
  )

  fcTest(`fixed campaign reaches a changed byte in every case`, () => {
    const result = fc.check(
      fc.property(arbitraryChangedBytes, (sample) => {
        assertChangedBytes(sample, areValuesEqual)
      }),
      { seed: 20260911, numRuns: 100 },
    )
    expect(result).toMatchObject({ failed: false, numRuns: 100, numSkips: 0 })
  })

  it(`transitivity reaches a strict chain and rejects a cyclic order`, () => {
    const [a, b, c] = [0, 1, 2]
    const ab = ascComparator(a, b, defaultOpts)
    const bc = ascComparator(b, c, defaultOpts)
    const ac = ascComparator(a, c, defaultOpts)
    expect(ab).toBeLessThan(0)
    expect(bc).toBeLessThan(0)
    assertTransitive(ab, bc, ac)

    // The wrong rule preserves adjacent order but reverses the 0-to-2 edge.
    expect(() => assertTransitive(-1, -1, 1)).toThrow()
  })
})

describe(`ascComparator property-based tests`, () => {
  describe(`comparator laws`, () => {
    comparisonProperty([arbitraryComparablePrimitive])(
      `reflexivity: compare(a, a) === 0`,
      (a) => {
        expect(ascComparator(a, a, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([arbitrarySameTypePair])(
      `antisymmetry: sign(compare(a, b)) === -sign(compare(b, a)) for same types`,
      ([a, b]) => {
        const ab = ascComparator(a, b, defaultOpts)
        const ba = ascComparator(b, a, defaultOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )

    comparisonProperty([arbitrarySameTypeTriple])(
      `transitivity: if a <= b and b <= c then a <= c (same types)`,
      ([a, b, c]) => {
        const ab = ascComparator(a, b, defaultOpts)
        const bc = ascComparator(b, c, defaultOpts)
        const ac = ascComparator(a, c, defaultOpts)
        assertTransitive(ab, bc, ac)
      },
    )

    comparisonProperty([arbitrarySameTypePair])(
      `consistency: compare(a, b) always returns the same value`,
      ([a, b]) => {
        const result1 = ascComparator(a, b, defaultOpts)
        const result2 = ascComparator(a, b, defaultOpts)
        assertValidComparison(result1)
        assertValidComparison(result2)
        expect(result1).toBe(result2)
      },
    )
  })

  describe(`null handling`, () => {
    comparisonProperty([arbitraryComparablePrimitive])(
      `nulls first: null comes before any non-null value`,
      (a) => {
        expect(ascComparator(null, a, defaultOpts)).toBeLessThan(0)
        expect(ascComparator(a, null, defaultOpts)).toBeGreaterThan(0)
      },
    )

    comparisonProperty([arbitraryComparablePrimitive])(
      `nulls last: null comes after any non-null value`,
      (a) => {
        expect(ascComparator(null, a, nullsLastOpts)).toBeGreaterThan(0)
        expect(ascComparator(a, null, nullsLastOpts)).toBeLessThan(0)
      },
    )

    comparisonProperty([fc.constant(null), fc.constant(null)])(
      `null equals null`,
      (a, b) => {
        expect(ascComparator(a, b, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([fc.constant(undefined), fc.constant(undefined)])(
      `undefined equals undefined`,
      (a, b) => {
        expect(ascComparator(a, b, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([
      fc.constantFrom(null, undefined),
      fc.constantFrom(null, undefined),
    ])(`null and undefined are treated the same for comparison`, (a, b) => {
      // Both null and undefined are treated as "null-ish" values
      expect(ascComparator(a, b, defaultOpts)).toBe(0)
    })
  })

  describe(`string comparison`, () => {
    it(`lexical and en-US locale order distinguish the string-mode axis`, () => {
      const localeOpts: CompareOptions = { ...defaultOpts, locale: `en-US` }
      expect(ascComparator(`a`, `B`, lexicalOpts)).toBeGreaterThan(0)
      expect(ascComparator(`a`, `B`, localeOpts)).toBeLessThan(0)
    })

    comparisonProperty([fc.string()])(
      `locale sort: reflexivity holds for strings`,
      (a) => {
        expect(ascComparator(a, a, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([fc.string(), fc.string()])(
      `lexical sort: antisymmetry holds for strings`,
      (a, b) => {
        const ab = ascComparator(a, b, lexicalOpts)
        const ba = ascComparator(b, a, lexicalOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )
  })

  describe(`array comparison`, () => {
    comparisonProperty([arbitraryComparableArray])(
      `reflexivity: compare(arr, arr) === 0`,
      (arr) => {
        expect(ascComparator(arr, arr, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([arbitrarySameTypeArray])(
      `antisymmetry for arrays of same element type`,
      ([a, b]) => {
        const ab = ascComparator(a, b, defaultOpts)
        const ba = ascComparator(b, a, defaultOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )

    comparisonProperty([fc.array(fc.integer(), { maxLength: 5 })])(
      `arrays with same elements compare equal`,
      (arr) => {
        const copy = [...arr]
        expect(ascComparator(arr, copy, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([
      fc.array(fc.integer(), { minLength: 1, maxLength: 5 }),
    ])(`shorter prefix array comes before longer array`, (arr) => {
      const prefix = arr.slice(0, -1)
      if (prefix.length < arr.length) {
        expect(ascComparator(prefix, arr, defaultOpts)).toBeLessThan(0)
        expect(ascComparator(arr, prefix, defaultOpts)).toBeGreaterThan(0)
      }
    })
  })

  describe(`date comparison`, () => {
    comparisonProperty([arbitraryDate])(
      `reflexivity: compare(date, date) === 0`,
      (date) => {
        expect(ascComparator(date, date, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([arbitraryDate, arbitraryDate])(
      `antisymmetry for dates`,
      (a, b) => {
        const ab = ascComparator(a, b, defaultOpts)
        const ba = ascComparator(b, a, defaultOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )

    comparisonProperty([arbitraryDate])(
      `dates with same time compare equal`,
      (date) => {
        const copy = new Date(date.getTime())
        expect(ascComparator(date, copy, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([
      // Use bounded dates to avoid overflow when adding offset
      fc.date({ min: new Date(0), max: new Date(`2100-01-01`) }),
      fc.integer({ min: 1, max: 1000000 }),
    ])(`earlier date comes before later date`, (date, offset) => {
      const later = new Date(date.getTime() + offset)
      // Only test if the later date is valid
      if (!isNaN(later.getTime())) {
        expect(ascComparator(date, later, defaultOpts)).toBeLessThan(0)
        expect(ascComparator(later, date, defaultOpts)).toBeGreaterThan(0)
      }
    })
  })

  describe(`number comparison`, () => {
    comparisonProperty([fc.integer()])(`reflexivity for integers`, (n) => {
      expect(ascComparator(n, n, defaultOpts)).toBe(0)
    })

    comparisonProperty([fc.double({ noNaN: true, noDefaultInfinity: true })])(
      `reflexivity for doubles`,
      (n) => {
        expect(ascComparator(n, n, defaultOpts)).toBe(0)
      },
    )

    comparisonProperty([fc.integer(), fc.integer()])(
      `integer ordering is correct`,
      (a, b) => {
        const result = ascComparator(a, b, defaultOpts)
        if (a < b) {
          expect(result).toBeLessThan(0)
        } else if (a > b) {
          expect(result).toBeGreaterThan(0)
        } else {
          expect(result).toBe(0)
        }
      },
    )
  })
})

describe(`NaN and invalid Date default-order refinement`, () => {
  it(`reconstructs the finite, duplicate NaN, null, and invalid Date witnesses`, () => {
    assertNonFiniteOrder({
      family: `number`,
      finiteDays: [3, 1, 5],
      unorderedCount: 2,
      includeNull: false,
    })
    assertNonFiniteOrder({
      family: `number`,
      finiteDays: [5, 1],
      unorderedCount: 1,
      includeNull: true,
    })
    assertNonFiniteOrder({
      family: `date`,
      finiteDays: [19_358], // 2023-01-01, the legacy valid-Date operand.
      unorderedCount: 1,
      includeNull: false,
    })
  })

  comparisonProperty([arbitraryNonFiniteInput])(
    `default comparator refines tagged finite and non-finite order`,
    (input) => assertNonFiniteOrder(input),
  )

  it(`rejects a wrong comparison that ties non-finite and finite values`, () => {
    for (const family of [`number`, `date`] as const) {
      let reachedFault = false
      const faultyComparator = (
        a: number | Date | null,
        b: number | Date | null,
      ) => {
        const faultApplies =
          family === `number`
            ? typeof a === `number` &&
              Number.isNaN(a) &&
              typeof b === `number` &&
              Number.isFinite(b)
            : a instanceof Date &&
              Number.isNaN(a.getTime()) &&
              b instanceof Date &&
              Number.isFinite(b.getTime())
        if (faultApplies) {
          reachedFault = true
          return 0
        }
        return ascComparator(a, b, DEFAULT_COMPARE_OPTIONS)
      }
      expect(() =>
        assertNonFiniteOrder(
          {
            family,
            finiteDays: [1],
            unorderedCount: 1,
            includeNull: false,
          },
          faultyComparator,
        ),
      ).toThrowError()
      expect(reachedFault).toBe(true)
    }
  })

  it(`rejects a default sort that ties NaN to finite values`, () => {
    let reachedFault = false
    const faultySort = (a: number | Date | null, b: number | Date | null) => {
      if (typeof a === `number` && Number.isNaN(a)) {
        reachedFault = true
        return 0
      }
      if (typeof b === `number` && Number.isNaN(b)) {
        reachedFault = true
        return 0
      }
      return defaultComparator(a, b)
    }
    expect(() =>
      assertNonFiniteOrder(
        {
          family: `number`,
          finiteDays: [3, 1, 5],
          unorderedCount: 2,
          includeNull: false,
        },
        (a, b) => ascComparator(a, b, DEFAULT_COMPARE_OPTIONS),
        faultySort,
      ),
    ).toThrowError()
    expect(reachedFault).toBe(true)
  })
})

describe(`native Date order across JavaScript realms`, () => {
  it(`uses the native Date brand without reading an unrelated display tag`, () => {
    const forged = { [Symbol.toStringTag]: `Date` }
    let tagReads = 0
    const unrelated = Object.defineProperty({}, Symbol.toStringTag, {
      get() {
        tagReads++
        return `Other`
      },
    })
    expect(isUnorderable(forged)).toBe(false)
    expect(normalizeValue(forged)).toBe(forged)
    expect(
      sign(ascComparator(forged, new Date(0), DEFAULT_COMPARE_OPTIONS)),
    ).not.toBe(0)
    expect(isUnorderable(unrelated)).toBe(false)
    expect(tagReads).toBe(0)
  })

  it(`keeps native Date semantics when a foreign Date has an own display tag`, () => {
    const timestamp = 123
    const foreignValid = dateInRealm(timestamp, true, true)
    const foreignInvalid = dateInRealm(null, true, true)
    const foreignTemporalTagged = dateInRealm(timestamp, true)
    Object.defineProperty(foreignTemporalTagged, Symbol.toStringTag, {
      value: `Temporal.PlainDate`,
    })
    const foreignPrototypeTagged = dateInRealm(timestamp, true)
    Object.defineProperty(
      Object.getPrototypeOf(foreignPrototypeTagged),
      Symbol.toStringTag,
      { value: `Other` },
    )
    const foreignGetter = dateInRealm(timestamp, true)
    let tagReads = 0
    Object.defineProperty(foreignGetter, Symbol.toStringTag, {
      get() {
        tagReads++
        return `Other`
      },
    })
    const localValid = new Date(timestamp)
    // The intrinsic establishes the native Date premise without consulting
    // the production detector or the object's display tag.
    expect(Date.prototype.getTime.call(foreignValid)).toBe(timestamp)
    expect(Date.prototype.getTime.call(foreignInvalid)).toBeNaN()
    expect(normalizeValue(foreignValid)).toBe(timestamp)
    expect(normalizeValue(foreignTemporalTagged)).toBe(timestamp)
    expect(normalizeValue(foreignPrototypeTagged)).toBe(timestamp)
    expect(normalizeValue(foreignGetter)).toBe(timestamp)
    expect(tagReads).toBe(0)
    expect(normalizeValue(foreignInvalid)).toBeNaN()
    expect(isUnorderable(foreignInvalid)).toBe(true)
    expect(
      ascComparator(foreignValid, localValid, DEFAULT_COMPARE_OPTIONS),
    ).toBe(0)
    expect(
      ascComparator(localValid, foreignValid, DEFAULT_COMPARE_OPTIONS),
    ).toBe(0)
    expect(
      ascComparator(foreignTemporalTagged, localValid, DEFAULT_COMPARE_OPTIONS),
    ).toBe(0)
    expect(
      ascComparator(
        foreignPrototypeTagged,
        localValid,
        DEFAULT_COMPARE_OPTIONS,
      ),
    ).toBe(0)
    expect(
      sign(ascComparator(foreignInvalid, localValid, DEFAULT_COMPARE_OPTIONS)),
    ).toBe(1)
  })

  it(`uses the native timestamp of a tagged foreign Date subclass`, () => {
    class LocalDate extends Date {}
    const timestamp = 123
    const localSubclass = new LocalDate(timestamp)
    const foreignSubclass = runInNewContext(
      `class D extends Date {}; new D(timestamp)`,
      { timestamp },
    ) as Date
    const localInvalid = new LocalDate(Number.NaN)
    const foreignInvalid = runInNewContext(
      `class D extends Date {}; new D(Number.NaN)`,
    ) as Date
    for (const value of [
      localSubclass,
      foreignSubclass,
      localInvalid,
      foreignInvalid,
    ]) {
      Object.defineProperty(value, Symbol.toStringTag, { value: `Other` })
    }
    // The supplied time and native slot establish the Date premise. The
    // foreign subclass's immediate prototype inherits native getTime.
    expect(Date.prototype.getTime.call(foreignSubclass)).toBe(timestamp)
    expect(foreignSubclass instanceof Date).toBe(false)
    expect(
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(foreignSubclass),
        `getTime`,
      ),
    ).toBeUndefined()

    const assertEarlierDateOrder = (
      value: Date,
      compare: typeof ascComparator = ascComparator,
    ) => {
      expect(
        sign(compare(value, new Date(timestamp - 1), DEFAULT_COMPARE_OPTIONS)),
      ).toBe(1)
      expect(
        sign(compare(new Date(timestamp - 1), value, DEFAULT_COMPARE_OPTIONS)),
      ).toBe(-1)
    }

    for (const value of [localSubclass, foreignSubclass]) {
      expect(normalizeValue(value)).toBe(timestamp)
      expect(
        ascComparator(value, new Date(timestamp), DEFAULT_COMPARE_OPTIONS),
      ).toBe(0)
      expect(
        ascComparator(new Date(timestamp), value, DEFAULT_COMPARE_OPTIONS),
      ).toBe(0)
      // A subclass-first comparator would put this value before both
      // unequal Dates. The earlier Date must instead precede it.
      assertEarlierDateOrder(value)
      expect(
        sign(
          ascComparator(
            value,
            new Date(timestamp + 1),
            DEFAULT_COMPARE_OPTIONS,
          ),
        ),
      ).toBe(-1)
      expect(
        sign(
          ascComparator(
            new Date(timestamp + 1),
            value,
            DEFAULT_COMPARE_OPTIONS,
          ),
        ),
      ).toBe(1)
    }
    // Feed a subclass-first answer through the same earlier-Date comparison.
    // It reaches the comparison and fails at the expected sign assertion.
    let reachedWrongOrder = false
    expect(() =>
      assertEarlierDateOrder(foreignSubclass, (left, right, options) => {
        if (left === foreignSubclass && right instanceof Date) {
          reachedWrongOrder = true
          return -1
        }
        return ascComparator(left, right, options)
      }),
    ).toThrowError()
    expect(reachedWrongOrder).toBe(true)

    for (const invalid of [localInvalid, foreignInvalid]) {
      expect(normalizeValue(invalid)).toBeNaN()
      expect(isUnorderable(invalid)).toBe(true)
      expect(ascComparator(invalid, Number.NaN, DEFAULT_COMPARE_OPTIONS)).toBe(
        0,
      )
      expect(
        sign(
          ascComparator(invalid, new Date(timestamp), DEFAULT_COMPARE_OPTIONS),
        ),
      ).toBe(1)
      expect(
        sign(
          ascComparator(new Date(timestamp), invalid, DEFAULT_COMPARE_OPTIONS),
        ),
      ).toBe(-1)
    }

    // Borrowing that prototype and display tag cannot forge native Date
    // slots. The intrinsic rejects this adjacent non-Date control.
    const forged = Object.create(Object.getPrototypeOf(foreignSubclass)) as Date
    Object.defineProperty(forged, Symbol.toStringTag, { value: `Other` })
    expect(() => Date.prototype.getTime.call(forged)).toThrow(TypeError)
    expect(normalizeValue(forged)).toBe(forged)
    expect(isUnorderable(forged)).toBe(false)
    const forward = sign(
      ascComparator(forged, foreignSubclass, DEFAULT_COMPARE_OPTIONS),
    )
    const reverse = sign(
      ascComparator(foreignSubclass, forged, DEFAULT_COMPARE_OPTIONS),
    )
    expect(forward).not.toBe(0)
    expect(reverse).toBe(-forward)
  })

  it(`rejects a local Date subclass prototype without a native Date slot`, () => {
    class LocalDate extends Date {}
    const forged = Object.create(LocalDate.prototype) as object
    const real = new Date(1)
    // instanceof sees the borrowed local prototype, but the Date intrinsic
    // rejects the missing native slot. The object keeps reference identity.
    expect(forged instanceof Date).toBe(true)
    expect(() => Date.prototype.getTime.call(forged)).toThrow(TypeError)
    expect(normalizeValue(forged)).toBe(forged)
    expect(isUnorderable(forged)).toBe(false)
    const forward = sign(ascComparator(forged, real, DEFAULT_COMPARE_OPTIONS))
    const reverse = sign(ascComparator(real, forged, DEFAULT_COMPARE_OPTIONS))
    expect(forward).not.toBe(0)
    expect(reverse).toBe(-forward)
  })

  it(`treats numeric NaN and invalid Dates as one non-finite order position`, () => {
    for (const foreign of [false, true]) {
      const invalid = dateInRealm(null, foreign)
      expect(ascComparator(Number.NaN, invalid, DEFAULT_COMPARE_OPTIONS)).toBe(
        0,
      )
      expect(ascComparator(invalid, Number.NaN, DEFAULT_COMPARE_OPTIONS)).toBe(
        0,
      )
    }
  })

  it(`orders foreign valid and invalid Dates by the promised timestamp law`, () => {
    const jan1 = Date.UTC(2023, 0, 1)
    const jan2 = Date.UTC(2023, 0, 2)
    assertRealmDateOrder({
      leftTime: jan2,
      rightTime: jan1,
      leftForeign: true,
      rightForeign: false,
    })
    assertRealmDateOrder({
      leftTime: null,
      rightTime: jan1,
      leftForeign: true,
      rightForeign: false,
    })
    assertRealmDateOrder({
      leftTime: jan1,
      rightTime: jan1,
      leftForeign: true,
      rightForeign: false,
    })
    assertRealmDateOrder({
      leftTime: jan1,
      rightTime: null,
      leftForeign: false,
      rightForeign: true,
    })
  })

  comparisonProperty([arbitraryRealmDateSample])(
    `local and foreign Dates refine timestamp and invalidity order`,
    (sample) => assertRealmDateOrder(sample),
  )

  it(`orders a foreign invalid Date after a valid Date in a public scan`, async () => {
    for (const [foreign, ownTag] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      const invalid = dateInRealm(null, foreign, ownTag)
      const valid = new Date(Date.UTC(2023, 0, 1))
      const source = createCollection({
        id: `realm-date-order-${foreign}-${ownTag}`,
        getKey: (row: { id: number; when: Date }) => row.id,
        autoIndex: `off`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: 1, when: invalid } })
            write({ type: `insert`, value: { id: 2, when: valid } })
            commit()
            markReady()
          },
        },
      })
      const query = createLiveQueryCollection((q) =>
        q
          .from({ rows: source })
          .orderBy(({ rows }) => rows.when, `asc`)
          .select(({ rows }) => ({ id: rows.id, when: rows.when })),
      )
      // Preserve an ordered-row mismatch if either resource also fails to
      // clean up, and attempt both cleanups in all cases.
      await withOracleCleanup(async () => {
        await query.preload()
        // The local control proves that this public query actually orders
        // rows; the foreign case must have the same promised result.
        expect([...query.values()].map(({ id }) => id)).toEqual([2, 1])
      }, [() => query.cleanup(), () => source.cleanup()])
    }
  })
})

describe(`descComparator property-based tests`, () => {
  comparisonProperty([arbitrarySameTypePair])(
    `descComparator reverses ascComparator ordering (same types)`,
    ([a, b]) => {
      const asc = ascComparator(a, b, defaultOpts)
      const desc = descComparator(a, b, defaultOpts)
      expect(checkAntisymmetry(asc, desc)).toBe(true)
    },
  )

  comparisonProperty([arbitraryComparablePrimitive])(
    `reflexivity: descComparator(a, a) === 0`,
    (a) => {
      expect(descComparator(a, a, defaultOpts)).toBe(0)
    },
  )

  comparisonProperty([fc.integer({ min: 1 })])(
    `nulls first in desc: null sorts before non-null values`,
    (a) => {
      // With nulls: 'first', null should come before non-null values in sorted output
      // If compare(a, b) < 0, then a comes before b in the result
      const result = descComparator(null, a, defaultOpts)
      expect(result).toBeLessThan(0)
    },
  )
})

describe(`makeComparator property-based tests`, () => {
  comparisonProperty([
    arbitrarySameTypePair,
    fc.constantFrom(`asc`, `desc`),
    fc.constantFrom(`first`, `last`),
  ])(
    `makeComparator produces valid comparator for any options (same types)`,
    ([a, b], direction, nulls) => {
      const opts: CompareOptions = {
        direction: direction as `asc` | `desc`,
        nulls: nulls as `first` | `last`,
        stringSort: `locale`,
      }
      const comparator = makeComparator(opts)

      // Reflexivity
      expect(comparator(a, a)).toBe(0)

      // Antisymmetry
      const ab = comparator(a, b)
      const ba = comparator(b, a)
      expect(checkAntisymmetry(ab, ba)).toBe(true)
    },
  )

  it(`delegates only string pairs to a custom string comparator`, () => {
    const calls: Array<[string, string]> = []
    const compare = (a: string, b: string) => {
      calls.push([a, b])
      return a.replaceAll(` `, ``).localeCompare(b.replaceAll(` `, ``))
    }
    const custom: CompareOptions = {
      direction: `asc`,
      nulls: `first`,
      stringSort: `custom`,
      compare,
    }

    expect(makeComparator(custom)(`pillowfort`, `pillow fort`)).toBe(0)
    expect(calls).toEqual([[`pillowfort`, `pillow fort`]])

    calls.length = 0
    expect(makeComparator(custom)(2, 1)).toBeGreaterThan(0)
    expect(makeComparator(custom)(null, `value`)).toBeLessThan(0)
    expect(calls).toEqual([])

    expect(
      makeComparator({ ...custom, direction: `desc` })(`a`, `b`),
    ).toBeGreaterThan(0)
  })

  it(`preserves signed infinity from a valid custom string comparator`, () => {
    const comparator = makeComparator({
      ...defaultOpts,
      stringSort: `custom`,
      compare: (a, b) => (a === b ? 0 : a < b ? -Infinity : Infinity),
    })
    expect(comparator(`a`, `b`)).toBe(-Infinity)
    expect(comparator(`b`, `a`)).toBe(Infinity)
    expect(comparator(`a`, `a`)).toBe(0)
    expect(checkAntisymmetry(comparator(`a`, `b`), comparator(`b`, `a`))).toBe(
      true,
    )
  })
})

describe(`normalizeValue property-based tests`, () => {
  it(`binary keys ignore own byte-count shadows`, () => {
    // Supplied native bytes, rather than public count properties, establish
    // the key relation. The function return is the comparison checkpoint.
    const equalKey = normalizeValue(new Uint8Array([1, 2]))
    const unequalKey = normalizeValue(new Uint8Array([9, 9]))
    expect(equalKey).not.toBe(unequalKey)
    for (const field of [`length`, `byteLength`] as const) {
      const equal = Object.defineProperty(new Uint8Array([1, 2]), field, {
        value: 0,
      })
      const unequal = Object.defineProperty(new Uint8Array([9, 9]), field, {
        value: 0,
      })
      expect(equal[field]).toBe(0)
      expect(unequal[field]).toBe(0)
      expect(Array.from(equal)).toEqual([1, 2])
      expect(Array.from(unequal)).toEqual([9, 9])
      expect(normalizeValue(equal)).toBe(equalKey)
      expect(normalizeValue(unequal)).toBe(unequalKey)
    }
  })

  it(`binary key size and content laws reach the bounded length margins`, () => {
    for (const length of [0, 1, 128, 129, 200]) {
      const bytes = Uint8Array.from({ length }, (_, index) => index % 256)
      const normalized = normalizeValue(bytes)
      expect(typeof normalized).toBe(`string`)
      expect((normalized as string).length - length).toBeLessThan(32)
      expect(normalizeValue(new Uint8Array(bytes))).toBe(normalized)
      if (length > 0) {
        const changed = new Uint8Array(bytes)
        changed[length - 1] = (changed[length - 1]! + 1) % 256
        expect(normalizeValue(changed)).not.toBe(normalized)
      }
    }
  })

  comparisonProperty([arbitraryDate])(
    `dates normalize to their timestamp`,
    (date) => {
      expect(normalizeValue(date)).toBe(date.getTime())
    },
  )

  comparisonProperty([fc.uint8Array({ minLength: 0, maxLength: 128 })])(
    `small Uint8Arrays normalize to a stable key`,
    (arr) => {
      const normalized = normalizeValue(arr)
      expect(typeof normalized).toBe(`string`)
      expect(normalized).toBe(normalizeValue(new Uint8Array(arr)))
    },
  )

  comparisonProperty([fc.uint8Array({ minLength: 129, maxLength: 200 })])(
    `large Uint8Arrays normalize to a stable linear-size key`,
    (arr) => {
      const normalized = normalizeValue(arr)
      expect(typeof normalized).toBe(`string`)
      expect(normalized).toBe(normalizeValue(new Uint8Array(arr)))
      expect((normalized as string).length - arr.length).toBeLessThan(32)
    },
  )

  comparisonProperty([fc.string()])(
    `strings preserve equality after normalization`,
    (str) => {
      expect(normalizeValue(str)).toBe(normalizeValue(`${str}`))
    },
  )

  comparisonProperty([fc.integer()])(`integers pass through unchanged`, (n) => {
    expect(normalizeValue(n)).toBe(n)
  })

  comparisonProperty([fc.uint8Array({ minLength: 0, maxLength: 128 })])(
    `binary keys cannot collide with user strings`,
    (arr) => {
      const normalized = normalizeValue(arr)
      expect(normalizeValue(normalized)).not.toBe(normalized)
    },
  )

  fcTest(`reads binary keys from indexed bytes, not custom iteration`, () => {
    const bytes = new Uint8Array([2])
    Object.defineProperty(bytes, Symbol.iterator, {
      value: function* () {
        yield 1
      },
    })

    expect(normalizeValue(bytes)).toBe(normalizeValue(new Uint8Array([2])))
  })
})

describe(`areValuesEqual property-based tests`, () => {
  it(`different integer law reaches an unequal pair`, () => {
    expect(areValuesEqual(1, 2)).toBe(false)
    expect(areValuesEqual(2, 1)).toBe(false)
  })

  comparisonProperty([fc.uint8Array({ minLength: 0, maxLength: 50 })])(
    `Uint8Arrays with same content are equal`,
    (arr) => {
      const copy = new Uint8Array(arr)
      expect(areValuesEqual(arr, copy)).toBe(true)
    },
  )

  comparisonProperty([arbitraryChangedBytes])(
    `Uint8Arrays with different content are not equal`,
    (sample) => {
      assertChangedBytes(sample, areValuesEqual)
    },
  )

  comparisonProperty([fc.integer()])(
    `reference equality for primitives`,
    (n) => {
      expect(areValuesEqual(n, n)).toBe(true)
    },
  )

  comparisonProperty([fc.integer(), fc.integer()])(
    `different integers are not equal`,
    (a, b) => {
      if (a !== b) {
        expect(areValuesEqual(a, b)).toBe(false)
      }
    },
  )
})

/**
 * Temporal ordering uses the value's calendar position or instant, not its
 * display text. The published #1519 contract gives PlainDate calendar order
 * and ZonedDateTime instant order even when zones differ. These models use
 * supplied ISO date fields and epoch-nanosecond offsets; neither asks the
 * production comparator or Temporal's static compare for an expected sign.
 *
 * Legal inputs are ISO PlainDates from years 2000..2030 with days 1..28 and
 * ZonedDateTimes within two seconds of a fixed instant in four offset zones.
 * Equal-value branches construct separate objects, and the zoned branch forces
 * different zones at the same instant. A fixed genuine ZonedDateTime also
 * shadows its own display tag; a genuine subclass changes its prototype's
 * display tag while inheriting Temporal's slot-checking method. The supplied
 * instant still determines order for both.
 * The production paths are the exported
 * `ascComparator` under the default options and `compareValues` in hostile
 * dispatch histories. Each return is the observation checkpoint;
 * this lane makes no indexed or public-query claim. Comparator
 * zero for same-instant ZonedDateTimes is distinct from `eq`/`in` identity:
 * the zone remains part of identity under the #1519 contract.
 */
type IsoDateFields = { year: number; month: number; day: number }
type PlainDateOrderInput = { left: IsoDateFields; right: IsoDateFields }

function modelPlainDateSign(
  left: IsoDateFields,
  right: IsoDateFields,
): -1 | 0 | 1 {
  for (const field of [`year`, `month`, `day`] as const) {
    if (left[field] < right[field]) return -1
    if (left[field] > right[field]) return 1
  }
  return 0
}

function assertPlainDateOrder(input: PlainDateOrderInput): void {
  const left = new Temporal.PlainDate(
    input.left.year,
    input.left.month,
    input.left.day,
  )
  const right = new Temporal.PlainDate(
    input.right.year,
    input.right.month,
    input.right.day,
  )
  const expected = modelPlainDateSign(input.left, input.right)
  const actual = ascComparator(left, right, DEFAULT_COMPARE_OPTIONS)
  const reverse = ascComparator(right, left, DEFAULT_COMPARE_OPTIONS)
  expect(sign(actual)).toBe(expected)
  expect(sign(reverse)).toBe(expected === 0 ? 0 : -expected)
  if (expected === 0) {
    // The old unit block asserted an exact zero for two distinct instances.
    expect(left).not.toBe(right)
    expect(actual).toBe(0)
    expect(reverse).toBe(0)
  }
}

const arbitraryIsoDateFields: fc.Arbitrary<IsoDateFields> = fc.record({
  year: fc.integer({ min: 2000, max: 2030 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
})
const arbitraryPlainDateOrderInput: fc.Arbitrary<PlainDateOrderInput> =
  fc.oneof(
    fc.record({
      left: arbitraryIsoDateFields,
      right: arbitraryIsoDateFields,
    }),
    arbitraryIsoDateFields.map((fields) => ({ left: fields, right: fields })),
  )

type OffsetZone = `+00:00` | `+05:30` | `-05:00` | `+14:00`
type ZonedDateTimeOrderInput = {
  leftNanoOffset: number
  rightNanoOffset: number
  leftZone: OffsetZone
  rightZone: OffsetZone
}

// The base instant reconstructs the old 06:30 UTC / 12:00 +05:30 witness.
// Offsets are safe integers, so their ordinary numeric order is the reference
// for the generated epoch nanoseconds.
const zonedBaseEpochNanoseconds =
  BigInt(Date.UTC(2024, 0, 15, 6, 30)) * 1_000_000n

function modelNanosecondSign(left: number, right: number): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0
}

function zonedValue(nanoOffset: number, zone: OffsetZone) {
  return Temporal.Instant.fromEpochNanoseconds(
    zonedBaseEpochNanoseconds + BigInt(nanoOffset),
  ).toZonedDateTimeISO(zone)
}

function assertZonedDateTimeOrder(
  input: ZonedDateTimeOrderInput,
  compare: (left: unknown, right: unknown) => number = (left, right) =>
    ascComparator(left, right, DEFAULT_COMPARE_OPTIONS),
): void {
  const left = zonedValue(input.leftNanoOffset, input.leftZone)
  const right = zonedValue(input.rightNanoOffset, input.rightZone)
  const expected = modelNanosecondSign(
    input.leftNanoOffset,
    input.rightNanoOffset,
  )
  const actual = compare(left, right)
  const reverse = compare(right, left)
  expect(sign(actual)).toBe(expected)
  expect(sign(reverse)).toBe(expected === 0 ? 0 : -expected)
  if (expected === 0) {
    expect(actual).toBe(0)
    expect(reverse).toBe(0)
    if (input.leftZone !== input.rightZone) {
      // A text-order mutant sees different strings for one model instant.
      expect(left.toString()).not.toBe(right.toString())
    }
  }
}

const arbitraryNanoOffset = fc.integer({
  min: -1_999_999_999,
  max: 1_999_999_999,
})
const arbitraryOffsetZone: fc.Arbitrary<OffsetZone> = fc.constantFrom(
  `+00:00`,
  `+05:30`,
  `-05:00`,
  `+14:00`,
)
const arbitraryZonedDateTimeOrderInput: fc.Arbitrary<ZonedDateTimeOrderInput> =
  fc.oneof(
    fc.record({
      leftNanoOffset: arbitraryNanoOffset,
      rightNanoOffset: arbitraryNanoOffset,
      leftZone: arbitraryOffsetZone,
      rightZone: arbitraryOffsetZone,
    }),
    fc
      .tuple(arbitraryNanoOffset, arbitraryOffsetZone, arbitraryOffsetZone)
      .filter(([, leftZone, rightZone]) => leftZone !== rightZone)
      .map(([nanoOffset, leftZone, rightZone]) => ({
        leftNanoOffset: nanoOffset,
        rightNanoOffset: nanoOffset,
        leftZone,
        rightZone,
      })),
    fc
      .tuple(
        arbitraryNanoOffset,
        fc.boolean(),
        arbitraryOffsetZone,
        arbitraryOffsetZone,
      )
      .map(([nanoOffset, forward, leftZone, rightZone]) => ({
        leftNanoOffset: nanoOffset,
        rightNanoOffset: nanoOffset + (forward ? 1 : -1),
        leftZone,
        rightZone,
      })),
  )

// Dispatch previously cached the first comparison function seen for a tag.
// Reload before each hostile history so its first dispatch, rather than test
// execution order, determines whether a bad function can poison later values.
async function freshTemporalComparison() {
  vi.resetModules()
  return import('../src/utils/comparison')
}

describe(`Temporal default-order refinement`, () => {
  it(`reconstructs the three PlainDate and one ZonedDateTime assertions`, () => {
    const jan = { year: 2024, month: 1, day: 1 }
    const june = { year: 2024, month: 6, day: 1 }
    assertPlainDateOrder({
      left: { year: 2023, month: 12, day: 28 },
      right: jan,
    })
    assertPlainDateOrder({ left: jan, right: june })
    assertPlainDateOrder({
      left: jan,
      right: { year: 2024, month: 1, day: 2 },
    })
    assertPlainDateOrder({ left: jan, right: jan })
    assertZonedDateTimeOrder({
      leftNanoOffset: 0,
      rightNanoOffset: 0,
      leftZone: `+00:00`,
      rightZone: `+05:30`,
    })
    assertZonedDateTimeOrder({
      leftNanoOffset: 0,
      rightNanoOffset: 1,
      leftZone: `+05:30`,
      rightZone: `+00:00`,
    })
  })

  comparisonProperty([arbitraryPlainDateOrderInput])(
    `ISO PlainDate order refines supplied calendar fields`,
    assertPlainDateOrder,
  )

  comparisonProperty([arbitraryZonedDateTimeOrderInput])(
    `ZonedDateTime order refines supplied instants across offset zones`,
    assertZonedDateTimeOrder,
  )

  it(`rejects text order for one instant shown in two zones`, () => {
    const sample: ZonedDateTimeOrderInput = {
      leftNanoOffset: 0,
      rightNanoOffset: 0,
      leftZone: `+00:00`,
      rightZone: `+05:30`,
    }
    const lexical = (left: unknown, right: unknown) =>
      String(left).localeCompare(String(right))
    expect(() => assertZonedDateTimeOrder(sample, lexical)).toThrow()
  })

  it(`rejects millisecond truncation across adjacent instants`, () => {
    const sample: ZonedDateTimeOrderInput = {
      leftNanoOffset: 0,
      rightNanoOffset: 1,
      leftZone: `+05:30`,
      rightZone: `+00:00`,
    }
    const truncated = (left: unknown, right: unknown) => {
      const leftEpoch = (left as { epochNanoseconds: bigint }).epochNanoseconds
      const rightEpoch = (right as { epochNanoseconds: bigint })
        .epochNanoseconds
      return Number(leftEpoch / 1_000_000n - rightEpoch / 1_000_000n)
    }
    expect(() => assertZonedDateTimeOrder(sample, truncated)).toThrow()
  })

  it(`keeps a genuine ZonedDateTime's instant order when its own tag is shadowed`, () => {
    const utc = zonedValue(0, `+00:00`)
    const peer = zonedValue(0, `+05:30`)
    const later = zonedValue(1, `+05:30`)
    Object.defineProperty(utc, Symbol.toStringTag, { value: `ordinary` })

    // The supplied offsets, not the instance's display property, define the
    // model positions. The direct comparator and helper are separate paths.
    expect(ascComparator(utc, peer, DEFAULT_COMPARE_OPTIONS)).toBe(0)
    expect(ascComparator(peer, utc, DEFAULT_COMPARE_OPTIONS)).toBe(0)
    expect(compareValues(utc, peer)).toBe(0)
    expect(sign(ascComparator(utc, later, DEFAULT_COMPARE_OPTIONS))).toBe(-1)
  })

  it.each([
    [
      `ascComparator`,
      (left: unknown, right: unknown) =>
        ascComparator(left, right, DEFAULT_COMPARE_OPTIONS),
    ],
    [`compareValues`, compareValues],
  ] as const)(
    `keeps a tagged ZonedDateTime subclass in instant order through %s`,
    (_name, compare) => {
      class TaggedZonedDateTime extends Temporal.ZonedDateTime {}
      Object.defineProperty(TaggedZonedDateTime.prototype, Symbol.toStringTag, {
        value: `Tagged`,
      })
      const tagged = new TaggedZonedDateTime(
        zonedBaseEpochNanoseconds,
        `+00:00`,
      )
      const peer = zonedValue(0, `+05:30`)
      const later = zonedValue(1, `+00:00`)

      // Model positions come from supplied nanosecond offsets. Native compare
      // confirms that the tagged receiver still has genuine Temporal slots.
      expect(Temporal.ZonedDateTime.compare(tagged, peer)).toBe(0)
      expect(Temporal.ZonedDateTime.compare(tagged, later)).toBe(-1)
      expect(compare(tagged, peer)).toBe(0)
      expect(compare(peer, tagged)).toBe(0)
      expect(sign(compare(tagged, later))).toBe(-1)
      expect(sign(compare(later, tagged))).toBe(1)
    },
  )

  it(`keeps a PlainDate constructor override from poisoning later comparisons`, async () => {
    const { ascComparator: isolatedComparator, compareValues: isolatedValues } =
      await freshTemporalComparison()
    // A genuine Temporal instance may have an own data property; its calendar
    // value is unchanged by that property. It is the first dispatch here.
    const shadowed = new Temporal.PlainDate(2024, 1, 1)
    Object.defineProperty(shadowed, `constructor`, {
      value: { compare: () => 0 },
    })
    const later = new Temporal.PlainDate(2024, 6, 1)
    const ordinary = new Temporal.PlainDate(2024, 1, 1)
    const expected = modelPlainDateSign(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 6, day: 1 },
    )
    const observed = [
      isolatedComparator(shadowed, later, DEFAULT_COMPARE_OPTIONS),
      isolatedComparator(ordinary, later, DEFAULT_COMPARE_OPTIONS),
      isolatedValues(ordinary, later),
    ]
    expect(observed.map(sign)).toEqual([expected, expected, expected])
  })

  it(`keeps a right-hand constructor override from changing PlainDate order`, async () => {
    const { ascComparator: isolatedComparator, compareValues: isolatedValues } =
      await freshTemporalComparison()
    const january = new Temporal.PlainDate(2024, 1, 1)
    const shadowedJune = new Temporal.PlainDate(2024, 6, 1)
    Object.defineProperty(shadowedJune, `constructor`, {
      value: { compare: () => 0 },
    })
    const ordinaryJanuary = new Temporal.PlainDate(2024, 1, 1)
    const ordinaryJune = new Temporal.PlainDate(2024, 6, 1)
    const expected = modelPlainDateSign(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 6, day: 1 },
    )
    const observed = [
      isolatedComparator(january, shadowedJune, DEFAULT_COMPARE_OPTIONS),
      isolatedValues(january, shadowedJune),
      isolatedComparator(
        ordinaryJanuary,
        ordinaryJune,
        DEFAULT_COMPARE_OPTIONS,
      ),
      isolatedValues(ordinaryJanuary, ordinaryJune),
    ]
    expect(observed.map(sign)).toEqual([expected, expected, expected, expected])
  })

  it(`keeps a compareValues-first constructor override from poisoning later comparisons`, async () => {
    const { ascComparator: isolatedComparator, compareValues: isolatedValues } =
      await freshTemporalComparison()
    const shadowedJanuary = new Temporal.PlainDate(2024, 1, 1)
    Object.defineProperty(shadowedJanuary, `constructor`, {
      value: { compare: () => 0 },
    })
    const june = new Temporal.PlainDate(2024, 6, 1)
    const ordinaryJanuary = new Temporal.PlainDate(2024, 1, 1)
    const expected = modelPlainDateSign(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 6, day: 1 },
    )
    const observed = [
      isolatedValues(shadowedJanuary, june),
      isolatedValues(ordinaryJanuary, june),
      isolatedComparator(ordinaryJanuary, june, DEFAULT_COMPARE_OPTIONS),
    ]
    expect(observed.map(sign)).toEqual([expected, expected, expected])
  })

  it(`keeps a forged Temporal tag from poisoning genuine PlainDate order`, async () => {
    // A claimed display tag may enter the dispatch path, but must not change
    // the result of a later comparison between genuine Temporal values.
    const { ascComparator: isolatedComparator, compareValues: isolatedValues } =
      await freshTemporalComparison()
    const forged = {
      [Symbol.toStringTag]: `Temporal.PlainDate`,
      constructor: { compare: () => 0 },
    }
    const june = new Temporal.PlainDate(2024, 6, 1)
    try {
      isolatedComparator(forged, june, DEFAULT_COMPARE_OPTIONS)
    } catch {
      // Rejecting the forged value is a valid outcome for this history.
    }
    const january = new Temporal.PlainDate(2024, 1, 1)
    const expected = modelPlainDateSign(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 6, day: 1 },
    )
    expect(
      [
        isolatedComparator(january, june, DEFAULT_COMPARE_OPTIONS),
        isolatedValues(january, june),
      ].map(sign),
    ).toEqual([expected, expected])
  })
})

describe(`native binary key content`, () => {
  it(`distinguishes a changed interior byte at the normalized-key return`, () => {
    // Equal lengths and endpoints cannot conceal an interior byte change.
    // Native byte content, not the production encoding, defines inequality.
    const left = Uint8Array.of(1, 0, 2)
    const right = Uint8Array.of(1, 9, 2)
    expect(normalizeValue(left)).not.toBe(normalizeValue(right))
  })

  it(`distinguishes interior and last bytes of long native views`, () => {
    // The supplied byte at each named position changes while length and all
    // other bytes stay equal. At each function return, equality must reject
    // the pair in both directions and normalization must produce distinct keys.
    for (const { length, index } of [
      { length: 129, index: 64 },
      { length: 200, index: 199 },
    ]) {
      const bytes = Uint8Array.from({ length }, (_, byteIndex) => byteIndex)
      const changed = new Uint8Array(bytes)
      changed[index] = (changed[index]! + 1) % 256
      const sample = { bytes, changed, index }

      // A plausible first-64-byte comparator passes every short pair but
      // fails the same changed-byte checker used by the generated equality
      // property. This fault injection reaches the intended return check.
      expect(() =>
        assertChangedBytes(
          sample,
          (left, right) =>
            left.length === right.length &&
            left
              .subarray(0, 64)
              .every((byte, byteIndex) => byte === right[byteIndex]),
        ),
      ).toThrow(`changed byte must be unequal`)

      expect(areValuesEqual(bytes, new Uint8Array(bytes))).toBe(true)
      expect(areValuesEqual(bytes, changed)).toBe(false)
      expect(areValuesEqual(changed, bytes)).toBe(false)
      expect(normalizeValue(bytes)).not.toBe(normalizeValue(changed))
    }
  })

  comparisonProperty([arbitraryChangedBytes])(
    `a changed native byte changes the normalized key`,
    (sample) => {
      // Reuse the independently authored changed-byte history. This
      // property has its own assertion site so a shrunk failure identifies
      // key normalization rather than direct byte equality.
      assertChangedBytes(
        sample,
        (left, right) => normalizeValue(left) === normalizeValue(right),
      )
    },
  )
})

describe(`native byte content order`, () => {
  // The independent rule reads only the supplied unsigned elements. It does
  // not use the production object-identity allocator, comparator, or exact-key
  // normalization. Each fresh pair exercises immediate comparator returns.
  const model = (left: Uint8Array, right: Uint8Array): number => {
    // Native iteration reads the byte slots even when an own `length`
    // property shadows the public getter.
    const leftBytes = Array.from(Uint8Array.prototype.values.call(left))
    const rightBytes = Array.from(Uint8Array.prototype.values.call(right))
    for (
      let index = 0;
      index < Math.min(leftBytes.length, rightBytes.length);
      index++
    ) {
      const difference = leftBytes[index]! - rightBytes[index]!
      if (difference !== 0) return difference
    }
    return leftBytes.length - rightBytes.length
  }

  it.each([
    {
      caseId: `equal-content distinct views`,
      makePair: () => [Uint8Array.of(1), Uint8Array.of(1)] as const,
      expectedSign: 0,
    },
    {
      caseId: `first differing unsigned byte`,
      makePair: () => [Uint8Array.of(1, 255), Uint8Array.of(2, 0)] as const,
      expectedSign: -1,
    },
    {
      caseId: `unsigned 127/128 boundary`,
      makePair: () => [Uint8Array.of(127), Uint8Array.of(128)] as const,
      expectedSign: -1,
    },
    {
      caseId: `foreign native byte view`,
      makePair: () =>
        [
          runInNewContext(`new Uint8Array([1])`) as Uint8Array,
          Uint8Array.of(2),
        ] as const,
      expectedSign: -1,
    },
    {
      caseId: `own length shadow`,
      makePair: () =>
        [
          Uint8Array.of(1),
          Object.defineProperty(Uint8Array.of(2), `length`, { value: 0 }),
        ] as const,
      expectedSign: -1,
    },
    {
      caseId: `shorter equal prefix`,
      makePair: () => [Uint8Array.of(1), Uint8Array.of(1, 0)] as const,
      expectedSign: -1,
    },
    {
      caseId: `Buffer and Uint8Array with equal content`,
      makePair: () => [Uint8Array.of(1), Buffer.from([1])] as const,
      expectedSign: 0,
    },
    {
      caseId: `Buffer and Uint8Array with differing content`,
      makePair: () => [Uint8Array.of(1), Buffer.from([2])] as const,
      expectedSign: -1,
    },
  ])(`compares $caseId`, ({ makePair, expectedSign }) => {
    const [lessOrEqual, greaterOrEqual] = makePair()
    expect(sign(model(lessOrEqual, greaterOrEqual))).toBe(expectedSign)
    const reverseSign = expectedSign === 0 ? 0 : -expectedSign

    // Call the reverse direction first. An identity-order implementation
    // assigns its first runtime ID to the greater operand here; content order
    // must still return the opposite sign. Both directions and descending
    // have the same immediate checkpoint.
    expect
      .soft(sign(ascComparator(greaterOrEqual, lessOrEqual, defaultOpts)))
      .toBe(reverseSign)
    expect
      .soft(sign(ascComparator(lessOrEqual, greaterOrEqual, defaultOpts)))
      .toBe(expectedSign)
    expect
      .soft(sign(descComparator(lessOrEqual, greaterOrEqual, defaultOpts)))
      .toBe(reverseSign)
  })

  it(`keeps byte content order transitive through ordinary objects`, () => {
    const high = Uint8Array.of(2)
    const ordinary = {}
    const low = Uint8Array.of(1)
    // These two mixed comparisons assign identity IDs in an implementation
    // that wrongly groups bytes with ordinary objects. The content edge then
    // closes a strict cycle: high < ordinary < low < high.
    const highToOrdinary = ascComparator(high, ordinary, defaultOpts)
    const ordinaryToLow = ascComparator(ordinary, low, defaultOpts)
    const highToLow = ascComparator(high, low, defaultOpts)
    expect(highToLow).toBeGreaterThan(0)
    assertTransitive(highToOrdinary, ordinaryToLow, highToLow)
  })
})

if (requestedProperty !== undefined) {
  it(`selects a registered comparison oracle property`, () => {
    expect(requestedProperty).toMatch(/^\d+$/)
    expect(Number(requestedProperty)).toBeGreaterThanOrEqual(1)
    expect(Number(requestedProperty)).toBeLessThanOrEqual(nextPropertyId)
  })
}
