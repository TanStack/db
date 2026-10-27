// Harness self-test for checkWithCleanup, which the virtual row field oracle
// uses to run cleanup after its checks. The published-row law is owned by
// virtual-row-fields-oracle.test.ts.
import { describe, expect, test } from 'vitest'
import { checkWithCleanup } from './virtual-row-fields-support.js'

describe(`virtual row field runtime boundary`, () => {
  test(`keeps the primary mismatch and attempts every cleanup`, async () => {
    const mismatch = new Error(`published row mismatch`)
    const firstCleanupError = new Error(`first cleanup failed`)
    const lastCleanupError = new Error(`last cleanup failed`)
    const attempted: Array<string> = []

    await expect(
      checkWithCleanup(async () => {
        throw mismatch
      }, [
        async () => {
          attempted.push(`first`)
          throw firstCleanupError
        },
        async () => {
          attempted.push(`middle`)
        },
        async () => {
          attempted.push(`last`)
          throw lastCleanupError
        },
      ]),
    ).rejects.toMatchObject({
      cause: mismatch,
      errors: [firstCleanupError, lastCleanupError],
    })
    expect(attempted).toEqual([`first`, `middle`, `last`])
  })
})
