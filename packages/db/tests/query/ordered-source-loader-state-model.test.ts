// Checker calibration for ordered-source-loader-state-oracle.test.ts. It runs
// no production: a retirement start observed before the invalidation, or
// after public replacement, must fail the shared retirement-progress
// comparison. The law and the production comparisons are in that oracle file;
// the comparison is in ordered-source-loader-state-model-oracle.ts.
import { describe, expect, it } from 'vitest'
import { checkRetirementProgress } from './ordered-source-loader-state-model-oracle.js'

describe(`Ordered source request authority`, () => {
  // The same relation judges a start before the invalidation, or at or
  // after the replacement publication, in both receivers and the ledger.
  it.each([
    { position: `before invalidation`, startedAt: 1 },
    { position: `at invalidation`, startedAt: 2 },
    { position: `at publication`, startedAt: 4 },
    { position: `after publication`, startedAt: 5 },
  ])(`rejects a retirement start observed $position`, ({ startedAt }) => {
    expect(() => checkRetirementProgress(2, [startedAt], 4)).toThrow(
      `retirement invalidation`,
    )
  })
})
