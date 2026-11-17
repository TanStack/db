// Checker calibration for custom-index-order-selection-oracle.test.ts. It
// runs no production: an extra index and the opposite optimized-read
// availability must be rejected by the output-indexing comparisons. The law
// and the production comparison are in that oracle file; the grammar, model,
// and comparisons are in custom-index-order-selection-model-oracle.ts.
import { expect, it } from 'vitest'
import { expectedIndexing } from '../conformance/indexing-config-oracle.js'
import {
  configurations,
  expectMaterializedIndexes,
  expectMaterializedWindow,
  expectedMaterializedIndexes,
  expectedMaterializedWindow,
} from './custom-index-order-selection-model-oracle.js'
import type { MaterializedRow } from './custom-index-order-selection-model-oracle.js'

// Calibrate the policy comparisons independently of a production path: an
// extra index and the opposite optimized-read availability must be rejected.
it.each(
  configurations.filter((settings) => !expectedIndexing(settings).rejects),
)(`rejects wrong output-indexing observations: %j`, (settings) => {
  const expected = expectedMaterializedIndexes(settings)
  expect(() =>
    expectMaterializedIndexes(expected.count + 1, settings),
  ).toThrow()
  const values: Array<MaterializedRow> = [
    { id: 1, rank: 3, score: 1 },
    { id: 2, rank: null, score: 3 },
    { id: 3, rank: 1, score: null },
  ]
  const wrong = expected.optimized
    ? undefined
    : expectedMaterializedWindow(values, `rank`, `first`)
  expect(() =>
    expectMaterializedWindow(
      wrong,
      values,
      `rank`,
      `first`,
      expected.optimized,
    ),
  ).toThrow()
})
