import { afterAll, describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { deepEquals } from '../src/utils'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config.js'
import {
  assertDistinctTypes,
  assertExtraProperty,
  edgeCarriers,
  expectCopyAndChanged,
  expectEqualityPair,
  expectRingLaw,
} from './deep-equals-support'
import { createOracleReach } from './oracle-reach.js'
import {
  checkSetChain,
  checkSetFamily,
  setShapes,
} from './set-equality-oracle.js'

/**
 * The `deepEquals` API contract in `../src/utils.ts`, reinforced by the
 * established examples in `utils.test.ts`, promises change-event equality for
 * its supported value classes. This oracle checks bounded equality and
 * inequality laws for those classes, not general graph isomorphism.
 * Independent value constructors exercise reflexivity, symmetry, copied
 * structure, and changed-leaf inequality for primitives, arrays, records,
 * dates, regexes, typed bytes, and selected Temporal types. Named cross-type
 * pairs remain unequal, even when a primitive displays or encodes a Date or
 * RegExp value. Published #1519 keeps equivalent Temporal.Duration forms
 * distinct for query `eq`. The `deepEquals` API and #1901's change-message
 * reconstruction law carry that field distinction to Collection events: a
 * changed public Duration row cannot be suppressed because its display text
 * matches. Separate bounded graph laws construct corresponding rings and
 * acyclic copies without reusing the production walk.
 *
 * Arbitrary different cycle topologies are outside this model. Naming that
 * exclusion matters: more random examples cannot establish semantics the
 * reference relation does not define.
 */
// Every generated law below uses the same property in a fixed and a fresh
// campaign. Set TANSTACK_DB_ORACLE_PROPERTY to `utils.<number>` from the test
// label, with TANSTACK_DB_ORACLE_SEED and TANSTACK_DB_ORACLE_PATH, to replay
// its fast-check shrink directly, for example with
// `vitest run tests/utils-oracle.property.test.ts`.
const fixedSeed = 20260911

const campaignRuns = 100

// Each property registers as `utils.<number>`, in file order. A path replay
// selects one with TANSTACK_DB_ORACLE_PROPERTY=utils.<number>.
let nextPropertyId = 0

function utilsProperty<Ts extends [unknown, ...Array<unknown>]>(arbitraries: {
  [K in keyof Ts]: fc.Arbitrary<Ts[K]>
}) {
  return (name: string, check: (...values: Ts) => void): void => {
    const id = ++nextPropertyId
    const property = `utils.${id}`
    const label = `${id}: ${name}`
    // fast-check's variadic tuple overload widens a generic tuple to any[].
    // The mapped arbitraries preserve each position's Ts member.
    const argumentsArbitrary = fc.tuple(...arbitraries) as fc.Arbitrary<Ts>

    oracleReplayTest(fcTest).prop([argumentsArbitrary], {
      seed: fixedSeed,
      numRuns: oracleRuns(campaignRuns),
    })(`${label} fixed`, (values) => check(...values))
    oracleReplayTest(fcTest, property).prop(
      [argumentsArbitrary],
      oraclePropertyOptions(campaignRuns, property),
    )(`${label} random`, (values) => check(...values))
  }
}

const arbitraryPrimitive = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
)

const arbitraryDate = fc.date().map((d) => new Date(d.getTime()))

const arbitraryFiniteDate = fc
  .integer({ min: -1_000_000_000_000, max: 2_000_000_000_000 })
  .map((time) => new Date(time))

