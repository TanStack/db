// Checker calibration for the React source ID reuse release law: a
// hand-built release observation, with no production render, passes
// checkReleaseObservation, and each planted fault makes it throw. Moved
// unchanged from source-id-reuse-oracle.test.tsx, which registers only
// oracleProperty tests.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import {
  checkReleaseObservation,
  expectedReleaseObservation,
} from './source-id-reuse-release-oracle'

it.each([
  `missing-start`,
  `extra-start`,
  `wrong-row`,
  `duplicate-row`,
] as const)(`rejects wrong descriptor release observation: %s`, (fault) => {
  const expected = expectedReleaseObservation({
    id: `one`,
    value: `authored`,
    rank: 2,
  })
  const actual = { ...expected, rows: expected.rows.map((row) => ({ ...row })) }
  oracleAssertion('checkReleaseObservation', () =>
    checkReleaseObservation(actual, expected),
  )
  if (fault === `missing-start`) actual.starts = 0
  if (fault === `extra-start`) actual.starts = 2
  if (fault === `wrong-row`) actual.rows[0]!.rank++
  if (fault === `duplicate-row`) actual.rows.push({ ...actual.rows[0]! })
  oracleAssertion(
    'expect(() => checkReleaseObservation(actual, expected)).toThrow()',
    () =>
      expect(() =>
        oracleAssertion('checkReleaseObservation', () =>
          checkReleaseObservation(actual, expected),
        ),
      ).toThrow(),
  )
})
