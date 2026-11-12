// Checker calibrations for optimistic-ordered-refetch-oracle.test.ts. Each
// control builds a correct public observation, checks that the comparison
// accepts it, corrupts it, and requires the comparison to reject it. They run
// no production, so they calibrate the comparison, not Query DB.
import { expect, it } from 'vitest'
import {
  checkOrderedMutationObservation,
  expectedPublicWindow,
} from './optimistic-ordered-refetch-model-oracle.js'
import type { Row } from './optimistic-ordered-refetch-probe.js'

// These controls challenge the same public-window/outcome comparison. They
// establish sensitivity without changing any production code.
it.each([
  `rollback-confirmed-row`,
  `discarded-value-failure`,
  `reversed-order`,
] as const)(`rejects ordered wrong observation: %s`, (fault) => {
  const remote: Array<Row> = [
    { id: 1, folder: `inbox`, at: 1 },
    { id: 2, folder: `inbox`, at: 2 },
  ]
  const ending =
    fault === `rollback-confirmed-row`
      ? `reject-after-write`
      : `fulfilled-legacy`
  const failure = new Error(`handler failure`)
  const actual = {
    ids: expectedPublicWindow(remote),
    error:
      ending === `reject-after-write`
        ? (failure as unknown)
        : (undefined as unknown),
    state: ending === `reject-after-write` ? `failed` : `completed`,
  }
  checkOrderedMutationObservation(remote, ending, actual, failure)
  if (fault === `rollback-confirmed-row`) actual.ids = [3, 2]
  if (fault === `discarded-value-failure`) {
    actual.error = new Error(`legacy value`)
    actual.state = `failed`
  }
  if (fault === `reversed-order`) actual.ids.reverse()
  expect(() =>
    checkOrderedMutationObservation(remote, ending, actual, failure),
  ).toThrow()
})
