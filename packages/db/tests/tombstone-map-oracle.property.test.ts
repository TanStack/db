import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { TombstoneMap } from '../src/utils/tombstone-map'
import { oraclePropertyOptions } from './oracle-config'

/**
 * A TombstoneMap is a Map whose delete keeps the key's entry and marks it
 * deleted, so a key deleted and added again is written in place. Per-row
 * Collection and index state uses it because V8 rehashes a large Map on
 * that pattern.
 *
 * The law: after every operation, a TombstoneMap and a native Map given the
 * same operations agree on `get`, `has`, `size`, the result of `set` and
 * `delete`, and the set of entries that iteration, `keys`, `values` and
 * `forEach` visit. The one declared difference is order: a key added again
 * keeps the position of its first insertion, so entries are compared as
 * sets, not sequences.
 *
 * The native Map is the model. It shares no code with the implementation.
 * Histories draw keys from a small pool so deletes and re-adds of one key
 * are common. A separate lane deletes and re-adds more than the compaction
 * threshold of distinct keys, so compaction runs between observations, and
 * values include `undefined`, which a tombstone must not be confused with.
 */

type Op =
  | { type: `set`; key: number; value: number | undefined }
  | { type: `delete`; key: number }
  | { type: `clear` }

const op = (keys: number): fc.Arbitrary<Op> =>
  fc.oneof(
    {
      weight: 5,
      arbitrary: fc.record({
        type: fc.constant(`set` as const),
        key: fc.nat(keys - 1),
        value: fc.option(fc.integer(), { nil: undefined, freq: 8 }),
      }),
    },
    {
      weight: 4,
      arbitrary: fc.record({
        type: fc.constant(`delete` as const),
        key: fc.nat(keys - 1),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ type: `clear` as const }) },
  )

function apply(
  model: Map<number, number | undefined>,
  map: TombstoneMap<number, number | undefined>,
  step: Op,
): void {
  if (step.type === `set`) {
    expect(map.set(step.key, step.value)).toBe(map)
    model.set(step.key, step.value)
  } else if (step.type === `delete`) {
    expect(map.delete(step.key)).toBe(model.delete(step.key))
  } else {
    map.clear()
    model.clear()
  }
}

/** Observations follow the native Map: lookups, size, and entries as a set. */
function expectAgreement(
  model: Map<number, number | undefined>,
  map: TombstoneMap<number, number | undefined>,
  probes: number,
): void {
  for (let key = 0; key < probes; key++) {
    expect(map.has(key), `has ${key}`).toBe(model.has(key))
    expect(map.get(key), `get ${key}`).toBe(model.get(key))
  }
  expect(map.size).toBe(model.size)
  const byKey = (entries: Iterable<[number, unknown]>) =>
    [...entries].sort(([left], [right]) => left - right)
  expect(byKey(map)).toEqual(byKey(model))
  expect(byKey(map.entries())).toEqual(byKey(model))
  expect([...map.keys()].sort((a, b) => a - b)).toEqual(
    [...model.keys()].sort((a, b) => a - b),
  )
  expect(
    [...map.values()].sort((a, b) => (a ?? -Infinity) - (b ?? -Infinity)),
  ).toEqual(
    [...model.values()].sort((a, b) => (a ?? -Infinity) - (b ?? -Infinity)),
  )
  const visited: Array<[number, unknown]> = []
  map.forEach((value, key, owner) => {
    expect(owner).toBe(map)
    visited.push([key, value])
  })
  expect(byKey(visited)).toEqual(byKey(model))
}

describe(`TombstoneMap`, () => {
  it(`agrees with a native Map over generated histories`, () => {
    fc.assert(
      fc.property(fc.array(op(6), { maxLength: 60 }), (history) => {
        const model = new Map<number, number | undefined>()
        const map = new TombstoneMap<number, number | undefined>()
        for (const step of history) {
          apply(model, map, step)
          expectAgreement(model, map, 6)
        }
      }),
      oraclePropertyOptions(200),
    )
  })

  it(`agrees with a native Map across compaction`, () => {
    // 1,500 distinct deletions pass the 1,024-tombstone threshold while
    // tombstones outnumber the live keys that remain.
    fc.assert(
      fc.property(
        fc.integer({ min: 1100, max: 1600 }),
        fc.nat(50),
        fc.array(op(1700), { maxLength: 40 }),
        (deleted, kept, tail) => {
          const model = new Map<number, number | undefined>()
          const map = new TombstoneMap<number, number | undefined>()
          const total = deleted + kept
          for (let key = 0; key < total; key++) {
            apply(model, map, { type: `set`, key, value: key })
          }
          for (let key = 0; key < deleted; key++) {
            apply(model, map, { type: `delete`, key })
          }
          expectAgreement(model, map, 1700)
          for (const step of tail) apply(model, map, step)
          expectAgreement(model, map, 1700)
        },
      ),
      oraclePropertyOptions(20),
    )
  })
})
