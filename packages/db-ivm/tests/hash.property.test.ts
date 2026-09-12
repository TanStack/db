import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { HashReplayError, captureHashSession } from './hash-session'
import type { HashSession } from './hash-session'

const nativeSession = await captureHashSession()
const { hash } = nativeSession

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

type HashValue = (value: unknown) => number

function expectDistinctHashes(
  law: string,
  input: unknown,
  left: unknown,
  right: unknown,
  session: HashSession = nativeSession,
): void {
  // Callers supply JSON-safe descriptors (arrays, entries, finite timestamps),
  // detached before either driver input is exposed to the hasher.
  const originalInput: unknown = JSON.parse(JSON.stringify(input))
  const observed: Array<number> = []
  try {
    observed.push(session.hash(left), session.hash(right))
    expect(observed[0]).not.toBe(observed[1])
  } catch (cause) {
    throw new HashReplayError(
      {
        law,
        input: originalInput,
        observed,
        tape: session.tape,
        environment: session.environment,
      },
      cause,
    )
  }
}

// This is the original sampled array/object distinction, also used to verify
// actual source failure replay below. A collision is not a product defect.
function expectArrayObjectDistinct(
  arr: Array<number>,
  session: HashSession = nativeSession,
): void {
  const obj: Record<string, number> = {}
  arr.forEach((value, index) => {
    obj[String(index)] = value
  })
  expectDistinctHashes(`array-object`, arr, arr, obj, session)
}

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

    fcTest.prop([arbitrarySimpleArray])(
      `cloned arrays have same hash`,
      (arr) => {
        const clone = [...arr]
        expect(hash(clone)).toBe(hash(arr))
      },
    )

    fcTest.prop([arbitraryDate])(
      `dates with same time have same hash`,
      (date) => {
        const clone = new Date(date.getTime())
        expect(hash(clone)).toBe(hash(date))
      },
    )

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

    fcTest.prop([
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

    for (const seed of [1657021, undefined]) {
      it(`preserves hashes after an observed non-index key permutation (${seed ?? `random`})`, () => {
        fc.assert(
          fc.property(arbitraryNonIndexEntries, (entries) => {
            expectPermutedHashes(entries)
          }),
          { numRuns: 100, ...(seed === undefined ? {} : { seed }) },
        )
      })
    }
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

  // These are sampled discrimination controls, not universal injectivity laws.
  // A finite hash can collide; a collision needs diagnosis, not a stronger API claim.
  describe(`sampled type distinction controls`, () => {
    fcTest.prop([fc.array(fc.integer(), { minLength: 1, maxLength: 5 })])(
      `array and object with same indices have different hashes`,
      (arr) => {
        expectArrayObjectDistinct(arr)
      },
    )

    fcTest.prop([fc.integer()])(
      `number and string representation have different hashes`,
      (n) => {
        expectDistinctHashes(`number-string`, n, n, String(n))
      },
    )

    fcTest.prop([fc.boolean()])(
      `boolean and its string representation have different hashes`,
      (b) => {
        expectDistinctHashes(`boolean-string`, b, b, String(b))
      },
    )

    fcTest.prop([fc.date({ noInvalidDate: true })])(
      `date and its timestamp have different hashes`,
      (date) => {
        expectDistinctHashes(
          `date-timestamp`,
          date.getTime(),
          date,
          date.getTime(),
        )
      },
    )

    fcTest.prop([fc.array(fc.integer(), { minLength: 1, maxLength: 5 })])(
      `array and Set with same values have different hashes`,
      (arr) => {
        const set = new Set(arr)
        expectDistinctHashes(`array-set`, arr, arr, set)
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
    fcTest.prop([arbitraryPrimitive])(
      `hash returns a number for primitives`,
      (value) => {
        expect(typeof hash(value)).toBe(`number`)
        expect(Number.isFinite(hash(value))).toBe(true)
      },
    )

    fcTest.prop([arbitrarySimpleObject])(
      `hash returns a number for objects`,
      (obj) => {
        expect(typeof hash(obj)).toBe(`number`)
        expect(Number.isFinite(hash(obj))).toBe(true)
      },
    )

    fcTest.prop([arbitrarySimpleArray])(
      `hash returns a number for arrays`,
      (arr) => {
        expect(typeof hash(arr)).toBe(`number`)
        expect(Number.isFinite(hash(arr))).toBe(true)
      },
    )
  })

  describe(`reconstructed primitive equality`, () => {
    fcTest.prop([fc.integer()])(
      `integer decimal round trips preserve hashes`,
      (value) => {
        const equivalent = Number(String(value))
        expect(equivalent).toBe(value)
        expectEqualHashes(value, equivalent)
      },
    )

    fcTest.prop([fc.string()])(
      `reconstructed strings preserve hashes`,
      (value) => {
        const equivalent = value.split(``).join(``)
        expect(equivalent).toBe(value)
        expectEqualHashes(value, equivalent)
      },
    )
  })

  describe(`sampled extension distinction controls`, () => {
    fcTest.prop([
      fc.array(fc.integer(), { minLength: 1, maxLength: 10 }),
      fc.integer(),
    ])(`arrays with extra element have different hashes`, (arr, extra) => {
      const extended = [...arr, extra]
      expectDistinctHashes(`array-extension`, { arr, extra }, arr, extended)
    })

    fcTest.prop([
      fc.dictionary(fc.string(), fc.integer(), { minKeys: 1, maxKeys: 5 }),
      fc.string(),
      fc.integer(),
    ])(
      `objects with extra property have different hashes`,
      (obj, newKey, newValue) => {
        // Keep arbitrary key content, but construct a fresh key rather than
        // silently pass when it already exists (including on the prototype).
        while (newKey in obj) newKey += `\0`
        const extended = { ...obj, [newKey]: newValue }
        expect(Object.keys(extended)).toHaveLength(Object.keys(obj).length + 1)
        expectDistinctHashes(
          `object-extension`,
          { entries: Object.entries(obj), newKey, newValue },
          obj,
          extended,
        )
      },
    )
  })

  describe(`law checker calibration`, () => {
    it(`replays an actual sampled-law collision with its native failure cause`, async () => {
      // A legal but deliberately colliding initialization environment. Its
      // count comes from native capture, not a copied list of marker constants.
      const collisionSession = await captureHashSession(
        nativeSession.tape.map(() => 0),
      )
      const property = fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 5 }),
        (arr) => expectArrayObjectDistinct(arr, collisionSession),
      )
      const failed = fc.check(property, { seed: 205205, numRuns: 1 })
      expect(failed.failed).toBe(true)
      expect(failed.numShrinks).toBeGreaterThan(0)
      expect(failed.counterexample).toEqual([[0]])
      expect(failed.counterexamplePath).toBe(`0:0:0`)
      expect(failed.errorInstance).toBeInstanceOf(HashReplayError)
      if (
        !(failed.errorInstance instanceof HashReplayError) ||
        failed.counterexamplePath === null
      ) {
        throw new Error(`Missing sampled-law replay evidence`)
      }
      const failure = failed.errorInstance
      expect(failure.cause).toMatchObject({ name: `AssertionError` })
      expect(failure.replay.law).toBe(`array-object`)
      expect(failure.replay.input).toEqual(failed.counterexample[0])
      expect(failure.replay.observed[0]).toBe(failure.replay.observed[1])
      const replaySession = await captureHashSession(failure.replay.tape)
      const replay = fc.check(
        fc.property(
          fc.array(fc.integer(), { minLength: 1, maxLength: 5 }),
          (arr) => expectArrayObjectDistinct(arr, replaySession),
        ),
        {
          seed: failed.seed,
          path: failed.counterexamplePath,
          numRuns: 1,
          endOnFailure: true,
        },
      )
      expect(replay.failed).toBe(true)
      expect(replay.counterexample).toEqual(failed.counterexample)
      expect(replay.errorInstance).toBeInstanceOf(HashReplayError)
      if (!(replay.errorInstance instanceof HashReplayError))
        throw new Error(`Missing replay error`)
      expect(replay.errorInstance.replay).toEqual(failure.replay)
      expect(replay.errorInstance.cause).toMatchObject({
        name: `AssertionError`,
      })
      let reported: unknown
      try {
        fc.assert(property, {
          seed: failed.seed,
          path: failed.counterexamplePath,
          numRuns: 1,
          endOnFailure: true,
          errorWithCause: true,
        })
      } catch (cause) {
        reported = cause
      }
      expect(reported).toBeInstanceOf(Error)
      if (!(reported instanceof Error))
        throw new Error(`Missing native fast-check report`)
      expect(reported.message).toContain(`seed: ${failed.seed}`)
      expect(reported.message).toContain(`path:`)
      expect(reported.cause).toBeInstanceOf(HashReplayError)
      // The same original consumer remains a valid sampled control under its
      // native initialization; it is not weakened to accommodate the collision.
      expectArrayObjectDistinct([0])
    })

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
