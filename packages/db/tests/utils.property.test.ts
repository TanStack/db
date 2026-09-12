import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { deepEquals } from '../src/utils'

/**
 * Custom arbitraries for generating values that deepEquals handles.
 *
 * Same-type pairs exercise structural equality. The cross-type laws below
 * separately require Date/Temporal values of different types to be unequal in
 * both directions. They make no claim about ordering those types, or about deep
 * equality for object-valued Sets and arbitrary shared/circular graphs. The
 * bounded graph laws below construct corresponding rings and acyclic copies;
 * they do not define equality for arbitrary different cycle topologies.
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
// Mixed Date/Temporal inequality has its own generated and fixed witnesses below.
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

    fcTest.prop([ringArbitrary], { numRuns: 100 })(
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

    fcTest.prop([fc.integer(), fc.string()])(
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

    fcTest.prop([fc.integer(), fc.string()])(
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

    fcTest.prop([fc.integer()])(
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

    fcTest.prop([fc.uniqueArray(fc.integer(), { minLength: 1, maxLength: 8 })])(
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
    fcTest.prop([arbitraryDate, arbitraryTemporalDuration])(
      `generated Date and Temporal.Duration are unequal in both directions`,
      (date, duration) => assertDistinctTypes(date, duration, deepEquals),
    )

    fcTest.prop([arbitraryDate, arbitraryTemporalPlainDate])(
      `generated Date and Temporal.PlainDate are unequal in both directions`,
      (date, plainDate) => assertDistinctTypes(date, plainDate, deepEquals),
    )

    fcTest.prop([arbitraryTemporalPlainDate, arbitraryTemporalDuration])(
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

    fcTest.prop([arbitraryExtraProperty])(
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