const arbitraryRegExp = fc
  .tuple(fc.string(), fc.constantFrom(``, `g`, `i`, `gi`, `m`, `gim`))
  .map(([source, flags]) => {
    const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
    return new RegExp(escapedSource, flags)
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

// One nonzero intrinsic field at a time is a legal Duration. Every campaign
// enumerates all ten fields at generated magnitudes 1–9 and both signs. Each
// field has an equal fresh copy, a changed-field neighbor, and an opposite-sign
// value, so its exact value affects change-event equality independently of
// production comparison.
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

const adjacentDurationUnits = [
  [`seconds`, `milliseconds`],
  [`milliseconds`, `microseconds`],
  [`microseconds`, `nanoseconds`],
] as const

// Same-type value arbitraries for testing equivalence properties
// Mixed Date/Temporal inequality has its own generated and fixed witnesses below.
const arbitrarySameTypePrimitive = fc.oneof(
  fc.tuple(fc.string(), fc.string()),
  fc.tuple(fc.integer(), fc.integer()),
  fc.tuple(fc.double(), fc.double()),
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

const arbitraryNonNullValue = arbitrarySingleValue.filter(
  (value) => value !== null,
)

const arbitraryDefinedValue = arbitrarySingleValue.filter(
  (value) => value !== undefined,
)

// The non-ring grammar is a bounded value grammar, not a grammar of arbitrary
// JavaScript objects. Every arm of arbitrarySingleValue is reconstructed by
// one of the fixed witnesses below: the six primitive arms, Date, RegExp,
// Uint8Array, Float32Array, two Temporal classes, array, and record. The
// same-type pair grammar has four primitive arms plus Date, RegExp, bytes,
// two Temporal classes, array, and record. Each pair arm is a product of two
// independently generated values, so both equal and unequal pairs are legal.
// The fixed witnesses exercise those two outcomes; deleting either outcome
// would leave an always-true or always-false comparator undetected. The
// generated distinct-type grammar names Date/Temporal pairs, Date versus its
// ISO text and epoch number, and RegExp versus its source text; it does not
// claim every cross-class combination. String lengths, integer
// magnitude, and object keys are fast-check defaults; explicit array/record
// bounds are 0–5 for equivalence and 0–10 for structural copies, bytes 0–50,
// Float32Array 0–10, Temporal years 1–9999/months 1–12/days 1–28, and
// durations 0–100 hours/0–59 minutes/0–59 seconds. Invalid Temporal dates,
// arbitrary prototypes, nonenumerable properties, and different graph
// topologies are excluded; dedicated fixed contract tests own some of them.
// An object and array with the same enumerable index keys is a nearby invalid
// same-type pair, and the edge-case law rejects it below.

const arbitraryExtraProperty = fc
  .tuple(
    fc.dictionary(fc.string(), fc.integer(), { minKeys: 1, maxKeys: 5 }),
    fc.string(),
    fc.integer(),
  )
  .map(([original, keyHint, value]) => {
    let key = keyHint
    // Also avoid inherited names; this stays valid when the hint shrinks to an
    // existing key or names such as __proto__ and constructor.
    while (key in original) key += `_`
    return { original, key, value }
  })

function adjacentDateTime(time: number): number {
  if (Number.isNaN(time)) return 0
  return time === 8_640_000_000_000_000 ? time - 1 : time + 1
}

// Legal rings have 1–5 reachable nodes, integer payloads, and one of four
// native edge carriers at each node. A zero-node ring has no root and is
// excluded. The fixed pair enumeration below reconstructs every ordered
// two-carrier overlap; the length cases pin the lower and upper bounds.
const ringArbitrary = fc.array(
  fc.record({
    value: fc.integer(),
    carrier: fc.constantFrom(...edgeCarriers),
  }),
  { minLength: 1, maxLength: 5 },
)

describe(`deepEquals property-based tests`, () => {
  describe(`bounded native graph relations`, () => {
    utilsProperty([ringArbitrary])(
      `compares separately allocated mixed rings and every changed payload`,
      (cells) => expectRingLaw(cells),
    )
    it(`runs a fixed mixed-ring campaign without skipped antecedents`, () => {
      const result = fc.check(
        fc.property(ringArbitrary, (cells) => expectRingLaw(cells)),
        { seed: 101301, numRuns: 100 },
      )
      expect(result).toMatchObject({ failed: false, numRuns: 100, numSkips: 0 })
    })
    utilsProperty([fc.integer(), fc.string()])(
      `preserves structural equality across acyclic sharing and unfolding`,
      (value, key) => {
        const leaf = { value }
        const shared = {
          left: leaf,
          right: [leaf],
          map: new Map([[key, leaf]]),
        }
        const unfolded = {
          left: { value },
          right: [{ value }],
          map: new Map([[key, { value }]]),
        }
        expect(shared.left).toBe(shared.right[0])
        expect(unfolded.left).not.toBe(unfolded.right[0])
        expectEqualityPair(shared, unfolded, true)
        unfolded.map.set(key, { value: value + 1 })
        expectEqualityPair(shared, unfolded, false)
      },
    )
    utilsProperty([fc.integer(), fc.string()])(
      `distinguishes symbol identity from description in keys and values`,
      (value, description) => {
        const key = Symbol(description)
        const other = Symbol(description)
        expectEqualityPair({ [key]: value }, { [key]: value }, true)
        expectEqualityPair({ [key]: value }, { [key]: value + 1 }, false)
        expectEqualityPair({ [key]: value }, { [other]: value }, false)
        expectEqualityPair({ value: key }, { value: key }, true)
        expectEqualityPair({ value: key }, { value: other }, false)
        expectEqualityPair(
          new Map([[key, { value }]]),
          new Map([[other, { value }]]),
          false,
        )
      },
    )
    utilsProperty([fc.integer()])(
      `keeps Map key identity while comparing nested values structurally`,
      (value) => {
        const key = { value }
        expectEqualityPair(
          new Map([[key, { value }]]),
          new Map([[key, { value }]]),
          true,
        )
        expectEqualityPair(
          new Map([[key, { value }]]),
          new Map([[{ value }, { value }]]),
          false,
        )
        expectEqualityPair(
          new Map([[key, { value }]]),
          new Map([[key, { value: value + 1 }]]),
          false,
        )
      },
    )
    it(`shrinks and replays a payload-blind graph comparator`, () => {
      const property = fc.property(ringArbitrary, (cells) =>
        expectRingLaw(cells, () => true),
      )
      const failure = fc.check(property, { seed: 101302, numRuns: 10 })
      expect(failure.failed).toBe(true)
      expect(failure.errorInstance).toMatchObject({ name: `AssertionError` })
      if (failure.counterexample === null)
        throw new Error(`Missing ring replay`)
      const replay = fc.check(property, {
        seed: failure.seed,
        path: failure.counterexamplePath,
        endOnFailure: true,
      })
      expect(replay.failed).toBe(true)
      expect(replay.counterexample).toEqual(failure.counterexample)
      expectRingLaw(failure.counterexample[0])
    })
    utilsProperty([
      fc.uniqueArray(fc.integer(), { minLength: 1, maxLength: 8 }),
    ])(
      `compares primitive Set membership independent of insertion order`,
      (values) => {
        const original = new Set(values)
        expectEqualityPair(original, new Set([...values].reverse()), true)
        // A string cannot alias the generated numeric members; cardinality stays equal.
        const different = new Set<number | string>(values.slice(1))
        different.add(`fresh`)
        expect(different.size).toBe(original.size)
        expectEqualityPair(original, different, false)
      },
    )
  })
  describe(`equivalence relation properties`, () => {
    utilsProperty([arbitrarySingleValue])(
      `reflexivity: deepEquals(a, a) is always true`,
      (a) => {
        expect(deepEquals(a, a)).toBe(true)
      },
    )

    utilsProperty([arbitrarySameTypePair])(
      `symmetry: deepEquals(a, b) === deepEquals(b, a) for same-type values`,
      ([a, b]) => {
        expect(deepEquals(a, b)).toBe(deepEquals(b, a))
      },
    )

    utilsProperty([fc.array(fc.integer(), { maxLength: 5 })])(
      `separately allocated equal arrays satisfy both premises and transitivity`,
      (arr) => {
        const a = [...arr]
        const b = [...arr]
        const c = [...arr]
        expect(a).not.toBe(b)
        expect(b).not.toBe(c)
        expect(deepEquals(a, b)).toBe(true)
        expect(deepEquals(b, c)).toBe(true)
        expect(deepEquals(a, c)).toBe(true)
      },
    )
  })
  describe(`cross-type comparisons`, () => {
    utilsProperty([arbitraryDate, arbitraryTemporalDuration])(
      `generated Date and Temporal.Duration are unequal in both directions`,
      (date, duration) => assertDistinctTypes(date, duration, deepEquals),
    )
    utilsProperty([arbitraryDate, arbitraryTemporalPlainDate])(
      `generated Date and Temporal.PlainDate are unequal in both directions`,
      (date, plainDate) => assertDistinctTypes(date, plainDate, deepEquals),
    )
    utilsProperty([arbitraryTemporalPlainDate, arbitraryTemporalDuration])(
      `generated different Temporal types are unequal in both directions`,
      (plainDate, duration) =>
        assertDistinctTypes(plainDate, duration, deepEquals),
    )
  })
  describe(`change-event equality`, () => {
    utilsProperty([fc.array(fc.integer(), { minLength: 0, maxLength: 10 })])(
      `arrays with same elements are equal`,
      (arr) => {
        const copy = [...arr]
        expectCopyAndChanged(arr, copy, [...arr, 0])
      },
    )
    utilsProperty([
      fc.dictionary(fc.string(), fc.integer(), { minKeys: 0, maxKeys: 10 }),
    ])(`objects with same properties are equal`, (obj) => {
      const copy = { ...obj }
      let freshKey = `extra`
      while (freshKey in obj) freshKey += `_`
      expectCopyAndChanged(obj, copy, { ...obj, [freshKey]: 0 })
    })
    utilsProperty([
      fc.array(fc.tuple(fc.string(), fc.integer()), {
        minLength: 0,
        maxLength: 5,
      }),
    ])(`Maps with same entries are equal`, (entries) => {
      const map1 = new Map(entries)
      const map2 = new Map(entries)
      let freshKey = `extra`
      while (map1.has(freshKey)) freshKey += `_`
      expectCopyAndChanged(map1, map2, new Map([...map1, [freshKey, 0]]))
    })
    utilsProperty([fc.array(fc.integer(), { minLength: 0, maxLength: 10 })])(
      `Sets with same primitive values are equal`,
      (arr) => {
        const set1 = new Set(arr)
        const set2 = new Set(arr)
        expectCopyAndChanged(set1, set2, new Set([...set1, `fresh`]))
      },
    )
    utilsProperty([fc.uint8Array({ minLength: 0, maxLength: 50 })])(
      `Uint8Arrays with same content are equal`,
      (arr) => {
        const copy = new Uint8Array(arr)
        expectCopyAndChanged(arr, copy, new Uint8Array([...arr, 0]))
      },
    )
    utilsProperty([arbitraryDate])(`Dates with same time are equal`, (date) => {
      const copy = new Date(date.getTime())
      expectCopyAndChanged(
        date,
        copy,
        new Date(adjacentDateTime(date.getTime())),
      )
    })
    utilsProperty([arbitraryTemporalPlainDate])(
      `Temporal.PlainDate with same values are equal`,
      (date) => {
        const copy = new Temporal.PlainDate(date.year, date.month, date.day)
        expectCopyAndChanged(date, copy, date.add({ days: 1 }))
      },
    )
  })
  describe(`inequality properties`, () => {
    utilsProperty([
      fc.array(fc.integer(), { minLength: 1, maxLength: 10 }),
      fc.integer(),
    ])(`arrays with different elements are not equal`, (arr, extraElement) => {
      const modified = [...arr, extraElement]
      expect(deepEquals(arr, modified)).toBe(false)
    })
    utilsProperty([arbitraryExtraProperty])(
      `objects with extra property are not equal`,
      (sample) => {
        assertExtraProperty(sample, deepEquals)
      },
    )
    it(`fixed campaign reaches an extra property in every case`, () => {
      const result = fc.check(
        fc.property(arbitraryExtraProperty, (sample) => {
          assertExtraProperty(sample, deepEquals)
        }),
        { seed: 20260911, numRuns: 100 },
      )
      expect(result).toMatchObject({ failed: false, numRuns: 100, numSkips: 0 })
    })
    utilsProperty([fc.integer(), fc.string()])(
      `different types are not equal`,
      (num, str) => {
        expect(deepEquals(num, str)).toBe(false)
      },
    )
    utilsProperty([fc.date(), fc.date()])(
      `dates with different times are not equal`,
      (date1, date2) => {
        // Equal draws, including two invalid Dates, still exercise the
        // different-time consequence instead of silently skipping it.
        const changedTime = Object.is(date1.getTime(), date2.getTime())
          ? adjacentDateTime(date1.getTime())
          : date2.getTime()
        expectCopyAndChanged(
          date1,
          new Date(date1.getTime()),
          new Date(changedTime),
        )
      },
    )
  })
  describe(`edge cases`, () => {
    utilsProperty([arbitraryNonNullValue])(
      `null is never equal to a non-null value`,
      (a) => {
        expect(a).not.toBe(null)
        expectEqualityPair(null, a, false)
      },
    )

    utilsProperty([arbitraryDefinedValue])(
      `undefined is never equal to a non-undefined value`,
      (a) => {
        expect(a).not.toBe(undefined)
        expectEqualityPair(undefined, a, false)
      },
    )

    utilsProperty([fc.array(fc.integer(), { minLength: 0, maxLength: 5 })])(
      `array is never equal to object with same values`,
      (arr) => {
        const obj = { ...arr }
        expect(deepEquals(arr, obj)).toBe(false)
      },
    )
  })
  // `deepEquals` drives change-event suppression, so it deliberately ignores
  // state that draft revert detection keeps (see proxy-revert-oracle): Map and
  // Set insertion order, RegExp `lastIndex`, and array holes. These laws pin
  // that current relation so a shared walker cannot leak draft rules into it.
  describe(`order and state the general relation ignores`, () => {
    utilsProperty([
      fc.uniqueArray(fc.tuple(fc.string(), fc.integer()), {
        minLength: 2,
        maxLength: 5,
        selector: ([key]) => key,
      }),
    ])(
      `Maps with the same entries in another insertion order are equal`,
      (entries) => {
        const reordered = new Map([...entries].reverse())
        expect([...reordered.keys()]).not.toEqual(entries.map(([key]) => key))
        expectEqualityPair(new Map(entries), reordered, true)
        expectEqualityPair(
          new Map(entries.map(([key, value]) => [key, { value }])),
          new Map(
            [...entries].reverse().map(([key, value]) => [key, { value }]),
          ),
          true,
        )
      },
    )

    utilsProperty([
      fc.uniqueArray(fc.integer(), { minLength: 2, maxLength: 5 }),
    ])(
      `Sets with the same values in another insertion order are equal`,
      (values) => {
        expectEqualityPair(
          new Set(values),
          new Set([...values].reverse()),
          true,
        )
        expectEqualityPair(
          new Set(values.map((value) => ({ value }))),
          new Set([...values].reverse().map((value) => ({ value }))),
          true,
        )
      },
    )

    utilsProperty([fc.constantFrom(``, `g`, `y`), fc.nat(5), fc.nat(5)])(
      `RegExps with the same source and flags are equal at any lastIndex`,
      (flags, left, right) => {
        const a = new RegExp(`x`, flags)
        const b = new RegExp(`x`, flags)
        a.lastIndex = left
        b.lastIndex = right
        expectEqualityPair(a, b, true)
        expectEqualityPair({ pattern: a }, { pattern: b }, true)
      },
    )

    utilsProperty([
      fc.constantFrom(`a`, `b`),
      fc.constantFrom(`a`, `b`),
      fc.constantFrom(1, 2),
      fc.constantFrom(1, 2),
    ])(
      `objects compare by class and keys, and keyless instances by identity`,
      (pathA, pathB, v, w) => {
        class Secret {
          #v: number
          constructor(value: number) {
            this.#v = value
          }
          read(): number {
            return this.#v
          }
        }
        class Point {
          constructor(public a: number) {}
        }
        class Other {
          constructor(public a: number) {}
        }
        const url = (path: string) => new URL(`https://example.com/${path}`)
        expectEqualityPair(url(pathA), url(pathB), pathA === pathB)
        expectEqualityPair(
          { u: url(pathA) },
          { u: url(pathB) },
          pathA === pathB,
        )
        // Another class with the same href is still another class.
        expectEqualityPair(
          url(pathA),
          Object.create({ href: url(pathA).href }),
          false,
        )
        // State outside enumerable keys is unknown, so only identity is equal.
        const secret = new Secret(v)
        expectEqualityPair(secret, secret, true)
        expectEqualityPair(secret, new Secret(w), false)
        expectEqualityPair({ s: secret }, { s: new Secret(v) }, false)
        expectEqualityPair(new Secret(v), {}, false)
        // Class instances with keys compare by keys within their class, and
        // with a plain object, which is how JSON and draft snapshots hold
        // them. Two different classes differ.
        expectEqualityPair(new Point(v), new Point(w), v === w)
        expectEqualityPair(new Point(v), { a: w }, v === w)
        expectEqualityPair(new Point(v), new Other(v), false)
        // Plain and null-prototype objects are one class.
        const bare = Object.assign(Object.create(null), { a: v })
        expectEqualityPair(bare, { a: w }, v === w)
        expectEqualityPair(Object.create(null), {}, true)
      },
    )

    utilsProperty([
      fc.array(fc.oneof(fc.double(), fc.constant(NaN), fc.constant(-0)), {
        minLength: 1,
        maxLength: 5,
      }),
      fc.array(fc.integer({ min: 0, max: 127 }), {
        minLength: 1,
        maxLength: 5,
      }),
    ])(
      `typed arrays compare elements like numbers and ignore their class`,
      (values, bytes) => {
        const a = Float64Array.from(values)
        const b = Float64Array.from(
          values.map((v) => (Object.is(v, -0) ? 0 : v)),
        )
        expectEqualityPair(a, b, true)
        expectEqualityPair({ v: a }, { v: b }, true)
        // Draft equality keeps the class; the draft revert oracle owns that.
        expectEqualityPair(Uint8Array.from(bytes), Int8Array.from(bytes), true)
        expectEqualityPair(
          Uint8Array.from(bytes),
          Int8Array.from([...bytes.slice(1), 128]),
          false,
        )
      },
    )

    utilsProperty([
      fc.array(fc.oneof(fc.integer(), fc.constant(`hole`)), {
        minLength: 1,
        maxLength: 5,
      }),
    ])(`an array hole equals undefined at the same index`, (cells) => {
      const sparse: Array<unknown> = []
      sparse.length = cells.length
      const dense: Array<unknown> = []
      cells.forEach((cell, index) => {
        if (cell !== `hole`) sparse[index] = cell
        dense[index] = cell === `hole` ? undefined : cell
      })
      expectEqualityPair(sparse, dense, true)
      expectEqualityPair({ items: sparse }, { items: dense }, true)
    })
  })
  describe(`nested structure consistency`, () => {
    utilsProperty([
      fc.array(fc.array(fc.integer(), { maxLength: 3 }), { maxLength: 3 }),
    ])(`nested arrays maintain equality through cloning`, (nestedArr) => {
      const clone = nestedArr.map((inner) => [...inner])
      expect(deepEquals(nestedArr, clone)).toBe(true)
    })

    utilsProperty([
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
  describe(`additional non-ring value boundaries`, () => {
    utilsProperty([arbitraryRegExp])(
      `RegExp source and flags determine equality`,
      (regex) => {
        const copy = new RegExp(regex.source, regex.flags)
        const changedFlags = regex.flags.includes(`i`)
          ? regex.flags.replace(`i`, ``)
          : `${regex.flags}i`
        // The source neighbor keeps flags fixed; a source-blind comparator
        // must fail even when generated flags happen to match.
        const changedSource = new RegExp(`${regex.source}(?:x)`, regex.flags)
        expectCopyAndChanged(
          regex,
          copy,
          new RegExp(regex.source, changedFlags),
        )
        expectEqualityPair(regex, changedSource, false)
      },
    )
    utilsProperty([arbitraryFloat32Array])(
      `Float32Array content and length determine equality`,
      (array) => {
        expectCopyAndChanged(
          array,
          new Float32Array(array),
          new Float32Array([...array, 0]),
        )
      },
    )
    utilsProperty([arbitraryTemporalDuration])(
      `Temporal.Duration with same fields is equal and changed seconds are unequal`,
      (duration) => {
        const copy = Temporal.Duration.from({
          hours: duration.hours,
          minutes: duration.minutes,
          seconds: duration.seconds,
        })
        const changed = Temporal.Duration.from({
          hours: duration.hours,
          minutes: duration.minutes,
          seconds: duration.seconds + 1,
        })
        expectCopyAndChanged(duration, copy, changed)
      },
    )
    utilsProperty([arbitraryFiniteDate])(
      `Date differs from its ISO text and epoch number in both directions`,
      (date) => {
        assertDistinctTypes(date, date.toISOString(), deepEquals)
        assertDistinctTypes(date, date.getTime(), deepEquals)
      },
    )
    utilsProperty([arbitraryRegExp])(
      `RegExp differs from its source text in both directions`,
      (regex) => assertDistinctTypes(regex, regex.source, deepEquals),
    )
    // The source fields, rather than Temporal's display or ordered duration,
    // form the reference identity. The production path is deepEquals in both
    // directions; its direct result is compared after each constructed pair.
    // Every field is exercised at a positive magnitude, its neighbor, and its
    // negative counterpart. No one field may be ignored or compared by magnitude.
    utilsProperty([fc.integer({ min: 1, max: 9 })])(
      `each Temporal.Duration field determines change-event equality`,
      (value) => {
        for (const field of durationFields) {
          const original = Temporal.Duration.from({ [field]: value })
          const copy = Temporal.Duration.from({ [field]: value })
          const changed = Temporal.Duration.from({ [field]: value + 1 })
          const opposite = Temporal.Duration.from({ [field]: -value })
          expectCopyAndChanged(original, copy, changed)
          expectEqualityPair(original, opposite, false)
        }
      },
    )
    // This generated grammar varies magnitude and sign while enumerating every
    // adjacent subsecond unit boundary. Both constructors encode the same
    // displayed elapsed time, but the single nonzero source field differs.
    // #1519's query equality distinction and #1901's event reconstruction
    // law together predict inequality in both directions here. This rejects
    // a comparator that checks seconds alone before using display text.
    utilsProperty([fc.integer({ min: 1, max: 9 })])(
      `adjacent Duration units remain unequal despite matching display`,
      (magnitude) => {
        for (const sign of [-1, 1] as const) {
          for (const [coarser, finer] of adjacentDurationUnits) {
            const left = Temporal.Duration.from({
              [coarser]: sign * magnitude,
            })
            const right = Temporal.Duration.from({
              [finer]: sign * magnitude * 1000,
            })
            expect(left.toString()).toBe(right.toString())
            expectEqualityPair(left, right, false)
          }
        }
      },
    )
  })
  // Append this property so existing numeric replay selectors stay stable.
  // Generated payload and order choices cross every class-pair/cycle shape;
  // duplicate multiplicity and a late mismatch expose factorial work.
  const setReach = createOracleReach(`utils Set equality`, [
    ...setShapes,
    `equal-duplicates`,
    `late-mismatch`,
    `cardinality`,
  ])
  let enteredSetProperty = false
  afterAll(() => {
    if (enteredSetProperty) setReach.assertReached()
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(
        `utils Set equality reach`,
        Object.fromEntries(setReach.counts()),
      )
  })
  describe(`ambiguous Set membership`, () => {
    utilsProperty([fc.integer({ min: -100, max: 100 }), fc.boolean()])(
      `matches ambiguous object Sets with quadratic flat-member reads`,
      (value, reverse) => {
        enteredSetProperty = true
        setReach.beginHistory()
        checkSetFamily(value, reverse, (state) => setReach.reach(state))
      },
    )
  })
})

// The chain family varies structural length, insertion order and a neighboring
// isolated-column violation. Both campaigns use the same descriptor judgment.
// The large finite witness checks flat matching depth without multiplying that
// expensive witness by the random campaign budget.
describe(`Set assignment paths`, () => {
  const chainReach = createOracleReach(`Set augmenting chains`, [
    `assignment`,
    `isolated`,
  ])
  let entered = false
  afterAll(() => {
    if (entered) chainReach.assertReached()
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(`Set chain reach`, Object.fromEntries(chainReach.counts()))
  })
  utilsProperty([fc.integer({ min: 2, max: 6 }), fc.boolean()])(
    `preserves Set assignment across augmenting paths and isolated columns`,
    (bits, rotate) => {
      entered = true
      chainReach.beginHistory()
      for (const broken of [false, true]) {
        checkSetChain(bits, broken, rotate)
        chainReach.reach(broken ? `isolated` : `assignment`)
      }
    },
  )
  const scaleReach = createOracleReach(
    `flat Set matching scale`,
    [`positive`, `negative`],
    { replaying: false },
  )
  let enteredScale = false
  afterAll(() => {
    if (enteredScale) scaleReach.assertReached()
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(`Set scale reach`, Object.fromEntries(scaleReach.counts()))
  })
  it.each([false, true])(
    `keeps flat Set matching off the call stack: isolated=%s`,
    (broken) => {
      enteredScale = true
      scaleReach.beginHistory()
      checkSetChain(13, broken, false)
      scaleReach.reach(broken ? `negative` : `positive`)
    },
  )
})
