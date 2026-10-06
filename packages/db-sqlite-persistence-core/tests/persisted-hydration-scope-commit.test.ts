/**
 * # Does a source commit buffered during hydration settle on a scheduled driver?
 *
 * Contract: a sync commit that lands while a persisted Collection hydrates is
 * buffered and replayed when the hydrate's rows are applied. Its receipt
 * settles, the row becomes durable, and the Collection and every other
 * Collection on the same persistence reach `ready`. The driver's scheduling
 * capability must not change any of these observations.
 *
 * Production path: the real core adapter over a SQLite CLI driver with the
 * default `SingleProcessCoordinator`. With a shared logical scheduling key, the
 * hydrate runs inside `runInHydrationScope` and holds the shared scheduler while
 * it replays the buffered commit. The replay must persist through the scoped
 * adapter it was handed; entering the scheduler again waits on the hydrate that
 * holds it, and nothing settles. Recording adapters in the persisted oracle do
 * not expose `runInHydrationScope`, so they take a different startup branch and
 * cannot observe this. See https://github.com/TanStack/db/issues/2046.
 *
 * History: hold the hydrate's first row read (the startup resume snapshot, or
 * an on-demand `loadSubset`), commit one row from the source while it is held,
 * then release. The unscheduled driver is the control.
 *
 * Known omissions: one row-bearing insert per history; no coordinator other
 * than `SingleProcessCoordinator`; no browser driver. The two-tab OPFS oracles
 * own `BrowserCollectionCoordinator`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  createSQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../src'
import { SqliteCliDriver } from './sqlite-core-adapter-oracle.test'
import type { PersistenceAdapter } from '../src'

type Row = { id: string }
type Hydrate = `startup` | `on-demand subset`

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** Whether `promise` settles within the window; a hang reads as `false`. */
async function settles(promise: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), 2_000)
    }),
  ])
  clearTimeout(timer)
  return result
}

/**
 * Holds the first row read inside a hydration scope: the startup resume
 * snapshot, or the subset load of an on-demand hydrate.
 */
function holdFirstHydrationRowRead(
  adapter: PersistenceAdapter,
  hydrate: Hydrate,
): { entered: Promise<void>; release: () => void } {
  const entered = createDeferred()
  const gate = createDeferred()
  if (!adapter.runInHydrationScope) {
    throw new Error(`The real adapter must expose a hydration scope`)
  }
  const runInHydrationScope = adapter.runInHydrationScope.bind(adapter)
  let held = false
  const hold = async () => {
    if (held) return
    held = true
    entered.resolve()
    await gate.promise
  }
  adapter.runInHydrationScope = (task) =>
    runInHydrationScope((scopedAdapter) =>
      task({
        ...scopedAdapter,
        loadResumeSnapshot: async (...args) => {
          if (hydrate === `startup` && args[1]?.includeRows !== false) {
            await hold()
          }
          return scopedAdapter.loadResumeSnapshot(...args)
        },
        loadSubset: async (...args) => {
          if (hydrate === `on-demand subset`) await hold()
          return scopedAdapter.loadSubset(...args)
        },
      }),
    )
  return { entered: entered.promise, release: gate.resolve }
}

async function observeCommitDuringHydration(options: {
  scheduled: boolean
  hydrate: Hydrate
}): Promise<{
  receiptSettled: boolean
  committingCollectionReady: boolean
  peerCollectionReady: boolean
  rowPersisted: boolean
}> {
  const directory = mkdtempSync(join(tmpdir(), `persisted-hydration-commit-`))
  const driver = new SqliteCliDriver(join(directory, `state.sqlite`))
  if (options.scheduled) {
    Object.defineProperty(driver, SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY, {
      value: {},
    })
  }
  const adapter = createSQLiteCorePersistenceAdapter({ driver })
  const heldRead = holdFirstHydrationRowRead(adapter, options.hydrate)

  const sourceStarted = createDeferred()
  let commitR1: (() => unknown) | undefined
  const committing = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `committing`,
      getKey: (row) => row.id,
      syncMode: options.hydrate === `startup` ? `eager` : `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          commitR1 = () => {
            begin()
            write({ type: `insert`, value: { id: `r1` } })
            return commit()
          }
          sourceStarted.resolve()
          markReady()
        },
      },
      persistence: { adapter },
    }),
  )
  const peer = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `peer`,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
      persistence: { adapter },
    }),
  )

  try {
    const committingReady = committing.preload()
    if (options.hydrate === `on-demand subset`) {
      expect(await settles(committingReady)).toBe(true)
      committing.subscribeChanges(() => {}, { includeInitialState: true })
    }
    await Promise.all([heldRead.entered, sourceStarted.promise])
    const receipt = Promise.resolve(commitR1!())
    heldRead.release()

    const receiptSettled = await settles(receipt)
    const committingCollectionReady = await settles(committingReady)
    const peerCollectionReady = await settles(peer.preload())
    const persistedRows = receiptSettled
      ? await adapter.loadSubset(`committing`, {})
      : []
    return {
      receiptSettled,
      committingCollectionReady,
      peerCollectionReady,
      rowPersisted: persistedRows.some((row) => row.key === `r1`),
    }
  } finally {
    heldRead.release()
    await settles(Promise.all([committing.cleanup(), peer.cleanup()]))
    rmSync(directory, { recursive: true, force: true })
  }
}

describe(`source commit buffered during hydration`, () => {
  it.each([
    { scheduled: true, hydrate: `startup` as const },
    { scheduled: true, hydrate: `on-demand subset` as const },
    { scheduled: false, hydrate: `startup` as const },
    { scheduled: false, hydrate: `on-demand subset` as const },
  ])(
    `settles and persists during a $hydrate hydrate (scheduled driver: $scheduled)`,
    async (options) => {
      await expect(observeCommitDuringHydration(options)).resolves.toEqual({
        receiptSettled: true,
        committingCollectionReady: true,
        peerCollectionReady: true,
        rowPersisted: true,
      })
    },
    15_000,
  )
})
