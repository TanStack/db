import { describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import {
  deepEquals,
  equalPersistedSnapshotValues,
  resetWarnings,
  warnOnce,
} from '../src/utils'
import { normalizeError } from '../src/utils/error'
import { isPromiseLike } from '../src/utils/type-guards'
import {
  assertDistinctTypes,
  assertExtraProperty,
  edgeCarriers,
  expectCopyAndChanged,
  expectEqualityPair,
  expectRingLaw,
} from './deep-equals-support'
import {
  oracleRandomParameters,
  readOracleRunConfig,
  validateOraclePropertyRegistry,
} from './oracle-config'

describe(`normalizeError`, () => {
  it(`normalizes unstringifiable thrown values`, () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const thrownValues = [
      Object.create(null),
      {
        [Symbol.toPrimitive]: () => {
          throw new Error(`conversion failed`)
        },
      },
      new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw new Error(`prototype lookup failed`)
          },
        },
      ),
      revoked.proxy,
    ]

    for (const thrownValue of thrownValues) {
      expect(() => normalizeError(thrownValue)).not.toThrow()
      expect(normalizeError(thrownValue)).toEqual(new Error(`Unknown error`))
    }
  })
})

describe(`warnOnce`, () => {
  it(`logs each warning key once and permits an explicit reset`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})

    try {
      resetWarnings()
      warnOnce(`first`, `first message`)
      warnOnce(`first`, `ignored replacement`)
      warnOnce(`second`, `second message`)

      expect(warn.mock.calls).toEqual([[`first message`], [`second message`]])

      resetWarnings()
      warnOnce(`first`, `after reset`)
      expect(warn).toHaveBeenLastCalledWith(`after reset`)
    } finally {
      resetWarnings()
      warn.mockRestore()
    }
  })
})

describe(`oracle run configuration`, () => {
  it(`reads the multiplier and replay coordinates from an explicit environment`, () => {
    expect(
      readOracleRunConfig({
        TANSTACK_DB_ORACLE_RUNS_MULTIPLIER: `100`,
        TANSTACK_DB_ORACLE_SEED: `-42`,
        TANSTACK_DB_ORACLE_PATH: `1:0:2`,
        TANSTACK_DB_ORACLE_PROPERTY: `includes.incremental-history`,
      }),
    ).toEqual({
      multiplier: 100,
      replaySeed: -42,
      replayPath: `1:0:2`,
      replayProperty: `includes.incremental-history`,
    })
  })

  it(`uses one run multiplier and no replay coordinates by default`, () => {
    expect(readOracleRunConfig({})).toEqual({
      multiplier: 1,
      replaySeed: undefined,
      replayPath: undefined,
      replayProperty: undefined,
    })
  })

  it.each([
    [{ TANSTACK_DB_ORACLE_RUNS_MULTIPLIER: `0` }, `positive integer`],
    [{ TANSTACK_DB_ORACLE_RUNS_MULTIPLIER: `1.5` }, `positive integer`],
    [{ TANSTACK_DB_ORACLE_RUNS_MULTIPLIER: ` ` }, `positive integer`],
    [{ TANSTACK_DB_ORACLE_SEED: `1.5` }, `must be an integer`],
    [{ TANSTACK_DB_ORACLE_SEED: ` ` }, `must be an integer`],
    [{ TANSTACK_DB_ORACLE_PATH: `1:0` }, `requires TANSTACK_DB_ORACLE_SEED`],
    [
      { TANSTACK_DB_ORACLE_PROPERTY: `includes.incremental-history` },
      `requires TANSTACK_DB_ORACLE_PATH`,
    ],
    [
      {
        TANSTACK_DB_ORACLE_SEED: `42`,
        TANSTACK_DB_ORACLE_PATH: ` `,
        TANSTACK_DB_ORACLE_PROPERTY: `includes.incremental-history`,
      },
      `must be non-empty`,
    ],
    [
      {
        TANSTACK_DB_ORACLE_SEED: `42`,
        TANSTACK_DB_ORACLE_PATH: `1:-1`,
        TANSTACK_DB_ORACLE_PROPERTY: `includes.incremental-history`,
      },
      `colon-separated nonnegative integers`,
    ],
    [
      {
        TANSTACK_DB_ORACLE_SEED: `42`,
        TANSTACK_DB_ORACLE_PATH: `1:0`,
      },
      `requires TANSTACK_DB_ORACLE_PROPERTY`,
    ],
    [
      {
        TANSTACK_DB_ORACLE_SEED: `42`,
        TANSTACK_DB_ORACLE_PATH: `1:0`,
        TANSTACK_DB_ORACLE_PROPERTY: `includes.typo`,
      },
      `unknown oracle property`,
    ],
    [
      {
        TANSTACK_DB_ORACLE_SEED: `42`,
        TANSTACK_DB_ORACLE_PROPERTY: `includes.incremental-history`,
      },
      `requires TANSTACK_DB_ORACLE_PATH`,
    ],
  ] satisfies ReadonlyArray<readonly [Record<string, string>, string]>)(
    `rejects invalid environment values`,
    (environment, message) => {
      expect(() => readOracleRunConfig(environment)).toThrow(message)
    },
  )

  it(`rejects duplicate registered property names`, () => {
    expect(() =>
      validateOraclePropertyRegistry([`one.property`, `one.property`]),
    ).toThrow(`duplicate oracle property`)
  })

  it(`adds a shrink path only to its named property`, () => {
    const ordinaryRun = {
      replaySeed: undefined,
      replayPath: undefined,
      replayProperty: undefined,
    }
    const replayRun = {
      replaySeed: -42,
      replayPath: `1:0:2`,
      replayProperty: `includes.incremental-history`,
    }

    expect(
      oracleRandomParameters(40, ordinaryRun, `includes.incremental-history`),
    ).toEqual({ numRuns: 40 })
    expect(
      oracleRandomParameters(40, replayRun, `includes.alpha-renaming`),
    ).toEqual({
      numRuns: 40,
      seed: -42,
    })
    // A path replays one recorded counterexample, so it runs once.
    expect(
      oracleRandomParameters(40, replayRun, `includes.incremental-history`),
    ).toEqual({ numRuns: 1, seed: -42, path: `1:0:2` })
  })
})

