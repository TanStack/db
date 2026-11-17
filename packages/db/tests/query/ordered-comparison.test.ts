import { expect, it } from 'vitest'
import {
  observeComparison,
  recordedComparison,
  rejectAt,
} from './ordered-comparison-oracle.js'
import type { Observation } from '../oracle-property.js'

it(`retains an authored judgment error through the native comparison adapter`, async () => {
  const history = {}
  const observations: Array<Observation> = []
  const error = new Error(`the request ledger rejects the observed release`)

  await expect(
    observeComparison(
      history,
      (checkpoint, value) => observations.push({ checkpoint, value }),
      () => rejectAt(`request ownership`, error),
    ),
  ).rejects.toBe(error)

  const verdict = recordedComparison(history, observations)
  expect(verdict).toEqual({
    kind: `violation`,
    checkpoint: `request ownership`,
    difference: error.message,
    cause: error,
  })
  if (verdict.kind === `violation`) expect(verdict.cause).toBe(error)
})
