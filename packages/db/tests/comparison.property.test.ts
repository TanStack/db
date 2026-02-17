import { describe, expect } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  ascComparator,
  descComparator,
  makeComparator,
  normalizeValue,
} from '../src/utils/comparison'
import type { CompareOptions } from '../src/query/builder/types'

/**
 * Property-based tests for comparison functions
 *
 * A valid comparator must satisfy:
 * 1. Consistency: compare(a, b) always returns the same value
 * 2. Antisymmetry: sign(compare(a, b)) === -sign(compare(b, a))
 * 3. Transitivity: if compare(a, b) <= 0 and compare(b, c) <= 0 then compare(a, c) <= 0
 * 4. Reflexivity: compare(a, a) === 0
 *
 * Note: Object comparison uses stable IDs based on creation order, which means
 * comparing two different object instances has order-dependent behavior.
 * These tests focus on primitives, dates, and arrays where comparison is deterministic.
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

// Comparator-compatible values (primitives that can be compared deterministically)
// Note: We exclude plain objects because they use stable IDs which are creation-order dependent
const arbitraryComparablePrimitive = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
)

const arbitraryDate = fc.date({ noInvalidDate: true })

const arbitraryComparableArray = fc.array(arbitraryComparablePrimitive, {
  maxLength: 5,
})

// Helper to get sign of a number
const sign = (n: number): -1 | 0 | 1 => {
  if (n < 0) return -1
  if (n > 0) return 1
  return 0
}

/**
 * Check antisymmetry property: sign(compare(a, b)) === -sign(compare(b, a))
 * This handles the +0/-0 JavaScript edge case where -0 !== 0 in Object.is
 */
