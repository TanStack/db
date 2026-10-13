import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { persistedCollectionOptions } from '@tanstack/db-sqlite-persistence-core'
import { createNodeSQLitePersistence } from '@tanstack/node-db-sqlite-persistence'
import { createCollection, createLiveQueryCollection, eq } from '../../db/src'
import { createDeferred } from '../../db/src/deferred'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver'
import {
  createElectronSQLitePersistence,
  exposeElectronSQLitePersistence,
} from '../src'
import {
  createElectronRuntimeBridgeInvoke,
  isElectronFullE2EEnabled,
} from './e2e/electron-process-client'
import type { Collection, LoadSubsetOptions } from '../../db/src'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
} from '../src/protocol'

/**
 * # Does the Electron renderer carry initial-query readiness?
 *
 * ARCHITECTURE.md law 10 makes a settled `loadSubset` the readiness evidence
 * for an on-demand source, and law 7 says a successful load settles only after
 * its rows are visible. In a renderer, the persisted wrapper hydrates the
 * subset through the Electron IPC adapter, which reads SQLite in the main
 * process, and then awaits the upstream source's load. The upstream never
 * calls `markReady()`, as a progressive source would not during its full
 * sync.
 *
 * The independent model below predicts, for each history, what a live query
 * over the demanded rows shows at three checkpoints: while the main process's
 * `loadSubset` reply is held, after that reply but before the upstream load
 * settles, and after the upstream load settles. It knows only the rows that an
 * earlier renderer run persisted and the outcome of each step; it knows
 * nothing about the IPC protocol or the wrapper's internals.
 *
 * The history grammar crosses a fresh or reopened renderer (an earlier run
 * persisted one local row) with the IPC hydration outcome (a reply, or a
 * failed reply) and what follows a reply: the upstream load succeeds, fails,
 * or the query releases its demand while the IPC hydration is in flight.
 *
 * The driver uses the real renderer adapter and the real main-process
 * handler over a real SQLite file. The `ipcMain` double forwards each
 * envelope in process and lets the driver hold or fail the `loadSubset`
 * reply, which is the only part of the IPC transport that this law depends
 * on. With `TANSTACK_DB_ELECTRON_E2E_ALL=1`, each envelope instead crosses a
 * real Electron main process through the runtime bridge. The histories cover
 * a renderer without a coordinator; a follower renderer routes upstream
 * demand through the shared broadcast coordinator, which the persisted
 * oracle's follower remote-demand lane owns.
 */

type Row = { id: string; group: string }

// A real Electron process starts for each envelope, so waits are longer.
const settleTimeout = { timeout: isElectronFullE2EEnabled() ? 60_000 : 1_000 }
// Bound each history, so a stalled main process fails one history instead of
// holding the run until the suite's timeout.
const historyTimeout = isElectronFullE2EEnabled() ? 90_000 : 10_000

type IpcHandler = (
  event: unknown,
  request: ElectronPersistenceRequestEnvelope,
) => Promise<ElectronPersistenceResponseEnvelope>

function mainProcessInvoke(dbPath: string): ElectronPersistenceInvoke {
  if (isElectronFullE2EEnabled()) {
    return createElectronRuntimeBridgeInvoke({
      dbPath,
      collectionId: `electron-readiness`,
      allowAnyCollectionId: true,
      timeoutMs: 60_000,
    })
  }
  const driver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
  let handler: IpcHandler | undefined
  const dispose = exposeElectronSQLitePersistence({
    ipcMain: {
      handle: (_channel: string, listener: IpcHandler) => {
        handler = listener
      },
      removeHandler: () => {},
    },
    persistence: createNodeSQLitePersistence({
      database: driver.getDatabase(),
    }),
  })
  onTestFinished(() => {
    dispose()
    driver.close()
  })
  return (_channel, request) => handler!(undefined, request)
}

