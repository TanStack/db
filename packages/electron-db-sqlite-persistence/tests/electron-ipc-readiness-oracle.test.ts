import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { persistedCollectionOptions } from '@tanstack/db-sqlite-persistence-core'
import { createNodeSQLitePersistence } from '@tanstack/node-db-sqlite-persistence'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
  whenSyncAccepted,
} from '../../db/src'
import { createDeferred } from '../../db/src/deferred'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver'
import {
  createElectronSQLitePersistence,
  exposeElectronSQLitePersistence,
} from '../src'
import { ElectronCollectionCoordinator } from '../src/electron-coordinator'
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
 * a renderer without a coordinator. A second lane below runs a follower and
 * an owner renderer with coordinators.
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

// The law of initial readiness: the observed checkpoints of each composed load
// equal the model's prediction for that history.
async function compareIpcReadinessHistory(
  history: IpcReadinessHistory,
): Promise<void> {
  expect(await observeIpcReadinessHistory(history)).toEqual(
    expectedCheckpoints(history),
  )
}

declareOracle({
  check: [compareIpcReadinessHistory],
  model: [expectedCheckpoints],
})

describe(`Electron renderer initial readiness follows the composed load`, () => {
  it.each(ipcReadinessHistories)(
    `matches the model: $renderer renderer, hydration $hydration, then $next`,
    async (history) => {
      await compareIpcReadinessHistory(history)
    },
    historyTimeout,
  )
})

/**
 * # Does a follower renderer settle with its owner's rows?
 *
 * Two renderers share one main process and SQLite file, each with its own
 * ElectronCollectionCoordinator over Node's BroadcastChannel and Web Locks.
 * The first renderer owns the Collection and runs the source; the second is a
 * follower and routes its demand to the owner. Law 7 owes the follower: its
 * load, and its query's first ready, settle only once the owner's rows are
 * visible in the follower, and they reject if applying the owner's commit
 * fails here. That failure is a local persistence failure, so the follower
 * source crashes.
 *
 * The model knows only whether the owner's commit applies in the follower.
 * The grammar crosses that outcome with the consumer: a live query over the
 * demanded row, or the follower's load. The driver holds the follower's IPC
 * `loadSubset` reply that carries the owner's row, which is the follower's
 * read of the owner's commit, and fails it for the `fails` histories. The
 * checkpoint is after the owner's reply reached the follower while that read
 * is held: the consumer has not settled. The browser per-collection oracle
 * owns the queued placement and the Query Collection source across real tabs.
 */
type CoordinatedRendererHistory = {
  apply: `ok` | `fails`
  consumer: `live-query` | `load`
}

function expectedCoordinatedRenderer(history: CoordinatedRendererHistory) {
  const applied = history.apply === `ok`
  return {
    settledWhileApplyHeld: false,
    outcome: applied ? `fulfilled` : `rejected`,
    rows: applied ? [`remote`] : undefined,
    source: applied ? `ready` : `crashed`,
  }
}

function coordinatedRenderer(options: {
  invoke: ElectronPersistenceInvoke
  dbName: string
  collectionId: string
  gateRead?: (response: unknown) => Promise<void>
}) {
  const coordinator = new ElectronCollectionCoordinator({
    dbName: options.dbName,
  })
  onTestFinished(() => coordinator.dispose())
  const trace: Array<string> = []
  const ensure = coordinator.requestEnsureRemoteSubset.bind(coordinator)
  coordinator.requestEnsureRemoteSubset = (collectionId, subset) => {
    trace.push(`ensure`)
    return ensure(collectionId, subset).finally(() =>
      trace.push(`ensure-settled`),
    )
  }
  // Record when the owner's commit notice reaches this renderer, so the lane
  // can check the premise it relies on: the notice precedes the reply.
  const subscribe = coordinator.subscribe.bind(coordinator)
  coordinator.subscribe = (collectionId, onMessage) =>
    subscribe(collectionId, (message) => {
      const payload = message.payload as { type?: string } | undefined
      if (payload?.type === `tx:committed`) trace.push(`broadcast`)
      onMessage(message)
    })
  const persistence = createElectronSQLitePersistence({
    timeoutMs: isElectronFullE2EEnabled() ? 90_000 : undefined,
    coordinator,
    invoke: async (channel, request) => {
      const response = await options.invoke(channel, request)
      if (request.method === `loadSubset`) await options.gateRead?.(response)
      return response
    },
  })
  const delivered = new Set<string>()
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: options.collectionId,
      getKey: (row) => row.id,
      persistence,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              // Deliver the owner's upstream row once, as a real source does.
              if (delivered.has(`remote`)) return
              delivered.add(`remote`)
              trace.push(`upstream`)
              begin()
              write({ type: `insert`, value: { id: `remote`, group: `a` } })
              await whenSyncAccepted(commit())
            },
          }
        },
      },
    }),
  )
  onTestFinished(() => collection.cleanup())
  return { coordinator, collection, trace }
}

