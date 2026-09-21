/**
 * Browser checkpoint assertions for the OPFS refinement. Expected public rows
 * are rebuilt from the scenario IDs rather than from production output. The
 * neutral case proves cold-query reach; the storm case requires no K=1
 * violation. Failure-before-checkpoint, semantic mismatch, driver cleanup, and
 * OPFS cleanup remain distinct outcomes so setup or teardown cannot satisfy the
 * scheduling law.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { OPFSOracleResult } from './shared-driver-fairness.opfs'

async function readOracleResult(
  page: Page,
  mode: `neutral` | `storm`,
): Promise<OPFSOracleResult> {
  await page.goto(`/e2e/shared-driver-fairness.opfs.html?mode=${mode}`)
  await page.waitForFunction(
    () => window.__tanstackDriverFairnessOracle !== undefined,
  )
  return page.evaluate(() => window.__tanstackDriverFairnessOracle!)
}

function expectedHydratedCollections(scenarioId: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    collectionId: `${scenarioId}-hydrate-${index}`,
    rows: [
      { id: `row-${index}-0`, value: index * 10 },
      { id: `row-${index}-1`, value: index * 10 + 1 },
    ],
  }))
}

test(`real Chromium OPFS fixture reaches and cleans up cold hydration`, async ({
  page,
}) => {
  const result = await readOracleResult(page, `neutral`)

  if (result.status !== `complete`) throw new Error(result.primaryFailure)
  expect(result.provider).toBe(`Chromium OPFSCoopSyncVFS worker`)
  expect(result.observation.admittedHydrateIds).toHaveLength(2)
  // These are actual public Collection rows captured after preload, compared
  // with seed values built independently by this browser assertion.
  expect(result.observation.hydratedCollections).toEqual(
    expectedHydratedCollections(`opfs-neutral-reach`, 2),
  )
  expect(
    result.observation.rawDequeues.some((entry) =>
      entry.sql.startsWith(`SELECT key, value, metadata, row_version FROM`),
    ),
  ).toBe(true)
  expect(result.observation.cleanupFailures).toEqual([])
  expect(result.opfsCleanupFailures).toEqual([])
})

test(`real Chromium OPFS fixture bounds pending cold hydration behind persists`, async ({
  page,
}) => {
  const result = await readOracleResult(page, `storm`)

  if (result.status !== `complete`) throw new Error(result.primaryFailure)
  expect(result.provider).toBe(`Chromium OPFSCoopSyncVFS worker`)
  expect(result.observation.admittedHydrateIds).toHaveLength(4)
  expect(result.observation.hydratedCollections).toEqual(
    expectedHydratedCollections(`opfs-fixed-persist-storm`, 4),
  )
  // This is the semantic RED checkpoint. Setup, wall time, and cleanup are
  // reported independently and cannot satisfy this assertion.
  if (result.violation !== undefined) {
    throw new Error(
      `real OPFS fairness mismatch: ${JSON.stringify(result.violation)}; ` +
        `logical completion order: ${JSON.stringify(result.observation.logicalCompletionOrder)}; ` +
        `driver admissions: ${result.observation.driverAdmissions.length}; ` +
        `raw dequeues: ${result.observation.rawDequeues.length}; ` +
        `driver cleanup diagnostics: ${JSON.stringify(result.observation.cleanupFailures)}; ` +
        `OPFS cleanup diagnostics: ${JSON.stringify(result.opfsCleanupFailures)}`,
    )
  }
  expect(result.observation.cleanupFailures).toEqual([])
  expect(result.opfsCleanupFailures).toEqual([])
})
