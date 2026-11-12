/**
 * The output-indexing grammar, model, and comparisons of
 * `custom-index-order-selection-oracle.test.ts`, moved unchanged so that the
 * checker calibration in `custom-index-order-selection-model.test.ts` can read
 * them. That oracle file states the law and its authority. This module
 * registers no tests.
 */
import { expect } from 'vitest'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import {
  expectedIndexing,
  indexConfigurations,
} from '../conformance/indexing-config-oracle.js'
import { oracleAssertion } from '../oracle-assertion-adapter.js'
import type { IndexSettings } from '../conformance/indexing-config-oracle.js'

export type MaterializedRow = {
  id: number
  rank: number | null
  score: number | null
}
export const configurations = indexConfigurations({
  indexTypes: { basic: BasicIndex, btree: BTreeIndex },
}).flatMap((settings) =>
  ([`direct`, `options`] as const).map((path) => ({ ...settings, path })),
)
export const orderedReads = [
  [`rank`, `first`],
  [`rank`, `last`],
  [`score`, `first`],
  [`score`, `last`],
  [`rank`, `first`],
] as const

// One automatic index serves each distinct ordered specification. Repeating a
// read or updating source rows must not allocate another index. Off admits no
// optimized reader until a caller explicitly creates an index.
export function expectedMaterializedIndexes(settings: IndexSettings) {
  const indexing = expectedIndexing(settings)
  return {
    optimized: indexing.mode === `eager`,
    count:
      indexing.automaticIndexes *
      new Set(orderedReads.map(([field, nulls]) => `${field}/${nulls}`)).size,
  }
}
export function expectMaterializedIndexes(
  count: number,
  settings: IndexSettings,
) {
  oracleAssertion(`expectMaterializedIndexes comparison 2`, () =>
    expect(count).toBe(expectedMaterializedIndexes(settings).count),
  )
}

// Full recomputation uses only the projected values and the declared null
// placement. Distinct non-null values avoid an unrelated tie-order promise.
export function expectedMaterializedWindow(
  values: ReadonlyArray<MaterializedRow>,
  field: `rank` | `score`,
  nulls: `first` | `last`,
) {
  return [...values]
    .sort((a, b) => {
      const left = a[field]
      const right = b[field]
      if (left === right) return 0
      if (left === null) return nulls === `first` ? -1 : 1
      if (right === null) return nulls === `first` ? 1 : -1
      return left - right
    })
    .slice(0, 2)
    .map(({ id }) => id)
}

export function expectMaterializedWindow(
  actual: unknown,
  values: ReadonlyArray<MaterializedRow>,
  field: `rank` | `score`,
  nulls: `first` | `last`,
  optimized = true,
) {
  oracleAssertion(`expectMaterializedWindow comparison 3`, () =>
    expect(actual).toEqual(
      optimized ? expectedMaterializedWindow(values, field, nulls) : undefined,
    ),
  )
}
