import { describe, expect } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'

/**
 * Property-based tests for hash function
 *
 * Key properties:
 * 1. Determinism: hash(x) always returns the same value
 * 2. Structural equality: equal structures should have the same hash
 * 3. Property order independence: objects with same properties in different order have same hash
 * 4. Number normalization: -0 and 0 have same hash, NaN has consistent hash
 * 5. Type markers: different types should generally produce different hashes
 */

// Arbitraries for generating test values
const arbitraryPrimitive = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
)

const arbitraryDate = fc.date({ noInvalidDate: true })

const arbitraryUint8Array = fc.uint8Array({ minLength: 0, maxLength: 128 })

const arbitrarySimpleObject = fc.dictionary(fc.string(), fc.integer(), {
  maxKeys: 5,
})

const arbitrarySimpleArray = fc.array(fc.integer(), { maxLength: 10 })

describe(`hash property-based tests`, () => {
  describe(`determinism`, () => {
    fcTest.prop([arbitraryPrimitive])(
      `hash is deterministic for primitives`,
      (value) => {
        const first = hash(value)
        const second = hash(value)
        expect(first).toBe(second)
      },
    )

    fcTest.prop([arbitrarySimpleObject])(
      `hash is deterministic for objects`,
      (obj) => {
        const first = hash(obj)
        const second = hash(obj)
        expect(first).toBe(second)
      },
    )

    fcTest.prop([arbitrarySimpleArray])(
      `hash is deterministic for arrays`,
      (arr) => {
        const first = hash(arr)
        const second = hash(arr)
        expect(first).toBe(second)
      },
    )

    fcTest.prop([arbitraryDate])(`hash is deterministic for dates`, (date) => {
      const first = hash(date)
      const second = hash(date)
      expect(first).toBe(second)
    })

    fcTest.prop([arbitraryUint8Array])(
      `hash is deterministic for Uint8Arrays`,
      (arr) => {
        const first = hash(arr)
        const second = hash(arr)
        expect(first).toBe(second)
      },
    )
  })

  describe(`structural equality`, () => {
    fcTest.prop([arbitrarySimpleObject])(
      `cloned objects have same hash`,
      (obj) => {
        const clone = { ...obj }
        expect(hash(clone)).toBe(hash(obj))
      },
    )

    fcTest.prop([arbitrarySimpleArray])(`cloned arrays have same hash`, (arr) => {
      const clone = [...arr]
      expect(hash(clone)).toBe(hash(arr))
    })

    fcTest.prop([arbitraryDate])(`dates with same time have same hash`, (date) => {
      const clone = new Date(date.getTime())
      expect(hash(clone)).toBe(hash(date))
    })

    fcTest.prop([arbitraryUint8Array])(
      `Uint8Arrays with same content have same hash`,
      (arr) => {
        const clone = new Uint8Array(arr)
        expect(hash(clone)).toBe(hash(arr))
      },
    )

    fcTest.prop([
      fc.array(fc.tuple(fc.string(), fc.integer()), { maxLength: 5 }),
    ])(`Maps with same entries have same hash`, (entries) => {
      const map1 = new Map(entries)
      const map2 = new Map(entries)
      expect(hash(map1)).toBe(hash(map2))
    })

    fcTest.prop([fc.array(fc.integer(), { maxLength: 10 })])(
      `Sets with same values have same hash`,
      (arr) => {
        const set1 = new Set(arr)
        const set2 = new Set(arr)
        expect(hash(set1)).toBe(hash(set2))
      },
    )
  })

  describe(`property order independence`, () => {
    fcTest.prop([
      fc.tuple(
        fc.string().filter((s) => s !== ``),
        fc.integer(),
        fc.string().filter((s) => s !== ``),
        fc.integer(),
      ),
    ])(
      `objects with same properties in different order have same hash`,
      ([key1, val1, key2, val2]) => {
        // Skip if keys are the same
        if (key1 === key2) return

        const obj1 = { [key1]: val1, [key2]: val2 }
        const obj2 = { [key2]: val2, [key1]: val1 }
        expect(hash(obj1)).toBe(hash(obj2))
      },
    )

    fcTest.prop([fc.dictionary(fc.string(), fc.integer(), { minKeys: 2, maxKeys: 5 })])(
      `object hash is independent of property insertion order`,
      (obj) => {
        const keys = Object.keys(obj)
        const reversedKeys = [...keys].reverse()

        // Create new object with reversed key order
        const reversed: Record<string, number> = {}
        for (const key of reversedKeys) {
          reversed[key] = obj[key]!
        }

        expect(hash(reversed)).toBe(hash(obj))
      },
    )
  })

  describe(`number normalization`, () => {
    fcTest.prop([fc.constant(0)])(`0 and -0 have the same hash`, () => {
      expect(hash(0)).toBe(hash(-0))
    })

    fcTest.prop([fc.constant(NaN)])(`NaN has consistent hash`, () => {
      const first = hash(NaN)
      const second = hash(NaN)
      expect(first).toBe(second)
    })

    fcTest.prop([fc.integer()])(`integers hash consistently`, (n) => {
      expect(hash(n)).toBe(hash(n))
    })

    fcTest.prop([fc.double({ noNaN: true, noDefaultInfinity: true })])(
      `doubles hash consistently`,
      (n) => {
        expect(hash(n)).toBe(hash(n))
      },
    )
  })

  describe(`type distinction`, () => {
    fcTest.prop([fc.array(fc.integer(), { minLength: 0, maxLength: 5 })])(
      `array and object with same indices have different hashes`,
      (arr) => {
        // Create object with same numeric keys
        const obj: Record<string, number> = {}
        arr.forEach((val, idx) => {
          obj[String(idx)] = val
        })

        // Arrays and objects should generally have different hashes due to markers
        // but for empty ones, both might hash the same
        if (arr.length > 0) {
          expect(hash(arr)).not.toBe(hash(obj))
        }
      },
    )

    fcTest.prop([fc.integer()])(
      `number and string representation have different hashes`,
      (n) => {
        expect(hash(n)).not.toBe(hash(String(n)))
      },
    )

    fcTest.prop([fc.boolean()])(
      `boolean and its string representation have different hashes`,
      (b) => {
        expect(hash(b)).not.toBe(hash(String(b)))
      },
    )

    fcTest.prop([fc.date({ noInvalidDate: true })])(
      `date and its timestamp have different hashes`,
      (date) => {
        expect(hash(date)).not.toBe(hash(date.getTime()))
      },
    )

    fcTest.prop([fc.array(fc.integer(), { minLength: 1, maxLength: 5 })])(
      `array and Set with same values have different hashes`,
      (arr) => {
        const set = new Set(arr)
        expect(hash(arr)).not.toBe(hash(set))
      },
    )
  })

  describe(`nested structures`, () => {
    fcTest.prop([
      fc.array(fc.array(fc.integer(), { maxLength: 3 }), { maxLength: 3 }),
    ])(`nested arrays hash consistently`, (nested) => {
      const clone = nested.map((inner) => [...inner])
      expect(hash(clone)).toBe(hash(nested))
    })

    fcTest.prop([
      fc.dictionary(
        fc.string(),
        fc.dictionary(fc.string(), fc.integer(), { maxKeys: 3 }),
        { maxKeys: 3 },
      ),
    ])(`nested objects hash consistently`, (nested) => {
      const clone = Object.fromEntries(
        Object.entries(nested).map(([k, v]) => [k, { ...v }]),
      )
      expect(hash(clone)).toBe(hash(nested))
    })
  })

  describe(`hash produces numbers`, () => {
    fcTest.prop([arbitraryPrimitive])(`hash returns a number for primitives`, (value) => {
      expect(typeof hash(value)).toBe(`number`)
      expect(Number.isFinite(hash(value))).toBe(true)
    })

    fcTest.prop([arbitrarySimpleObject])(`hash returns a number for objects`, (obj) => {
      expect(typeof hash(obj)).toBe(`number`)
      expect(Number.isFinite(hash(obj))).toBe(true)
    })

    fcTest.prop([arbitrarySimpleArray])(`hash returns a number for arrays`, (arr) => {
      expect(typeof hash(arr)).toBe(`number`)
      expect(Number.isFinite(hash(arr))).toBe(true)
    })
  })

  describe(`inequality detection`, () => {
    fcTest.prop([fc.integer(), fc.integer()])(
      `different integers have different hashes (most of the time)`,
      (a, b) => {
        // Hash collisions are possible, so we only check that equal values have equal hashes
        if (a === b) {
          expect(hash(a)).toBe(hash(b))
        }
        // We don't assert different values have different hashes due to collisions
      },
    )

    fcTest.prop([fc.string(), fc.string()])(
      `equal strings have equal hashes`,
      (a, b) => {
        if (a === b) {
          expect(hash(a)).toBe(hash(b))
        }
      },
    )

    fcTest.prop([
      fc.array(fc.integer(), { minLength: 1, maxLength: 10 }),
      fc.integer(),
    ])(`arrays with extra element have different hashes`, (arr, extra) => {
      const extended = [...arr, extra]
      expect(hash(arr)).not.toBe(hash(extended))
    })

    fcTest.prop([
      fc.dictionary(fc.string(), fc.integer(), { minKeys: 1, maxKeys: 5 }),
      fc.string(),
      fc.integer(),
    ])(`objects with extra property have different hashes`, (obj, newKey, newValue) => {
      if (!(newKey in obj)) {
        const extended = { ...obj, [newKey]: newValue }
        expect(hash(obj)).not.toBe(hash(extended))
      }
    })
  })
})
