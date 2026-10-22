/**
 * Chromium checkpoint for the reload class oracle in
 * `packages/db-sqlite-persistence-core/tests/reload-class-oracle.ts`. The page
 * runs every fixed history against real OPFS and publishes each history's
 * violations from the oracle's own comparison. A failure before the checkpoint
 * stays distinct from a law violation.
 */
import { expect, test } from '@playwright/test'
import type { ReloadClassResult } from './reload-class.opfs'

test(`real Chromium OPFS reload is free of avoidable work ahead of its reads`, async ({
  page,
}) => {
  test.setTimeout(300_000)
  const pageErrors: Array<string> = []
  page.on(`pageerror`, (error) => pageErrors.push(error.message))
  await page.goto(`/e2e/reload-class.opfs.html`)
  await page.waitForFunction(
    () => window.__tanstackReloadClassOracle !== undefined,
    undefined,
    { timeout: 290_000 },
  )
  const result: ReloadClassResult = await page.evaluate(
    () => window.__tanstackReloadClassOracle!,
  )
  expect(pageErrors).toEqual([])
  expect(result).toMatchObject({ status: `complete` })
  if (result.status !== `complete`) return
  expect(result.expected.length).toBeGreaterThan(0)
  expect(result.results.map(({ name }) => name)).toEqual(result.expected)
  expect(
    result.results
      .filter(({ violations }) => violations.length > 0)
      .map(({ name, violations }) => ({ name, violations })),
  ).toEqual([])
})
