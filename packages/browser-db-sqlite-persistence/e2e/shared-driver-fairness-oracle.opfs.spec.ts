/**
 * Browser checkpoint assertions for the OPFS refinement. The page applies the
 * shared comparison `findSharedDriverFairnessLawViolations`, which the Node
 * driver also applies, so this spec states no expected rows or completion
 * order of its own. It adds reach and premise checks: the neutral case proves
 * cold-query reach, and the storm case proves the already-running persist. This is the
 * receiving witness for the Node fixture's held-BEGIN, cold-hydrate premise:
 * the same public preload/core-adapter/driver path reaches a Chromium OPFS
 * worker, then public rows and logical completions are checked after all work
 * settles. Failure-before-checkpoint, semantic mismatch, driver cleanup, and
 * OPFS cleanup remain distinct outcomes so setup or teardown cannot satisfy
 * the scheduling laws.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { OPFSOracleResult } from './shared-driver-fairness.opfs'

async function readOracleResult(
  page: Page,
  mode: `neutral` | `storm`,
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

test(`real Chromium OPFS fixture reaches and cleans up cold hydration`, async ({
  page,
}) => {
  expectLawsHold(await readOracleResult(page, `neutral`))
})

test(`real Chromium OPFS fixture bounds cold hydration and completes persists in FIFO order`, async ({
  page,
}) => {
  const result = await readOracleResult(page, `storm`)
  expectLawsHold(result)
  if (result.status !== `complete`) return
  // Premise: the storm began with one persist already running. That persist is
  // non-preemptible, so it completes before the first hydrate.
  const { scenario } = result.observation
  const runningPersist = scenario.work.find((work) => work.kind === `persist`)
  expect(
    result.observation.hydrationCompletions[0]?.completedPersistIds,
  ).toEqual([`${scenario.id}-${runningPersist?.id}`])
})
