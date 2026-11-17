/**
 * These are the original constructive inputs for copied/changed ring equality
 * and fresh-key inequality in utils-oracle.property.test.ts. The ordinary
 * checker runner also uses them to retain its fixed-campaign and shrink/replay
 * controls. This module changes neither grammar and supplies no new judgment.
 */
import { fc } from '@fast-check/vitest'
import { edgeCarriers } from './deep-equals-support'

export const arbitraryExtraProperty = fc
  .tuple(
    fc.dictionary(fc.string(), fc.integer(), { minKeys: 1, maxKeys: 5 }),
    fc.string(),
    fc.integer(),
  )
  .map(([original, keyHint, value]) => {
    let key = keyHint
    // Also avoid inherited names; this stays valid when the hint shrinks to an
    // existing key or names such as __proto__ and constructor.
    while (key in original) key += `_`
    return { original, key, value }
  })

// Legal rings have 1–5 reachable nodes, integer payloads, and one of four
// native edge carriers at each node. A zero-node ring has no root and is
// excluded. utils.test.ts retains the fixed pair enumeration for every ordered
// two-carrier overlap and the length cases at the lower and upper bounds.
export const ringArbitrary = fc.array(
  fc.record({
    value: fc.integer(),
    carrier: fc.constantFrom(...edgeCarriers),
  }),
  { minLength: 1, maxLength: 5 },
)

// The ordinary checker controls consume these original parameters. Keeping
// them with the shared grammar preserves source-level run-budget tracking.
export const ringNoSkipsCampaign = { seed: 101301, numRuns: 100 }
export const ringComparatorCalibration = { seed: 101302, numRuns: 10 }
