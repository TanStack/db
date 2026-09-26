import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, expect, it } from 'vitest'
import { oraclePropertyOptions } from './oracle-config.js'

/**
 * Calibration fixture for the guarded replay protocol.
 *
 * Ordinary discovery runs one real positive property and one unrelated test.
 * A child process may inject exactly one fault: setup, property, unrelated test,
 * skip, zero runs, expected failure, precondition exhaustion, or wrong replay
 * coordinates. The parent uses these variants to prove it neither accepts a
 * false-green run nor rewrites fast-check's real failure.
 */
const fault = process.env.TANSTACK_DB_ORACLE_REPLAY_CALIBRATION
beforeEach(() => {
  if (fault === `setup`) throw new Error(`replay setup sentinel`)
})

const options = oraclePropertyOptions(
  fault === `zero` ? 0 : 3,
  `oracle-replay.calibration`,
)
if (fault === `seed`) options.seed = 43
if (fault === `path`) options.path = `1`
const propertyTest =
  fault === `skip` ? fcTest.skip : fault === `expected` ? fcTest.fails : fcTest
propertyTest.prop([fc.integer({ min: 0, max: 100 })], options)(
  `executes the replay calibration property`,
  (value) => {
    if (fault === `precondition`) fc.pre(false)
    if (fault === `property` || fault === `expected`)
      throw new Error(`replay property sentinel`)
    expect(value + 1).toBeGreaterThan(value)
  },
)

it(`executes an unrelated calibration assertion`, () => {
  if (fault === `unrelated`) throw new Error(`replay unrelated sentinel`)
  expect([1, 2].length).toBe(2)
})
