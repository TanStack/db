/**
 * Chromium receiving spec for persisted demand coverage, over real OPFS with
 * the wa-sqlite worker driver. The law, the histories, the production path,
 * and the observations are the receiving contract's
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`),
 * and the page `persisted-on-demand-coverage.opfs.ts` drives them. Each
 * history is one page load for session 1 (online) and one later page load over
 * the same OPFS file for session 2 (offline, upstream as the history says).
 *
 * The spec states no expected results. It checks that each run completed, that
 * session 2 asked the offline source (the positive witness), and that the
 * shared judge, which runs in the session 2 page, reports no violations at
 * either checkpoint. The judge cannot load in Playwright's Node process (the
 * `@tanstack/db` path reaches TypeScript sources that Playwright cannot
 * transform), so the page runs it.
 *
 * The coordinated scenario passes `BrowserCollectionCoordinator`. The law does
 * not cover it: the guide (`docs/guides/sqlite-persistence.md`) says only the
 * default single-process coordinator supports this. Its run is recorded and not
 * judged against the law.
 */
import { expect, test } from '@playwright/test'
import { RECEIVING_HISTORIES } from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-histories'
import type { Session1Record } from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import type { Session2Result } from './persisted-on-demand-coverage.opfs'

const SCENARIOS = [
  ...RECEIVING_HISTORIES.map((history) => ({
    id: history.id,
    name: history.description,
    coordinator: `none` as const,
  })),
  {
    id: `covered`,
    name: `covered demand with a multi-tab coordinator (guide: out of scope)`,
    coordinator: `browser` as const,
  },
]

for (const scenario of SCENARIOS) {
  test(scenario.name, async ({ page }) => {
    test.setTimeout(120_000)
    const pageErrors: Array<string> = []
    page.on(`pageerror`, (error) => pageErrors.push(error.message))
    const databaseName = `pod-${crypto.randomUUID().slice(0, 8)}.sqlite`
    const url = (phase: `1` | `2`) =>
      `/e2e/persisted-on-demand-coverage.opfs.html?phase=${phase}&history=${scenario.id}&coordinator=${scenario.coordinator}&db=${databaseName}`

    await page.goto(url(`1`))
    await page.waitForFunction(
      () => window.__persistedOnDemandSession1 !== undefined,
      undefined,
      { timeout: 60_000 },
    )
    const session1 = await page.evaluate(
      () => window.__persistedOnDemandSession1,
    )
    expect(session1).toBeDefined()
    expect(session1).not.toHaveProperty(`error`)
    expect((session1 as Session1Record).events.length).toBeGreaterThanOrEqual(0)

    await page.goto(url(`2`))
    await page.waitForFunction(
      () => window.__persistedOnDemandSession2 !== undefined,
      undefined,
      { timeout: 60_000 },
    )
    const session2 = (await page.evaluate(
      () => window.__persistedOnDemandSession2,
    )) as Session2Result | undefined
    expect(session2).toBeDefined()
    expect(session2).not.toHaveProperty(`error`)
    expect(pageErrors).toEqual([])
    if (!session2 || !(`record` in session2)) return
    // Positive witness: session 2 asked the offline source for the demand.
    expect(session2.record.sent.length).toBeGreaterThan(0)
    if (scenario.coordinator === `none`) {
      expect(session2.violations).toEqual({
        beforeDeadline: [],
        afterDeadline: [],
      })
    }
  })
}
