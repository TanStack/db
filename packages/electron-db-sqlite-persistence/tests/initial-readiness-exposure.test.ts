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
 * sync. Each witness records the rows visible at the query's first-ready
 * transition.
 *
 * The driver uses the real renderer adapter and the real main-process
 * handler over a real SQLite file. The `ipcMain` double forwards each
 * envelope in process and lets a witness hold or fail the `loadSubset` reply,
 * which is the only part of the IPC transport that this law depends on. With
 * `TANSTACK_DB_ELECTRON_E2E_ALL=1`, each envelope instead crosses a real
 * Electron main process through the runtime bridge. These witnesses cover a
 * renderer
 * without a coordinator; a follower renderer routes upstream demand through
 * the shared broadcast coordinator, which the persistence-core owners cover.
 */

type Row = { id: string; group: string }

// A real Electron process starts for each envelope, so waits are longer.
const settleTimeout = { timeout: isElectronFullE2EEnabled() ? 60_000 : 1_000 }

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

describe(`Electron renderer initial readiness follows the composed load`, () => {
  // A reopened renderer hydrates the rows that an earlier run persisted. The
  // query is first ready only after that IPC reply and the upstream load.
  it(`a reopened renderer is first ready with its IPC-hydrated local rows`, async () => {
    const main = electronMain()
    const id = `electron-readiness-reopen-${Math.random().toString(36).slice(2)}`
    {
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

    const held = main.holdLoads()
    const [source, upstream] = persistedOnDemand(main, id)
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()
    await held.arrived
    expect(query.toArray).toEqual([])
    expect(upstream.calls).toHaveLength(0)

    held.release()
    await vi.waitFor(
      () => expect(upstream.calls).toHaveLength(1),
      settleTimeout,
    )
    expect(query.toArray.map((row: Row) => row.id)).toEqual([`local`])
    expect(query.isReady()).toBe(false)

    upstream.respond([{ id: `remote`, group: `a` }])
    await preload
    expect(source.isReady()).toBe(false)
    expect(seen.rows).toEqual([`local`, `remote`])
  })

  it(`is first ready with upstream subset rows visible after the IPC hydration reply`, async () => {
    const main = electronMain()
    const held = main.holdLoads()
    const [source, upstream] = persistedOnDemand(main)
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()

    await held.arrived
    expect(upstream.calls).toHaveLength(0)
    expect(query.isReady()).toBe(false)

    held.release()
    await vi.waitFor(
      () => expect(upstream.calls).toHaveLength(1),
      settleTimeout,
    )
    expect(main.loadReplies).toContain(`sent`)
    expect(query.isReady()).toBe(false)

    upstream.respond([{ id: `remote`, group: `a` }])
    await preload
    expect(source.isReady()).toBe(false)
    expect(seen.rows).toEqual([`remote`])
  })

  it(`a failed IPC hydration errors the query and never readies it`, async () => {
    quietLogs()
    const main = electronMain()
    main.failNextLoad(new Error(`main process unavailable`))
    const [source, upstream] = persistedOnDemand(main)
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    void query.preload().catch(() => {})

    await vi.waitFor(
      () => expect(main.loadReplies).toContain(`failed`),
      settleTimeout,
    )
    await vi.waitFor(() => expect(query.status).toBe(`error`), settleTimeout)
    expect(upstream.calls).toHaveLength(0)
    expect(seen.rows).toBeUndefined()
  })

  it(`an upstream failure after IPC hydration errors the query and never readies it`, async () => {
    quietLogs()
    const main = electronMain()
    const [source, upstream] = persistedOnDemand(main)
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    void query.preload().catch(() => {})

    await vi.waitFor(
      () => expect(upstream.calls).toHaveLength(1),
      settleTimeout,
    )
    upstream.fail(new Error(`upstream failed`))
    await vi.waitFor(() => expect(query.status).toBe(`error`), settleTimeout)
    expect(seen.rows).toBeUndefined()
  })

  it(`a demand released during an in-flight IPC hydration starts no upstream load`, async () => {
    const main = electronMain()
    const held = main.holdLoads()
    const [source, upstream] = persistedOnDemand(main)
    const query = groupA(source)
    void query.preload().catch(() => {})

    await held.arrived
    await query.cleanup()
    held.release()
    await vi.waitFor(
      () => expect(main.loadReplies).toContain(`sent`),
      settleTimeout,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(upstream.calls.every((options) => options.signal?.aborted)).toBe(
      true,
    )
    expect(source.size).toBe(0)
    expect(source.status).not.toBe(`error`)
  })
})
