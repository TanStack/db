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
import type {
  ImmediateReloadObservation,
  ImmediateReloadPublicObservation,
} from './electric-immediate-reload-oracle.opfs'

const pageErrors = new WeakMap<Page, Array<string>>()

function recordInsertRequests(page: Page): Array<string> {
  const requests: Array<string> = []
  page.on(`request`, (request) => {
    if (
      request.method() === `POST` &&
      new URL(request.url()).pathname === `/__issue1456/insert`
    ) {
      requests.push(request.url())
    }
  })
  return requests
}

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
    await page.goto(url, { waitUntil: `commit` })
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

async function observePublic(
  page: Page,
): Promise<ImmediateReloadPublicObservation> {
  return page.evaluate(() =>
    window.__electricImmediateReloadProbe!.observePublic(),
  )
}

function expectedPublicObservation(
  expected: ImmediateReloadObservation,
): ImmediateReloadPublicObservation {
  return {
    phase: expected.phase,
    ...(expected.failure !== undefined ? { failure: expected.failure } : {}),
    status: expected.status,
    insertAcknowledged: expected.insertAcknowledged,
    sourcePersistenceHeld: expected.sourcePersistenceHeld,
    publicRows: expected.publicRows,
  }
}

async function pollExpectedObservation(
  expected: ImmediateReloadObservation,
  readPublic: () => Promise<ImmediateReloadPublicObservation>,
  readFull: () => Promise<ImmediateReloadObservation>,
  timeout = 60_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await readPublic()
        if (state.phase === `failed`) {
          throw new Error(state.failure || `Probe failed without a message`)
        }
        return state
      },
      { timeout },
    )
    .toEqual(expectedPublicObservation(expected))
  await expect
    .poll(
      async () => {
        const state = await readFull()
        if (state.phase === `failed`) {
          throw new Error(state.failure || `Probe failed without a message`)
        }
        return state
      },
      { timeout },
    )
    .toEqual(expected)
}

async function expectObservation(
  page: Page,
  expected: ImmediateReloadObservation,
): Promise<void> {
  try {
    await pollExpectedObservation(
      expected,
      () => observePublic(page),
      () => observe(page),
    )
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
    const reopenedInsertRequests = recordInsertRequests(reopened)
    await openProbe(reopened, urlFor(`plain`))
    const beforeRecovery = await observe(reopened)
    expect(beforeRecovery).toEqual({
      phase: `before-source-start`,
      status: `unavailable`,
      insertAcknowledged: false,
      sourcePersistenceHeld: false,
      publicRows: [],
      durableRows: [],
    })
    await reopened.evaluate(() =>
      window.__electricImmediateReloadProbe!.releaseRecoveryStart(),
    )
    await expectObservation(reopened, {
      phase: `ready`,
      status: `ready`,
      insertAcknowledged: false,
      sourcePersistenceHeld: false,
      publicRows: [row],
      durableRows: [row],
    })
    expect(reopenedInsertRequests).toEqual([])
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

test(`records only insert posts on the observed page`, () => {
  let onRequest:
    | ((request: { method: () => string; url: () => string }) => void)
    | undefined
  const page = {
    on: (
      event: string,
      listener: (request: { method: () => string; url: () => string }) => void,
    ) => {
      if (event === `request`) onRequest = listener
    },
  } as unknown as Page
  const requests = recordInsertRequests(page)
  const emit = (method: string, url: string) => {
    onRequest!({ method: () => method, url: () => url })
  }

  emit(`GET`, `http://example.test/__issue1456/insert`)
  emit(`POST`, `http://example.test/unrelated`)
  emit(`POST`, `http://example.test/__issue1456/insert`)
  expect(requests).toEqual([`http://example.test/__issue1456/insert`])
})

test(`waits for public rows before reading and then checks durable rows`, async () => {
  const row = { id: `one`, label: `inserted on server` }
  const expected: ImmediateReloadObservation = {
    phase: `ready`,
    status: `ready`,
    insertAcknowledged: false,
    sourcePersistenceHeld: false,
    publicRows: [row],
    durableRows: [row],
  }
  let publicReads = 0
  let fullSnapshotReads = 0

  await pollExpectedObservation(
    expected,
    () => {
      publicReads++
      return Promise.resolve({
        ...expectedPublicObservation(expected),
        publicRows: publicReads < 3 ? [] : [row],
      })
    },
    () => {
      fullSnapshotReads++
      return Promise.resolve({
        ...expected,
        durableRows: fullSnapshotReads < 2 ? [] : [row],
      })
    },
    5_000,
  )
  expect(publicReads).toBe(3)
  expect(fullSnapshotReads).toBe(2)
})

test(`reports a failed probe even when its error message is empty`, async () => {
  const page = {
    on: () => undefined,
    goto: () => Promise.resolve(),
    waitForFunction: () => Promise.resolve(),
    evaluate: () => Promise.resolve({ phase: `failed`, failure: `` }),
    isClosed: () => false,
  } as unknown as Page

  const failure: unknown = await openProbe(page, `/unused`).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(String(failure)).toContain(`Probe failed without a message`)
})

test(`reports terminal failure without polling for durable rows`, async () => {
  test.setTimeout(10_000)
  let observations = 0
  const page = {
    isClosed: () => false,
    evaluate: () => {
      observations++
      return Promise.resolve({ phase: `failed`, failure: `source rejected` })
    },
  } as unknown as Page

  const failure: unknown = await expectObservation(page, {
    phase: `ready`,
    status: `ready`,
    insertAcknowledged: true,
    sourcePersistenceHeld: true,
    publicRows: [],
    durableRows: [],
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(String(failure)).toContain(`source rejected`)
  expect(observations).toBe(2)
})

test(`includes page errors that occur after probe startup`, async () => {
  let onPageError: ((error: Error) => void) | undefined
  const page = {
    on: (event: string, listener: (error: Error) => void) => {
      if (event === `pageerror`) onPageError = listener
    },
    goto: () => Promise.resolve(),
    waitForFunction: () => Promise.resolve(),
    evaluate: () => Promise.resolve({ phase: `ready`, status: `ready` }),
    isClosed: () => false,
  } as unknown as Page

  await openProbe(page, `/unused`)
  expect(onPageError).toBeDefined()
  onPageError!(new Error(`late page failure`))
  expect(await diagnostic(page)).toContain(`late page failure`)
})

test(`retains page errors when a diagnostic sees a closed page`, async () => {
  const page = { isClosed: () => true } as unknown as Page
  pageErrors.set(page, [`page closed after failure`])
  expect(await diagnostic(page)).toContain(`page closed after failure`)
})
