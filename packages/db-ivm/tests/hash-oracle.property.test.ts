import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'
import type { Arbitrary } from 'fast-check'

/**
 * The hash is a deterministic fingerprint of its declared value domain.
 * `hash-identity-oracle.property.test.ts` owns D2 value identity. This file
 * checks the equal-hash consequence for flat equivalent constructors and
 * deterministic hashing of their values.
 *
 * Independent constructors build equivalent values with different allocation,
 * plain-object property order, and normalized numeric representations.
 * They must agree. Distinct values may share a 32-bit digest, so this file
 * makes no distinct-digest assertion. The identity owner checks inequality
 * through `equalHashValues`, including under deliberately colliding markers.
 *
 * Graph reachability, mixed carriers, failed traversal, and retry atomicity are
 * separate owners. Keeping them separate makes this file's flat-value model
 * small enough to inspect.
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

type HashValue = (value: unknown) => number

function expectEqualHashes(
  value: unknown,
  equivalent: unknown,
  hashValue: HashValue = hash,
): void {
  expect(hashValue(value)).toBe(hashValue(equivalent))
}

// Prefixing preserves arbitrary string content while excluding integer-index
// keys. Unique keys and at least two entries make reversal consequential.
const arbitraryNonIndexEntries = fc.uniqueArray(
  fc.tuple(
    fc.string().map((key) => `key:${key}`),
    fc.integer(),
  ),
  { minLength: 2, maxLength: 5, selector: ([key]) => key },
)

function expectPermutedHashes(
  entries: Array<[string, number]>,
  hashValue: HashValue = hash,
): void {
  const original = Object.fromEntries(entries)
  const reversed = Object.fromEntries([...entries].reverse())
  expect(Object.keys(original)).not.toEqual(Object.keys(reversed))
  expect(original).toEqual(reversed)
  expectEqualHashes(original, reversed, hashValue)
}

// The reusable value laws run with identical generators and checks in a
// stable campaign and a fresh campaign. Select a single test name with Vitest
// when replaying, for example:
// TANSTACK_DB_IVM_HASH_SEED=123 TANSTACK_DB_IVM_HASH_PATH=0:1 \
//   pnpm exec vitest --run tests/hash-oracle.property.test.ts -t 'cloned arrays have same hash'
const valueReplaySeedText = process.env.TANSTACK_DB_IVM_HASH_SEED
const valueReplayPath = process.env.TANSTACK_DB_IVM_HASH_PATH
const valueReplaySeed =
  valueReplaySeedText === undefined ? undefined : Number(valueReplaySeedText)
const valueCampaigns =
  valueReplaySeedText === undefined && valueReplayPath === undefined
    ? [
        { name: `fixed`, seed: 1657021 },
        { name: `random`, seed: undefined },
      ]
    : [{ name: `replay`, seed: valueReplaySeed }]

function hashProp<Ts extends [unknown, ...Array<unknown>]>(arbitraries: {
  [K in keyof Ts]: Arbitrary<Ts[K]>
}) {
  return (name: string, check: (...values: Ts) => void): void => {
    const property = fc.property(...arbitraries, check)
    for (const { name: campaign, seed } of valueCampaigns) {
      it(`${name} (${campaign})`, () => {
        if (valueReplayPath !== undefined && valueReplaySeedText === undefined)
          throw new Error(`TANSTACK_DB_IVM_HASH_PATH requires a seed`)
        if (
          valueReplaySeedText !== undefined &&
          (valueReplaySeedText.trim() === `` ||
            typeof seed !== `number` ||
            !Number.isSafeInteger(seed) ||
            seed < -2147483648 ||
            seed > 2147483647)
        )
          throw new Error(`TANSTACK_DB_IVM_HASH_SEED must be a 32-bit integer`)
        fc.assert(property, {
          numRuns: 100,
          ...(seed === undefined ? {} : { seed }),
          ...(valueReplayPath === undefined ? {} : { path: valueReplayPath }),
        })
      })
    }
  }
}

describe(`hash property-based tests`, () => {
  describe(`determinism`, () => {
    hashProp([arbitraryPrimitive])(
      `hash is deterministic for primitives`,
      (value) => {
        const first = hash(value)
        const second = hash(value)
        expect(first).toBe(second)
      },
    )

    hashProp([arbitrarySimpleObject])(
      `hash is deterministic for objects`,
      (obj) => {
        const first = hash(obj)
        const second = hash(obj)
        expect(first).toBe(second)
      },
    )

    hashProp([arbitrarySimpleArray])(
      `hash is deterministic for arrays`,
      (arr) => {
        const first = hash(arr)
        const second = hash(arr)
        expect(first).toBe(second)
      },
    )

    hashProp([arbitraryDate])(`hash is deterministic for dates`, (date) => {
      const first = hash(date)
      const second = hash(date)
      expect(first).toBe(second)
    })

    hashProp([arbitraryUint8Array])(
      `hash is deterministic for Uint8Arrays`,
      (arr) => {
        const first = hash(arr)
        const second = hash(arr)
        expect(first).toBe(second)
      },
    )
  })

  describe(`equal-hash consequences of D2 value identity`, () => {
    hashProp([arbitrarySimpleObject])(
      `cloned objects have same hash`,
      (obj) => {
        const clone = { ...obj }
        expect(hash(clone)).toBe(hash(obj))
      },
    )

    hashProp([arbitrarySimpleArray])(`cloned arrays have same hash`, (arr) => {
      const clone = [...arr]
      expect(hash(clone)).toBe(hash(arr))
    })

    hashProp([arbitraryDate])(`dates with same time have same hash`, (date) => {
      const clone = new Date(date.getTime())
      expect(hash(clone)).toBe(hash(date))
    })

    hashProp([arbitraryUint8Array])(
      `Uint8Arrays with same content have same hash`,
      (arr) => {
        const clone = new Uint8Array(arr)
        expect(hash(clone)).toBe(hash(arr))
      },
    )

    hashProp([fc.array(fc.tuple(fc.string(), fc.integer()), { maxLength: 5 })])(
      `Maps with same entries have same hash`,
      (entries) => {
        const map1 = new Map(entries)
        const map2 = new Map(entries)
        expect(hash(map1)).toBe(hash(map2))
      },
    )

    hashProp([fc.array(fc.integer(), { maxLength: 10 })])(
      `Sets with same values have same hash`,
      (arr) => {
        const set1 = new Set(arr)
        const set2 = new Set(arr)
        expect(hash(set1)).toBe(hash(set2))
      },
    )
  })

  describe(`property order independence`, () => {
    hashProp([
      fc.uniqueArray(
        fc.string().filter((s) => s !== `` && s !== `__proto__`),
        { minLength: 2, maxLength: 2 },
      ),
      fc.integer(),
      fc.integer(),
    ])(
      `objects with same properties in different order have same hash`,
      ([key1, key2], val1, val2) => {
        expect(key1).not.toBe(key2)
        const obj1 = { [key1!]: val1, [key2!]: val2 }
        const obj2 = { [key2!]: val2, [key1!]: val1 }
        expect(hash(obj1)).toBe(hash(obj2))
      },
    )

    hashProp([
      fc.dictionary(
        fc.string().filter((s) => s !== `__proto__`),
        fc.integer(),
        { minKeys: 2, maxKeys: 5 },
      ),
    ])(`object hash is independent of property insertion order`, (obj) => {
      const keys = Object.keys(obj)
      const reversedKeys = [...keys].reverse()

      // Create new object with reversed key order
      const reversed: Record<string, number> = {}
      for (const key of reversedKeys) {
        reversed[key] = obj[key]!
      }

      expect(hash(reversed)).toBe(hash(obj))
    })

    hashProp([arbitraryNonIndexEntries])(
      `preserves hashes after an observed non-index key permutation`,
      (entries) => {
        expectPermutedHashes(entries)
      },
    )
  })

  describe(`number normalization`, () => {
    hashProp([fc.constant(0)])(`0 and -0 have the same hash`, () => {
      expect(hash(0)).toBe(hash(-0))
    })

    hashProp([fc.constant(NaN)])(`NaN has consistent hash`, () => {
      const first = hash(NaN)
      const second = hash(NaN)
      expect(first).toBe(second)
    })

    hashProp([fc.integer()])(`integers hash consistently`, (n) => {
      expect(hash(n)).toBe(hash(n))
    })

    hashProp([fc.double({ noNaN: true, noDefaultInfinity: true })])(
      `doubles hash consistently`,
      (n) => {
        expect(hash(n)).toBe(hash(n))
      },
    )
  })

  describe(`nested structures`, () => {
    hashProp([
      fc.array(fc.array(fc.integer(), { maxLength: 3 }), { maxLength: 3 }),
    ])(`nested arrays hash consistently`, (nested) => {
      const clone = nested.map((inner) => [...inner])
      expect(hash(clone)).toBe(hash(nested))
    })

    hashProp([
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
    hashProp([arbitraryPrimitive])(
      `hash returns a number for primitives`,
      (value) => {
        expect(typeof hash(value)).toBe(`number`)
        expect(Number.isFinite(hash(value))).toBe(true)
      },
    )

    hashProp([arbitrarySimpleObject])(
      `hash returns a number for objects`,
      (obj) => {
        expect(typeof hash(obj)).toBe(`number`)
        expect(Number.isFinite(hash(obj))).toBe(true)
      },
    )

    hashProp([arbitrarySimpleArray])(
      `hash returns a number for arrays`,
      (arr) => {
        expect(typeof hash(arr)).toBe(`number`)
        expect(Number.isFinite(hash(arr))).toBe(true)
      },
    )
  })

  describe(`reconstructed primitive equality`, () => {
    hashProp([fc.integer()])(
      `integer decimal round trips preserve hashes`,
      (value) => {
        const equivalent = Number(String(value))
        expect(equivalent).toBe(value)
        expectEqualHashes(value, equivalent)
      },
    )

    hashProp([fc.string()])(
      `reconstructed strings preserve hashes`,
      (value) => {
        const equivalent = value.split(``).join(``)
        expect(equivalent).toBe(value)
        expectEqualHashes(value, equivalent)
      },
    )
  })

  describe(`law checker calibration`, () => {
    it.each([0, 42, ``, `reconstructed`])(
      `rejects inconsistent equal-value hashes for %j`,
      (value) => {
        let calls = 0
        expect(() => expectEqualHashes(value, value, () => ++calls)).toThrow()
        expect(calls).toBe(2)
        expectEqualHashes(value, value)
      },
    )

    it(`rejects an insertion-order-sensitive result but accepts equal structures`, () => {
      const entries: Array<[string, number]> = [
        [`key:left`, 1],
        [`key:right`, 2],
      ]
      expect(() =>
        expectPermutedHashes(entries, (value) =>
          Object.keys(value as object)[0] === `key:left` ? 1 : 2,
        ),
      ).toThrow()
      expectPermutedHashes(entries)
      // The reach guard must also reject a nominal reversal of index keys.
      expect(() =>
        expectPermutedHashes([
          [`0`, 1],
          [`1`, 2],
        ]),
      ).toThrow()
    })

    it(`shrinks and replays an injected equality-law failure`, () => {
      const property = fc.property(arbitraryNonIndexEntries, (entries) => {
        let calls = 0
        expectPermutedHashes(entries, () => ++calls)
      })
      const failed = fc.check(property, { seed: 1657021, numRuns: 100 })
      expect(failed.failed).toBe(true)
      expect(failed.counterexample).not.toBeNull()
      expect(failed.numShrinks).toBeGreaterThan(0)
      if (failed.counterexamplePath === null) {
        throw new Error(`Expected a counterexample path for replay`)
      }
      const replayed = fc.check(property, {
        seed: failed.seed,
        path: failed.counterexamplePath,
        numRuns: 100,
        endOnFailure: true,
      })
      expect(replayed.failed).toBe(true)
      expect(replayed.counterexample).toEqual(failed.counterexample)
    })
  })
})
