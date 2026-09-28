/**
 * PostgreSQL commits the expected row. After the reporter-style onInsert
 * awaits Electric's txid, the first page is closed before its OPFS write can
 * start. A new page must recover the row from Electric and persist it locally.
 * This bounded Chromium history does not establish Windows/Edge behavior or
 * change awaitTxId into a SQLite durability acknowledgment.
 */
import { expect, test } from '@playwright/test'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import type { Page } from '@playwright/test'
import type { ImmediateReloadObservation } from './electric-immediate-reload.opfs'

const pageErrors = new WeakMap<Page, Array<string>>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function diagnostic(page: Page): Promise<string> {
  const errors = pageErrors.get(page) ?? []
  try {
    if (page.isClosed()) return JSON.stringify({ page: `closed`, errors })
    return JSON.stringify({
      observation: await page.evaluate(() =>
        window.__electricImmediateReloadProbe?.observe(),
      ),
      errors,
    })
  } catch (error) {
    return JSON.stringify({ diagnosticError: errorMessage(error), errors })
  }
}

async function openProbe(page: Page, url: string): Promise<void> {
  const errors: Array<string> = []
  pageErrors.set(page, errors)
  page.on(`pageerror`, (error) => errors.push(error.message))
  try {
    await page.goto(url)
    await page.waitForFunction(
      () =>
        window.__electricImmediateReloadProbe !== undefined &&
        window.__electricImmediateReloadProbe.phase() !== `starting`,
      undefined,
      { timeout: 60_000 },
    )
    const state = await observe(page)
    if (state.phase === `failed`) {
      throw new Error(state.failure || `Probe failed without a message`)
    }
  } catch (error) {
    throw new Error(
      `Electric immediate-reload page failed: ${errorMessage(error)}; ` +
        `diagnostic: ${await diagnostic(page)}`,
      { cause: error },
    )
  }
}

async function observe(page: Page): Promise<ImmediateReloadObservation> {
  return page.evaluate(() => window.__electricImmediateReloadProbe!.observe())
}

async function expectObservation(
  page: Page,
  expected: ImmediateReloadObservation,
): Promise<void> {
  try {
    await expect
      .poll(
        async () => {
          const state = await observe(page)
          if (state.phase === `failed`) {
            throw new Error(state.failure || `Probe failed without a message`)
          }
          return state
        },
        { timeout: 60_000 },
      )
      .toEqual(expected)
  } catch (error) {
    throw new Error(
      `${errorMessage(error)}\ndiagnostic: ${await diagnostic(page)}`,
      { cause: error },
    )
  }
}

test(`an Electric-acknowledged insert survives an immediate reload before its OPFS write`, async ({
  context,
}) => {
  const token = crypto.randomUUID().replaceAll(`-`, ``).slice(0, 12)
  const databaseId = `electric-1456-${token}`
  const collectionId = `${databaseId}-rows`
  const table = `electric_1456_${token}`
  const row = { id: `one`, label: `inserted on server` }
  const parameters = new URLSearchParams({ databaseId, collectionId, table })
  const urlFor = (mode: `hold` | `plain`) =>
    `/e2e/electric-immediate-reload.opfs.html?${parameters}&mode=${mode}`
  const postgres = makePgClient()
  const pages: Array<Page> = []
  const cleanupFailures: Array<string> = []
  let insertRequests = 0
  let connected = false
  let primaryFailure: unknown

  try {
    await postgres.connect()
    connected = true
    await postgres.query(
      `CREATE TABLE public.${table} (id TEXT PRIMARY KEY, label TEXT NOT NULL)`,
    )

    const first = await context.newPage()
    pages.push(first)
    await first.route(`**/__issue1456/insert`, async (route) => {
      try {
        insertRequests++
        const payload: unknown = route.request().postDataJSON()
        if (
          !payload ||
          typeof payload !== `object` ||
          !(`id` in payload) ||
          !(`label` in payload) ||
          payload.id !== row.id ||
          payload.label !== row.label
        ) {
          throw new Error(`Unexpected insert payload`)
        }
        await postgres.query(`BEGIN`)
        try {
          await postgres.query(
            `INSERT INTO public.${table} (id, label) VALUES ($1, $2)`,
            [row.id, row.label],
          )
          const result = await postgres.query<{ txid: string }>(
            `SELECT txid_current()::text AS txid`,
          )
          await postgres.query(`COMMIT`)
          const txid = Number(result.rows[0]?.txid)
          if (!Number.isSafeInteger(txid)) {
            throw new Error(`PostgreSQL returned an unsafe txid`)
          }
          await route.fulfill({ json: { txid } })
        } catch (error) {
          await postgres.query(`ROLLBACK`)
          throw error
        }
      } catch (error) {
        cleanupFailures.push(`insert route: ${errorMessage(error)}`)
        await route.fulfill({ status: 500, body: errorMessage(error) })
      }
    })
    await openProbe(first, urlFor(`hold`))
    await expectObservation(first, {
      phase: `ready`,
      status: `ready`,
      insertAcknowledged: false,
      sourcePersistenceHeld: false,
      publicRows: [],
      durableRows: [],
    })
    await first.evaluate(
      (inserted) => window.__electricImmediateReloadProbe!.insert(inserted),
      row,
    )
    await expectObservation(first, {
      phase: `ready`,
      status: `ready`,
      insertAcknowledged: true,
      sourcePersistenceHeld: true,
      publicRows: [row],
      durableRows: [],
    })
    expect(insertRequests).toBe(1)
    expect(pageErrors.get(first)).toEqual([])
    const sourceRows = await postgres.query<{ id: string; label: string }>(
      `SELECT id, label FROM public.${table} ORDER BY id`,
    )
    expect(sourceRows.rows).toEqual([row])

    // Do not call probe.cleanup(): that would release the held write. Closing
    // the page simulates the refresh/crash boundary the reporter described.
    await first.close()
    const reopened = await context.newPage()
    pages.push(reopened)
    await openProbe(reopened, urlFor(`plain`))
    await expectObservation(reopened, {
      phase: `ready`,
      status: `ready`,
      insertAcknowledged: false,
      sourcePersistenceHeld: false,
      publicRows: [row],
      durableRows: [row],
    })
    expect(pageErrors.get(reopened)).toEqual([])
  } catch (error) {
    primaryFailure = error
  }

  for (const page of pages.reverse()) {
    try {
      if (page.isClosed()) continue
      cleanupFailures.push(
        ...(await page.evaluate(
          () => window.__electricImmediateReloadProbe?.cleanup() ?? [],
        )),
      )
      await page.close()
    } catch (error) {
      cleanupFailures.push(`page cleanup: ${errorMessage(error)}`)
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
      cleanupFailures.push(`PostgreSQL table cleanup: ${errorMessage(error)}`)
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
      `Immediate-reload witness and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
})