describe(`deepEquals`, () => {
  it.each([`later`, Symbol(`later`)])(
    `checks own-key visibility after a getter runs: %s`,
    (key) => {
      const right = { first: 1, [key]: undefined }
      const left = {
        get first() {
          Object.defineProperty(right, key, { enumerable: false })
          return 1
        },
        [key]: undefined,
      }
      expect(deepEquals(left, right)).toBe(false)
    },
  )

  it.each(
    [`field`, Symbol(`field`)].flatMap((key) =>
      [false, true].map((inherited) => ({ key, inherited })),
    ),
  )(
    `requires matching enumerable own keys: $key / inherited=$inherited`,
    ({ key, inherited }) => {
      const own = { [key]: 1 }
      const other = { other: 1 }
      if (inherited) Object.setPrototypeOf(other, { [key]: 1 })
      else Object.defineProperty(other, key, { value: 1, enumerable: false })
      expect(deepEquals(own, other)).toBe(false)
      expect(deepEquals(other, own)).toBe(false)
      expect(deepEquals(own, { [key]: 1 })).toBe(true)
    },
  )

  describe(`primitives`, () => {
    it(`should handle identical primitives`, () => {
      expect(deepEquals(1, 1)).toBe(true)
      expect(deepEquals(`hello`, `hello`)).toBe(true)
      expect(deepEquals(true, true)).toBe(true)
      expect(deepEquals(null, null)).toBe(true)
      expect(deepEquals(undefined, undefined)).toBe(true)
    })

    it(`should handle different primitives`, () => {
      expect(deepEquals(1, 2)).toBe(false)
      expect(deepEquals(`hello`, `world`)).toBe(false)
      expect(deepEquals(true, false)).toBe(false)
      expect(deepEquals(null, undefined)).toBe(false)
    })

    it(`should handle different types`, () => {
      expect(deepEquals(1, `1`)).toBe(false)
      expect(deepEquals(0, false)).toBe(false)
      expect(deepEquals(null, 0)).toBe(false)
    })
  })

  describe(`arrays`, () => {
    it(`should handle identical arrays`, () => {
      expect(deepEquals([], [])).toBe(true)
      expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(deepEquals([1, [2, 3]], [1, [2, 3]])).toBe(true)
    })

    it(`should handle different arrays`, () => {
      expect(deepEquals([1, 2, 3], [1, 2, 4])).toBe(false)
      expect(deepEquals([1, 2, 3], [1, 2])).toBe(false)
      expect(deepEquals([1, [2, 3]], [1, [2, 4]])).toBe(false)
    })

    it(`should handle circular references in arrays`, () => {
      const a: Array<any> = [1, 2]
      a.push(a)
      const b: Array<any> = [1, 2]
      b.push(b)

      expect(deepEquals(a, b)).toBe(true)
    })
  })

  describe(`objects`, () => {
    it(`should handle identical objects`, () => {
      expect(deepEquals({}, {})).toBe(true)
      expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
      expect(deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true) // property order doesn't matter
      expect(deepEquals({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
    })

    it(`should handle different objects`, () => {
      expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false)
      expect(deepEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false)
      expect(deepEquals({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    })

    it(`should compare enumerable symbol properties`, () => {
      const key = Symbol(`key`)

      expect(deepEquals({ [key]: 1 }, { [key]: 1 })).toBe(true)
      expect(deepEquals({ [key]: 1 }, { [key]: 2 })).toBe(false)
      expect(deepEquals({ [Symbol(`key`)]: 1 }, { [Symbol(`key`)]: 1 })).toBe(
        false,
      )
    })

    it(`should handle circular references in objects`, () => {
      const a: any = { x: 1 }
      a.self = a
      const b: any = { x: 1 }
      b.self = b

      expect(deepEquals(a, b)).toBe(true)
    })
  })

  describe(`Map objects`, () => {
    it(`should handle identical maps`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      expect(deepEquals(map1, map2)).toBe(true)
    })

    it(`should handle maps with different order`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([
        [`b`, 2],
        [`a`, 1],
      ])
      expect(deepEquals(map1, map2)).toBe(true)
    })

    it(`should handle different maps`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([
        [`a`, 1],
        [`b`, 3],
      ])
      expect(deepEquals(map1, map2)).toBe(false)
    })

    it(`should handle maps with different sizes`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([[`a`, 1]])
      expect(deepEquals(map1, map2)).toBe(false)
    })

    it(`should handle nested objects in maps`, () => {
      const map1 = new Map([
        [`a`, { x: 1 }],
        [`b`, { y: 2 }],
      ])
      const map2 = new Map([
        [`a`, { x: 1 }],
        [`b`, { y: 2 }],
      ])
      expect(deepEquals(map1, map2)).toBe(true)
    })

    it(`should handle circular references in maps`, () => {
      const map1 = new Map()
      map1.set(`self`, map1)
      const map2 = new Map()
      map2.set(`self`, map2)

      expect(deepEquals(map1, map2)).toBe(true)
    })
  })

  describe(`Set objects`, () => {
    it(`should handle identical sets with primitives`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2, 3])
      expect(deepEquals(set1, set2)).toBe(true)
    })

    it(`should handle sets with different order`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([3, 1, 2])
      expect(deepEquals(set1, set2)).toBe(true)
    })

    it(`should handle different sets`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2, 4])
      expect(deepEquals(set1, set2)).toBe(false)
    })

    it(`should handle sets with different sizes`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2])
      expect(deepEquals(set1, set2)).toBe(false)
    })

    it(`should handle sets with objects (simplified comparison)`, () => {
      const set1 = new Set([{ a: 1 }, { b: 2 }])
      const set2 = new Set([{ a: 1 }, { b: 2 }])
      // Note: Set comparison for objects is simplified and may not work for all cases
      expect(deepEquals(set1, set2)).toBe(true)
    })

    it(`should handle circular references in sets`, () => {
      const set1 = new Set()
      set1.add(set1)
      const set2 = new Set()
      set2.add(set2)

      expect(deepEquals(set1, set2)).toBe(true)
    })
  })

  describe(`TypedArrays`, () => {
    it(`should handle identical Uint8Arrays`, () => {
      const arr1 = new Uint8Array([1, 2, 3, 4])
      const arr2 = new Uint8Array([1, 2, 3, 4])
      expect(deepEquals(arr1, arr2)).toBe(true)
    })

    it(`should handle different Uint8Arrays`, () => {
      const arr1 = new Uint8Array([1, 2, 3, 4])
      const arr2 = new Uint8Array([1, 2, 3, 5])
      expect(deepEquals(arr1, arr2)).toBe(false)
    })

    it(`should handle arrays with different lengths`, () => {
      const arr1 = new Uint8Array([1, 2, 3])
      const arr2 = new Uint8Array([1, 2])
      expect(deepEquals(arr1, arr2)).toBe(false)
    })

    it(`should handle different TypedArray types`, () => {
      const arr1 = new Uint8Array([1, 2, 3])
      const arr2 = new Int8Array([1, 2, 3])
      // Different types should be handled by the typeof check
      expect(deepEquals(arr1, arr2)).toBe(true) // Both are typed arrays with same values
    })

    it(`should handle Float32Arrays`, () => {
      const arr1 = new Float32Array([1.1, 2.2, 3.3])
      const arr2 = new Float32Array([1.1, 2.2, 3.3])
      expect(deepEquals(arr1, arr2)).toBe(true)
    })
  })

  describe(`Temporal objects (if available)`, () => {
    it(`should handle Temporal.PlainDate objects`, () => {
      const date1 = new Temporal.PlainDate(2023, 1, 1)
      const date2 = new Temporal.PlainDate(2023, 1, 1)
      const date3 = new Temporal.PlainDate(2023, 1, 2)

      expect(deepEquals(date1, date2)).toBe(true)
      expect(deepEquals(date1, date3)).toBe(false)
    })

    it(`should handle Temporal.Duration objects`, () => {
      const duration1 = Temporal.Duration.from(`PT1H30M`)
      const duration2 = Temporal.Duration.from(`PT1H30M`)
      const duration3 = Temporal.Duration.from(`PT2H30M`)

      expect(deepEquals(duration1, duration2)).toBe(true)
      expect(deepEquals(duration1, duration3)).toBe(false)
    })

    it(`should handle different Temporal types`, () => {
      const date = new Temporal.PlainDate(2023, 1, 1)
      const duration = Temporal.Duration.from(`PT1H30M`)
      expect(deepEquals(date, duration)).toBe(false)
    })
  })

  describe(`mixed complex cases`, () => {
    it(`should handle complex nested structures`, () => {
      const obj1 = {
        array: [1, 2, { nested: true }],
        map: new Map([[`key`, `value`]]),
        set: new Set([1, 2, 3]),
        date: new Date(`2023-01-01`),
        regex: /test/gi,
        typedArray: new Uint8Array([1, 2, 3]),
      }

      const obj2 = {
        array: [1, 2, { nested: true }],
        map: new Map([[`key`, `value`]]),
        set: new Set([1, 2, 3]),
        date: new Date(`2023-01-01`),
        regex: /test/gi,
        typedArray: new Uint8Array([1, 2, 3]),
      }

      expect(deepEquals(obj1, obj2)).toBe(true)
    })

    it(`should handle complex nested structures with differences`, () => {
      const obj1 = {
        array: [1, 2, { nested: true }],
        map: new Map([[`key`, `value`]]),
        date: new Date(`2023-01-01`),
      }

      const obj2 = {
        array: [1, 2, { nested: false }], // difference here
        map: new Map([[`key`, `value`]]),
        date: new Date(`2023-01-01`),
      }

      expect(deepEquals(obj1, obj2)).toBe(false)
    })
  })

  describe(`edge cases`, () => {
    it(`should handle null and undefined`, () => {
      expect(deepEquals(null, null)).toBe(true)
      expect(deepEquals(undefined, undefined)).toBe(true)
      expect(deepEquals(null, undefined)).toBe(false)
      expect(deepEquals(null, 0)).toBe(false)
      expect(deepEquals(undefined, ``)).toBe(false)
    })

    it(`should handle empty structures`, () => {
      expect(deepEquals({}, {})).toBe(true)
      expect(deepEquals([], [])).toBe(true)
      expect(deepEquals(new Map(), new Map())).toBe(true)
      expect(deepEquals(new Set(), new Set())).toBe(true)
    })

    it(`should handle mixed types`, () => {
      expect(deepEquals([], {})).toBe(false)
      expect(deepEquals(new Map(), new Set())).toBe(false)
      expect(deepEquals(new Date(), /regex/)).toBe(false)
    })
  })
})

