// Ordinary consolidation tests: the detector that a replaced input record
// changes the contents encoding. The encoding is the oracle's own snapshot
// machinery, so this self-test reaches no declared part.
// multiset-consolidate-oracle.property.test.ts owns the consolidation law.
import { describe, expect, it } from 'vitest'
import { contentsOf } from './multiset-support.js'
import type { Data } from './multiset-support.js'
import type { MultiSetArray } from '../src/multiset.js'

describe(`MultiSet consolidation oracle`, () => {
  it(`detects replacement of an input value with equal contents`, () => {
    const records: MultiSetArray<Data> = [[[0, { v: 1 }], 1]]
    const ids = new Map<object | symbol, number>()
    const inputContents = contentsOf(records, ids)
    ;(records[0]![0] as [number, Data])[1] = { v: 1 }
    expect(contentsOf(records, ids)).not.toBe(inputContents)
  })
})
