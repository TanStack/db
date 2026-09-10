import { describe, expect, it } from 'vitest'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'

describe(`BTree exact-bucket ownership work`, () => {
  it.each(
    [300, 100000].flatMap((size) =>
      [1, 2].map((groupSize) => ({ size, groupSize })),
    ),
  )(
    `reuses comparator buckets for $size keys with $groupSize exact values per position`,
    ({ size, groupSize }) => {
      let comparisons = 0
      const index = new BTreeIndex<number>(
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
      const distinct = 3 * groupSize
      // Keep one owner of every exact value throughout the measured batch.
      for (let value = 0; value < distinct; value++)
        index.add(-value - 1, { value })
      comparisons = 0
      for (let key = 0; key < size; key++)
        index.add(key, { value: key % distinct })
      const insertComparisons = comparisons
      comparisons = 0
      for (let key = 0; key < size; key++)
        index.remove(key, { value: key % distinct })
      const removeComparisons = comparisons
      expect(index.keyCount).toBe(distinct)
      for (let value = 0; value < distinct; value++) {
        expect(index.lookup(`eq`, value)).toEqual(new Set([-value - 1]))
      }
      expect(insertComparisons).toBe(0)
      expect(removeComparisons).toBe(0)
    },
  )
})
