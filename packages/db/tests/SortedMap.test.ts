import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { SortedMap } from '../src/SortedMap'
import { oraclePropertyOptions, oracleRuns } from './oracle-config'

type Order = `key` | `ascending` | `descending`

function expectMap(
  actual: SortedMap<number, number>,
  model: Map<number, number>,
  order: Order,
) {
  // Recompute from a plain Map; do not copy SortedMap's binary insertion logic.
  const expected = [...model].sort(
    ([ka, va], [kb, vb]) =>
      (order === `key` ? 0 : order === `ascending` ? va - vb : vb - va) ||
      ka - kb,
  )
  expect(actual.size).toBe(model.size)
  expect([...actual]).toEqual(expected)
  expect([...actual.entries()]).toEqual(expected)
  expect([...actual.keys()]).toEqual(expected.map(([key]) => key))
  expect([...actual.values()]).toEqual(expected.map(([, value]) => value))
  const visited: Array<[number, number]> = []
  actual.forEach((value, key) => visited.push([key, value]))
  expect(visited).toEqual(expected)
  for (let key = -3; key <= 3; key++) {
    expect(actual.has(key)).toBe(model.has(key))
    expect(actual.get(key)).toBe(model.get(key))
  }
}

describe.each([`key`, `ascending`, `descending`] as const)(
  `SortedMap %s history`,
  (order) => {
    const property = {
      key: `sorted-map.key`,
      ascending: `sorted-map.ascending`,
      descending: `sorted-map.descending`,
    }[order]
    it.each([20260912, undefined])(
      `agrees with full recomputation (seed %s)`,
      async (seed) => {
        await fc.assert(
          fc.asyncProperty(
            fc.array(
              fc.record({
                kind: fc.constantFrom(`set`, `set`, `delete`, `clear`),
                key: fc.integer({ min: -3, max: 3 }),
                value: fc.integer({ min: -3, max: 3 }),
              }),
              { maxLength: 40 },
            ),
            (actions) => {
              const actual = new SortedMap<number, number>(
                order === `key`
                  ? undefined
                  : order === `ascending`
                    ? (a, b) => a - b
                    : (a, b) => b - a,
              )
              const model = new Map<number, number>()
              expectMap(actual, model, order)
              for (const action of actions) {
                if (action.kind === `set`) {
                  expect(actual.set(action.key, action.value)).toBe(actual)
                  model.set(action.key, action.value)
                } else if (action.kind === `delete`) {
                  expect(actual.delete(action.key)).toBe(
                    model.delete(action.key),
                  )
                } else {
                  actual.clear()
                  model.clear()
                }
                expectMap(actual, model, order)
              }
              return Promise.resolve()
            },
          ),
          {
            ...(seed === undefined
              ? oraclePropertyOptions(100, property)
              : { seed, numRuns: oracleRuns(100) }),
            examples: [
              [
                [
                  { kind: `set`, key: 1, value: 3 },
                  { kind: `set`, key: -1, value: 3 },
                  { kind: `set`, key: 1, value: -3 },
                  { kind: `delete`, key: -1, value: 0 },
                  { kind: `clear`, key: 0, value: 0 },
                  { kind: `set`, key: -1, value: 2 },
                ],
              ],
            ],
          },
        )
      },
    )
  },
)

it(`rejects wrong default ordering, missing tied entries, and stale overwrites`, () => {
  const byValue = new SortedMap<number, number>((a, b) => a - b)
  byValue.set(1, 3).set(-1, 4)
  expect(() =>
    expectMap(
      byValue,
      new Map([
        [1, 3],
        [-1, 4],
      ]),
      `key`,
    ),
  ).toThrow()
  const missingTie = new SortedMap<number, number>((a, b) => a - b)
  missingTie.set(1, 3)
  expect(() =>
    expectMap(
      missingTie,
      new Map([
        [1, 3],
        [-1, 3],
      ]),
      `ascending`,
    ),
  ).toThrow()
  const stale = new SortedMap<number, number>()
  stale.set(1, 3)
  expect(() => expectMap(stale, new Map([[1, 2]]), `key`)).toThrow()
})

describe(`SortedMap`, () => {
  it(`sorts by key by default, even when values have the opposite order`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 1)
    map.set(`a`, 3)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([3, 2, 1])
  })

  it(`works with custom comparator`, () => {
    // Create a map that sorts numbers in descending order
    const map = new SortedMap<string, number>((a, b) => b - a)
    map.set(`a`, 1)
    map.set(`c`, 3)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([3, 2, 1])
  })

  it(`correctly handles updates`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 3)
    map.set(`a`, 2) // update existing key

    expect(map.size).toBe(2)
    expect(map.get(`a`)).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([2, 3])
  })

  it(`correctly handles deletions`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)
    map.set(`c`, 3)

    map.delete(`b`)
    expect(map.size).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([1, 3])
  })

  it(`implements iteration methods correctly`, () => {
    const map = new SortedMap<string, number>()
    map.set(`b`, 2)
    map.set(`a`, 1)
    map.set(`c`, 3)

    // Test entries()
    const entries = Array.from(map.entries())
    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])

    // Test values()
    const values = Array.from(map.values())
    expect(values).toEqual([1, 2, 3])

    // Test forEach
    const forEachResults: Array<number> = []
    map.forEach((value) => forEachResults.push(value))
    expect(forEachResults).toEqual([1, 2, 3])
  })

  it(`orders string keys when no custom comparator is provided`, () => {
    const map = new SortedMap<string, string>()
    map.set(`c`, `charlie`)
    map.set(`a`, `alpha`)
    map.set(`b`, `bravo`)

    const values = Array.from(map.values())
    expect(values).toEqual([`alpha`, `bravo`, `charlie`])

    // Test with values that would be sorted differently by a custom comparator
    const numericMap = new SortedMap<string, string>()
    numericMap.set(`a`, `10`)
    numericMap.set(`b`, `2`)

    // Default string comparison will put '10' before '2'
    const numericValues = Array.from(numericMap.values())
    expect(numericValues).toEqual([`10`, `2`])
  })

  // Test for keys() method
  it(`provides keys in sorted order`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const keys = Array.from(map.keys())
    expect(keys).toEqual([`a`, `b`, `c`])
  })

  // Test for Symbol.iterator implementation
  it(`supports direct iteration with for...of`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const entries: Array<[string, number]> = []
    for (const entry of map) {
      entries.push(entry)
    }

    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])
  })

  // Test for clear method
  it(`clears all entries`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)

    map.clear()
    expect(map.size).toBe(0)
    expect(Array.from(map.entries())).toEqual([])
  })
})
