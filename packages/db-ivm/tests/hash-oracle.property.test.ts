import { describe } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'
import { oracleProperty } from '../../db/tests/oracle-property.js'
import {
  arbitraryNonIndexEntries,
  checkHashComparisons,
  comparisonReferences,
  observePermutedHashes,
} from './hash-value-oracle.js'
import type { ComparisonRecorder } from './hash-value-oracle.js'
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

// The flat-value law remains a differential comparison between independent
// equivalent constructors; each cell records its original pair of results.

// The reusable value laws run with identical generators and checks in a
// fixed campaign and a random campaign. A path replay of `ivm.hash-value`
// selects only its reported random unit. For a current replay, copy all printed
// Replay: coordinates, including TANSTACK_DB_ORACLE_UNIT. The following example
// preserves the original pre-unit coordinates; no constructions preceded this
// generated stream, so add UNIT='random seed: generated' without shifting its
// path when replaying that source revision:
// TANSTACK_DB_ORACLE_SEED=123 TANSTACK_DB_ORACLE_PATH=0:1 \
//   TANSTACK_DB_ORACLE_PROPERTY=ivm.hash-value \
//   pnpm exec vitest --run tests/hash-oracle.property.test.ts -t 'cloned arrays have same hash'
function hashProp<Ts extends [unknown, ...Array<unknown>]>(arbitraries: {
  [K in keyof Ts]: Arbitrary<Ts[K]>
}) {
  return (
    name: string,
    drive: (record: ComparisonRecorder, ...values: Ts) => void,
  ): void => {
    describe(name, () => {
      oracleProperty<Ts, Array<unknown>>({
        id: `ivm.hash-value`,
        law: {
          statement: name,
          authority: `The existing deterministic fingerprint and equal-constructor laws documented above.`,
          limits: `The original flat-value constructor domain for this cell; distinct digests and graph topology are outside this owner.`,
        },
        owns: [`src/hashing/hash.ts#hash`],
        histories: {
          arbitrary: fc.tuple(...arbitraries) as Arbitrary<Ts>,
          runs: 100,
          fixedSeeds: [1657021],
        },
        // The second independently constructed result is the established
        // differential reference, including the original construction guards.
        model: comparisonReferences,
        driver: (values, observe) => {
          let at = 0
          drive(
            (actual, reference, relation = `same value`) => {
              observe(`comparison ${at++}`, { actual, reference, relation })
            },
            ...values,
          )
        },
        check: checkHashComparisons,
      })
    })
  }
}

