// A census of the Index refinement oracle's grammar. It samples the fixed
// campaign of index-refinement-oracle.property.test.ts (the same seed and run
// count) and counts histories that reach a cancelled NaN-prefixed value
// beside other values. It runs no production code, so it tests the grammar.
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { oracleFixedSeed } from '../../db/tests/oracle-config.js'
import { historyArbitrary } from './index-refinement-grammar-oracle.js'

describe(`Index refinement oracle`, () => {
  // Positive execution witness: generated histories reach a NaN prefix that
  // cancels after another value joined its key.
  it(`reaches cancelled NaN-prefixed values beside other values`, () => {
    const sample = fc.sample(
      historyArbitrary,
      oracleFixedSeed(20260930, { numRuns: 300 }),
    )
    const reached = sample.filter((additions) =>
      additions.some(
        (addition, step) =>
          Array.isArray(addition.value) &&
          Number.isNaN(addition.value[0]) &&
          addition.multiplicity < 0 &&
          additions
            .slice(0, step)
            .some((earlier) => earlier.value !== addition.value),
      ),
    )
    expect(reached.length).toBeGreaterThan(10)
  })
})
