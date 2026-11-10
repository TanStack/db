/**
 * Native registration for complete existing independent Electric comparisons.
 * The supplied helper retains its model, driver, assertions, and checkpoints.
 * This binding adds no product model or coverage claim. The shared transport
 * retains the original assertion error and propagates setup/cleanup failures.
 */
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'

export const checkExistingElectricComparison = forwardAssertionJudgment

export function existingElectricComparison<THistory>(
  law: string,
  compare: (history: THistory) => void | Promise<void>,
) {
  return {
    resolve: (history: THistory) => ({ history }),
    model: recordedAssertionJudgment,
    driver: async (
      plan: { history: THistory },
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      await recordAssertionJudgment(law, plan, observe, () =>
        oracleAssertion(law, () => compare(plan.history)),
      )
    },
    check: checkExistingElectricComparison,
  }
}