async function observeCoordinatedRendererHistory(
  history: CoordinatedRendererHistory,
) {
  quietLogs()
  const directory = mkdtempSync(join(tmpdir(), `electron-follower-`))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const invoke = mainProcessInvoke(join(directory, `state.sqlite`))
  const dbName = `electron-follower-${Math.random().toString(36).slice(2)}`
  const collectionId = `electron-follower-items`
  const owner = coordinatedRenderer({ invoke, dbName, collectionId })
  owner.collection.startSyncImmediate()
  await owner.collection.stateWhenReady()

  const applyHeld = createDeferred<void>()
  let applyReached = false
  let gate = false
  const follower = coordinatedRenderer({
    invoke,
    dbName,
    collectionId,
    gateRead: async (response) => {
      if (!gate || !JSON.stringify(response).includes(`remote`)) return
      gate = false
      applyReached = true
      await applyHeld.promise
      if (history.apply === `fails`) throw new Error(`follower read failed`)
    },
  })
  onTestFinished(() => applyHeld.resolve())
  follower.collection.startSyncImmediate()
  await follower.collection.stateWhenReady()
  gate = true

  let settledAt: { rows: Array<string> } | undefined
  let outcome: Promise<`fulfilled` | `rejected`>
  if (history.consumer === `live-query`) {
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: follower.collection })
        .where(({ row }) => eq(row.id, `remote`)),
    )
    onTestFinished(() => query.cleanup())
    query.onFirstReady(() => {
      settledAt = { rows: query.toArray.map((row: Row) => row.id).sort() }
    })
    outcome = query.preload().then(
      () => `fulfilled` as const,
      () => `rejected` as const,
    )
  } else {
    outcome = Promise.resolve(
      follower.collection._sync.loadSubset({
        where: new IR.Func(`eq`, [
          new IR.PropRef([`id`]),
          new IR.Value(`remote`),
        ]),
      }),
    ).then(
      () => {
        settledAt = {
          rows: follower.collection.has(`remote`) ? [`remote`] : [],
        }
        return `fulfilled` as const
      },
      () => `rejected` as const,
    )
  }

  await vi.waitFor(
    () => {
      expect(applyReached).toBe(true)
      expect(follower.trace).toContain(`ensure-settled`)
    },
    { timeout: isElectronFullE2EEnabled() ? 60_000 : 8_000 },
  )
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setImmediate(resolve))
  // Checkpoint: the owner has replied while the follower's apply is held.
  // The premise transferred: its notice reached the follower before the reply.
  expect(follower.trace.indexOf(`broadcast`)).toBeGreaterThan(-1)
  expect(follower.trace.indexOf(`broadcast`)).toBeLessThan(
    follower.trace.indexOf(`ensure-settled`),
  )
  const settledWhileApplyHeld = settledAt !== undefined
  // The topology this lane claims: the owner loads upstream, and the
  // follower routes its demand instead of running its own source.
  expect(owner.trace).toContain(`upstream`)
  expect(follower.trace).not.toContain(`upstream`)
  applyHeld.resolve()
  const settled = await outcome
  await vi.waitFor(
    () =>
      expect(follower.collection.status).toBe(
        expectedCoordinatedRenderer(history).source,
      ),
    settleTimeout,
  )
  return {
    settledWhileApplyHeld,
    outcome: settled,
    rows: settledAt?.rows,
    source: follower.collection.status,
  }
}

// The law of follower settlement: the observed follower checkpoints equal the
// model's prediction for each apply outcome and consumer.
async function compareCoordinatedRendererHistory(
  history: CoordinatedRendererHistory,
): Promise<void> {
  expect(await observeCoordinatedRendererHistory(history)).toEqual(
    expectedCoordinatedRenderer(history),
  )
}

declareOracle({
  check: [compareCoordinatedRendererHistory],
  model: [expectedCoordinatedRenderer],
})

describe(`Electron follower renderer settles with its owner's rows`, () => {
  it.each(
    ([`ok`, `fails`] as const).flatMap((apply) =>
      ([`live-query`, `load`] as const).map((consumer) => ({
        apply,
        consumer,
      })),
    ),
  )(
    `matches the model: apply $apply, consumer $consumer`,
    async (history) => {
      await compareCoordinatedRendererHistory(history)
    },
    isElectronFullE2EEnabled() ? 180_000 : 20_000,
  )
})
