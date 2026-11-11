// Preserve the premature-success shrinking and direct-replay control.
import { expect, it } from 'vitest'
import fc from 'fast-check'
import { oracleRoute } from './oracle-config.js'
import { expectHistoryOutcome } from './optimistic-history-oracle.js'

it(`shrinks and replays a premature success counterexample`, () => {
  oracleRoute(`calibration`)
  const property = fc.property(fc.integer({ min: 1, max: 100 }), (value) => {
    expectHistoryOutcome({ status: `pending` }, { status: `pending` }, `valid`)
    expectHistoryOutcome(
      { status: `fulfilled`, value },
      { status: `pending` },
      `fault`,
    )
  })
  const failed = fc.check(property, { seed: 851204 })
  expect(failed.failed).toBe(true)
  expect(failed.numShrinks).toBeGreaterThan(0)
  expect(failed.errorInstance).toMatchObject({ name: `AssertionError` })
  const replay = fc.check(property, {
    seed: failed.seed,
    path: failed.counterexamplePath!,
    endOnFailure: true,
  })
  expect(replay.failed).toBe(true)
  expect(replay.counterexample).toEqual(failed.counterexample)
  expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
})
