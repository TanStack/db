/**
 * Browser checkpoint assertions for the OPFS refinement. The page applies the
 * shared comparison `findSharedDriverFairnessLawViolations`, which the Node
 * driver also applies, so this spec states no expected rows or completion
 * order of its own. It adds a reach check: both cases prove a cold SQL read. This is the
 * receiving witness for the Node fixture's held-BEGIN, cold-hydrate premise:
 * the same public preload/core-adapter/driver path reaches a Chromium OPFS
 * worker, then public rows and logical completions are checked after all work
 * settles. Failure-before-checkpoint, semantic mismatch, driver cleanup, and
 * OPFS cleanup remain distinct outcomes so setup or teardown cannot satisfy
 * the scheduling laws.
 */
import { expect, test } from '@playwright/test'
import { declareOracle } from '../../db/tests/oracle-config.js'
import type { Page } from '@playwright/test'
import type { OPFSOracleResult } from './shared-driver-fairness.opfs'

async function readOracleResult(
  page: Page,
  mode: `neutral` | `storm` | `interleaved`,
): Promise<OPFSOracleResult> {
  let rejectPageError!: (error: Error) => void
  const pageError = new Promise<never>((_resolve, reject) => {
    rejectPageError = reject
  })
  void pageError.catch(() => undefined)
  const onPageError = (error: Error) => {
    rejectPageError(
      new Error(
        `OPFS fairness page failed before publishing a result: ${error.message}`,
      ),
    )
  }
  page.on(`pageerror`, onPageError)

  try {
    await page.goto(`/e2e/shared-driver-fairness.opfs.html?mode=${mode}`)
    await Promise.race([
      page.waitForFunction(
        () => window.__tanstackDriverFairnessOracle !== undefined,
      ),
      pageError,
    ])
    return page.evaluate(() => window.__tanstackDriverFairnessOracle!)
  } finally {
    page.off(`pageerror`, onPageError)
  }
}

function expectLawsHold(result: OPFSOracleResult): void {
  if (result.status !== `complete`) throw new Error(result.primaryFailure)
  expect(result.provider).toBe(`Chromium OPFSCoopSyncVFS worker`)
  // Reach: a cold hydrate read real rows through the OPFS worker.
  expect(
    result.observation.rawDequeues.some((entry) =>
      entry.sql.startsWith(`SELECT key, value, metadata, row_version FROM`),
    ),
  ).toBe(true)
  // This is the semantic RED checkpoint: the shared comparison that the Node
  // driver also applies. Setup, wall time, and cleanup are reported apart.
  expect(
    result.lawViolations,
    `logical completion order: ${JSON.stringify(result.observation.logicalCompletionOrder)}`,
  ).toEqual([])
  expect(result.observation.cleanupFailures).toEqual([])
  expect(result.opfsCleanupFailures).toEqual([])
}

declareOracle({ check: [expectLawsHold] })

test(`real Chromium OPFS fixture reaches and cleans up cold hydration`, async ({
  page,
}) => {
  expectLawsHold(await readOracleResult(page, `neutral`))
})

test(`real Chromium OPFS fixture bounds cold hydration and completes persists in FIFO order`, async ({
  page,
}) => {
  expectLawsHold(await readOracleResult(page, `storm`))
})

test(`real Chromium OPFS fixture bounds hydrates queued ahead of later persists`, async ({
  page,
}) => {
  expectLawsHold(await readOracleResult(page, `interleaved`))
})
