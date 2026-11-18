// Preserve the original retired-identity shrinking and direct-replay control.
import { expect, test } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleRoute } from './oracle-config'
import { expectExactIdentities } from './index-identity-oracle'

test(`retired-identity calibration shrinks and replays the same semantic failure`, () => {
  oracleRoute(`calibration`)
  const property = fc.property(
    fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }),
    (keys) => {
      const identity = {}
      expectExactIdentities(
        { equalityLookup: () => new Set(keys.map(String)) },
        [],
        [identity],
      )
    },
  )
  const failed = fc.check(property, { seed: 303108, numRuns: 1 })
  expect(failed.failed).toBe(true)
  expect(String(failed.errorInstance)).toMatch(/expected/)
  expect(failed.counterexample).toEqual([[0]])
  expect(failed.counterexamplePath).toBe(`0:0:0`)
  if (failed.counterexamplePath === null)
    throw new Error(`Missing calibration replay path`)
  const replay = fc.check(property, {
    seed: failed.seed,
    path: failed.counterexamplePath,
    numRuns: 1,
    endOnFailure: true,
  })
  expect(replay.failed).toBe(true)
  expect(String(replay.errorInstance)).toMatch(/expected/)
  expect(replay.counterexample).toEqual(failed.counterexample)
})
