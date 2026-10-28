/**
 * Cold-successor checkpoint for the leader-close law in
 * `leader-close-oracle.opfs.spec.ts`, which owns the law and its histories.
 * This scenario states its own hand-written term and row expectations.
 */
import { expect, test } from '@playwright/test'
import { observe, openProbe } from './leader-close-probe'
import type { Page } from '@playwright/test'

// The cold successor is opened only after the idle owner closes. It cannot
// have learned that owner's term from a heartbeat. Real OPFS SQLite must
// retain the no-write election reservation across page lifetimes, and the
// new owner must use the next term for its first public source receipt.
test(`cold OPFS successor reserves a new term after a no-write leader closes`, async ({
  context,
}) => {
  const databaseId = `leader-close-${crypto.randomUUID()}`
  const pageUrl = (role: `leader` | `follower`) =>
    `/e2e/leader-close.opfs.html?databaseId=${databaseId}&role=${role}&hold=none`
  const pages: Array<Page> = []
  const cleanupFailures: Array<string> = []
  let primaryFailure: unknown
  try {
    const former = await context.newPage()
    pages.push(former)
    await openProbe(former, pageUrl(`leader`))
    await expect.poll(async () => (await observe(former)).isLeader).toBe(true)
    expect(
      await former.evaluate(() => window.__leaderCloseProbe!.durableState()),
    ).toMatchObject({ term: 1, rowVersion: 0, ids: [] })
    await former.close()

    const successor = await context.newPage()
    pages.push(successor)
    await openProbe(successor, pageUrl(`follower`))
    await expect
      .poll(async () => (await observe(successor)).isLeader)
      .toBe(true)
    expect(
      await successor.evaluate(() => window.__leaderCloseProbe!.durableState()),
    ).toMatchObject({ term: 2, rowVersion: 0, ids: [] })
    expect(
      await successor.evaluate(() =>
        window.__leaderCloseProbe!.commitNext(`later`),
      ),
    ).toEqual({ status: `fulfilled` })
    expect(
      await successor.evaluate(() => window.__leaderCloseProbe!.durableState()),
    ).toMatchObject({ term: 2, rowVersion: 1, ids: [`later`] })
    expect((await observe(successor)).publicIds).toEqual([`later`])
  } catch (error) {
    primaryFailure = error
  }
  for (const page of pages.reverse()) {
    try {
      if (page.isClosed()) continue
      cleanupFailures.push(
        ...(await page.evaluate(
          () => window.__leaderCloseProbe?.cleanup() ?? [],
        )),
      )
      await page.close()
    } catch (error) {
      cleanupFailures.push(`page cleanup: ${String(error)}`)
      await page.close().catch(() => undefined)
    }
  }
  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((message) => new Error(message)),
      `Cold leader-close oracle and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
})