function electronMain() {
  const directory = mkdtempSync(join(tmpdir(), `electron-readiness-`))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const invoke = mainProcessInvoke(join(directory, `state.sqlite`))

  // A held `loadSubset` reply waits for `release`; `failNext` rejects the
  // next reply. `arrived` resolves once the main process has answered.
  let hold: { arrived: () => void; released: Promise<void> } | undefined
  let failNext: Error | undefined
  const loadReplies: Array<`sent` | `failed`> = []
  const renderer = createElectronSQLitePersistence({
    timeoutMs: isElectronFullE2EEnabled() ? 90_000 : undefined,
    invoke: async (channel, request) => {
      const response = await invoke(channel, request)
      if (request.method === `loadSubset`) {
        if (hold) {
          hold.arrived()
          await hold.released
        }
        if (failNext) {
          const error = failNext
          failNext = undefined
          loadReplies.push(`failed`)
          throw error
        }
        loadReplies.push(`sent`)
      }
      return response
    },
  })
  return {
    renderer,
    loadReplies,
    holdLoads: () => {
      const arrived = createDeferred<void>()
      const released = createDeferred<void>()
      hold = { arrived: () => arrived.resolve(), released: released.promise }
      return {
        arrived: arrived.promise,
        release: () => released.resolve(),
      }
    },
    failNextLoad: (error: Error) => {
      failNext = error
    },
  }
}

type Upstream = {
  calls: Array<LoadSubsetOptions>
  respond: (rows: ReadonlyArray<Row>) => void
  fail: (error: unknown) => void
}

function persistedOnDemand(
  main: ReturnType<typeof electronMain>,
  id = `electron-readiness-${Math.random().toString(36).slice(2)}`,
): [Collection<Row, string, any>, Upstream] {
  let pending = createDeferred<void>()
  let write!: (rows: ReadonlyArray<Row>) => void
  const upstream: Upstream = {
    calls: [],
    respond: (rows) => {
      write(rows)
      pending.resolve()
    },
    fail: (error) => pending.reject(error),
  }
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence: main.renderer,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          write = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `insert`, value })
            params.commit()
          }
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              upstream.calls.push(options)
              pending = createDeferred<void>()
              return pending.promise
            },
          }
        },
      },
    }),
  )
  onTestFinished(() => collection.cleanup())
  return [collection, upstream]
}

function groupA(source: Collection<Row, string, any>) {
  const query = createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
  )
  onTestFinished(() => query.cleanup())
  return query
}

function rowsAtFirstReady(query: Collection<any, any, any>) {
  const seen: { rows?: Array<unknown> } = {}
  query.onFirstReady(() => {
    seen.rows = query.toArray.map((row: Row) => row.id).sort()
  })
  return seen
}

function quietLogs() {
  const warned = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  onTestFinished(() => {
    warned.mockRestore()
    loggedError.mockRestore()
  })
}

type IpcReadinessHistory = {
  renderer: `fresh` | `reopened`
  hydration: `reply` | `fails`
  // What follows a hydration reply.
  next: `upstream-ok` | `upstream-fails` | `release-during-hydration`
}

type Checkpoints = {
  whileReplyHeld?: {
    ready: boolean
    rows: Array<string>
    upstreamCalls: number
  }
  afterReply:
    | { ready: false; rows: Array<string>; upstreamCalls: 1 }
    | { status: `error`; upstreamCalls: 0; firstReadyRows: undefined }
    | { releasedQuietly: true }
  afterUpstream?:
    | { firstReadyRows: Array<string>; sourceReady: false }
    | { status: `error`; firstReadyRows: undefined }
}

// The model: readiness waits for both loads, and each load's rows are visible
// when the query is first ready. A failure of either load errors the query
// before it is ever ready. A demand released while its hydration is in flight
// starts no live upstream load, installs no upstream rows, and causes no
// error. Whether locally hydrated rows stay is retention, which the persisted
// oracle's retained-demand lane owns, so the model does not predict it.
function expectedCheckpoints(history: IpcReadinessHistory): Checkpoints {
  const local = history.renderer === `reopened` ? [`local`] : []
  if (history.hydration === `fails`)
    return {
      afterReply: {
        status: `error`,
        upstreamCalls: 0,
        firstReadyRows: undefined,
      },
    }
  const whileReplyHeld = { ready: false, rows: [], upstreamCalls: 0 }
  if (history.next === `release-during-hydration`)
    return { whileReplyHeld, afterReply: { releasedQuietly: true } }
  return {
    whileReplyHeld,
    afterReply: { ready: false, rows: local, upstreamCalls: 1 },
    afterUpstream:
      history.next === `upstream-ok`
        ? { firstReadyRows: [...local, `remote`].sort(), sourceReady: false }
        : { status: `error`, firstReadyRows: undefined },
  }
}

