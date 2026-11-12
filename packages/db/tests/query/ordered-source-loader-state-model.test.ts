// Checker calibration for ordered-source-loader-state-oracle.test.ts. It runs
// no production: a retirement start observed before the invalidation, or
// after public replacement, must fail the shared retirement-progress
// comparison. The law and the production comparisons are in that oracle file;
// the comparison is in ordered-source-loader-state-model-oracle.ts.
import { describe, expect, it } from 'vitest'
import { checkRetirementProgress } from './ordered-source-loader-state-model-oracle.js'

describe(`Ordered source request authority`, () => {
  // A start before the invalidation, or after public replacement, cannot
  // discharge the debt. These adversarial observations calibrate the same
  // relation used by both consumers and the request ledger.
  it.each([`before-invalidation`, `after-publication`] as const)(
    `rejects a retirement start observed %s`,
    (fault) => {
      const startedAt = fault === `before-invalidation` ? 1 : 4
      expect(() => checkRetirementProgress(2, [startedAt], 4)).toThrow(
        `retirement invalidation`,
      )
    },
  )
})
