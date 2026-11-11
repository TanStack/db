// Checker calibrations for the claim-lifecycle checks in
// live-query-cache-lifecycle-model-oracle.ts. These tests run no production:
// each hands a deliberately wrong answer to a shared check and requires it to
// reject. The production histories that use the same checks are in
// live-query-cache-lifecycle-oracle.test.ts.
import { expect, test } from 'vitest'
import {
  cacheOptionHistories,
  conflictingCacheOptions,
} from './live-query-cache-options-oracle'
import {
  checkLifecycleAdmission,
  checkPortableCacheState,
  claimSurvives,
  phases,
} from './live-query-cache-lifecycle-model-oracle'

// Transport must not inherit a local claim merely because a serializer would
// discard it. Deliberately leaking either kind of callable fails this judgment.
test.each([`getKey`, `schema`] as const)(
  `portable cache rejects a leaked %s function`,
  (option) => {
    expect(() => checkPortableCacheState({ [option]: () => {} })).toThrow()
  },
)

// A wrong forever-claim policy rejects retired results; a no-claim policy
// accepts active conflicts. Both are judged by the same lifecycle comparison.
test.each(phases)(
  `lifecycle checker rejects the opposite claim policy at %s`,
  (phase) => {
    const history = cacheOptionHistories.find(conflictingCacheOptions)!
    const wrong = () => {
      if (!claimSurvives(phase)) throw new Error(`getKey conflict`)
    }
    expect(() => checkLifecycleAdmission(wrong, history, phase)).toThrow()
  },
)
