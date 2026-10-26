import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import {
  areValuesEqual,
  ascComparator,
  defaultComparator,
  descComparator,
  makeComparator,
  normalizeValue,
} from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplaySkips,
  oracleRuns,
  recordOracleReplay,
} from './oracle-config.js'
import { defaultOpts, lexicalOpts } from './comparison-options.js'
import type { CompareOptions } from '../src/query/builder/types'

/**
 * Comparison defines the order and equality domains used by queries and
 * indexes. The laws are reflexivity, deterministic sign, antisymmetry, and
 * transitivity under one resolved option set. Null placement, direction, and
 * lexical/locale string modes are independent axes. In the bounded default
 * ascending domain below, NaN and invalid Dates share one non-finite order
 * position and follow finite values; null remains first. The published NaN
 * ordering change in `packages/db/CHANGELOG.md` (#1582) establishes that law
 * for ordinary numbers and Dates in the transferred unit-test domain.
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
 * optional null; it does not claim mixed-type order or query/index paths.
 * Equality laws separately cover normalized value classes and changed-byte
 * controls. Comparator signs reject NaN and non-number results before
 * reduction. Signed infinity is a valid comparator result, including for
 * custom string collation.
 *
 * Binary normalization has a narrower, established contract: equal byte
 * contents produce one Map key, different contents remain distinct, and a
 * user string cannot alias that key. This follows the binary-ID equality fix
 * recorded in `packages/db/CHANGELOG.md` (#779). The bounded key-size and
 * indexed-byte checks retain the regression contract introduced with #1797;
 * they constrain this internal utility, not a public serialized format or a
 * universal performance bound. The 32-character margin is the existing
 * constant-overhead budget for the sampled 0..200-byte keys.
 */

const nullsLastOpts: CompareOptions = {
  direction: `asc`,
  nulls: `last`,
  stringSort: `locale`,
}

// These properties judge immediate comparator and normalization results; there
// is no mutable history or cleanup. Each function return is its observation cut.
// The fixed campaign preserves one sample set, while the random campaign explores
// new values. A path replay runs one property directly, for example
// TANSTACK_DB_ORACLE_PROPERTY=comparison.1 TANSTACK_DB_ORACLE_SEED=123
// TANSTACK_DB_ORACLE_PATH='0:0' pnpm --filter @tanstack/db exec vitest run
// --configLoader runner tests/comparison-oracle.property.test.ts.
const fixedSeed = 20260911
const campaignRuns = 100
// Each property registers as `comparison.<number>`, in file order. A path
// replay selects one with TANSTACK_DB_ORACLE_PROPERTY=comparison.<number>.
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
  replayProperty?: string,
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
  if (replayProperty !== undefined) recordOracleReplay(replayProperty, result)
  return { result, original, reduced }
}

function assertComparisonProperty<T>(
  label: string,
  arbitrary: fc.Arbitrary<T>,
  check: (value: T) => void,
  options: Parameters<typeof fc.check>[1],
  // The registered property, so a guarded replay can witness this run.
  replayProperty?: string,
): void {
  const { result, original, reduced } = checkWithOriginalFailure(
    arbitrary,
    check,
    options,
    replayProperty,
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
    const id = ++nextPropertyId
    const property = `comparison.${id}`
    const label = `${id}: ${name}`
    const arbitrary = fc.tuple<Ts>(...arbitraries)
    const checkValues = (values: Ts) => {
      check(...values)
    }

    it.skipIf(oracleReplayRequested())(`${label} fixed`, () => {
      assertComparisonProperty(label, arbitrary, checkValues, {
        seed: fixedSeed,
        numRuns: oracleRuns(campaignRuns),
      })
    })
    it.skipIf(oracleReplaySkips(property))(`${label} random`, () => {
      assertComparisonProperty(
        label,
        arbitrary,
        checkValues,
        oraclePropertyOptions(campaignRuns, property),
        property,
      )
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
// order. Mixed-type order is outside this bounded grammar. A tagged grammar
// below admits NaN and invalid Date inputs; an invalid comparator result is
// rejected by the control below.
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

const arbitraryChangedBytes = fc
  .tuple(
    fc.uint8Array({ minLength: 1, maxLength: 50 }),
    fc.integer({ min: 0, max: 49 }),
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

declareOracle({
  check: [
    assertComparisonProperty,
    checkAntisymmetry,
    assertNonFiniteOrder,
    assertChangedBytes,
    assertTransitive,
    assertPlainDateOrder,
    assertZonedDateTimeOrder,
  ],
  model: [modelPlainDateSign, modelNanosecondSign],
})

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
})

describe(`areValuesEqual property-based tests`, () => {
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
 * Temporal ordering uses calendar position or instant. The published #1519
 * contract gives PlainDate calendar order
 * and ZonedDateTime instant order even when zones differ. These models use
 * supplied ISO date fields and epoch-nanosecond offsets; neither asks the
 * production comparator or Temporal's static compare for an expected sign.
 *
 * Legal inputs are ISO PlainDates from years 2000..2030 with days 1..28 and
 * ZonedDateTimes within two seconds of a fixed instant in four offset zones.
 * Equal-value branches construct separate objects, and the zoned branch forces
 * different zones at the same instant. The production path is the exported
 * `ascComparator` under default options; each return is the observation
 * checkpoint. This lane makes no indexed or public-query claim.
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
})
