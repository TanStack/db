import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { deepEquals } from '../src/utils'

/**
 * Custom arbitraries for generating values that deepEquals handles.
 *
 * Note: We use same-type arbitraries for symmetry/transitivity tests because
 * deepEquals has known asymmetric behavior when comparing certain cross-type
 * values (e.g., Date vs Temporal.Duration). This is documented in the
 * "known edge cases" section below.
 */
const arbitraryPrimitive = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true }), // NaN !== NaN, which would break reflexivity
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
)

const arbitraryDate = fc.date().map((d) => new Date(d.getTime()))

const arbitraryRegExp = fc
  .tuple(fc.string(), fc.constantFrom(``, `g`, `i`, `gi`, `m`, `gim`))
  .map(([source, flags]) => {
    try {
      // Escape special regex characters to avoid invalid patterns
      const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
      return new RegExp(escapedSource, flags)
    } catch {
      return /test/
    }
  })

const arbitraryUint8Array = fc.uint8Array({ minLength: 0, maxLength: 20 })

const arbitraryFloat32Array = fc
  .array(fc.float({ noNaN: true }), { minLength: 0, maxLength: 10 })
  .map((arr) => new Float32Array(arr))

const arbitraryTemporalPlainDate = fc
  .tuple(
    fc.integer({ min: 1, max: 9999 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }), // Safe day range
  )
  .map(([year, month, day]) => new Temporal.PlainDate(year, month, day))

const arbitraryTemporalDuration = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(([hours, minutes, seconds]) =>
    Temporal.Duration.from({ hours, minutes, seconds }),
  )

// Same-type value arbitraries for testing equivalence properties
// These avoid cross-type comparisons that have known asymmetric behavior
const arbitrarySameTypePrimitive = fc.oneof(
  fc.tuple(fc.string(), fc.string()),
  fc.tuple(fc.integer(), fc.integer()),
  fc.tuple(fc.double({ noNaN: true }), fc.double({ noNaN: true })),
  fc.tuple(fc.boolean(), fc.boolean()),
)

const arbitrarySameTypeDate = fc.tuple(arbitraryDate, arbitraryDate)
const arbitrarySameTypeRegExp = fc.tuple(arbitraryRegExp, arbitraryRegExp)
const arbitrarySameTypeUint8Array = fc.tuple(
  arbitraryUint8Array,
  arbitraryUint8Array,
)
const arbitrarySameTypeTemporalDate = fc.tuple(
  arbitraryTemporalPlainDate,
  arbitraryTemporalPlainDate,
)
const arbitrarySameTypeTemporalDuration = fc.tuple(
  arbitraryTemporalDuration,
  arbitraryTemporalDuration,
)

// Pair of values of the same type
const arbitrarySameTypePair = fc.oneof(
  arbitrarySameTypePrimitive,
  arbitrarySameTypeDate,
  arbitrarySameTypeRegExp,
  arbitrarySameTypeUint8Array,
  arbitrarySameTypeTemporalDate,
  arbitrarySameTypeTemporalDuration,
  fc.tuple(
    fc.array(fc.integer(), { maxLength: 5 }),
    fc.array(fc.integer(), { maxLength: 5 }),
  ),
  fc.tuple(
    fc.dictionary(fc.string(), fc.integer(), { maxKeys: 5 }),
    fc.dictionary(fc.string(), fc.integer(), { maxKeys: 5 }),
  ),
)

// Single values for reflexivity tests
const arbitrarySingleValue = fc.oneof(
  arbitraryPrimitive,
  arbitraryDate,
  arbitraryRegExp,
  arbitraryUint8Array,
  arbitraryFloat32Array,
  arbitraryTemporalPlainDate,
  arbitraryTemporalDuration,
  fc.array(fc.integer(), { maxLength: 5 }),
  fc.dictionary(fc.string(), fc.integer(), { maxKeys: 5 }),
)

