import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { deepEquals, equalPersistedSnapshotValues } from '../src/utils'

/**
 * The `deepEquals` API contract in `../src/utils.ts`, reinforced by the
 * established examples in `utils.test.ts`, promises change-event equality for
 * its supported value classes. This oracle checks bounded equality and
 * inequality laws for those classes, not general graph isomorphism.
 *
 * Independent value constructors exercise reflexivity, symmetry, copied
 * structure, and changed-leaf inequality for primitives, arrays, records,
 * dates, regexes, typed bytes, and selected Temporal types. Cross-type values
 * remain unequal. Separate bounded graph laws construct corresponding rings
 * and acyclic copies without reusing the production walk.
 *
 * Arbitrary different cycle topologies are outside this model. Naming that
 * exclusion matters: more random examples cannot establish semantics the
 * reference relation does not define.
 */
// Every generated law below uses the same property in a fixed and a fresh
// campaign. Set UTILS_ORACLE_PROPERTY to the numbered test label and provide
// UTILS_ORACLE_SEED and UTILS_ORACLE_PATH to replay its fast-check shrink
// directly, for example with `vitest run tests/utils-oracle.property.test.ts`.
const fixedSeed = 20260911
const campaignRuns = 100
const requestedProperty = process.env.UTILS_ORACLE_PROPERTY
const replaySeed = process.env.UTILS_ORACLE_SEED
const replayPath = process.env.UTILS_ORACLE_PATH
let nextPropertyId = 0

if (
  requestedProperty === undefined &&
  (replaySeed !== undefined || replayPath !== undefined)
) {
  throw new Error(`utils oracle replay needs a property number`)
}

