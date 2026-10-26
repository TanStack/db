/**
 * Harness self-test for the hydration-commit checkpoint: the fixture's cleanup
 * failures must not replace the primary observation. The law it protects is
 * owned by `hydration-commit-oracle.opfs.spec.ts`.
 */
import { expect, test } from '@playwright/test'

// ORC-010 calibration: two teardown failures cannot erase the independently
// captured observation, mutate its receipt errors, or hide one another.
test(`preserves the primary observation through multiple cleanup failures`, async ({
  page,
}) => {
  await page.goto(
    `/e2e/hydration-commit.opfs.html?phase=after-ready&baseline=false&coordinator=browser&rich=false&cleanupFault=true`,
  )
  await page.waitForFunction(() => window.__hydrationCommitDone === true)
  const result = await page.evaluate(() => ({
    observation: window.__hydrationCommitResult,
    error: window.__hydrationCommitError,
    cleanup: window.__hydrationCommitCleanupErrors,
  }))
  expect(result.error).toBeUndefined()
  expect(result.observation?.cycleCalls).toBe(0)
  expect(result.observation?.errors).toEqual([])
  expect(result.observation?.reopenedRows).toEqual([
    { id: `r1`, value: 1 },
    { id: `tail`, value: 9 },
  ])
  expect(result.cleanup).toEqual([
    `Error: injected first cleanup failure`,
    `Error: injected last cleanup failure`,
  ])
})
