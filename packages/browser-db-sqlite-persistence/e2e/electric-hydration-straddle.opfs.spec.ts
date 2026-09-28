/**
 * A source sync transaction may begin while local hydration runs and commit
 * after that hydration scope closes. PostgreSQL supplies the expected row;
 * public Collection rows and the OPFS resume snapshot must retain it at the
 * settled cut and after leadership transfer and reopen. The controlled holds
 * prove this exact timing, not every Electric response schedule or browser.
 */
import { expect, test } from '@playwright/test'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import type { Page } from '@playwright/test'
import type {
  HydrationStraddleObservation,
  HydrationStraddleReach,
} from './electric-hydration-straddle.opfs'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function diagnostic(page: Page): Promise<string> {
  try {
    if (page.isClosed()) return `page closed`
    return JSON.stringify(
      (await page.evaluate(() =>
        window.__electricHydrationStraddleProbe?.diagnostic(),
      )) ?? { probe: `unavailable` },
    )
  } catch (error) {
    return `probe diagnostic unavailable: ${errorMessage(error)}`
  }
}

async function openProbe(page: Page, url: string): Promise<void> {
  const pageErrors: Array<string> = []
  page.on(`pageerror`, (error) => pageErrors.push(error.message))
  try {
    await page.goto(url, { waitUntil: `commit` })
    await page.waitForFunction(
      () => window.__electricHydrationStraddleProbe !== undefined,
      undefined,
      { timeout: 60_000 },
    )
    const state = await page.evaluate(() =>
      window.__electricHydrationStraddleProbe!.diagnostic(),
    )
    if (state.phase === `failed`) throw new Error(state.failure)
  } catch (error) {
    throw new Error(
      `Electric hydration-straddle page failed: ${errorMessage(error)}; ` +
        `page errors: ${JSON.stringify(pageErrors)}; ` +
        `diagnostic: ${await diagnostic(page)}`,
      { cause: error },
    )
  }
}

async function reach(page: Page): Promise<HydrationStraddleReach> {
  return page.evaluate(() => window.__electricHydrationStraddleProbe!.reach())
}

async function observe(page: Page): Promise<HydrationStraddleObservation> {
  return page.evaluate(() => window.__electricHydrationStraddleProbe!.observe())
}

async function expectExactRow(
  page: Page,
  row: { id: string; label: string },
): Promise<void> {
  await expect
    .poll(
      async () => {
        const { phase, status, publicRows, durableRows } = await observe(page)
        return { phase, status, publicRows, durableRows }
      },
      { timeout: 60_000, message: await diagnostic(page) },
    )
    .toEqual({
      phase: `ready`,
      status: `ready`,
      publicRows: [row],
      durableRows: [row],
    })
}

