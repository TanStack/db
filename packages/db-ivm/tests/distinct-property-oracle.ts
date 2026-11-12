/**
 * Native registration transports the existing independent distinct comparisons.
 * Only their typed mismatch is recorded; the original error is rethrown so its
 * cause survives. Missing construction reach is checked last at an unrecorded
 * checkpoint, which cannot turn a graph or setup error into a semantic kill.
 */
import { pass, violation } from '../../db/tests/oracle-property.js'
import { OracleComparisonMismatch } from './incrementalization-law-oracle.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'

type Observe = (checkpoint: string, value: unknown) => void

interface ComparisonObservation {
  kind: `comparison mismatch`
  law: string
  difference: string
  actual: unknown
  expected: unknown
}

function isComparison(value: unknown): value is ComparisonObservation {
  return (
    typeof value === `object` &&
    value !== null &&
    `kind` in value &&
    value.kind === `comparison mismatch` &&
    `law` in value &&
    typeof value.law === `string` &&
    `difference` in value &&
    typeof value.difference === `string` &&
    `actual` in value &&
    `expected` in value
  )
}

export function driveDistinctChecked<T>(run: () => T, observe: Observe): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof OracleComparisonMismatch)
      observe(error.checkpoint, {
        kind: `comparison mismatch`,
        law: error.law,
        difference: error.message,
        actual: error.actual,
        expected: error.expected,
      })
    throw error
  }
}

export function checkDistinctCampaign(
  _plan: unknown,
  trace: ReadonlyArray<Observation>,
  requiredStates: ReadonlyArray<string>,
): Verdict {
  for (const entry of trace) {
    const value = entry.value
    if (isComparison(value))
      return violation(entry.checkpoint, value.difference, value.law, {
        actual: value.actual,
        expected: value.expected,
      })
  }
  for (const state of requiredStates)
    if (
      !trace.some(
        (entry) => entry.checkpoint === `reach` && entry.value === state,
      )
    )
      return violation(
        `constructed states`,
        `constructed history missed ${state}`,
        `constructed reach`,
      )
  return pass
}
