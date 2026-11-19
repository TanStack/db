// Calibrations of the distinct oracles' shared checkers. Each test hands a
// wrong snapshot or an invented representative straight to the checker and
// requires it to reject the input; no production operator runs. The
// production campaigns are in distinct-incrementalization-oracle.property.test.ts
// and distinct-representative-oracle.property.test.ts.
import { expect, it } from 'vitest'
import { hash } from '../src/hashing/hash.js'
import {
  checkDistinctRepresentatives,
  checkDistinctSnapshot,
  distinctCollisionValues,
} from './distinct-incrementalization-oracle.js'
import type { DistinctValue } from './distinct-incrementalization-oracle.js'
import type { Weighted } from './incrementalization-law-oracle.js'

it(`rejects omitted, duplicate and wrong-member snapshots`, () => {
  const values = distinctCollisionValues(hash)
  const input: Weighted<DistinctValue> = values.map((value) => [value, 1])
  for (const bad of [
    values.slice(1),
    [...values, values[0]!],
    [values[0]!, values[0]!, values[2]!],
  ])
    expect(() => checkDistinctSnapshot(bad, input, 0)).toThrow(
      /snapshot diverged/,
    )
})

// Checker calibration supplies a wrong observation to the same refinement
// check. Correct selected membership alone cannot authorize invented payloads.
it(`rejects a representative absent from source inputs`, () => {
  const source = [{ member: 0, variant: 0 }]
  expect(() =>
    checkDistinctRepresentatives(
      [[[0, { member: 0, variant: 999 }], 1]],
      source,
      source,
      `fabricated representative`,
    ),
  ).toThrow(/distinct representative contribution diverged/)
})
