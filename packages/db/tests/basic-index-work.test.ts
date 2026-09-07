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
