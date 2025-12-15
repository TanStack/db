import { beforeEach, describe, expect, it } from "vitest"
import { MultiSet } from "../src/multiset.js"

describe(`MultiSet`, () => {
  describe(`basic operations`, () => {
    let a: MultiSet<[string, string | Array<string>]>
    let b: MultiSet<[string, string | Array<string>]>

    beforeEach(() => {
      a = new MultiSet<[string, string | Array<string>]>([
        [[`apple`, `$5`], 2],
        [[`banana`, `$2`], 1],
      ])
      b = new MultiSet<[string, string | Array<string>]>([
        [[`apple`, `$3`], 1],
        [[`apple`, [`granny smith`, `$2`]], 1],
        [[`kiwi`, `$2`], 1],
      ])
    })

    it(`should concatenate two multisets`, () => {
      const concat = a.concat(b)
      expect(concat.getInner()).toEqual([
        [[`apple`, `$5`], 2],
        [[`banana`, `$2`], 1],
        [[`apple`, `$3`], 1],
        [[`apple`, [`granny smith`, `$2`]], 1],
        [[`kiwi`, `$2`], 1],
      ])
    })

    it(`should filter elements`, () => {
      const filtered = a.filter((data) => data[0] !== `apple`)
      expect(filtered.getInner()).toEqual([[[`banana`, `$2`], 1]])
    })

    it(`should map elements`, () => {
      const mapped = a.map((data) => [data[1], data[0]])
      expect(mapped.getInner()).toEqual([
        [[`$5`, `apple`], 2],
        [[`$2`, `banana`], 1],
      ])
    })
  })

  it(`should handle negative multiplicities correctly`, () => {
    const a = new MultiSet([[1, 1]])
    const b = new MultiSet([[1, -1]])
    const result = a.concat(b).consolidate()
    expect(result.getInner()).toHaveLength(0)
  })

  it(`should consolidate simple string values`, () => {
    // Create a multiset with duplicate string values that need consolidation
    const stringSet = new MultiSet<string>([
      [`a`, 1],
      [`a`, 2],
      [`b`, 3],
      [`b`, 1],
      [`c`, 1],
    ])

    const consolidated = stringSet.consolidate()

    // After consolidation, duplicates should be combined
    expect(consolidated.getInner()).toEqual([
      [`a`, 3],
      [`b`, 4],
      [`c`, 1],
    ])
  })

  it(`should consolidate simple number values`, () => {
    // Create a multiset with duplicate number values that need consolidation
    const numberSet = new MultiSet<number>([
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [3, 1],
    ])

    const consolidated = numberSet.consolidate()

    // After consolidation, duplicates should be combined
    expect(consolidated.getInner()).toEqual([
      [1, 5],
      [2, 3],
      [3, 1],
    ])
  })

  it(`should consolidate mixed string and number values`, () => {
    // Create a multiset with mixed types that will require JSON stringification
    const mixedSet = new MultiSet<string | number>([
      [1, 2],
      [`1`, 3],
      [1, 1],
      [`1`, 2],
    ])

    const consolidated = mixedSet.consolidate()

    // After consolidation, the number 1 and string '1' should remain separate
    expect(consolidated.getInner()).toEqual([
      [1, 3],
      [`1`, 5],
    ])
  })
})