test(`a live Electric row commits after OPFS hydration closes and survives handoff and reopen`, async ({
  context,
}) => {
  const token = crypto.randomUUID().replaceAll(`-`, ``).slice(0, 12)
  const databaseId = `electric-1754-${token}`
  const collectionId = `${databaseId}-rows`
  const table = `electric_1754_${token}`
  const parameters = new URLSearchParams({ databaseId, collectionId, table })
  const urlFor = (mode: `controlled` | `plain`) =>
    `/e2e/electric-hydration-straddle.opfs.html?${parameters}&mode=${mode}`
  const initialRow = { id: `one`, label: `source row` }
  const updatedRow = { id: `one`, label: `source update` }
  const postgres = makePgClient()
  const pages: Array<Page> = []
  const cleanupFailures: Array<string> = []
  let connected = false
  let primaryFailure: unknown

  try {
    await postgres.connect()
    connected = true
    await postgres.query(
      `CREATE TABLE public.${table} (id TEXT PRIMARY KEY, label TEXT NOT NULL)`,
    )
    await postgres.query(
      `INSERT INTO public.${table} (id, label) VALUES ($1, $2)`,
      [initialRow.id, initialRow.label],
    )

    const leader = await context.newPage()
    pages.push(leader)
    await openProbe(leader, urlFor(`controlled`))
    await expectExactRow(leader, initialRow)
    await leader.evaluate(() =>
      window.__electricHydrationStraddleProbe!.startHydration(),
    )
    await expect
      .poll(() => reach(leader), {
        timeout: 60_000,
        message: await diagnostic(leader),
      })
      .toMatchObject({
        hydrationLoadReturned: true,
        hydrationHeld: true,
        hydrationScopeExited: false,
        rowCommitApplied: false,
      })
    await postgres.query(
      `UPDATE public.${table} SET label = $1 WHERE id = $2`,
      [updatedRow.label, updatedRow.id],
    )
    await expect
      .poll(() => reach(leader), {
        timeout: 60_000,
        message: await diagnostic(leader),
      })
      .toMatchObject({
        sourceBeginDuringHydration: true,
        rowCommitParked: true,
        hydrationScopeExited: false,
        rowCommitApplied: false,
      })
    await leader.evaluate(() =>
      window.__electricHydrationStraddleProbe!.releaseHydration(),
    )
    await expect
      .poll(() => reach(leader), {
        timeout: 30_000,
        message: await diagnostic(leader),
      })
      .toMatchObject({ hydrationScopeExited: true, rowCommitApplied: false })
    const beforeCommit = await observe(leader)
    expect(beforeCommit.publicRows).toEqual([initialRow])
    expect(beforeCommit.durableRows).toEqual([initialRow])
    await leader.evaluate(() =>
      window.__electricHydrationStraddleProbe!.releaseCommit(),
    )
    await expectExactRow(leader, updatedRow)
    expect((await reach(leader)).rowCommitApplied).toBe(true)
    await expect
      .poll(async () => (await reach(leader)).subsetDemandSettled, {
        timeout: 30_000,
        message: await diagnostic(leader),
      })
      .toBe(true)
    expect((await observe(leader)).phase).toBe(`ready`)
    expect((await observe(leader)).isLeader).toBe(true)

    const follower = await context.newPage()
    pages.push(follower)
    await openProbe(follower, urlFor(`plain`))
    await expectExactRow(follower, updatedRow)
    expect((await observe(follower)).isLeader).toBe(false)

    cleanupFailures.push(...(await closeProbe(leader)))
    await expect
      .poll(async () => (await observe(follower)).isLeader, {
        timeout: 30_000,
      })
      .toBe(true)
    await expectExactRow(follower, updatedRow)
    cleanupFailures.push(...(await closeProbe(follower)))

    const reopened = await context.newPage()
    pages.push(reopened)
    await openProbe(reopened, urlFor(`plain`))
    await expectExactRow(reopened, updatedRow)
  } catch (error) {
    primaryFailure = error
  }

  for (const page of pages.reverse()) {
    try {
      if (!page.isClosed()) cleanupFailures.push(...(await closeProbe(page)))
    } catch (error) {
      cleanupFailures.push(`probe cleanup: ${errorMessage(error)}`)
      try {
        if (!page.isClosed()) await page.close()
      } catch (closeError) {
        cleanupFailures.push(`page close: ${errorMessage(closeError)}`)
      }
    }
  }
  if (connected) {
    try {
      await postgres.query(`DROP TABLE IF EXISTS public.${table}`)
    } catch (error) {
      cleanupFailures.push(`PostgreSQL cleanup: ${errorMessage(error)}`)
    }
    try {
      await postgres.end()
    } catch (error) {
      cleanupFailures.push(`PostgreSQL close: ${errorMessage(error)}`)
    }
  }
  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((message) => new Error(message)),
      `The live Electric hydration-straddle oracle and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
})

async function closeProbe(page: Page): Promise<Array<string>> {
  const failures = await page.evaluate(
    () => window.__electricHydrationStraddleProbe?.cleanup() ?? [],
  )
  await page.close()
  return failures
}