function utilsProperty<Ts extends [unknown, ...Array<unknown>]>(arbitraries: {
  [K in keyof Ts]: fc.Arbitrary<Ts[K]>
}) {
  return (name: string, check: (...values: Ts) => void): void => {
    const id = String(++nextPropertyId)
    const label = `${id}: ${name}`
    // fast-check's variadic tuple overload widens a generic tuple to any[].
    // The mapped arbitraries preserve each position's Ts member.
    const argumentsArbitrary = fc.tuple(...arbitraries) as fc.Arbitrary<Ts>

    if (requestedProperty !== undefined) {
      if (requestedProperty !== id) {
        it.skip(`${label} skipped for oracle replay`, () => {})
        return
      }
      if (replaySeed === undefined || replayPath === undefined) {
        throw new Error(`utils oracle replay needs a seed and shrink path`)
      }
      const seed = Number(replaySeed)
      if (!Number.isSafeInteger(seed)) {
        throw new Error(`utils oracle replay seed must be an integer`)
      }
      fcTest.prop([argumentsArbitrary], {
        seed,
        path: replayPath,
        numRuns: campaignRuns,
      })(`${label} replay`, (values) => check(...values))
      return
    }

    fcTest.prop([argumentsArbitrary], {
      seed: fixedSeed,
      numRuns: campaignRuns,
    })(`${label} fixed`, (values) => check(...values))
    fcTest.prop([argumentsArbitrary], { numRuns: campaignRuns })(
      `${label} random`,
      (values) => check(...values),
    )
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
// distinct-type grammar is deliberately restricted to Date/Temporal pairs;
// it does not claim every cross-class combination. String lengths, integer
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

const edgeCarriers = [`object`, `array`, `map`, `symbol`] as const
type EdgeCarrier = (typeof edgeCarriers)[number]
type EqualityNode = { value: number; next?: unknown }

// Construct corresponding rings, not an implementation of deep equality.
// Every node is reachable; replacing one numeric payload must be observable.
// Map keys/symbol keys are shared tokens, while all structural nodes are fresh.
function equalityRing(
  cells: ReadonlyArray<{ value: number; carrier: EdgeCarrier }>,
  keys: ReadonlyArray<symbol>,
): EqualityNode {
  const nodes: Array<EqualityNode> = cells.map(({ value }) => ({ value }))
  for (const [index, cell] of cells.entries()) {
    const target = nodes[(index + 1) % nodes.length]!
    switch (cell.carrier) {
      case `object`:
        nodes[index]!.next = { target }
        break
      case `array`:
        nodes[index]!.next = [target]
        break
      case `map`:
        nodes[index]!.next = new Map([[keys[index]!, target]])
        break
      case `symbol`:
        nodes[index]!.next = { [keys[index]!]: target }
        break
    }
  }
  return nodes[0]!
}

function expectEqualityPair(
  a: unknown,
  b: unknown,
  expected: boolean,
  equal: (a: unknown, b: unknown) => boolean = deepEquals,
): void {
  expect(equal(a, b), `forward equality`).toBe(expected)
  expect(equal(b, a), `reverse equality`).toBe(expected)
}

function expectCopyAndChanged(
  original: unknown,
  copy: unknown,
  changed: unknown,
  equal: (a: unknown, b: unknown) => boolean = deepEquals,
): void {
  expectEqualityPair(original, copy, true, equal)
  expectEqualityPair(original, changed, false, equal)
}

function adjacentDateTime(time: number): number {
  if (Number.isNaN(time)) return 0
  return time === 8_640_000_000_000_000 ? time - 1 : time + 1
}

function expectRingLaw(
  cells: ReadonlyArray<{ value: number; carrier: EdgeCarrier }>,
  equal: (a: unknown, b: unknown) => boolean = deepEquals,
): void {
  expect(cells.length).toBeGreaterThan(0)
  const keys = cells.map((_, index) => Symbol(`edge-${index}`))
  const original = equalityRing(cells, keys)
  const copy = equalityRing(cells, keys)
  expect(original).not.toBe(copy)
  expectEqualityPair(original, copy, true, equal)
  // Check every reachable payload, including nodes past a mixed-container edge.
  for (let changed = 0; changed < cells.length; changed++) {
    const different = equalityRing(
      cells.map((cell, index) => ({
        ...cell,
        value: cell.value + (index === changed ? 1 : 0),
      })),
      keys,
    )
    expectEqualityPair(original, different, false, equal)
  }
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

function assertExtraProperty(
  {
    original,
    key,
    value,
  }: {
    original: Record<string, number>
    key: string
    value: number
  },
  equal: (a: unknown, b: unknown) => boolean,
): void {
  expect(key in original).toBe(false)
  const extended = { ...original, [key]: value }
  expect(Object.keys(extended)).toHaveLength(Object.keys(original).length + 1)
  expect(equal(original, { ...original }), `property copy must be equal`).toBe(
    true,
  )
  expect(equal(original, extended), `extra property must be unequal`).toBe(
    false,
  )
  expect(equal(extended, original), `extra property must be unequal`).toBe(
    false,
  )
}

function assertDistinctTypes(
  a: unknown,
  b: unknown,
  equal: (a: unknown, b: unknown) => boolean,
): void {
  expect(equal(a, b), `distinct types must be unequal (forward)`).toBe(false)
  expect(equal(b, a), `distinct types must be unequal (reverse)`).toBe(false)
}

describe(`deepEquals property-based tests`, () => {
  describe(`non-ring grammar boundaries`, () => {
    const cases: ReadonlyArray<{
      name: string
      values: () => readonly [unknown, unknown, unknown]
    }> = [
      { name: `null and undefined`, values: () => [null, null, undefined] },
      {
        name: `undefined and null`,
        values: () => [undefined, undefined, null],
      },
      { name: `boolean`, values: () => [true, true, false] },
      { name: `integer`, values: () => [0, 0, 1] },
      { name: `string`, values: () => [`a`, `a`, `b`] },
      { name: `double`, values: () => [0.5, 0.5, 1.5] },
      { name: `NaN`, values: () => [NaN, NaN, 1] },
      { name: `infinity`, values: () => [Infinity, Infinity, -Infinity] },
      { name: `signed zero`, values: () => [-0, 0, 1] },
      {
        name: `Date time`,
        values: () => [new Date(0), new Date(0), new Date(1)],
      },
      {
        name: `RegExp flags`,
        values: () => [/a/g, /a/g, /a/i],
      },
      {
        name: `RegExp source`,
        values: () => [/a/g, /a/g, /b/g],
      },
      {
        name: `Uint8Array length`,
        values: () => [new Uint8Array(), new Uint8Array(), new Uint8Array([1])],
      },
      {
        name: `Uint8Array content`,
        values: () => [
          new Uint8Array([1]),
          new Uint8Array([1]),
          new Uint8Array([2]),
        ],
      },
      {
        name: `Float32Array content`,
        values: () => [
          new Float32Array([1.5]),
          new Float32Array([1.5]),
          new Float32Array([2.5]),
        ],
      },
      {
        name: `Temporal.PlainDate day`,
        values: () => [
          new Temporal.PlainDate(2024, 1, 1),
          new Temporal.PlainDate(2024, 1, 1),
          new Temporal.PlainDate(2024, 1, 2),
        ],
      },
      {
        name: `Temporal.Duration seconds`,
        values: () => [
          Temporal.Duration.from({ seconds: 1 }),
          Temporal.Duration.from({ seconds: 1 }),
          Temporal.Duration.from({ seconds: 2 }),
        ],
      },
      { name: `array length`, values: () => [[], [], [1]] },
      { name: `array content`, values: () => [[1], [1], [2]] },
      { name: `record key`, values: () => [{}, {}, { a: 1 }] },
      { name: `record value`, values: () => [{ a: 1 }, { a: 1 }, { a: 2 }] },
      {
        name: `Map entry`,
        values: () => [
          new Map([[`a`, 1]]),
          new Map([[`a`, 1]]),
          new Map([[`a`, 2]]),
        ],
      },
      {
        name: `Set membership`,
        values: () => [new Set([1]), new Set([1]), new Set([2])],
      },
    ]

    it.each(cases)(
      `reconstructs equal and changed $name witnesses`,
      ({ values }) => {
        expectCopyAndChanged(...values())
      },
    )

    it(`rejects reference-only and type-only comparisons at their named checkpoints`, () => {
      const [date, dateCopy, changedDate] = cases
        .find(({ name }) => name === `Date time`)!
        .values()
      // A reference-only comparison loses equality between separate Dates.
      expect(() =>
        expectCopyAndChanged(date, dateCopy, changedDate, Object.is),
      ).toThrow(`forward equality`)
      const [array, arrayCopy, changedArray] = cases
        .find(({ name }) => name === `array content`)!
        .values()
      // A shallow type comparison accepts the wrong element at the same cut.
      const typeOnly = (a: unknown, b: unknown) =>
        Object.prototype.toString.call(a) === Object.prototype.toString.call(b)
      expect(() =>
        expectCopyAndChanged(array, arrayCopy, changedArray, typeOnly),
      ).toThrow(`forward equality`)
      expectCopyAndChanged(date, dateCopy, changedDate)
      expectCopyAndChanged(array, arrayCopy, changedArray)
    })

    it(`keeps empty and nonempty containers distinct across the 0–1 margin`, () => {
      expectCopyAndChanged([], [], [0])
      expectCopyAndChanged({}, {}, { value: 0 })
      expectCopyAndChanged(new Map(), new Map(), new Map([[0, 0]]))
      expectCopyAndChanged(new Set(), new Set(), new Set([0]))
      expectCopyAndChanged(
        new Uint8Array(),
        new Uint8Array(),
        new Uint8Array([0]),
      )
    })
  })

  describe(`bounded native graph relations`, () => {
    it.each(
      edgeCarriers.flatMap((first) =>
        edgeCarriers.map((second) => ({ first, second })),
      ),
    )(
      `compares equal and changed rings through $first then $second`,
      ({ first, second }) =>
        expectRingLaw([
          { value: 0, carrier: first },
          { value: 0, carrier: second },
        ]),
    )

    it.each([1, 4, 5])(`compares equal and changed %i-node rings`, (length) => {
      expectRingLaw(
        Array.from({ length }, (_, index) => ({
          value: index,
          carrier: edgeCarriers[index % edgeCarriers.length]!,
        })),
      )
    })

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

    it(`rejects comparators that ignore graph payloads or reject equal cycles`, () => {
      const cells = [
        { value: 0, carrier: `map` as const },
        { value: 0, carrier: `symbol` as const },
      ]
      expect(() => expectRingLaw(cells, () => true)).toThrow(`forward equality`)
      expect(() => expectRingLaw(cells, () => false)).toThrow(
        `forward equality`,
      )
      expectRingLaw(cells)
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

    it(`rejects symbol-erasing, Map-key-erasing and Set-size-only comparisons`, () => {
      const key = Symbol(`key`)
      const a = { [key]: 1 }
      const b = { [key]: 2 }
      const stringOnly = (left: unknown, right: unknown) =>
        deepEquals(
          Object.fromEntries(Object.entries(left as object)),
          Object.fromEntries(Object.entries(right as object)),
        )
      expect(() => expectEqualityPair(a, b, false, stringOnly)).toThrow(
        `forward equality`,
      )
      expectEqualityPair(a, b, false)
      expectEqualityPair(a, { [key]: 1 }, true)

      const mapA = new Map([[{ key: 1 }, 0]])
      const mapB = new Map([[{ key: 1 }, 0]])
      const mapValuesOnly = (left: unknown, right: unknown) =>
        deepEquals(
          [...(left as Map<unknown, unknown>).values()],
          [...(right as Map<unknown, unknown>).values()],
        )
      expect(() =>
        expectEqualityPair(mapA, mapB, false, mapValuesOnly),
      ).toThrow(`forward equality`)
      expectEqualityPair(mapA, mapB, false)
      expectEqualityPair(mapA, new Map(mapA), true)

      const setA = new Set([1, 2])
      const setB = new Set([1, 3])
      const sizeOnly = (left: unknown, right: unknown) =>
        (left as Set<unknown>).size === (right as Set<unknown>).size
      expect(() => expectEqualityPair(setA, setB, false, sizeOnly)).toThrow(
        `forward equality`,
      )
      expectEqualityPair(setA, setB, false)
      expectEqualityPair(setA, new Set([2, 1]), true)
    })

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

    it(`matches object-valued Sets by value rather than cardinality`, () => {
      expectEqualityPair(
        new Set([{ id: 1 }, { id: 2 }]),
        new Set([{ id: 2 }, { id: 1 }]),
        true,
      )
      expectEqualityPair(new Set([{ id: 1 }]), new Set([{ id: 2 }]), false)
    })
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

    it(`distinct-type law rejects equality in either direction`, () => {
      const date = new Date(0)
      const duration = Temporal.Duration.from({ seconds: 0 })
      expect(() =>
        assertDistinctTypes(date, duration, (a) => a === date),
      ).toThrow(`distinct types must be unequal (forward)`)
      expect(() =>
        assertDistinctTypes(date, duration, (a) => a === duration),
      ).toThrow(`distinct types must be unequal (reverse)`)
      assertDistinctTypes(date, duration, Object.is)
      // Distinct instances of the same type remain legitimate equal neighbors.
      expect(deepEquals(date, new Date(0))).toBe(true)
      expect(deepEquals(duration, Temporal.Duration.from({ seconds: 0 }))).toBe(
        true,
      )
    })

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

  describe(`change-event equality`, () => {
    it(`treats copied NaN values and invalid Dates as equal`, () => {
      expect(deepEquals({ rank: NaN }, { rank: NaN })).toBe(true)
      expect(deepEquals(new Date(NaN), new Date(NaN))).toBe(true)
      expect(deepEquals({ rank: NaN }, { rank: 10 })).toBe(false)
    })

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

    it(`extra-property law rejects a subset-only comparison`, () => {
      const sample = { original: { a: 1 }, key: `b`, value: 2 }
      const subsetEqual = (a: unknown, b: unknown): boolean => {
        const left = a as Record<string, number>
        const right = b as Record<string, number>
        return Object.keys(left).every((key) => left[key] === right[key])
      }
      expect(() => assertExtraProperty(sample, subsetEqual)).toThrow(
        `extra property must be unequal`,
      )
      assertExtraProperty(sample, deepEquals)
    })

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

  // Keep newly added generated laws after the original registration order:
  // UTILS_ORACLE_PROPERTY uses ordinal selectors for saved seed/path replays.
  describe(`additional non-ring value boundaries`, () => {
    utilsProperty([arbitraryRegExp])(
      `RegExp source and flags determine equality`,
      (regex) => {
        const copy = new RegExp(regex.source, regex.flags)
        const changedFlags = regex.flags.includes(`i`)
          ? regex.flags.replace(`i`, ``)
          : `${regex.flags}i`
        expectCopyAndChanged(
          regex,
          copy,
          new RegExp(regex.source, changedFlags),
        )
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
  })
})

// Persisted-snapshot equality decides whether a reload can leave the public
// row untouched. Prototype identity is part of that row's observable shape:
// equal fields on a class or null-prototype record cannot certify that a
// plain durable record is already public. Two values with the same prototype
// and fields remain equal. This is a direct comparator boundary; the persisted
// wrapper oracle owns the source/live publication checkpoint.
describe(`persisted-snapshot prototype equality`, () => {
  it(`distinguishes nested prototypes while accepting equal same-prototype values`, () => {
    class DetailBox {
      constructor(public rank: number) {}
    }
    const authored = { detail: new DetailBox(7) }
    const durable = { detail: { rank: 7 } }
    const sameShape = { detail: new DetailBox(7) }
    const nullPrototype = Object.assign(Object.create(null) as object, {
      rank: 7,
    })

    expect(deepEquals(authored, durable)).toBe(true)
    expect(equalPersistedSnapshotValues(authored, durable)).toBe(false)
    expect(equalPersistedSnapshotValues(authored, sameShape)).toBe(true)
    expect(
      equalPersistedSnapshotValues({ detail: nullPrototype }, durable),
    ).toBe(false)
  })
})

if (requestedProperty !== undefined) {
  it(`selects a known utils oracle property`, () => {
    const id = Number(requestedProperty)
    expect(
      Number.isSafeInteger(id) && id >= 1 && id <= nextPropertyId,
      `unknown utils oracle property: ${requestedProperty}`,
    ).toBe(true)
  })
}
