import { describe, expect, it, vi } from 'vitest'
import { BasicIndex } from '../src/indexes/basic-index'
import { PropRef } from '../src/query/ir'

describe(`BasicIndex removal work`, () => {
  it.each([1, 4])(
    `searches only the comparator group of size %s`,
    (groupSize) => {
      const size = 1024
      let comparisons = 0
      let scanned = 0
      const index = new BasicIndex<number>(
        1,
        new PropRef([`value`]),
        undefined,
        {
          compareFn: (a: number, b: number) => {
            comparisons++
            return Math.floor(a / groupSize) - Math.floor(b / groupSize)
          },
        },
      )
      for (let value = 0; value < size; value++) index.add(value, { value })
      const target = size - groupSize
      const findIndex = Array.prototype.findIndex
      const spy = vi
        .spyOn(Array.prototype, `findIndex`)
        .mockImplementation(function (
          this: Array<unknown>,
          predicate,
          thisArg,
        ) {
          return findIndex.call(this, (value, position, array) => {
            scanned++
            return predicate.call(thisArg, value, position, array)
          })
        })
      comparisons = 0
      try {
        index.remove(target, { value: target })
      } finally {
        spy.mockRestore()
      }
      expect(scanned + comparisons).toBeLessThanOrEqual(
        Math.ceil(Math.log2(size)) + groupSize + 1,
      )
      expect(index.lookup(`eq`, target).size).toBe(0)
      for (let value = target + 1; value < size; value++) {
        expect(index.lookup(`eq`, value)).toEqual(new Set([value]))
      }
    },
  )
})

describe(`BasicIndex page filtering work`, () => {
  it.each(
    [30, 3000, 100000].flatMap((size) =>
      [false, true].flatMap((reverse) =>
        [1, 3].map((stride) => ({ size, reverse, stride })),
      ),
    ),
  )(
    `filters only visited keys: $size rows, reverse=$reverse, stride=$stride`,
    ({ size, reverse, stride }) => {
      const index = new BasicIndex<number>(1, new PropRef([`value`]))
      const rows = Array.from({ length: size }, (_, id) => ({
        id,
        value: id % 3,
      }))
      // Deliberately insert backwards; insertion order is not key order.
      for (const row of [...rows].reverse()) index.add(row.id, row)
      const ordered = rows
        .slice()
        .sort((a, b) => a.value - b.value || a.id - b.id)
      if (reverse) ordered.reverse()
      let calls = 0
      const accept = (key: number) => Math.floor(key / 3) % stride === 0
      const expected = ordered
        .filter((row) => accept(row.id))
        .slice(0, 10)
        .map((row) => row.id)
      const filter = (key: number) => {
        calls++
        return accept(key)
      }
      const actual = reverse
        ? index.takeReversedFromEnd(10, filter)
        : index.takeFromStart(10, filter)
      expect(actual).toEqual(expected)
      const visits =
        expected.length === 10
          ? ordered.findIndex((row) => row.id === expected[9]) + 1
          : size
      expect(calls).toBe(visits)
    },
  )
})
