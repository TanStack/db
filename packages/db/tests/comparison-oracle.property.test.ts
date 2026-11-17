import { beforeEach, describe, expect } from 'vitest'
import { fc } from '@fast-check/vitest'
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
import { oracleProperty, oracleReplayRequested } from './oracle-config.js'
import { defaultOpts, lexicalOpts } from './comparison-options.js'
import { rejection } from './calibration-rejection.js'
import { nativeCampaignReceipt } from './native-campaign-receipt'
import {
  checkWithOriginalFailure,
  failureCheckpoint,
} from './comparison-failure-support'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter'
import {
  arbitraryChangedBytes,
  arbitraryComparableArray,
  arbitraryComparablePrimitive,
  arbitraryDate,
  arbitraryNonFiniteInput,
  arbitrarySameTypeArray,
  arbitrarySameTypePair,
  arbitrarySameTypeTriple,
  assertChangedBytes,
  assertNonFiniteOrder,
  assertTransitive,
  assertValidComparison,
  checkAntisymmetry,
  sign,
} from './comparison-laws-oracle'
import type { CompareOptions } from '../src/query/builder/types'
import type { ComparisonFailure } from './comparison-failure-support'
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
// new values. Copy complete printed Replay: coordinates, including
// TANSTACK_DB_ORACLE_UNIT, for a current generated replay. The original pre-unit
// example below has no construction prefix; its path needs no shift when adding
// UNIT='random seed: generated' to replay that source revision:
// TANSTACK_DB_ORACLE_PROPERTY=comparison.1 TANSTACK_DB_ORACLE_SEED=123
// TANSTACK_DB_ORACLE_PATH='0:0' pnpm --filter @tanstack/db exec vitest run
// --configLoader runner tests/comparison-oracle.property.test.ts.
const fixedSeed = 20260911
const campaignRuns = 100
// Each property registers as `comparison.<number>`, in file order. A path
// replay selects one with TANSTACK_DB_ORACLE_PROPERTY=comparison.<number>.
let nextPropertyId = 0

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

    describe(label, () => {
      let originalFailure: ComparisonFailure | undefined
      let reducedFailure: ComparisonFailure | undefined
      let replayCalls = 0
      beforeEach(() => {
        originalFailure = undefined
        reducedFailure = undefined
        replayCalls = 0
      })
      nativeCampaignReceipt<Ts>((result) => {
        if (!result.failed) return
        if (
          !originalFailure ||
          !reducedFailure ||
          result.counterexamplePath === null
        )
          throw new Error(
            `${label}: failing run lost its primary comparison failure`,
          )
        const replay = checkWithOriginalFailure(arbitrary, checkValues, {
          seed: result.seed,
          path: result.counterexamplePath,
          numRuns: 1,
          endOnFailure: true,
          examples: result.runConfiguration.examples,
        })
        const reproduced =
          replay.result.failed &&
          replay.original?.checkpoint === originalFailure.checkpoint &&
          replay.reduced?.checkpoint === originalFailure.checkpoint
        throw new Error(
          `${label}: ${originalFailure.checkpoint} failed at the function-return checkpoint; ` +
            `reduction ${reducedFailure.checkpoint === originalFailure.checkpoint ? 'kept' : 'changed'} the original violation; ` +
            `seed ${result.seed}, path ${result.counterexamplePath}; ` +
            `direct replay ${reproduced ? 'reproduced' : 'did not reproduce'} that violation.\n${String(result.errorInstance)}`,
          { cause: originalFailure.error },
        )
      })
      oracleProperty({
        id: property,
        law: {
          statement: name,
          authority:
            'OrderByOptions, CompareOptions and the comparison, binary normalization and non-finite ordering contracts stated by the named comparison-laws-oracle companion',
          limits:
            'The unchanged bounded same-type and normalization grammars; unrelated object identity order, mixed-type order and query/index receiving paths remain outside this owner.',
        },
        // What this oracle owns: the comparison and normalization functions in
        // utils/comparison.ts, which the comparison-laws-oracle companion's
        // checks and models judge through this file's properties.
        owns: [`src/utils/comparison.ts`],
        histories: { arbitrary, runs: campaignRuns, fixedSeeds: [fixedSeed] },
        resolve: (history) => ({ history }),
        model: recordedAssertionJudgment,
        driver: (plan, observe) =>
          recordAssertionJudgment(property, plan, observe, () => {
            if (oracleReplayRequested() && replayCalls++ > 0) return
            try {
              checkValues(plan.history)
            } catch (error) {
              const failure = { checkpoint: failureCheckpoint(error), error }
              originalFailure ??= failure
              if (failure.checkpoint !== originalFailure.checkpoint) return
              reducedFailure = failure
              rejectAt(
                failure.checkpoint,
                error instanceof Error
                  ? error
                  : new Error(String(error), { cause: error }),
              )
            }
          }),
        check: forwardAssertionJudgment,
      })
    })
  }
}

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
      // Bounded valid dates keep every later date valid after the offset, so
      // each generated pair checks the order. fast-check 4 draws Invalid Dates
      // unless noInvalidDate is set, and such a draw would check nothing.
      fc.date({
        noInvalidDate: true,
        min: new Date(0),
        max: new Date(`2100-01-01`),
      }),
      fc.integer({ min: 1, max: 1000000 }),
    ])(`earlier date comes before later date`, (date, offset) => {
      const later = new Date(date.getTime() + offset)
      expect(ascComparator(date, later, defaultOpts)).toBeLessThan(0)
      expect(ascComparator(later, date, defaultOpts)).toBeGreaterThan(0)
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

const comparisonAuthority =
  'OrderByOptions, CompareOptions and the comparison, binary normalization and non-finite ordering contracts stated by the named comparison-laws-oracle companion'

describe(`NaN and invalid Date default-order refinement`, () => {
  oracleProperty({
    id: `comparison.non-finite-witnesses`,
    law: {
      statement: `The default comparator refines the tagged finite and non-finite order: NaN and invalid Dates share one position after finite values, and null stays first.`,
      authority: comparisonAuthority,
      limits: `The three fixed legacy witnesses: duplicate NaN among finite numbers, NaN with null, and one invalid Date beside a valid one.`,
    },
    owns: [`src/utils/comparison.ts`],
    histories: [
      `reconstructs the finite, duplicate NaN, null, and invalid Date witnesses`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `comparison.non-finite-witnesses`,
        plan,
        observe,
        () => {
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
        },
      ),
    check: forwardAssertionJudgment,
    // Each calibration replays its old body: a wrong comparison or default
    // sort must make the shared non-finite order check throw, and the wrong
    // answer must have been reached.
    calibrations: [
      {
        name: `rejects a wrong comparison that ties non-finite and finite values`,
        law: `comparison.non-finite-witnesses`,
        driver: (plan, observe) =>
          recordAssertionJudgment(
            `comparison.non-finite-witnesses`,
            plan,
            observe,
            () => {
              const rejections: Array<Error> = []
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
                rejections.push(
                  rejection(
                    () => true,
                    () =>
                      assertNonFiniteOrder(
                        {
                          family,
                          finiteDays: [1],
                          unorderedCount: 1,
                          includeNull: false,
                        },
                        faultyComparator,
                      ),
                  ),
                )
                expect(reachedFault).toBe(true)
              }
              rejectAt(
                `calibration: a comparison that ties non-finite and finite values`,
                rejections[0]!,
              )
            },
          ),
      },
      {
        name: `rejects a default sort that ties NaN to finite values`,
        law: `comparison.non-finite-witnesses`,
        driver: (plan, observe) =>
          recordAssertionJudgment(
            `comparison.non-finite-witnesses`,
            plan,
            observe,
            () => {
              let reachedFault = false
              const faultySort = (
                a: number | Date | null,
                b: number | Date | null,
              ) => {
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
              const rejected = rejection(
                () => true,
                () =>
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
              )
              expect(reachedFault).toBe(true)
              rejectAt(
                `calibration: a default sort that ties NaN to finite values`,
                rejected,
              )
            },
          ),
      },
    ],
  })

  comparisonProperty([arbitraryNonFiniteInput])(
    `default comparator refines tagged finite and non-finite order`,
    (input) => assertNonFiniteOrder(input),
  )
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
        direction: direction,
        nulls: nulls,
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

  oracleProperty({
    id: `comparison.signed-infinity-custom`,
    law: {
      statement: `A comparator made with a valid custom string comparison preserves that comparison's signed infinity and stays antisymmetric.`,
      authority: comparisonAuthority,
      limits: `One custom comparison over the strings a and b that returns -Infinity, 0 or Infinity.`,
    },
    owns: [`src/utils/comparison.ts`],
    histories: [
      `preserves signed infinity from a valid custom string comparator`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `comparison.signed-infinity-custom`,
        plan,
        observe,
        () => {
          const comparator = makeComparator({
            ...defaultOpts,
            stringSort: `custom`,
            compare: (a, b) => (a === b ? 0 : a < b ? -Infinity : Infinity),
          })
          expect(comparator(`a`, `b`)).toBe(-Infinity)
          expect(comparator(`b`, `a`)).toBe(Infinity)
          expect(comparator(`a`, `a`)).toBe(0)
          expect(
            checkAntisymmetry(comparator(`a`, `b`), comparator(`b`, `a`)),
          ).toBe(true)
        },
      ),
    check: forwardAssertionJudgment,
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
 * checkpoint. This production path makes no indexed or public-query claim.
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
  oracleProperty({
    id: `comparison.temporal-witnesses`,
    law: {
      statement: `The default comparator orders ISO PlainDate values by their calendar fields and ZonedDateTime values by their instants across offset zones.`,
      authority: comparisonAuthority,
      limits: `The fixed legacy PlainDate pairs and two ZonedDateTime pairs: one instant in two zones, and adjacent nanosecond instants.`,
    },
    owns: [`src/utils/comparison.ts`],
    histories: [
      `reconstructs the three PlainDate and one ZonedDateTime assertions`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `comparison.temporal-witnesses`,
        plan,
        observe,
        () => {
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
        },
      ),
    check: forwardAssertionJudgment,
    // A wrong comparator must make the shared ZonedDateTime check throw.
    calibrations: [
      {
        name: `rejects text order for one instant shown in two zones`,
        law: `comparison.temporal-witnesses`,
        driver: (plan, observe) =>
          recordAssertionJudgment(
            `comparison.temporal-witnesses`,
            plan,
            observe,
            () => {
              const sample: ZonedDateTimeOrderInput = {
                leftNanoOffset: 0,
                rightNanoOffset: 0,
                leftZone: `+00:00`,
                rightZone: `+05:30`,
              }
              const lexical = (left: unknown, right: unknown) =>
                String(left).localeCompare(String(right))
              rejectAt(
                `calibration: text order for one instant shown in two zones`,
                rejection(
                  () => true,
                  () => assertZonedDateTimeOrder(sample, lexical),
                ),
              )
            },
          ),
      },
      {
        name: `rejects millisecond truncation across adjacent instants`,
        law: `comparison.temporal-witnesses`,
        driver: (plan, observe) =>
          recordAssertionJudgment(
            `comparison.temporal-witnesses`,
            plan,
            observe,
            () => {
              const sample: ZonedDateTimeOrderInput = {
                leftNanoOffset: 0,
                rightNanoOffset: 1,
                leftZone: `+05:30`,
                rightZone: `+00:00`,
              }
              const truncated = (left: unknown, right: unknown) => {
                const leftEpoch = (left as { epochNanoseconds: bigint })
                  .epochNanoseconds
                const rightEpoch = (right as { epochNanoseconds: bigint })
                  .epochNanoseconds
                return Number(leftEpoch / 1_000_000n - rightEpoch / 1_000_000n)
              }
              rejectAt(
                `calibration: millisecond truncation across adjacent instants`,
                rejection(
                  () => true,
                  () => assertZonedDateTimeOrder(sample, truncated),
                ),
              )
            },
          ),
      },
    ],
  })

  comparisonProperty([arbitraryPlainDateOrderInput])(
    `ISO PlainDate order refines supplied calendar fields`,
    assertPlainDateOrder,
  )

  comparisonProperty([arbitraryZonedDateTimeOrderInput])(
    `ZonedDateTime order refines supplied instants across offset zones`,
    assertZonedDateTimeOrder,
  )
})