describe(`hash property-based tests`, () => {
  describe(`determinism`, () => {
    hashProp([arbitraryPrimitive])(
      `hash is deterministic for primitives`,
      (record, value) => {
        const first = hash(value)
        const second = hash(value)
        record(first, second, `same value`)
      },
    )

    hashProp([arbitrarySimpleObject])(
      `hash is deterministic for objects`,
      (record, obj) => {
        const first = hash(obj)
        const second = hash(obj)
        record(first, second, `same value`)
      },
    )

    hashProp([arbitrarySimpleArray])(
      `hash is deterministic for arrays`,
      (record, arr) => {
        const first = hash(arr)
        const second = hash(arr)
        record(first, second, `same value`)
      },
    )

    hashProp([arbitraryDate])(
      `hash is deterministic for dates`,
      (record, date) => {
        const first = hash(date)
        const second = hash(date)
        record(first, second, `same value`)
      },
    )

    hashProp([arbitraryUint8Array])(
      `hash is deterministic for Uint8Arrays`,
      (record, arr) => {
        const first = hash(arr)
        const second = hash(arr)
        record(first, second, `same value`)
      },
    )
  })

  describe(`equal-hash consequences of D2 value identity`, () => {
    hashProp([arbitrarySimpleObject])(
      `cloned objects have same hash`,
      (record, obj) => {
        const clone = { ...obj }
        record(hash(clone), hash(obj), `same value`)
      },
    )

    hashProp([arbitrarySimpleArray])(
      `cloned arrays have same hash`,
      (record, arr) => {
        const clone = [...arr]
        record(hash(clone), hash(arr), `same value`)
      },
    )

    hashProp([arbitraryDate])(
      `dates with same time have same hash`,
      (record, date) => {
        const clone = new Date(date.getTime())
        record(hash(clone), hash(date), `same value`)
      },
    )

    hashProp([arbitraryUint8Array])(
      `Uint8Arrays with same content have same hash`,
      (record, arr) => {
        const clone = new Uint8Array(arr)
        record(hash(clone), hash(arr), `same value`)
      },
    )

    hashProp([fc.array(fc.tuple(fc.string(), fc.integer()), { maxLength: 5 })])(
      `Maps with same entries have same hash`,
      (record, entries) => {
        const map1 = new Map(entries)
        const map2 = new Map(entries)
        record(hash(map1), hash(map2), `same value`)
      },
    )

    hashProp([fc.array(fc.integer(), { maxLength: 10 })])(
      `Sets with same values have same hash`,
      (record, arr) => {
        const set1 = new Set(arr)
        const set2 = new Set(arr)
        record(hash(set1), hash(set2), `same value`)
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
      (record, [key1, key2], val1, val2) => {
        record(key1, key2, `different value`)
        const obj1 = { [key1!]: val1, [key2!]: val2 }
        const obj2 = { [key2!]: val2, [key1!]: val1 }
        record(hash(obj1), hash(obj2), `same value`)
      },
    )

    hashProp([
      fc.dictionary(
        fc.string().filter((s) => s !== `__proto__`),
        fc.integer(),
        { minKeys: 2, maxKeys: 5 },
      ),
    ])(
      `object hash is independent of property insertion order`,
      (record, obj) => {
        const keys = Object.keys(obj)
        const reversedKeys = [...keys].reverse()

        // Create new object with reversed key order
        const reversed: Record<string, number> = {}
        for (const key of reversedKeys) {
          reversed[key] = obj[key]!
        }

        record(hash(reversed), hash(obj), `same value`)
      },
    )

    hashProp([arbitraryNonIndexEntries])(
      `preserves hashes after an observed non-index key permutation`,
      (record, entries) => {
        observePermutedHashes(entries, record)
      },
    )
  })

  describe(`number normalization`, () => {
    hashProp([fc.constant(0)])(`0 and -0 have the same hash`, (record) => {
      record(hash(0), hash(-0), `same value`)
    })

    hashProp([fc.constant(NaN)])(`NaN has consistent hash`, (record) => {
      const first = hash(NaN)
      const second = hash(NaN)
      record(first, second, `same value`)
    })

    hashProp([fc.integer()])(`integers hash consistently`, (record, n) => {
      record(hash(n), hash(n), `same value`)
    })

    hashProp([fc.double({ noNaN: true, noDefaultInfinity: true })])(
      `doubles hash consistently`,
      (record, n) => {
        record(hash(n), hash(n), `same value`)
      },
    )
  })

  describe(`nested structures`, () => {
    hashProp([
      fc.array(fc.array(fc.integer(), { maxLength: 3 }), { maxLength: 3 }),
    ])(`nested arrays hash consistently`, (record, nested) => {
      const clone = nested.map((inner) => [...inner])
      record(hash(clone), hash(nested), `same value`)
    })

    hashProp([
      fc.dictionary(
        fc.string(),
        fc.dictionary(fc.string(), fc.integer(), { maxKeys: 3 }),
        { maxKeys: 3 },
      ),
    ])(`nested objects hash consistently`, (record, nested) => {
      const clone = Object.fromEntries(
        Object.entries(nested).map(([k, v]) => [k, { ...v }]),
      )
      record(hash(clone), hash(nested), `same value`)
    })
  })

  describe(`hash produces numbers`, () => {
    hashProp([arbitraryPrimitive])(
      `hash returns a number for primitives`,
      (record, value) => {
        record(typeof hash(value), `number`, `same value`)
        record(Number.isFinite(hash(value)), true, `same value`)
      },
    )

    hashProp([arbitrarySimpleObject])(
      `hash returns a number for objects`,
      (record, obj) => {
        record(typeof hash(obj), `number`, `same value`)
        record(Number.isFinite(hash(obj)), true, `same value`)
      },
    )

    hashProp([arbitrarySimpleArray])(
      `hash returns a number for arrays`,
      (record, arr) => {
        record(typeof hash(arr), `number`, `same value`)
        record(Number.isFinite(hash(arr)), true, `same value`)
      },
    )
  })

  describe(`reconstructed primitive equality`, () => {
    hashProp([fc.integer()])(
      `integer decimal round trips preserve hashes`,
      (record, value) => {
        const equivalent = Number(String(value))
        record(equivalent, value, `same value`)
        record(hash(value), hash(equivalent))
      },
    )

    hashProp([fc.string()])(
      `reconstructed strings preserve hashes`,
      (record, value) => {
        const equivalent = value.split(``).join(``)
        record(equivalent, value, `same value`)
        record(hash(value), hash(equivalent))
      },
    )
  })
})