describe(`isPromiseLike`, () => {
  it(`should return true for native Promises`, () => {
    const promise = Promise.resolve(42)
    expect(isPromiseLike(promise)).toBe(true)
  })

  it(`should return true for objects with a then method`, () => {
    const thenable = {
      then: (onFulfilled?: any, _onRejected?: any) => {
        onFulfilled?.(42)
      },
    }
    expect(isPromiseLike(thenable)).toBe(true)
  })

  it(`should return true for functions with a then method`, () => {
    const thenableFunction: any = function () {}
    thenableFunction.then = (onFulfilled?: any) => {
      onFulfilled?.(42)
    }
    expect(isPromiseLike(thenableFunction)).toBe(true)
  })

  it(`should return false for null`, () => {
    expect(isPromiseLike(null)).toBe(false)
  })

  it(`should return false for undefined`, () => {
    expect(isPromiseLike(undefined)).toBe(false)
  })

  it(`should return false for primitives`, () => {
    expect(isPromiseLike(42)).toBe(false)
    expect(isPromiseLike(`string`)).toBe(false)
    expect(isPromiseLike(true)).toBe(false)
    expect(isPromiseLike(false)).toBe(false)
  })

  it(`should return false for objects without a then method`, () => {
    expect(isPromiseLike({})).toBe(false)
    expect(isPromiseLike({ value: 42 })).toBe(false)
    expect(isPromiseLike([])).toBe(false)
    expect(isPromiseLike(new Map())).toBe(false)
  })

  it(`should return false for objects with a non-function then property`, () => {
    const obj = { then: 42 }
    expect(isPromiseLike(obj)).toBe(false)
  })

  it(`should return false for functions without a then method`, () => {
    const fn = () => 42
    expect(isPromiseLike(fn)).toBe(false)
  })

  it(`should handle async functions (which return promises)`, () => {
    const asyncFn = () => Promise.resolve(42)
    const result = asyncFn()
    expect(isPromiseLike(result)).toBe(true)
  })
})

