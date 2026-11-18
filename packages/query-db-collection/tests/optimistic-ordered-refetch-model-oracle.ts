// The public-window model and the per-checkpoint comparison of
// optimistic-ordered-refetch-oracle.test.ts. That oracle and its checker
// calibrations in optimistic-ordered-refetch-calibration.test.ts both import
// them. This module registers no tests.
import { expect } from 'vitest'
import type { Row } from './optimistic-ordered-refetch-probe.js'

export type OrderedMutationHistory = {
  operation: `insert` | `update` | `delete`
  ending:
    | `fulfilled-void`
    | `fulfilled-legacy`
    | `reject-before-write`
    | `reject-after-write`
  reportDuringHold: boolean
}

/**
 * The public window of the live query `inbox` order `at desc` limit 2, computed
 * from the plain remote row ledger. This is the model that the check compares
 * the live rows against at each checkpoint.
 */
export function expectedPublicWindow(
  remote: ReadonlyArray<Row>,
): Array<number> {
  return remote
    .filter(({ folder }) => folder === `inbox`)
    .sort((left, right) => right.at - left.at)
    .slice(0, 2)
    .map(({ id }) => id)
}

// Ordering derives from the backend ledger, while outcome derives from the
// handler's Promise. Rejecting after confirmation changes only the latter.
export function checkOrderedMutationObservation(
  remote: ReadonlyArray<Row>,
  ending: OrderedMutationHistory[`ending`],
  observed: { ids: Array<number>; error: unknown; state: string },
  failure: Error,
): void {
  expect(observed.ids).toEqual(expectedPublicWindow(remote))
  expect(observed.error).toBe(ending.startsWith(`reject`) ? failure : undefined)
  expect(observed.state).toBe(
    ending.startsWith(`reject`) ? `failed` : `completed`,
  )
}
