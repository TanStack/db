/**
 * Chromium receiving witness for persisted demand coverage, over real OPFS
 * with the wa-sqlite worker driver. The law, histories, production path,
 * observations, and checkpoints are described in
 * `persisted-on-demand-coverage.opfs.ts`, which this spec drives. Each
 * history is one page load for session 1 (online) and one later page load
 * over the same OPFS file for session 2 (offline, upstream never answers).
 * The spec asserts the session 2 observations at both checkpoints, and that
 * session 2 forwarded its upstream load (the positive witness).
 *
 * The five law histories use the default single-process coordinator. The last
 * history passes `BrowserCollectionCoordinator` and pins the guide's
 * out-of-scope statement (`docs/guides/sqlite-persistence.md`): a covered
 * demand waits for the network. It pins that statement, not the law.
 */
import { expect, test } from '@playwright/test'
import type { Session2Result } from './persisted-on-demand-coverage.opfs'

type Scenario = {
  name: string
  shape: `filter` | `window`
  session1: `covered` | `never` | `deleted` | `replaced`
  settles: boolean
  coordinator: `none` | `browser`
}

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: `covered demand settles offline with its restored rows`,
    shape: `filter`,
    session1: `covered`,
    settles: true,
    coordinator: `none`,
  },
  {
    name: `never-loaded demand stays loading offline`,
    shape: `filter`,
    session1: `never`,
    settles: false,
    coordinator: `none`,
  },
  {
    name: `covered demand stays loading after a source delete of one row`,
    shape: `filter`,
    session1: `deleted`,
    settles: false,
    coordinator: `none`,
  },
  {
    name: `covered ordered window settles offline`,
    shape: `window`,
    session1: `covered`,
    settles: true,
    coordinator: `none`,
  },
  {
    name: `covered ordered window stays loading after a row replaced below the boundary`,
    shape: `window`,
    session1: `replaced`,
    settles: false,
    coordinator: `none`,
  },
  {
    name: `covered demand stays loading offline with a multi-tab coordinator (guide: out of scope)`,
    shape: `filter`,
    session1: `covered`,
    settles: false,
    coordinator: `browser`,
  },
]

for (const scenario of SCENARIOS) {
  test(scenario.name, async ({ page }) => {
    test.setTimeout(120_000)
    const pageErrors: Array<string> = []
    page.on(`pageerror`, (error) => pageErrors.push(error.message))
    const databaseName = `pod-${crypto.randomUUID().slice(0, 8)}.sqlite`
    const url = (phase: `1` | `2`) =>
      `/e2e/persisted-on-demand-coverage.opfs.html?phase=${phase}&shape=${scenario.shape}&history=${scenario.session1}&coordinator=${scenario.coordinator}&db=${databaseName}`

    await page.goto(url(`1`))
    await page.waitForFunction(
      () => window.__persistedOnDemandSession1 !== undefined,
      undefined,
      { timeout: 60_000 },
    )
    expect(
      await page.evaluate(() => window.__persistedOnDemandSession1Error),
    ).toBeUndefined()
    expect(await page.evaluate(() => window.__persistedOnDemandSession1)).toBe(
      `complete`,
    )

    await page.goto(url(`2`))
    await page.waitForFunction(
      () =>
        window.__persistedOnDemandSession2 !== undefined ||
        window.__persistedOnDemandSession2Error !== undefined,
      undefined,
      { timeout: 60_000 },
    )
    expect(
      await page.evaluate(() => window.__persistedOnDemandSession2Error),
    ).toBeUndefined()
    const result: Session2Result = await page.evaluate(
      () => window.__persistedOnDemandSession2!,
    )

    expect(pageErrors).toEqual([])
    // Every history waits for the network before it may settle.
    expect(result.beforeDeadline.status).toBe(`loading`)
    // Positive witness: session 2 asked the offline source.
    expect(result.afterDeadline.upstreamCalls).toBeGreaterThan(0)
    expect({
      status: result.afterDeadline.status,
      rows: result.afterDeadline.rows,
    }).toEqual(
      scenario.settles
        ? { status: `ready`, rows: [`a1`, `a2`] }
        : { status: `loading`, rows: undefined },
    )
  })
}
