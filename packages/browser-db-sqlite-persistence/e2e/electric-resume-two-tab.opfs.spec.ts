/**
 * The independent source is PostgreSQL: each table has two known rows. The
 * browser driver runs real Electric streams through two OPFS tabs with distinct
 * per-collection schema versions. At each cut, public and durable rows must
 * equal the source rows, and merely opening another tab must not reset either
 * collection. Partial-row loss and a fully empty legacy baseline with a stale
 * resume marker must request a fresh source snapshot after reopen. These
 * bounded host histories do not choose the general exclusive-OPFS ownership
 * topology or prove Firefox/Zen behavior.
 */
import { expect, test } from '@playwright/test'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import type { BrowserContext, Page } from '@playwright/test'
import type {
  ElectricOPFSObservation,
  LegacyPoisonObservation,
} from './electric-resume-two-tab.opfs'

type SourceRows = {
  a: Array<{ id: string; label: string }>
  b: Array<{ id: string; label: string }>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pageDiagnostic(page: Page): Promise<string> {
  try {
    if (page.isClosed()) return `page closed`
    const diagnostic = await page.evaluate(() =>
      window.__electricOPFSProbe?.diagnostic(),
    )
    return JSON.stringify(diagnostic ?? { probe: `unavailable` })
  } catch (error) {
    return `probe diagnostic unavailable: ${errorMessage(error)}`
  }
}

async function openProbe(page: Page, url: string): Promise<void> {
  const pageErrors: Array<string> = []
  page.on(`pageerror`, (error) => pageErrors.push(error.message))
  try {
    await page.goto(url)
    await page.waitForFunction(
      () =>
        window.__electricOPFSProbe !== undefined &&
        window.__electricOPFSProbe.phase() !== `starting`,
      undefined,
      { timeout: 60_000 },
    )
    const observation = await page.evaluate(() =>
      window.__electricOPFSProbe!.observe(),
    )
    if (observation.phase === `failed`) {
      throw new Error(observation.failure)
    }
  } catch (error) {
    const diagnostic = await pageDiagnostic(page)
    throw new Error(
      `Electric OPFS page failed: ${errorMessage(error)}; ` +
        `page errors: ${JSON.stringify(pageErrors)}; diagnostic: ${diagnostic}`,
      { cause: error },
    )
  }
}

async function observe(page: Page): Promise<ElectricOPFSObservation> {
  return page.evaluate(() => window.__electricOPFSProbe!.observe())
}

function expectedRows(
  source: SourceRows,
): Array<Array<{ id: string; label: string }>> {
  return [source.a, source.b].map((rows) =>
    [...rows].sort((left, right) => left.id.localeCompare(right.id)),
  )
}

async function expectExactRows(page: Page, source: SourceRows): Promise<void> {
  const expected = expectedRows(source)
  await expect
    .poll(
      async () => {
        const result = await observe(page)
        return result.collections.map(
          ({ status, publicRows, durableRows }) => ({
            status,
            publicRows,
            durableRows,
          }),
        )
      },
      { timeout: 60_000 },
    )
    .toEqual(
      expected.map((rows) => ({
        status: `ready`,
        publicRows: rows,
        durableRows: rows,
      })),
    )
}

async function closeProbe(page: Page): Promise<Array<string>> {
  const failures = await page.evaluate(
    () => window.__electricOPFSProbe?.cleanup() ?? [],
  )
  await page.close()
  return failures
}

async function cleanupPages(
  pages: Array<Page>,
  cleanupFailures: Array<string>,
): Promise<void> {
  for (const page of pages.reverse()) {
    try {
      if (page.isClosed()) continue
      cleanupFailures.push(...(await closeProbe(page)))
    } catch (error) {
      cleanupFailures.push(`probe cleanup: ${errorMessage(error)}`)
      try {
        if (!page.isClosed()) await page.close()
      } catch (closeError) {
        cleanupFailures.push(`page close: ${errorMessage(closeError)}`)
      }
    }
  }
}

const legacyLossCases = [
  { name: `partially torn`, missingIds: [`a1`], rowsAfter: 1 },
  { name: `fully empty`, missingIds: [`a1`, `a2`], rowsAfter: 0 },
] as const

async function runHistory(
  context: BrowserContext,
  legacyLoss: (typeof legacyLossCases)[number],
): Promise<void> {
  const token = crypto.randomUUID().replaceAll(`-`, ``).slice(0, 12)
  const databaseId = `electric-1589-${token}`
  const collectionAId = `${databaseId}-a`
  const collectionBId = `${databaseId}-b`
  const tableA = `electric_1589_a_${token}`
  const tableB = `electric_1589_b_${token}`
  const parameters = new URLSearchParams({
    databaseId,
    collectionAId,
    collectionBId,
    tableA,
    tableB,
  })
  const urlFor = (mode: `normal` | `maintenance`) =>
    `/e2e/electric-resume-two-tab.opfs.html?${parameters}&mode=${mode}`
  const source: SourceRows = {
    a: [{ id: `a1`, label: `A one` }],
    b: [{ id: `b1`, label: `B one` }],
  }
  const postgres = makePgClient()
  const pages: Array<Page> = []
  const cleanupFailures: Array<string> = []
  let connected = false
  let primaryFailure: unknown

  try {
    await postgres.connect()
    connected = true
    await postgres.query(
      `CREATE TABLE public.${tableA} (id TEXT PRIMARY KEY, label TEXT NOT NULL)`,
    )
    await postgres.query(
      `CREATE TABLE public.${tableB} (id TEXT PRIMARY KEY, label TEXT NOT NULL)`,
    )
    await postgres.query(
      `INSERT INTO public.${tableA} (id, label) VALUES ($1, $2)`,
      [`a1`, `A one`],
    )
    await postgres.query(
      `INSERT INTO public.${tableB} (id, label) VALUES ($1, $2)`,
      [`b1`, `B one`],
    )

    const leader = await context.newPage()
    pages.push(leader)
    await openProbe(leader, urlFor(`normal`))
    await expectExactRows(leader, source)
    const initial = await observe(leader)
    expect(
      initial.collections.map(({ schemaVersion }) => schemaVersion),
    ).toEqual([1, 2])
    expect(initial.collections.map(({ isLeader }) => isLeader)).toEqual([
      true,
      true,
    ])
    for (const collection of initial.collections) {
      expect(collection.resume).toMatchObject({ kind: `resume` })
    }
    const resetEpochs = initial.collections.map(({ resetEpoch }) => resetEpoch)

    const follower = await context.newPage()
    pages.push(follower)
    await openProbe(follower, urlFor(`normal`))
    await expectExactRows(follower, source)
    const second = await observe(follower)
    expect(second.collections.map(({ isLeader }) => isLeader)).toEqual([
      false,
      false,
    ])
    expect(second.collections.map(({ resetEpoch }) => resetEpoch)).toEqual(
      resetEpochs,
    )
    await expectExactRows(leader, source)
    expect(
      (await observe(leader)).collections.map(({ resetEpoch }) => resetEpoch),
    ).toEqual(resetEpochs)

    cleanupFailures.push(...(await closeProbe(leader)))
    await expect
      .poll(
        async () =>
          (await observe(follower)).collections.map(({ isLeader }) => isLeader),
        { timeout: 30_000 },
      )
      .toEqual([true, true])

    source.a.push({ id: `a2`, label: `A two` })
    source.b.push({ id: `b2`, label: `B two` })
    await postgres.query(
      `INSERT INTO public.${tableA} (id, label) VALUES ($1, $2)`,
      [`a2`, `A two`],
    )
    await postgres.query(
      `INSERT INTO public.${tableB} (id, label) VALUES ($1, $2)`,
      [`b2`, `B two`],
    )
    await expectExactRows(follower, source)
    expect(
      (await observe(follower)).collections.map(({ resetEpoch }) => resetEpoch),
    ).toEqual(resetEpochs)
    cleanupFailures.push(...(await closeProbe(follower)))

    const maintenance = await context.newPage()
    pages.push(maintenance)
    await openProbe(maintenance, urlFor(`maintenance`))
    const poison: LegacyPoisonObservation = await maintenance.evaluate(
      ({ collectionId, missingIds }) =>
        window.__electricOPFSProbe!.poisonLegacy(collectionId, missingIds),
      { collectionId: collectionAId, missingIds: legacyLoss.missingIds },
    )
    expect(poison).toMatchObject({
      rowsBefore: 2,
      rowsAfter: legacyLoss.rowsAfter,
      metadataPreserved: true,
    })
    cleanupFailures.push(...(await closeProbe(maintenance)))

    const recovered = await context.newPage()
    pages.push(recovered)
    await openProbe(recovered, urlFor(`normal`))
    await expectExactRows(recovered, source)
    const recovery = await observe(recovered)
    expect(
      recovery.collections.map(({ schemaVersion }) => schemaVersion),
    ).toEqual([1, 2])
    expect(recovery.collections.map(({ resetEpoch }) => resetEpoch)).toEqual(
      resetEpochs,
    )
    for (const collection of recovery.collections) {
      expect(collection.resume).toMatchObject({ kind: `resume` })
    }
    const firstARequest = recovery.shapeRequests.find(
      ({ table }) => table === `public.${tableA}`,
    )
    expect(firstARequest).toMatchObject({ offset: `-1`, handle: null })
    expect(firstARequest?.offset).not.toBe(poison.resumeOffset)
  } catch (error) {
    primaryFailure = error
  }

  await cleanupPages(pages, cleanupFailures)
  if (connected) {
    for (const table of [tableA, tableB]) {
      try {
        await postgres.query(`DROP TABLE IF EXISTS public.${table}`)
      } catch (error) {
        cleanupFailures.push(
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    try {
      await postgres.end()
    } catch (error) {
      cleanupFailures.push(
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((message) => new Error(message)),
      `The live Electric OPFS oracle and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
}

for (const legacyLoss of legacyLossCases) {
  test(`two OPFS tabs with live Electric preserve distinct schemas and recover a ${legacyLoss.name} legacy baseline`, async ({
    context,
  }) => runHistory(context, legacyLoss))
}

test(`keeps the page failure primary when the diagnostic read also fails`, async () => {
  const navigationFailure = new Error(`navigation failed`)
  const page = {
    on: () => undefined,
    goto: () => Promise.reject(navigationFailure),
    isClosed: () => false,
    evaluate: () => Promise.reject(new Error(`diagnostic failed`)),
  } as unknown as Page

  const failure: unknown = await openProbe(page, `/unavailable`).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toMatchObject({ cause: navigationFailure })
  expect(String(failure)).toContain(`diagnostic failed`)
})

test(`records cleanup and fallback page-close failures separately`, async () => {
  const cleanupFailure = new Error(`cleanup failed`)
  const closeFailure = new Error(`close failed`)
  let closeAttempts = 0
  const page = {
    isClosed: () => false,
    evaluate: () => Promise.reject(cleanupFailure),
    close: () => {
      closeAttempts++
      return Promise.reject(closeFailure)
    },
  } as unknown as Page
  const failures: Array<string> = []

  await cleanupPages([page], failures)
  expect(failures).toEqual([
    `probe cleanup: cleanup failed`,
    `page close: close failed`,
  ])
  expect(closeAttempts).toBe(1)
})
