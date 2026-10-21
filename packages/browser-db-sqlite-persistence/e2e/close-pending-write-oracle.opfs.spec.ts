/**
 * Real-provider witness for the OPFS worker request-order oracle. A connection
 * that must wait for its OPFS access handle still answers its earlier write
 * before close settles, close succeeds, and work submitted after close starts
 * is refused. The answered write is durable across a reopen.
 *
 * The page takes the access handle with OPFSCoopSyncVFS's own handoff: it
 * notifies the handle's BroadcastChannel and holds the matching Web Lock. The
 * connection's next write then waits in wa-sqlite's retry loop, which is the
 * suspension the Node request-order oracle models. This checks one Chromium
 * history; it does not prove other browsers, frozen tabs, or a crash between
 * the write and close.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

type Settlement =
  | { label: string; status: `fulfilled`; value: unknown }
  | { label: string; status: `rejected`; name: string; message: string }

type ProbeWindow = Window & {
  __settlements?: Array<Settlement>
  __releaseHandle?: () => void
  __database?: {
    execute: (sql: string) => Promise<unknown>
    close?: () => Promise<void> | void
  }
  __track?: (label: string, promise: Promise<unknown>) => Promise<void>
}

async function hasPendingLock(page: Page, name: string): Promise<boolean> {
  return page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query()
    return (snapshot.pending ?? []).some((lock) => lock.name === lockName)
  }, name)
}

function settlements(page: Page): Promise<Array<Settlement>> {
  return page.evaluate(() => (window as ProbeWindow).__settlements ?? [])
}

test(`close waits for a write that is waiting for the OPFS access handle`, async ({
  page,
}) => {
  const databaseName = `close-wait-${crypto.randomUUID()}.sqlite`
  const lockName = `ahp:/${databaseName}`
  await page.goto(`/e2e/close-pending-write.opfs.html`)

  try {
    await page.evaluate(
      async ({ name, handleLock }) => {
        const probe = window as ProbeWindow
        const modulePath = `/src/opfs-database.ts`
        const { openBrowserWASQLiteOPFSDatabase } = await import(modulePath)
        const database = await openBrowserWASQLiteOPFSDatabase({
          databaseName: name,
        })
        await database.execute(`CREATE TABLE t(x INTEGER)`)

        // OPFSCoopSyncVFS hands its access handle to a connection that
        // notifies this channel and then requests the Web Lock.
        new BroadcastChannel(handleLock).postMessage(null)
        await new Promise<void>((acquired) => {
          void navigator.locks.request(handleLock, () => {
            acquired()
            return new Promise<void>((release) => {
              probe.__releaseHandle = release
            })
          })
        })

        const recorded: Array<Settlement> = []
        probe.__settlements = recorded
        const track = (label: string, promise: Promise<unknown>) =>
          promise.then(
            (value) => {
              recorded.push({ label, status: `fulfilled`, value })
            },
            (error: Error) => {
              recorded.push({
                label,
                status: `rejected`,
                name: error.name,
                message: error.message,
              })
            },
          )
        probe.__database = database
        probe.__track = track
        void track(`insert`, database.execute(`INSERT INTO t VALUES (1)`))
      },
      { name: databaseName, handleLock: lockName },
    )

    // Premise: the worker's insert waits behind the page's handle lock.
    await expect
      .poll(() => hasPendingLock(page, lockName), { timeout: 10_000 })
      .toBe(true)
    await page.evaluate(async () => {
      const probe = window as ProbeWindow
      const database = probe.__database!
      void probe.__track!(`close`, Promise.resolve(database.close!()))
      void probe.__track!(`after-close`, database.execute(`SELECT 1`))
      // Give a worker that runs close concurrently time to answer it.
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    // Admission ended at close; nothing else settles while the insert waits.
    expect(await settlements(page)).toEqual([
      {
        label: `after-close`,
        status: `rejected`,
        name: `InvalidPersistedCollectionConfigError`,
        message: `Browser OPFS worker connection is closed`,
      },
    ])

    await page.evaluate(() => (window as ProbeWindow).__releaseHandle?.())
    await expect
      .poll(() => settlements(page).then((all) => all.length), {
        timeout: 10_000,
      })
      .toBe(3)
    expect(await settlements(page)).toEqual([
      {
        label: `after-close`,
        status: `rejected`,
        name: `InvalidPersistedCollectionConfigError`,
        message: `Browser OPFS worker connection is closed`,
      },
      { label: `insert`, status: `fulfilled`, value: [] },
      { label: `close`, status: `fulfilled`, value: undefined },
    ])

    const reopened = await page.evaluate(async (name) => {
      const modulePath = `/src/opfs-database.ts`
      const { openBrowserWASQLiteOPFSDatabase } = await import(modulePath)
      const database = await openBrowserWASQLiteOPFSDatabase({
        databaseName: name,
        timeoutMs: 5_000,
      })
      try {
        return await database.execute(`SELECT x FROM t`)
      } finally {
        await database.close?.()
      }
    }, databaseName)
    expect(reopened).toEqual([{ x: 1 }])
  } finally {
    await page.evaluate(() => (window as ProbeWindow).__releaseHandle?.())
  }
})