describe(`deepEquals property-based tests`, () => {
  describe(`equivalence relation properties`, () => {
    fcTest.prop([arbitrarySingleValue])(
      `reflexivity: deepEquals(a, a) is always true`,
      (a) => {
        expect(deepEquals(a, a)).toBe(true)
      },
    )

    fcTest.prop([arbitrarySameTypePair])(
      `symmetry: deepEquals(a, b) === deepEquals(b, a) for same-type values`,
      ([a, b]) => {
        expect(deepEquals(a, b)).toBe(deepEquals(b, a))
      },
    )

    fcTest.prop([fc.array(fc.integer(), { maxLength: 5 })])(
      `transitivity: if deepEquals(a, b) && deepEquals(b, c) then deepEquals(a, c)`,
      (arr) => {
        // Create three copies to test transitivity
        const a = [...arr]
        const b = [...arr]
        const c = [...arr]
        if (deepEquals(a, b) && deepEquals(b, c)) {
          expect(deepEquals(a, c)).toBe(true)
        }
      },
    )
  })

  describe(`cross-type comparisons`, () => {
    it(`Date and Temporal.Duration are not equal in either direction`, () => {
      const date = new Date(`1970-01-01T00:00:00.000Z`)
      const duration = Temporal.Duration.from({
        hours: 0,
        minutes: 0,
        seconds: 0,
      })

      // Both directions should return false for different types (symmetric)
      expect(deepEquals(date, duration)).toBe(false)
      expect(deepEquals(duration, date)).toBe(false)
    })

    it(`Date and Temporal.PlainDate are not equal in either direction`, () => {
      const date = new Date(`2023-01-01T00:00:00.000Z`)
      const plainDate = new Temporal.PlainDate(2023, 1, 1)

      expect(deepEquals(date, plainDate)).toBe(false)
      expect(deepEquals(plainDate, date)).toBe(false)
    })

    it(`RegExp and object are not equal in either direction`, () => {
      const regex = /test/g
      const obj = { source: `test`, flags: `g` }

      expect(deepEquals(regex, obj)).toBe(false)
      expect(deepEquals(obj, regex)).toBe(false)
    })

    it(`Map and object are not equal in either direction`, () => {
      const map = new Map([[`a`, 1]])
      const obj = { a: 1 }

      expect(deepEquals(map, obj)).toBe(false)
      expect(deepEquals(obj, map)).toBe(false)
    })

    it(`Set and array are not equal in either direction`, () => {
      const set = new Set([1, 2, 3])
      const arr = [1, 2, 3]

      expect(deepEquals(set, arr)).toBe(false)
      expect(deepEquals(arr, set)).toBe(false)
    })

    it(`Uint8Array and array are not equal in either direction`, () => {
      const typedArr = new Uint8Array([1, 2, 3])
      const arr = [1, 2, 3]

      expect(deepEquals(typedArr, arr)).toBe(false)
      expect(deepEquals(arr, typedArr)).toBe(false)
    })
  })

  describe(`structural equality`, () => {
    fcTest.prop([fc.array(fc.integer(), { minLength: 0, maxLength: 10 })])(
      `arrays with same elements are equal`,
      (arr) => {
        const copy = [...arr]
        expect(deepEquals(arr, copy)).toBe(true)
      },
    )

    fcTest.prop([
      fc.dictionary(fc.string(), fc.integer(), { minKeys: 0, maxKeys: 10 }),
    ])(`objects with same properties are equal`, (obj) => {
      const copy = { ...obj }
      expect(deepEquals(obj, copy)).toBe(true)
    })

    fcTest.prop([
      fc.array(fc.tuple(fc.string(), fc.integer()), {
        minLength: 0,
        maxLength: 5,
      }),
    ])(`Maps with same entries are equal`, (entries) => {
      const map1 = new Map(entries)
      const map2 = new Map(entries)
      expect(deepEquals(map1, map2)).toBe(true)
    })

    fcTest.prop([fc.array(fc.integer(), { minLength: 0, maxLength: 10 })])(
      `Sets with same primitive values are equal`,
      (arr) => {
        const set1 = new Set(arr)
        const set2 = new Set(arr)
        expect(deepEquals(set1, set2)).toBe(true)
      },
    )

    fcTest.prop([fc.uint8Array({ minLength: 0, maxLength: 50 })])(
      `Uint8Arrays with same content are equal`,
      (arr) => {
        const copy = new Uint8Array(arr)
        expect(deepEquals(arr, copy)).toBe(true)
      },
    )

    fcTest.prop([arbitraryDate])(`Dates with same time are equal`, (date) => {
      const copy = new Date(date.getTime())
      expect(deepEquals(date, copy)).toBe(true)
    })

    fcTest.prop([arbitraryTemporalPlainDate])(
      `Temporal.PlainDate with same values are equal`,
      (date) => {
        const copy = new Temporal.PlainDate(date.year, date.month, date.day)
        expect(deepEquals(date, copy)).toBe(true)
      },
    )
  })

  describe(`inequality properties`, () => {
    fcTest.prop([
      fc.array(fc.integer(), { minLength: 1, maxLength: 10 }),
      fc.integer(),
    ])(`arrays with different elements are not equal`, (arr, extraElement) => {
      const modified = [...arr, extraElement]
      expect(deepEquals(arr, modified)).toBe(false)
    })

    fcTest.prop([
      fc.dictionary(fc.string(), fc.integer(), { minKeys: 1, maxKeys: 5 }),
      fc.string(),
      fc.integer(),
    ])(`objects with extra property are not equal`, (obj, newKey, newValue) => {
      // Only test if the key doesn't already exist
      if (!(newKey in obj)) {
        const modified = { ...obj, [newKey]: newValue }
        expect(deepEquals(obj, modified)).toBe(false)
      }
    })

    fcTest.prop([fc.integer(), fc.string()])(
      `different types are not equal`,
      (num, str) => {
        expect(deepEquals(num, str)).toBe(false)
      },
    )

    fcTest.prop([fc.date(), fc.date()])(
      `dates with different times are not equal`,
      (date1, date2) => {
        if (date1.getTime() !== date2.getTime()) {
          expect(deepEquals(date1, date2)).toBe(false)
        }
      },
    )
  })

  describe(`edge cases`, () => {
    fcTest.prop([arbitrarySingleValue])(
      `null is never equal to a non-null value`,
      (a) => {
        if (a !== null) {
          expect(deepEquals(null, a)).toBe(false)
          expect(deepEquals(a, null)).toBe(false)
        }
      },
    )

    fcTest.prop([arbitrarySingleValue])(
      `undefined is never equal to a non-undefined value`,
      (a) => {
        if (a !== undefined) {
          expect(deepEquals(undefined, a)).toBe(false)
          expect(deepEquals(a, undefined)).toBe(false)
        }
      },
    )

    fcTest.prop([fc.array(fc.integer(), { minLength: 0, maxLength: 5 })])(
      `array is never equal to object with same values`,
      (arr) => {
        const obj = { ...arr }
        expect(deepEquals(arr, obj)).toBe(false)
      },
    )
  })

  describe(`nested structure consistency`, () => {
    fcTest.prop([
      fc.array(fc.array(fc.integer(), { maxLength: 3 }), { maxLength: 3 }),
    ])(`nested arrays maintain equality through cloning`, (nestedArr) => {
      const clone = nestedArr.map((inner) => [...inner])
      expect(deepEquals(nestedArr, clone)).toBe(true)
    })

    fcTest.prop([
      fc.dictionary(
        fc.string(),
        fc.dictionary(fc.string(), fc.integer(), { maxKeys: 3 }),
        { maxKeys: 3 },
      ),
    ])(`nested objects maintain equality through cloning`, (nestedObj) => {
      const clone = Object.fromEntries(
        Object.entries(nestedObj).map(([k, v]) => [k, { ...v }]),
      )
      expect(deepEquals(nestedObj, clone)).toBe(true)
    })
  })
})
