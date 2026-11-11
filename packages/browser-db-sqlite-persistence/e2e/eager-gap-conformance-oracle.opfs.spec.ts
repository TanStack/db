import { expect, test } from '@playwright/test'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { precedenceHistories } from '../../query-db-collection/tests/persisted-precedence-oracle'
import {
  cachedPeerClaimHistories,
  scopedHydrationHistories,
} from '../../query-db-collection/tests/retained-scoped-hydration-oracle'
import { hydrationLifecycleHistories } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import { eagerReloadHistories } from '../../db-adapter-conformance/tests/eager-reload-oracle'
import type { EagerGapResult } from './eager-gap-conformance.opfs'
// The browser page applies the owners' shared comparisons and local reach.
// Count every receiver here so a missing run cannot pass as conformance.
function checkEagerGapReceiving(result: EagerGapResult) {
  expect(result.error).toBeUndefined()
  expect(result.results.filter((r) => r.owner === `query`)).toHaveLength(
    precedenceHistories.length,
  )
  expect(result.results.filter((r) => r.owner === `query-scoped`)).toHaveLength(
    scopedHydrationHistories.length,
  )
  expect(
    result.results.filter((r) => r.owner === `query-cached-claim`),
  ).toHaveLength(cachedPeerClaimHistories.length)
  expect(result.results.filter((r) => r.owner === `trailbase`)).toHaveLength(
    hydrationLifecycleHistories.length,
  )
  for (const owner of [`rxdb`, `powersync`])
    expect(result.results.filter((r) => r.owner === owner)).toHaveLength(
      eagerReloadHistories.length,
    )
  expect(result.results.flatMap((r) => r.violations)).toEqual([])
  expect(result.artifacts).toEqual([])
}
declareOracle({ check: [checkEagerGapReceiving] })
test(`persisted precedence, retired hydration, and unwrapped reload obey their owners in Chromium`, async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: Array<string> = []
  page.on(`pageerror`, (error) => errors.push(error.message))
  page.on(`console`, (message) =>
    console.info(`browser ${message.type()}: ${message.text()}`),
  )
  await page.goto(`/e2e/eager-gap-conformance.opfs.html`)
  await page.waitForFunction(() => window.__eagerGapConformance !== undefined)
  expect(errors).toEqual([])
  checkEagerGapReceiving(
    await page.evaluate(() => window.__eagerGapConformance!),
  )
})
