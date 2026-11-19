// Registration transports the existing independent subscription comparison.
// Its model, production path, assertions, and cleanup remain in the owner.
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'

export function subscriptionComparison<T>(
  law: string,
  compare: (history: T) => Promise<void>,
) {
  return {
    resolve: (history: T) => ({ history }),
    model: recordedAssertionJudgment,
    driver: async (
      plan: { history: T },
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      await recordAssertionJudgment(law, plan, observe, () =>
        compare(plan.history),
      )
    },
    check: forwardAssertionJudgment,
  }
}