const ipcReadinessHistories: Array<IpcReadinessHistory> = (
  [`fresh`, `reopened`] as const
).flatMap((renderer) => [
  { renderer, hydration: `fails` as const, next: `upstream-ok` as const },
  ...(
    [`upstream-ok`, `upstream-fails`, `release-during-hydration`] as const
  ).map((next) => ({ renderer, hydration: `reply` as const, next })),
])

async function observeIpcReadinessHistory(
  history: IpcReadinessHistory,
): Promise<Checkpoints> {
  quietLogs()
  const main = electronMain()
  const id = `electron-readiness-${history.renderer}-${Math.random().toString(36).slice(2)}`
  if (history.renderer === `reopened`) {
    // An earlier renderer run persists one local row.
    const [source, upstream] = persistedOnDemand(main, id)
    const query = groupA(source)
    const preload = query.preload()
    await vi.waitFor(
      () => expect(upstream.calls).toHaveLength(1),
      settleTimeout,
    )
    upstream.respond([{ id: `local`, group: `a` }])
    await preload
    await query.cleanup()
    await source.cleanup()
  }

  const observed: Checkpoints = { afterReply: { releasedQuietly: true } }
  if (history.hydration === `fails`) {
    main.failNextLoad(new Error(`main process unavailable`))
    const [source, upstream] = persistedOnDemand(main, id)
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    void query.preload().catch(() => {})
    await vi.waitFor(
      () => expect(main.loadReplies).toContain(`failed`),
      settleTimeout,
    )
    await vi.waitFor(() => expect(query.status).toBe(`error`), settleTimeout)
    observed.afterReply = {
      status: query.status as `error`,
      upstreamCalls: upstream.calls.length as 0,
      firstReadyRows: seen.rows as undefined,
    }
    return observed
  }

  const held = main.holdLoads()
  const [source, upstream] = persistedOnDemand(main, id)
  const query = groupA(source)
  const seen = rowsAtFirstReady(query)
  const preload = query.preload()
  void preload.catch(() => {})
  await held.arrived
  observed.whileReplyHeld = {
    ready: query.isReady(),
    rows: query.toArray.map((row: Row) => row.id).sort(),
    upstreamCalls: upstream.calls.length,
  }

  if (history.next === `release-during-hydration`) {
    await query.cleanup()
    held.release()
    await vi.waitFor(
      () => expect(main.loadReplies).toContain(`sent`),
      settleTimeout,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    observed.afterReply = {
      releasedQuietly: (upstream.calls.every(
        (options) => options.signal?.aborted,
      ) &&
        !source.has(`remote`) &&
        source.status !== `error`) as true,
    }
    return observed
  }

  held.release()
  await vi.waitFor(
    () => expect(upstream.calls.length).toBeGreaterThan(0),
    settleTimeout,
  )
  observed.afterReply = {
    ready: query.isReady() as false,
    rows: query.toArray.map((row: Row) => row.id).sort(),
    upstreamCalls: upstream.calls.length as 1,
  }

  if (history.next === `upstream-ok`) {
    upstream.respond([{ id: `remote`, group: `a` }])
    await preload
    observed.afterUpstream = {
      firstReadyRows: seen.rows as Array<string>,
      sourceReady: source.isReady() as false,
    }
  } else {
    upstream.fail(new Error(`upstream failed`))
    await vi.waitFor(() => expect(query.status).toBe(`error`), settleTimeout)
    observed.afterUpstream = {
      status: query.status as `error`,
      firstReadyRows: seen.rows as undefined,
    }
  }
  return observed
}

describe(`Electron renderer initial readiness follows the composed load`, () => {
  it.each(ipcReadinessHistories)(
    `matches the model: $renderer renderer, hydration $hydration, then $next`,
    async (history) => {
      expect(await observeIpcReadinessHistory(history)).toEqual(
        expectedCheckpoints(history),
      )
    },
    historyTimeout,
  )
})