/** Ordinary tests moved from src.ts; the oracle file owns the law. */

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
    it(`matches object-valued Sets by value rather than cardinality`, () => {
      expectEqualityPair(
        new Set([{ id: 1 }, { id: 2 }]),
        new Set([{ id: 2 }, { id: 1 }]),
        true,
      )
      expectEqualityPair(new Set([{ id: 1 }]), new Set([{ id: 2 }]), false)
    })
  })
  describe(`cross-type comparisons`, () => {
    // A Date's display and numeric timestamp encode the same instant, but
    // change-event equality keeps the Date value class distinct. The finite
    // generator makes both encodings legal; the 2023 case preserves the old
    // unit test's exact operands.
    it(`keeps a 2023 Date distinct from its old primitive probes`, () => {
      const date = new Date(`2023-01-01T00:00:00Z`)
      expectCopyAndChanged(
        date,
        new Date(`2023-01-01T00:00:00Z`),
        new Date(`2023-01-02T00:00:00Z`),
      )
      assertDistinctTypes(date, `2023-01-01T00:00:00Z`, deepEquals)
      assertDistinctTypes(date, date.getTime(), deepEquals)
    })
    // RegExp source text does not acquire the regex's value class, even when
    // it spells the same pattern. The source and flags still govern equality
    // between two genuine RegExps in the laws below.
    it(`keeps /abc/g distinct from its old source-text probe`, () => {
      expectCopyAndChanged(/abc/g, /abc/g, /abc/i)
      expectCopyAndChanged(/abc/g, /abc/g, /def/g)
      expectEqualityPair(/test/i, /test/i, true)
      assertDistinctTypes(/abc/g, `abc`, deepEquals)
    })
    it(`rejects primitive-coercing equality for Date and RegExp`, () => {
      const date = new Date(`2023-01-01T00:00:00Z`)
      const dateAsNumber = (left: unknown, right: unknown) =>
        (left instanceof Date ? left.getTime() : left) ===
        (right instanceof Date ? right.getTime() : right)
      const dateAsString = (left: unknown, right: unknown) =>
        (left instanceof Date ? left.toISOString() : left) ===
        (right instanceof Date ? right.toISOString() : right)
      const regexpAsSource = (left: unknown, right: unknown) =>
        (left instanceof RegExp ? left.source : left) ===
        (right instanceof RegExp ? right.source : right)
      expect(() =>
        assertDistinctTypes(date, date.getTime(), dateAsNumber),
      ).toThrow(`distinct types must be unequal (forward)`)
      expect(() =>
        assertDistinctTypes(date, date.toISOString(), dateAsString),
      ).toThrow(`distinct types must be unequal (forward)`)
      expect(() => assertDistinctTypes(/abc/g, `abc`, regexpAsSource)).toThrow(
        `distinct types must be unequal (forward)`,
      )
    })
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
  })
  describe(`inequality properties`, () => {
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
  })
  describe(`additional non-ring value boundaries`, () => {
    it(`keeps one second distinct from 1000 milliseconds with the same display`, () => {
      const seconds = Temporal.Duration.from({ seconds: 1 })
      const milliseconds = Temporal.Duration.from({ milliseconds: 1000 })
      expect(seconds.toString()).toBe(milliseconds.toString())
      expectEqualityPair(seconds, milliseconds, false)
    })
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
