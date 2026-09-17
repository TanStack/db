import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, expect, it } from 'vitest'
import { oraclePropertyOptions } from './oracle-config.js'

// Ordinary discovery runs a real positive property and an unrelated assertion.
// Only subprocess calibration chooses a fault, skip, or zero-run variant.
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
