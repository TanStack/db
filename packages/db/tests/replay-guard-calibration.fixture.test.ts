import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, expect, it } from 'vitest'
import { oraclePropertyOptions } from './oracle-config.js'

/**
 * Calibration fixture for the guarded replay protocol.
 *
 * Ordinary discovery runs one real positive property and one unrelated test.
 * A child process may inject exactly one fault: setup, property, unrelated test,
 * skip, zero runs, expected failure, precondition exhaustion, or wrong replay
 * coordinates. The `sync` variant registers the property as a synchronous
 * fast-check property, which the guarded runner witnesses in its synchronous
 * mode. The parent uses these variants to prove it neither accepts a
 * false-green run nor rewrites fast-check's real failure.
 */
const fault = process.env.TANSTACK_DB_ORACLE_REPLAY_CALIBRATION
beforeEach(() => {
  if (fault === `setup`) throw new Error(`replay setup sentinel`)
})

// A path replay runs once, so the zero-run fault overrides the run count
// after the replay options are chosen, like the seed and path faults.
const options = oraclePropertyOptions(3, `oracle-replay.calibration`)
if (fault === `zero`) options.numRuns = 0
if (fault === `seed`) options.seed = 43
if (fault === `path`) options.path = `1`
const propertyTest =
  fault === `skip` ? fcTest.skip : fault === `expected` ? fcTest.fails : fcTest
fcTest.prop([fc.constant(1)], { numRuns: 1, seed: 20260930 })(
  `runs an unrelated fixed campaign`,
  () => {
    if (process.env.TANSTACK_DB_ORACLE_REPLAY_WITNESS !== undefined)
      process.stdout.write(`unrelated fixed campaign ran\n`)
  },
)
if (fault === `sync`) {
  it(`executes the replay calibration property`, () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (value) => {
        expect(value + 1).toBeGreaterThan(value)
      }),
      options,
    )
  })
} else {
  propertyTest.prop([fc.integer({ min: 0, max: 100 })], options)(
    `executes the replay calibration property`,
    (value) => {
      if (fault === `precondition`) fc.pre(false)
      if (fault === `property` || fault === `expected`)
        throw new Error(`replay property sentinel`)
      expect(value + 1).toBeGreaterThan(value)
    },
  )
}

it(`executes an unrelated calibration assertion`, () => {
  if (fault === `unrelated`) throw new Error(`replay unrelated sentinel`)
  expect([1, 2].length).toBe(2)
})
