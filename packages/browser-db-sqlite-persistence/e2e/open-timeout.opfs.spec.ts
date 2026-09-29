/**
 * A held native Web Lock models a holder that cannot hand over its OPFS access
 * handle. The second tab's open must time out, release its worker's queued lock
 * request, and leave the database available for a fresh open after release.
 * This tests Chromium's OPFS worker boundary; it does not prove that CDP can
 * freeze a tab on every Chrome version or reproduce every browser lifecycle.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { BrowserWASQLiteDatabase } from '../src/wa-sqlite-driver'

type OpenState =
  | { status: `pending` }
  | { status: `opened` }
  | { status: `failed`; name: string; message: string }

type ProbeWindow = Window & {
  __releaseHeldLock?: () => void
  __openState?: OpenState
  __openDatabase?: BrowserWASQLiteDatabase
}

async function releaseHeldLock(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as ProbeWindow).__releaseHeldLock?.()
  })
}

async function hasPendingLock(page: Page, name: string): Promise<boolean> {
  return page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query()
    return (snapshot.pending ?? []).some((lock) => lock.name === lockName)
  }, name)
}

test(`an OPFS open deadline releases its queued worker and allows a later open`, async ({
  context,
}) => {
  const databaseName = `open-timeout-${crypto.randomUUID()}.sqlite`
  const lockName = `ahp:/${databaseName}`
  const timeoutMs = 15_000
  const pendingLockTimeoutMs = 10_000
  const pages: Array<Page> = []
  let holder: Page | undefined
  let contender: Page | undefined
  let primaryFailure: unknown

  try {
    holder = await context.newPage()
    pages.push(holder)
    contender = await context.newPage()
    pages.push(contender)
    await Promise.all([
      holder.goto(`/e2e/open-timeout.opfs.html`),
      contender.goto(`/e2e/open-timeout.opfs.html`),
    ])

    await holder.evaluate(async (name) => {
      const probe = window as ProbeWindow
      let acquired: () => void = () => {}
      const ready = new Promise<void>((resolve) => {
        acquired = resolve
      })
      void navigator.locks.request(name, async () => {
        await new Promise<void>((release) => {
          probe.__releaseHeldLock = release
          acquired()
        })
      })
      await ready
    }, lockName)

    await contender.evaluate(
      async ({ name, deadline }) => {
        const probe = window as ProbeWindow
        const modulePath = `/src/opfs-database.ts`
        const module = await import(modulePath)
        probe.__openState = { status: `pending` }
        void module
          .openBrowserWASQLiteOPFSDatabase({
            databaseName: name,
            timeoutMs: deadline,
          })
          .then(
            (database: BrowserWASQLiteDatabase) => {
              probe.__openDatabase = database
              probe.__openState = { status: `opened` }
            },
            (error: unknown) => {
              probe.__openState = {
                status: `failed`,
                name: error instanceof Error ? error.name : `NonError`,
                message: error instanceof Error ? error.message : String(error),
              }
            },
          )
      },
      { name: databaseName, deadline: timeoutMs },
    )

    await expect
      .poll(() => hasPendingLock(contender!, lockName), {
        timeout: pendingLockTimeoutMs,
        message: `The contender did not queue the held OPFS Web Lock`,
      })
      .toBe(true)

    await expect
      .poll(
        () => contender!.evaluate(() => (window as ProbeWindow).__openState),
        {
          timeout: timeoutMs + 5_000,
        },
      )
      .toEqual({
        status: `failed`,
        name: `TimeoutError`,
        message: `Opening browser OPFS database timed out after ${timeoutMs} ms`,
      })

    await expect
      .poll(() => hasPendingLock(contender!, lockName), { timeout: 5_000 })
      .toBe(false)

    await releaseHeldLock(holder)
    const reopened = await contender.evaluate(async (name) => {
      const modulePath = `/src/opfs-database.ts`
      const module = await import(modulePath)
      const database = await module.openBrowserWASQLiteOPFSDatabase({
        databaseName: name,
        timeoutMs: 5_000,
      })
      try {
        return await database.execute(`SELECT 1 AS value`)
      } finally {
        await database.close?.()
      }
    }, databaseName)
    expect(reopened).toEqual([{ value: 1 }])
    expect(
      await contender.evaluate(() => (window as ProbeWindow).__openState),
    ).toEqual({
      status: `failed`,
      name: `TimeoutError`,
      message: `Opening browser OPFS database timed out after ${timeoutMs} ms`,
    })
    expect(
      await contender.evaluate(
        () => (window as ProbeWindow).__openDatabase !== undefined,
      ),
    ).toBe(false)
  } catch (error) {
    primaryFailure = error
  }

  const cleanupFailures: Array<Error> = []
  if (holder) {
    try {
      await releaseHeldLock(holder)
    } catch (error) {
      cleanupFailures.push(
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  }
  if (contender) {
    try {
      await contender.evaluate(() =>
        (window as ProbeWindow).__openDatabase?.close?.(),
      )
    } catch (error) {
      cleanupFailures.push(
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  }
  for (const page of pages.reverse()) {
    try {
      await page.close()
    } catch (error) {
      cleanupFailures.push(
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  }

  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      `OPFS open and cleanup both failed`,
      {
        cause: primaryFailure,
      },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
})
