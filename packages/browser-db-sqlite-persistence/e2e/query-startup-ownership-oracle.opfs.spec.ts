import { expect, test } from '@playwright/test'
import { declareOracle } from '../../db/tests/oracle-declaration'
import type { QueryStartupResult } from './query-startup-ownership.opfs'

// The page uses the shared ownership comparison at every checkpoint. Check
// completion separately so a setup failure cannot masquerade as a law failure.
function checkStartupOwnership(result: QueryStartupResult) {
  expect(result.error).toBeUndefined()
  expect(result.results).toHaveLength(8)
  expect(result.results.flatMap(({ violations }) => violations)).toEqual([])
}
declareOracle({ check: [checkStartupOwnership] })
test(`a Query response reconciles persisted owners across OPFS startup`, async ({
  page,
}) => {
  page.on(`console`, (message) =>
    console.info(`browser ${message.type()}: ${message.text()}`),
  )
  const errors: Array<string> = []
  page.on(`pageerror`, (error) => errors.push(error.message))
  await page.goto(`/e2e/query-startup-ownership.opfs.html`)
  await page.waitForFunction(() => window.__queryStartupOwnership !== undefined)
  const result = await page.evaluate(() => window.__queryStartupOwnership!)
  expect(errors).toEqual([])
  checkStartupOwnership(result)
})
