// Checker calibrations for the cache-option checks in
// live-query-cache-options-oracle.ts. These tests run no production: each
// hands a deliberately wrong observation, or a hand-built admission promise,
// to a shared check and requires it to reject. The production histories that
// use the same checks are in live-query-cache-options-oracle.test.ts.
import { expect, test } from 'vitest'
import {
  cacheOptionHistories,
  checkCacheOptionAdmission,
  checkCacheOptionPromise,
  checkCacheOptionPublications,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from './live-query-cache-options-oracle'

// Deliberately wrong observations use the same judgment as every driver. The
// all-options-differ policy and claim-overwrite policy would accept these
// conflicts; checking both attempts is what distinguishes claim corruption.
test.each(
  cacheOptionHistories.filter((history) => conflictingCacheOptions(history)),
)(`cache admission rejects hostile acceptance %j`, (history) => {
  for (let attempt = 0; attempt < 2; attempt++)
    expect(() => checkCacheOptionAdmission(() => {}, history)).toThrow()
})
test.each([`first`, `other`] as const)(
  `cache rows reject hostile keys and leading publication for %s`,
  (key) => {
    const rows = [{ id: `one`, label: `authored` }]
    const correct = [{ key: `${key}-one`, value: rows[0] }]
    const wrong = [{ key: `borrowed`, value: rows[0] }]
    checkCacheOptionRows(correct, rows, key)
    expect(() => checkCacheOptionRows(wrong, rows, key)).toThrow()
    expect(() =>
      checkCacheOptionPublications([wrong, correct], rows, key),
    ).toThrow()
  },
)

// Admission calibration includes a promise that never settles. The check must
// reject it at the pre-delivery cut, allowing its driver's cleanup to proceed.
test.each([`pending`, `fulfilled`, `unrelated-error`, `conflict`] as const)(
  `rejects wrong pre-delivery admission outcome: %s`,
  async (outcome) => {
    const history = cacheOptionHistories.find(conflictingCacheOptions)!
    const result =
      outcome === `pending`
        ? new Promise<void>(() => {})
        : outcome === `fulfilled`
          ? Promise.resolve()
          : Promise.reject(
              new Error(
                outcome === `conflict`
                  ? `getKey/schema conflict`
                  : `unrelated failure`,
              ),
            )
    const check = checkCacheOptionPromise(result, history, {
      deliveryHeld: true,
    })
    if (outcome === `conflict`) await check
    else await expect(check).rejects.toThrow()
  },
)
