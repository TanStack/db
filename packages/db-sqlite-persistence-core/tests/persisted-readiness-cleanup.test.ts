// Self-tests for checkWithCleanup, the harness that the persisted-readiness
// oracle uses to keep its cleanup and primary failure visible. The readiness
// law is owned by persisted-readiness-oracle.test.ts.
import { describe, expect, it } from 'vitest'
import { checkWithCleanup } from './persisted-readiness-support.js'

describe(`persisted-readiness oracle`, () => {
  it(`preserves a failed checkpoint and a secondary cleanup failure`, async () => {
    const mismatch = new Error(`wrong persisted status`)
    const cleanupFailure = new Error(`cleanup failed`)
    await expect(
      checkWithCleanup(() => {
        throw mismatch
      }, [
        () => {
          throw cleanupFailure
        },
      ]),
    ).rejects.toMatchObject({
      cause: mismatch,
      errors: [mismatch, cleanupFailure],
    })
  })
})
