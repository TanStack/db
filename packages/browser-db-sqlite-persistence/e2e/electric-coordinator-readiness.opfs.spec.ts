import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ReadinessOracleResult } from './electric-coordinator-readiness.opfs'

type Mode = `non-empty` | `empty` | `network-wins` | `on-demand`

async function readResult(
  page: Page,
  mode: Mode,
): Promise<ReadinessOracleResult> {
  await page.goto(`/e2e/electric-coordinator-readiness.opfs.html?mode=${mode}`)
  await page.waitForFunction(
    () => window.__tanstackElectricCoordinatorReadiness !== undefined,
  )
  return page.evaluate(() => window.__tanstackElectricCoordinatorReadiness!)
}

function expectComplete(
  result: ReadinessOracleResult,
): asserts result is Extract<ReadinessOracleResult, { status: `complete` }> {
  if (result.status !== `complete`) {
    throw new Error(result.primaryFailure)
  }
}

const eagerCases = [
  {
    mode: `non-empty` as const,
    rows: [{ id: `persisted`, title: `Persisted while upstream is pending` }],
  },
  { mode: `empty` as const, rows: [] },
] as const

for (const expected of eagerCases) {
  test(`eager ${expected.mode} OPFS snapshot becomes ready while Electric remains pending`, async ({
    page,
  }) => {
    const result = await readResult(page, expected.mode)

    expectComplete(result)
    expect(result.status).toBe(`complete`)
    expect(result.provider).toBe(
      `Chromium OPFSCoopSyncVFS + BrowserCollectionCoordinator + Electric ShapeStream`,
    )
    expect(result.observation).toEqual({
      mode: expected.mode,
      status: `ready`,
      rows: expected.rows,
      readyEvents: 1,
      hydrationCalls: 1,
      upstreamRequests: 1,
      readyBeforeHydrationRelease: false,
    })
    expect(result.cleanupFailures).toEqual([])
  })
}

test(`on-demand remains upstream-gated with the same browser stack`, async ({
  page,
}) => {
  const result = await readResult(page, `on-demand`)

  expectComplete(result)
  expect(result.status).toBe(`complete`)
  expect(result.observation).toEqual({
    mode: `on-demand`,
    status: `loading`,
    rows: [],
    readyEvents: 0,
    hydrationCalls: 0,
    upstreamRequests: 1,
    readyBeforeHydrationRelease: false,
  })
  expect(result.cleanupFailures).toEqual([])
})

test(`an authoritative Electric snapshot wins before OPFS hydration finishes`, async ({
  page,
}) => {
  const result = await readResult(page, `network-wins`)

  expectComplete(result)
  expect(result.status).toBe(`complete`)
  expect(result.observation.mode).toBe(`network-wins`)
  expect(result.observation.status).toBe(`ready`)
  expect(result.observation.rows).toEqual([
    { id: `network`, title: `Network winner` },
  ])
  expect(result.observation.readyEvents).toBe(1)
  expect(result.observation.hydrationCalls).toBe(1)
  expect(result.observation.upstreamRequests).toBeGreaterThanOrEqual(1)
  expect(result.observation.readyBeforeHydrationRelease).toBe(true)
  expect(result.cleanupFailures).toEqual([])
})
