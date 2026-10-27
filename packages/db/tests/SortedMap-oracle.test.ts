import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { SortedMap } from '../src/SortedMap'
import { oraclePropertyOptions, oracleRuns } from './oracle-config'
import { declareOracle } from './oracle-declaration'

/**
 * SortedMap is an ordered view over ordinary map semantics.
 *
 * The contract has two independent parts. Keys still have Map ownership:
 * setting a key replaces its value, deleting reports whether the key existed,
 * and clearing removes everything. Iteration then presents the surviving
 * entries in either key order or the caller's value order. Equal values use
 * key order as a stable tie-breaker, so no entry disappears inside a tie.
 * Deferred writes may postpone ordering within one synchronous batch, but
 * point reads remain current and ordered reads restore the same view.
 *
 * The reference model is deliberately dull: a native Map owns the values and
 * a fresh full sort derives every observation. The production structure may
 * update its ordered index incrementally, but it must refine that recomputation
 * after every generated command. The driver observes size, point lookup, every
 * iterator, and forEach; checking only the final values would miss stale keys,
 * lost ties, and inconsistent views of the same state.
 */

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

declareOracle({ check: [expectMap] })

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
                deferOrder: fc.boolean(),
                observe: fc.boolean(),
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
                  expect(
                    actual.set(action.key, action.value, action.deferOrder),
                  ).toBe(actual)
                  model.set(action.key, action.value)
                } else if (action.kind === `delete`) {
                  expect(actual.delete(action.key, action.deferOrder)).toBe(
                    model.delete(action.key),
                  )
                } else {
                  actual.clear()
                  model.clear()
                }
                expect(actual.size).toBe(model.size)
                expect(actual.has(action.key)).toBe(model.has(action.key))
                expect(actual.get(action.key)).toBe(model.get(action.key))
                if (
                  action.kind === `clear` ||
                  !action.deferOrder ||
                  action.observe
                )
                  expectMap(actual, model, order)
              }
              expectMap(actual, model, order)
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
                  {
                    kind: `set`,
                    key: 1,
                    value: 3,
                    deferOrder: true,
                    observe: false,
                  },
                  {
                    kind: `set`,
                    key: -1,
                    value: 3,
                    deferOrder: true,
                    observe: false,
                  },
                  {
                    kind: `set`,
                    key: 1,
                    value: -3,
                    deferOrder: false,
                    observe: true,
                  },
                  {
                    kind: `delete`,
                    key: -1,
                    value: 0,
                    deferOrder: true,
                    observe: false,
                  },
                  {
                    kind: `clear`,
                    key: 0,
                    value: 0,
                    deferOrder: false,
                    observe: true,
                  },
                  {
                    kind: `set`,
                    key: -1,
                    value: 2,
                    deferOrder: true,
                    observe: true,
                  },
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
  it.each([`key`, `ascending`, `descending`] as const)(
    `keeps exact order after deferred %s inserts, reorders, and deletes`,
    (order) => {
      const map = new SortedMap<number, number>(
        order === `key`
          ? undefined
          : order === `ascending`
            ? (a, b) => a - b
            : (a, b) => b - a,
      )
      const model = new Map<number, number>()
      for (let key = 255; key >= 0; key--) {
        map.set(key, key % 17, true)
        model.set(key, key % 17)
      }
      expectMap(map, model, order)
      for (let key = 0; key < 256; key += 5) {
        map.set(key, -key, true)
        model.set(key, -key)
      }
      expectMap(map, model, order)
      for (let key = 0; key < 256; key += 7) {
        expect(map.delete(key, true)).toBe(model.delete(key))
      }
      expectMap(map, model, order)
    },
  )
})
