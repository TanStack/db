// Preserve the premature-success shrinking and direct-replay control. The
// outcome-observer calibrations below run no production: they hand built
// outcomes and test-helper promises to the shared outcome checker.
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createDeferred } from '../src/deferred.js'
import { oracleRoute } from './oracle-config.js'
import {
  expectHistoryOutcome,
  observeHistoryPromise,
  withHistoryCleanup,
} from './optimistic-history-oracle.js'
import type { HistoryOutcome } from './optimistic-history-oracle.js'

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

describe(`Outcome observer calibration`, () => {
  it.each([
    `early-success`,
    `wrong-value`,
    `wrong-error`,
    `missing-error`,
    `receipt-error`,
  ] as const)(
    `rejects %s through the actual outcome checker`,
    async (fault) => {
      const value = { id: 1 }
      const error = new Error(`original`)
      let expected: HistoryOutcome<unknown>
      let bad: HistoryOutcome<unknown>
      if (fault === `early-success`) {
        expected = { status: `pending` }
        bad = { status: `fulfilled`, value }
      } else if (fault === `wrong-value`) {
        expected = { status: `fulfilled`, value }
        bad = { status: `fulfilled`, value: { ...value } }
      } else if (fault === `receipt-error`) {
        expected = { status: `fulfilled`, value: undefined }
        bad = { status: `rejected`, reason: error }
      } else {
        expected = { status: `rejected`, reason: error }
        bad = {
          status: `rejected`,
          reason: fault === `wrong-error` ? new Error(`original`) : undefined,
        }
      }
      expectHistoryOutcome(expected, expected, `valid neighbor`)
      expect(() => expectHistoryOutcome(bad, expected, fault)).toThrowError(
        expect.objectContaining({ name: `AssertionError` }),
      )
      const gate = createDeferred<unknown>()
      const observed = observeHistoryPromise(gate.promise)
      expectHistoryOutcome(
        observed.read(),
        { status: `pending` },
        `before settlement`,
      )
      if (expected.status === `rejected`) gate.reject(error)
      else gate.resolve(value)
      await observed.settled
      expectHistoryOutcome(
        observed.read(),
        expected.status === `rejected`
          ? expected
          : { status: `fulfilled`, value },
        `after settlement`,
      )
    },
  )
  it(`preserves successful results and single errors without wrappers`, async () => {
    const value = { id: 1 }
    expect(
      await withHistoryCleanup(
        () => Promise.resolve(value),
        () => [() => {}],
      ),
    ).toBe(value)
    const error = Object.freeze(new Error(`single`))
    for (const fromCleanup of [false, true]) {
      const observed = observeHistoryPromise(
        withHistoryCleanup(
          () => (fromCleanup ? Promise.resolve(value) : Promise.reject(error)),
          () => [
            () => {
              if (fromCleanup) throw error
            },
          ],
        ),
      )
      await observed.settled
      expectHistoryOutcome(
        observed.read(),
        { status: `rejected`, reason: error },
        `single error`,
      )
    }
  })
})
