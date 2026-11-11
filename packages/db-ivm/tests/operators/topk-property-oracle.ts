import { differs, pass } from '../../../db/tests/oracle-property.js'
import type { Observation, Verdict } from '../../../db/tests/oracle-property.js'
import type { TopKComparisonRecorder } from './topk-relation-oracle.js'

/**
 * Native registration transports the existing Top-K comparisons. The expected
 * side still comes from the independent rank predicate or signed relation law.
 * Record before the original assertion, then let that assertion or any runtime
 * error propagate. A trace cut by a runtime error has no invented comparison.
 */
type Comparison = {
  law: string
  actual: unknown
  expected: unknown
  structural: boolean
}
export function topKReferences(
  _history: unknown,
  trace: ReadonlyArray<Observation>,
) {
  return trace
    .filter(({ checkpoint }) => checkpoint !== `reach`)
    .map(({ value }) => (value as Comparison).expected)
}
export function checkTopKComparisons(
  _history: unknown,
  trace: ReadonlyArray<Observation>,
  references: Array<unknown>,
): Verdict {
  let at = 0
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const comparison = value as Comparison
    const expected = references[at++]
    const mismatch = comparison.structural
      ? differs(checkpoint, comparison.law, comparison.actual, expected)
      : differs(
          checkpoint,
          comparison.law,
          Object.is(comparison.actual, expected),
          true,
        )
    if (mismatch) return mismatch
  }
  return pass
}
export function topKRecorder(
  observe: (checkpoint: string, value: unknown) => void,
) {
  let checkpoint = `setup`
  const record: TopKComparisonRecorder = (
    law,
    actual,
    expected,
    structural = false,
  ) => {
    observe(checkpoint, {
      law: `${law} at ${checkpoint}`,
      actual,
      expected,
      structural,
    })
  }
  return {
    record,
    at: (cut: string) => {
      checkpoint = cut
    },
  }
}