const checkAntisymmetry = (ab: number, ba: number): boolean => {
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

describe(`ascComparator property-based tests`, () => {
  describe(`comparator laws`, () => {
    fcTest.prop([arbitraryComparablePrimitive])(
      `reflexivity: compare(a, a) === 0`,
      (a) => {
        expect(ascComparator(a, a, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([arbitrarySameTypePair])(
      `antisymmetry: sign(compare(a, b)) === -sign(compare(b, a)) for same types`,
      ([a, b]) => {
        const ab = ascComparator(a, b, defaultOpts)
        const ba = ascComparator(b, a, defaultOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )

    fcTest.prop([arbitrarySameTypeTriple])(
      `transitivity: if a <= b and b <= c then a <= c (same types)`,
      ([a, b, c]) => {
        const ab = ascComparator(a, b, defaultOpts)
        const bc = ascComparator(b, c, defaultOpts)
        const ac = ascComparator(a, c, defaultOpts)

        if (ab <= 0 && bc <= 0) {
          expect(ac).toBeLessThanOrEqual(0)
        }
      },
    )

    fcTest.prop([arbitrarySameTypePair])(
      `consistency: compare(a, b) always returns the same value`,
      ([a, b]) => {
        const result1 = ascComparator(a, b, defaultOpts)
        const result2 = ascComparator(a, b, defaultOpts)
        expect(result1).toBe(result2)
      },
    )
  })

  describe(`null handling`, () => {
    fcTest.prop([arbitraryComparablePrimitive])(
      `nulls first: null comes before any non-null value`,
      (a) => {
        expect(ascComparator(null, a, defaultOpts)).toBeLessThan(0)
        expect(ascComparator(a, null, defaultOpts)).toBeGreaterThan(0)
      },
    )

    fcTest.prop([arbitraryComparablePrimitive])(
      `nulls last: null comes after any non-null value`,
      (a) => {
        expect(ascComparator(null, a, nullsLastOpts)).toBeGreaterThan(0)
        expect(ascComparator(a, null, nullsLastOpts)).toBeLessThan(0)
      },
    )

    fcTest.prop([fc.constant(null), fc.constant(null)])(
      `null equals null`,
      (a, b) => {
        expect(ascComparator(a, b, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([fc.constant(undefined), fc.constant(undefined)])(
      `undefined equals undefined`,
      (a, b) => {
        expect(ascComparator(a, b, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([
      fc.constantFrom(null, undefined),
      fc.constantFrom(null, undefined),
    ])(`null and undefined are treated the same for comparison`, (a, b) => {
      // Both null and undefined are treated as "null-ish" values
      expect(ascComparator(a, b, defaultOpts)).toBe(0)
    })
  })

  describe(`string comparison`, () => {
    fcTest.prop([fc.string()])(
      `locale sort: reflexivity holds for strings`,
      (a) => {
        expect(ascComparator(a, a, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([fc.string(), fc.string()])(
      `lexical sort: antisymmetry holds for strings`,
      (a, b) => {
        const ab = ascComparator(a, b, lexicalOpts)
        const ba = ascComparator(b, a, lexicalOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )
  })

  describe(`array comparison`, () => {
    fcTest.prop([arbitraryComparableArray])(
      `reflexivity: compare(arr, arr) === 0`,
      (arr) => {
        expect(ascComparator(arr, arr, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([arbitrarySameTypeArray])(
      `antisymmetry for arrays of same element type`,
      ([a, b]) => {
        const ab = ascComparator(a, b, defaultOpts)
        const ba = ascComparator(b, a, defaultOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )

    fcTest.prop([fc.array(fc.integer(), { maxLength: 5 })])(
      `arrays with same elements compare equal`,
      (arr) => {
        const copy = [...arr]
        expect(ascComparator(arr, copy, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([fc.array(fc.integer(), { minLength: 1, maxLength: 5 })])(
      `shorter prefix array comes before longer array`,
      (arr) => {
        const prefix = arr.slice(0, -1)
        if (prefix.length < arr.length) {
          expect(ascComparator(prefix, arr, defaultOpts)).toBeLessThan(0)
          expect(ascComparator(arr, prefix, defaultOpts)).toBeGreaterThan(0)
        }
      },
    )
  })

  describe(`date comparison`, () => {
    fcTest.prop([arbitraryDate])(
      `reflexivity: compare(date, date) === 0`,
      (date) => {
        expect(ascComparator(date, date, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([arbitraryDate, arbitraryDate])(
      `antisymmetry for dates`,
      (a, b) => {
        const ab = ascComparator(a, b, defaultOpts)
        const ba = ascComparator(b, a, defaultOpts)
        expect(checkAntisymmetry(ab, ba)).toBe(true)
      },
    )

    fcTest.prop([arbitraryDate])(
      `dates with same time compare equal`,
      (date) => {
        const copy = new Date(date.getTime())
        expect(ascComparator(date, copy, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([
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
    fcTest.prop([fc.integer()])(`reflexivity for integers`, (n) => {
      expect(ascComparator(n, n, defaultOpts)).toBe(0)
    })

    fcTest.prop([fc.double({ noNaN: true, noDefaultInfinity: true })])(
      `reflexivity for doubles`,
      (n) => {
        expect(ascComparator(n, n, defaultOpts)).toBe(0)
      },
    )

    fcTest.prop([fc.integer(), fc.integer()])(
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

describe(`descComparator property-based tests`, () => {
  fcTest.prop([arbitrarySameTypePair])(
    `descComparator reverses ascComparator ordering (same types)`,
    ([a, b]) => {
      const asc = ascComparator(a, b, defaultOpts)
      const desc = descComparator(a, b, defaultOpts)
      expect(checkAntisymmetry(asc, desc)).toBe(true)
    },
  )

  fcTest.prop([arbitraryComparablePrimitive])(
    `reflexivity: descComparator(a, a) === 0`,
    (a) => {
      expect(descComparator(a, a, defaultOpts)).toBe(0)
    },
  )

  fcTest.prop([fc.integer({ min: 1 })])(
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
  fcTest.prop([
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
})

describe(`normalizeValue property-based tests`, () => {
  fcTest.prop([arbitraryDate])(`dates normalize to their timestamp`, (date) => {
    expect(normalizeValue(date)).toBe(date.getTime())
  })

  fcTest.prop([fc.string()])(`strings pass through unchanged`, (str) => {
    expect(normalizeValue(str)).toBe(str)
  })

  fcTest.prop([fc.integer()])(`integers pass through unchanged`, (n) => {
    expect(normalizeValue(n)).toBe(n)
  })

})
