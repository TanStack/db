import { expect, test } from '@playwright/test'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { queryStartupHistories } from '../../query-db-collection/tests/persisted-startup-driver'
import { persistedStartupHistories } from '../../db-adapter-conformance/src/persisted-startup-oracle'
import type { StartupConformanceResult } from './persisted-startup-conformance.opfs'

// The page compares each cut with the shared model. Count each adapter's
// completion separately so a missing receiver cannot masquerade as conformance.
function checkStartupConformance(result: StartupConformanceResult) {
  expect(result.error).toBeUndefined()
  expect(
    result.results.filter((item) => item.adapter === `query`),
  ).toHaveLength(queryStartupHistories.length)
  for (const adapter of [
    `convex`,
    `electric`,
    `trailbase`,
    `rxdb`,
    `powersync`,
  ])
    expect(
      result.results.filter((item) => item.adapter === adapter),
    ).toHaveLength(persistedStartupHistories.length)
  expect(result.results.flatMap(({ violations }) => violations)).toEqual([])
}
declareOracle({ check: [checkStartupConformance] })
test(`complete source results replace persisted rows across OPFS startup`, async ({
  page,
}) => {
  page.on(`console`, (message) =>
    console.info(`browser ${message.type()}: ${message.text()}`),
  )
  const errors: Array<string> = []
  page.on(`pageerror`, (error) => errors.push(error.message))
  await page.goto(`/e2e/persisted-startup-conformance.opfs.html`)
  await page.waitForFunction(
    () => window.__persistedStartupConformance !== undefined,
  )
  const result = await page.evaluate(
    () => window.__persistedStartupConformance!,
  )
  expect(errors).toEqual([])
  checkStartupConformance(result)
})
