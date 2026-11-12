import { runInNewContext } from 'node:vm'
import { describe, expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { deepEquals, sameRowValue } from '../src/utils'
import { oracleReplayRequested } from './oracle-config.js'
import {
  assertDistinctTypes,
  assertExtraProperty,
  expectCopyAndChanged,
  expectEqualityPair,
  expectRingLaw,
} from './deep-equals-support'
import { oracleProperty } from './oracle-property.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
import {
  arbitraryExtraProperty,
  ringArbitrary,
} from './utils-campaign-grammar-oracle.js'
import { declareOracle } from './oracle-declaration.js'
import {
  makeSparseArray,
  sparseArrayCarriers,
  sparseArrayCase,
} from './sparse-array-value-oracle.js'
import type { Verdict } from './oracle-property.js'

/**
 * The `deepEquals` API contract in `../src/utils.ts`, reinforced by the
 * established examples in `utils.test.ts`, promises generic value equality.
 * `sameRowValue` additionally preserves record prototypes and signed zero for
 * Collection change events. This oracle checks bounded equality and
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

// The existing callbacks keep their independent constructions and exact
// assertions. The shared adapter transports only their judgment kind as data;
// it retains an assertion's original object and propagates runtime failures.
type EnterState = (state: string) => void

function utilsProperty<Ts extends [unknown, ...Array<unknown>]>(arbitraries: {
  [K in keyof Ts]: fc.Arbitrary<Ts[K]>
}) {
  return (
    name: string,
    check: (...values: [...Ts, EnterState]) => void,
    runs = campaignRuns,
    states: ReadonlyArray<string> = [],
  ): void => {
    const id = ++nextPropertyId
    const property = `utils.${id}`
    const label = `${id}: ${name}`
    // Preserve the original tuple, including rich generated values. Only
    // observations and enumerated histories have the native data boundary.
    const argumentsArbitrary = fc.tuple(...arbitraries) as fc.Arbitrary<Ts>
    oracleProperty<Ts, Verdict>({
      id: property,
      law: {
        statement: name,
        authority: `The existing utility equality laws and authorities documented in this file.`,
        limits: `The original bounded inputs and unchanged independent assertion callback for ${label}.`,
      },
      // What this oracle owns: the gap report judges the deepEquals relation in
      // utils.ts by this file's tests.
      owns: [`src/utils.ts`],
      histories: {
        arbitrary: argumentsArbitrary,
        runs,
        fixedSeeds: [fixedSeed],
        states,
        constructed:
          states.length === 0
            ? []
            : [
                {
                  name: `existing value paths`,
                  enters: states,
                  // Every existing history of these laws traverses every named path.
                  // The identity builder changes no input value or grammar choice.
                  build: (history: Ts) => history,
                },
              ],
      },
      model: recordedAssertionJudgment,
      driver: (values, observe) =>
        recordAssertionJudgment(label, values, observe, () =>
          oracleAssertion(label, () =>
            check(...values, (state) => observe(`reach`, state)),
          ),
        ),
      check: forwardAssertionJudgment,
    })
  }
}

// The former per-history checks required every listed path in that history.
// Native campaign reach is separate; retain this stronger local requirement
// and the former global path-replay bypass without campaign-level counters.
function caseStates(
  property: string,
  states: ReadonlyArray<string>,
  enter: EnterState,
) {
  const reached = new Set<string>()
  return {
    reach(state: string): void {
      if (!states.includes(state))
        throw new Error(`${property}: undeclared reach state ${state}`)
      reached.add(state)
      enter(state)
    },
    assertReached(): void {
      if (oracleReplayRequested()) return
      const missed = states.filter((state) => !reached.has(state))
      if (missed.length)
        rejectAt(
          `per-history reach`,
          new Error(
            `${property}: generated histories reached these states fewer than 1 times, so their laws were not enforced there: ${missed.map((state) => `${state} (0)`).join(`, `)}`,
          ),
        )
    },
  }
}

const recordPrototypeStates = [
  `same-class`,
  `plain-class`,
  `null-plain`,
  `foreign-plain`,
  `row-prototypes`,
] as const
const sparseReachStates = [
  `hole-undefined`,
  `hole-defined`,
  `general`,
  `row`,
  ...sparseArrayCarriers,
] as const

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
// ISO text and epoch number, RegExp versus its source text, and a typed array
// versus a record or an array of its elements; it does not
// claim every cross-class combination. String lengths, integer
// magnitude, and object keys are fast-check defaults; explicit array/record
// bounds are 0–5 for equivalence and 0–10 for structural copies, bytes 0–50,
// Float32Array 0–10, Temporal years 1–9999/months 1–12/days 1–28, and
// durations 0–100 hours/0–59 minutes/0–59 seconds. Invalid Temporal dates,
// arbitrary prototypes, nonenumerable properties, and different graph
// topologies are excluded; dedicated fixed contract tests own some of them.
// An object and array with the same enumerable index keys is a nearby invalid
// same-type pair, and the edge-case law rejects it below.

function adjacentDateTime(time: number): number {
  if (Number.isNaN(time)) return 0
  return time === 8_640_000_000_000_000 ? time - 1 : time + 1
}

describe(`deepEquals property-based tests`, () => {
  describe(`bounded native graph relations`, () => {
    utilsProperty([ringArbitrary])(
      `compares separately allocated mixed rings and every changed payload`,
      (cells) => expectRingLaw(cells),
    )
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
  // Set insertion order, RegExp `lastIndex`, and array holes. These laws fix
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
      (pathA, pathB, v, w, enter) => {
        // Every generated value pair exercises all three record relations.
        // Per-case reach prevents a campaign from losing one construction.
        const reach = caseStates(
          `utils.record-prototypes`,
          recordPrototypeStates,
          enter,
        )
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
        // Generic equality retains main's JSON/record bridge. The approved
        // publication decision changes row equality, not the exported helper.
        expectEqualityPair(new Point(v), new Point(w), v === w)
        reach.reach(`same-class`)
        expectEqualityPair(new Point(v), { a: w }, v === w)
        reach.reach(`plain-class`)
        expectEqualityPair(new Point(v), new Other(v), false)
        const bare = Object.assign(Object.create(null), { a: v })
        expectEqualityPair(bare, { a: w }, v === w)
        expectEqualityPair(Object.create(null), {}, true)
        reach.reach(`null-plain`)
        const foreign = runInNewContext(`({})`) as { a: number }
        foreign.a = v
        expectEqualityPair(foreign, { a: w }, v === w)
        reach.reach(`foreign-plain`)
        for (const record of [new Point(v), bare, foreign]) {
          expect(sameRowValue(record, { a: w })).toBe(false)
          expect(sameRowValue({ a: w }, record)).toBe(false)
        }
        expect(sameRowValue(new Point(v), new Point(w))).toBe(v === w)
        reach.reach(`row-prototypes`)
        reach.assertReached()
      },
      campaignRuns,
      recordPrototypeStates,
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

    utilsProperty([sparseArrayCase])(
      `array holes equal undefined but differ from defined values`,
      (spec, enter) => {
        const sparseReach = { reach: enter }
        for (const [name, equal] of [
          [`general`, deepEquals],
          [`row`, sameRowValue],
        ] as const) {
          for (const carrier of sparseArrayCarriers) {
            const hole = makeSparseArray(spec, `hole`, carrier)
            for (const form of [`undefined`, `defined`] as const) {
              expectEqualityPair(
                hole,
                makeSparseArray(spec, form, carrier),
                form === `undefined`,
                equal,
              )
              sparseReach.reach(`hole-${form}`)
            }
            sparseReach.reach(carrier)
          }
          sparseReach.reach(name)
        }
      },
      campaignRuns,
      sparseReachStates,
    )
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
})

// Appended last: properties are numbered in file order (utils.41).
describe(`typed-array value class`, () => {
  // A typed array is its own value class: a record or an array of its
  // elements, with the same index keys, is not equal to it either way.
  utilsProperty([arbitraryFloat32Array])(
    `a typed array differs from a record or an array of its elements in both directions`,
    (typed) => {
      assertDistinctTypes(typed, { ...Array.from(typed) }, deepEquals)
      assertDistinctTypes(typed, Array.from(typed), deepEquals)
    },
  )
})

/**
 * Object-valued Sets compare unordered structural members with multiplicity:
 * distinct objects with equal fields still occupy distinct Set positions.
 * Row equality distinguishes plain/class/null records; generic equality keeps
 * the established plain-record/class bridge.
 * AGENTS.md's Algorithm Efficiency rule excludes combinatorial assignment
 * searches. Scalar reads and native Map/Set operations below get generous
 * cubic ceilings. Cached candidate comparisons can keep reads polynomial
 * while a permutation search does factorial assignment work, so both measures
 * matter. Neither measure bounds elapsed time or arbitrary nested-value work.
 *
 * The model counts authored shape/value tokens. Row equality requires exact
 * counts. Generic equality permits a plain/null record to bridge either keyed
 * class, so each side's excess class counts must fit the other's plain slots.
 * This counts capacity without searching assignments or calling production.
 * Generated widths and values
 * construct equal bags, a late unmatched prototype, and a count deficit where
 * every member has some candidate. Rotation challenges insertion order. Empty
 * and singleton neighbors use the same model. Optional parent links close a
 * cycle through the compared Sets without changing token identity.
 */
type SetRecord = { kind: `plain` | `class` | `other` | `null`; value: number }
const ambiguousSets = fc.record({
  width: fc.integer({ min: 6, max: 12 }),
  value: fc.integer({ min: 1, max: 5 }),
  rotation: fc.nat(12),
})
function setBag(records: ReadonlyArray<SetRecord>) {
  const counts = new Map<number, Record<SetRecord[`kind`], number>>()
  for (const { kind, value } of records) {
    const entry = counts.get(value) ?? { plain: 0, class: 0, other: 0, null: 0 }
    entry[kind]++
    counts.set(value, entry)
  }
  return counts
}
function setBagsEqual(
  left: ReadonlyArray<SetRecord>,
  right: ReadonlyArray<SetRecord>,
  preserveShape: boolean,
): boolean {
  if (left.length !== right.length) return false
  const a = setBag(left)
  const b = setBag(right)
  if (a.size !== b.size) return false
  for (const [value, x] of a) {
    const y = b.get(value)
    if (!y) return false
    if (preserveShape) {
      if (
        (Object.keys(x) as Array<SetRecord[`kind`]>).some(
          (kind) => x[kind] !== y[kind],
        )
      )
        return false
    } else {
      const total = (counts: typeof x) =>
        Object.values(counts).reduce((sum, count) => sum + count, 0)
      const excess = (from: typeof x, to: typeof x) =>
        Math.max(0, from.class - to.class) + Math.max(0, from.other - to.other)
      if (
        total(x) !== total(y) ||
        excess(x, y) > y.plain + y.null ||
        excess(y, x) > x.plain + x.null
      )
        return false
    }
  }
  return true
}
class SetPayload {}
class OtherSetPayload {}
const setReachStates = [
  `empty`,
  `singleton`,
  `wide`,
  `equal`,
  `unmatched`,
  `deficit`,
  `reassignment`,
  `cyclic`,
  `acyclic`,
  `general-forward`,
  `general-reverse`,
  `row-forward`,
  `row-reverse`,
] as const

// Count comparison work after constructing both inputs and the independent
// expectation. These synchronous fixtures cannot interleave another comparison
// while native methods are wrapped. Restore the exact descriptors even when a
// work ceiling throws; no test-only hook enters production.
function withSetComparisonOperations(
  limit: number,
  compare: () => boolean,
): boolean {
  let operations = 0
  const wrap = (prototype: object, method: string): (() => void) => {
    const original = Object.getOwnPropertyDescriptor(prototype, method)
    if (!original || typeof original.value !== `function`) {
      throw new Error(`Missing native comparison method: ${method}`)
    }
    Object.defineProperty(prototype, method, {
      ...original,
      value: function (this: unknown, ...args: Array<unknown>): unknown {
        if (++operations > limit) {
          rejectAt(
            `Set collection-operation work`,
            new Error(
              `Set collection-operation work: ${operations} exceeds ${limit}`,
            ),
          )
        }
        return Reflect.apply(original.value, this, args)
      },
    })
    return () => Object.defineProperty(prototype, method, original)
  }
  const restore: Array<() => void> = []
  try {
    for (const method of [`has`, `get`, `set`, `delete`]) {
      restore.push(wrap(Map.prototype, method))
    }
    for (const method of [`has`, `add`, `delete`]) {
      restore.push(wrap(Set.prototype, method))
    }
    return compare()
  } finally {
    for (const method of restore) method()
  }
}

function checkSetBag(
  left: ReadonlyArray<SetRecord>,
  right: ReadonlyArray<SetRecord>,
  cyclic: boolean,
  reach: (state: (typeof setReachStates)[number]) => void,
  workLimits?: { scalarReads: number; collectionOperations: number },
): void {
  const errors: Array<Error> = []
  for (const [name, equal] of [
    [`general`, deepEquals],
    [`row`, sameRowValue],
  ] as const) {
    const expected = setBagsEqual(left, right, name === `row`)
    for (const [a, b, direction] of [
      [left, right, `forward`],
      [right, left, `reverse`],
    ] as const) {
      try {
        reach(`${name}-${direction}`)
        let reads = 0
        const scalarCeiling =
          workLimits?.scalarReads ?? 4 * (Math.max(a.length, b.length) + 1) ** 3
        const make = (records: ReadonlyArray<SetRecord>) => {
          const result = new Set<object>()
          for (const spec of records) {
            const member: object =
              spec.kind === `class`
                ? new SetPayload()
                : spec.kind === `other`
                  ? new OtherSetPayload()
                  : spec.kind === `null`
                    ? (Object.create(null) as object)
                    : {}
            Object.defineProperty(member, `value`, {
              enumerable: true,
              get() {
                // Fail at the work observation, before exponential code can hang.
                // Allocate diagnostics only on failure; each scalar read is counted.
                if (++reads > scalarCeiling) {
                  rejectAt(
                    `Set scalar-field comparison work`,
                    new Error(
                      `Set scalar-field comparison work: ${reads} exceeds ${scalarCeiling}`,
                    ),
                  )
                }
                return spec.value
              },
            })
            if (cyclic) Object.assign(member, { parent: result })
            result.add(member)
          }
          return result
        }
        const leftValue = make(a)
        const rightValue = make(b)
        const actual = withSetComparisonOperations(
          workLimits?.collectionOperations ?? scalarCeiling,
          () => equal(leftValue, rightValue),
        )
        oracleAssertion(`Set bag equality`, () =>
          expect(actual, `Set bag equality`).toBe(expected),
        )
      } catch (error) {
        errors.push(
          new Error(`${name} ${direction} Set comparison: ${String(error)}`, {
            cause: error,
          }),
        )
      }
    }
  }
  if (errors.length)
    throw new AggregateError(errors, errors.map(String).join(`; `), {
      cause: errors[0],
    })
}
declareOracle({
  model: [setBag, setBagsEqual],
  check: [checkSetBag],
  grammar: [ambiguousSets],
})
// Match the existing describe registration order to preserve IDs: utils.42.
describe(`object Set matching work`, () => {
  utilsProperty([ambiguousSets])(
    `object Set equality respects multiplicity with polynomial comparison work`,
    ({ width, value, rotation }, enter) => {
      const reach = caseStates(`utils.set-matching`, setReachStates, enter)
      const plain = (count: number, leaf = value): Array<SetRecord> =>
        Array.from({ length: count }, () => ({ kind: `plain`, value: leaf }))
      for (const cyclic of [false, true]) {
        reach.reach(cyclic ? `cyclic` : `acyclic`)
        for (const count of [0, 1, width]) {
          reach.reach(
            count === 0 ? `empty` : count === 1 ? `singleton` : `wide`,
          )
          const records = plain(count)
          checkSetBag(records, [...records].reverse(), cyclic, reach.reach)
          reach.reach(`equal`)
        }
        for (const kind of [`class`, `null`] as const) {
          const records = plain(width)
          checkSetBag(
            [...records, { kind, value }],
            plain(width + 1),
            cyclic,
            reach.reach,
          )
          reach.reach(`unmatched`)
        }
        // Every member has a candidate, but the value counts cannot be paired.
        const a = [...plain(width + 1), ...plain(1, value + 1)]
        const b = [...plain(width), ...plain(2, value + 1)]
        const offset = rotation % b.length
        checkSetBag(
          a,
          [...b.slice(offset), ...b.slice(0, offset)],
          cyclic,
          reach.reach,
        )
        reach.reach(`deficit`)
        // A greedy first match needs reassignment: the plain member can use
        // either class, but the class member can use only its own class.
        checkSetBag(
          [
            { kind: `plain`, value },
            { kind: `class`, value },
          ],
          [
            { kind: `class`, value },
            { kind: `other`, value },
          ],
          cyclic,
          reach.reach,
        )
        reach.reach(`reassignment`)
      }
      reach.assertReached()
    },
    campaignRuns,
    setReachStates,
  )
})

/**
 * Equal Sets whose corresponding members are equal need no assignment search.
 * Scalar reads and native Map/Set operations have linear bounds for this
 * common paired-input family. They do not impose linear work on arbitrary
 * unordered or unequal Sets. The independent bag model checks distinct and
 * interchangeable scalar members,
 * with and without links back to the root Set, through both equality APIs.
 * Width varies across 1,024–3,072, including the reported 3,000-member scale.
 */
const pairedSets = fc.record({
  width: fc.integer({ min: 1024, max: 3072 }),
  value: fc.integer({ min: 1, max: 5 }),
})
declareOracle({ grammar: [pairedSets] })
const pairedReachStates = [
  ...setReachStates.filter((state) =>
    [
      `general-forward`,
      `general-reverse`,
      `row-forward`,
      `row-reverse`,
    ].includes(state),
  ),
  `distinct`,
  `interchangeable`,
  `cyclic`,
  `acyclic`,
] as const

describe(`paired object Set matching work`, () => {
  utilsProperty([pairedSets])(
    `paired equal Sets use linear comparison work at large widths`,
    ({ width, value }, enter) => {
      const reach = caseStates(
        `utils.paired-set-matching`,
        pairedReachStates,
        enter,
      )
      for (const distinct of [false, true]) {
        const records: Array<SetRecord> = Array.from(
          { length: width },
          (_, at) => ({
            kind: `plain`,
            value: value + (distinct ? at : 0),
          }),
        )
        for (const cyclic of [false, true]) {
          checkSetBag(records, records, cyclic, reach.reach, {
            scalarReads: 4 * width,
            collectionOperations: 16 * (width + 1),
          })
          reach.reach(cyclic ? `cyclic` : `acyclic`)
        }
        reach.reach(distinct ? `distinct` : `interchangeable`)
      }
      reach.assertReached()
    },
    10,
    pairedReachStates,
  )
})
