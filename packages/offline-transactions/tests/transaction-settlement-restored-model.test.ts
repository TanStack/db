// Calibrates the restored-snapshot comparison against hand-built wrong
// observations. These are checker inputs, not production histories, so they
// live outside the oracle; the oracle in
// transaction-settlement-oracle.property.test.ts judges production with the
// same model and comparison.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import {
  checkRestoredState,
  expectedRestoredState,
} from './transaction-settlement-restored-model-oracle'
import type { RestoredHistory } from './transaction-settlement-restored-model-oracle'

// These are checker inputs, not alternate production histories. All expected
// answers come from the same prefix fold as the real restoration receiver.
it.each([
  `extra-error`,
  `extra-warning`,
  `leaked-pending`,
  `stale-waiter`,
  `resurrect-failed`,
  `early-peer`,
  `missing-row`,
] as const)(`rejects a wrong restored observation: %s`, (fault) => {
  const history: RestoredHistory = {
    layout: `shared`,
    width: 2,
    succeeds: [false, true, true],
  }
  const failures = history.succeeds.map(() => new Error(`provider failure`))
  const expected = expectedRestoredState(history, failures, 1)
  const actual = {
    ...expected,
    rows: [...expected.rows],
    states: [...expected.states],
    outcomes: [...expected.outcomes],
  }
  checkRestoredState(actual, expected)
  if (fault === `extra-error`) actual.errors = [[new Error(`cleanup failed`)]]
  if (fault === `extra-warning`)
    actual.warnings = [
      [`executor failed`, failures[0], new Error(`cleanup failed`)],
    ]
  if (fault === `leaked-pending`)
    actual.pending = actual.rows.map((row) => row.id)
  if (fault === `stale-waiter`)
    actual.waiters = actual.waiters.map((snapshot) =>
      snapshot
        ? { ...snapshot, pending: snapshot.rows.map((row) => row.id) }
        : snapshot,
    )
  if (fault === `resurrect-failed`) actual.states[1] = `completed`
  if (fault === `early-peer`) actual.outcomes[2] = `fulfilled`
  if (fault === `missing-row`) actual.rows.pop()
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(() => checkRestoredState(actual, expected)).toThrow(),
  )
})
