// Checker calibration for the React descriptor start and release oracle: a
// hand-built multi-source observation, with no production render, must fail
// checkDescriptorStart for each planted fault. Moved unchanged from
// descriptor-start-release-oracle.test.tsx, which registers only
// oracleProperty tests.
import { expect, it } from 'vitest'
import {
  checkDescriptorStart,
  expectedDescriptorStart,
} from '../../db/tests/descriptor-start-release-oracle'

it.each([
  `blocked-peer`,
  `duplicate-start`,
  `leaked-resource`,
  `wrong-row`,
] as const)(`rejects wrong multi-source release observation: %s`, (fault) => {
  const history = { acquired: 3, failedStarts: 3, eagerStarts: 7 }
  const actual = expectedDescriptorStart(history, `cleaned`)
  checkDescriptorStart(actual, history, `cleaned`)
  if (fault === `blocked-peer`) actual.starts[2] = 0
  if (fault === `duplicate-start`) actual.starts[2] = actual.starts[2]! + 1
  if (fault === `leaked-resource`) actual.cleanups[2] = 0
  if (fault === `wrong-row`) actual.rows[2] = [{ id: `bad`, value: `bad` }]
  expect(() => checkDescriptorStart(actual, history, `cleaned`)).toThrow()
})
