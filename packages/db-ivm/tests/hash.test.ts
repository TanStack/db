// Ordinary hash tests: a key-order case with holes and extra keys, and the
// calibration of the equal-hash assertion. hash-oracle.property.test.ts owns
// the hash laws and declares the key-order check.
import { describe, expect, it } from 'vitest'
import { expectEqualHashes } from './hash-support.js'

describe(`hash property-based tests`, () => {
  describe(`property order independence`, () => {
    it(`hashes an array with holes and extra keys the same in any key order`, () => {
      // Only a dense array keeps its index order unsorted; this one sorts.
      const first = [] as unknown as Array<number> & Record<string, number>
      first.length = 4
      first[1] = 1
      first[3] = 3
      first.x = 1
      first.y = 2
      const second = [] as unknown as Array<number> & Record<string, number>
      second.length = 4
      second[1] = 1
      second[3] = 3
      second.y = 2
      second.x = 1
      expectEqualHashes(first, second)
    })
  })

  describe(`law checker calibration`, () => {
    it.each([0, 42, ``, `reconstructed`])(
      `rejects inconsistent equal-value hashes for %j`,
      (value) => {
        let calls = 0
        expect(() => expectEqualHashes(value, value, () => ++calls)).toThrow()
        expect(calls).toBe(2)
        expectEqualHashes(value, value)
      },
    )
  })
})
