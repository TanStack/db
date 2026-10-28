// Unit tests for the rank-tie probe classifier that the optimistic ordered
// refetch oracle uses. The law (a boundary probe must select one rank) is owned
// by optimistic-ordered-refetch-oracle.test.ts.
import { expect, it } from 'vitest'
import { isNarrowRankTieProbe } from './optimistic-ordered-refetch-probe.js'
import type { Row } from './optimistic-ordered-refetch-probe.js'

it(`rejects an unordered page cap as a rank-tie probe`, () => {
  const remote: Array<Row> = [1, 2, 3].map((id) => ({
    id,
    folder: `inbox`,
    at: id,
  }))
  expect(isNarrowRankTieProbe({ limit: 1 }, remote)).toBe(false)
  expect(isNarrowRankTieProbe({}, [])).toBe(false)
})
