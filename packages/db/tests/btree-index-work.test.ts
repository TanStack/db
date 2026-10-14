import { describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'

describe(`BTree comparator-tie update work`, () => {
  it(`does not copy every owner when an exact value returns to a tie`, () => {
    const instant = Temporal.Instant.fromEpochNanoseconds(0n)
    const first = instant.toZonedDateTimeISO(`UTC`)
    const second = instant.toZonedDateTimeISO(`+14:00`)
    const additions = [16, 256].map((size) => {
      const index = new BTreeIndex<number>(1, new PropRef([`value`]))
      for (let key = 0; key < size; key++) {
        index.add(key, { value: first })
      }
      index.add(-1, { value: second })
      index.remove(-1, { value: second })

      const originalAdd = Set.prototype.add
      const add = vi.spyOn(Set.prototype, `add`).mockImplementation(function (
        this: Set<unknown>,
        value: unknown,
      ) {
        return originalAdd.call(this, value)
      })
      let calls = 0
      try {
        index.add(-1, { value: second })
        calls = add.mock.calls.length
      } finally {
        add.mockRestore()
      }
      expect(index.equalityLookup(first).size).toBe(size)
      expect(index.equalityLookup(second)).toEqual(new Set([-1]))
      expect(index.takeFromStart(1)).toEqual([-1])
      return calls
    })
    expect(additions[1]).toBeLessThanOrEqual(additions[0]! + 4)
  })
})

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
