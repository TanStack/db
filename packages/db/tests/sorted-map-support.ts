import { expect } from 'vitest'
import type { SortedMap } from '../src/SortedMap'

/**
 * Comparison shared by SortedMap-oracle.test.ts and SortedMap.test.ts. expectMap
 * states the SortedMap law: an observed view must refine a full recomputation of
 * a plain Map model. Rows compare by rank, so one check serves row objects from
 * the oracle driver and plain numbers in unit examples.
 */

export type Order = `key` | `ascending` | `descending`

// Production stores row objects so the driver can change one in place. The
// model stores each row's rank as a number and never shares an object.
export type Row = { rank: number }

export type ModelKey = number

const probeKeys: Array<ModelKey> = [
  -3,
  -2,
  -1,
  0,
  1,
  2,
  3,
  Number.NaN,
  10,
  26,
  50,
]

// The generated keys are numbers, which key order sorts ascending with `NaN`
// after every other number.
const compareModelKeys = (a: ModelKey, b: ModelKey) =>
  Number.isNaN(a) || Number.isNaN(b)
    ? Number(Number.isNaN(a)) - Number(Number.isNaN(b))
    : a - b

export function modelOrder(model: Map<ModelKey, number>, order: Order) {
  return [...model].sort(
    ([ka, va], [kb, vb]) =>
      (order === `key` ? 0 : order === `ascending` ? va - vb : vb - va) ||
      compareModelKeys(ka, kb),
  )
}

const byKey = (entries: Array<[ModelKey, number]>) =>
  [...entries].sort(([a], [b]) => compareModelKeys(a, b))

// Compare one observed view with the model. Without the order promise, the
// view must still hold each key once with its current value.
export function expectView(
  actual: Array<[ModelKey, number]>,
  expected: Array<[ModelKey, number]>,
  orderPromised: boolean,
) {
  if (orderPromised) expect(actual).toEqual(expected)
  else expect(byKey(actual)).toEqual(byKey(expected))
}

function rankOf(value: Row | number | undefined): number {
  return (typeof value === `number` ? value : value?.rank) as number
}

export function expectMap<V extends Row | number>(
  actual: SortedMap<number, V>,
  model: Map<ModelKey, number>,
  order: Order,
  orderPromised = true,
) {
  // Recompute from a plain Map; do not copy SortedMap's binary insertion logic.
  const expected = modelOrder(model, order)
  const ranks = (entries: Iterable<[number, V]>) =>
    // A stale slot reads no row; keep it visible to the comparison.
    [...entries].map(([key, value]): [ModelKey, number] => [key, rankOf(value)])
  expect(actual.size).toBe(model.size)
  expectView(ranks(actual), expected, orderPromised)
  expectView(ranks(actual.entries()), expected, orderPromised)
  const values = [...actual.values()]
  expectView(
    [...actual.keys()].map((key, index) => [key, rankOf(values[index])]),
    expected,
    orderPromised,
  )
  for (const key of probeKeys) {
    expect(actual.has(key)).toBe(model.has(key))
    expect(rankOf(actual.get(key))).toBe(model.get(key))
  }
}
