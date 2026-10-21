import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { persistedCollectionOptions } from '@tanstack/db-sqlite-persistence-core'
import { createNodeSQLitePersistence } from '@tanstack/node-db-sqlite-persistence'
import { createCollection } from '../../db/src'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver'
import {
  createElectronSQLitePersistence,
  exposeElectronSQLitePersistence,
} from '../src'
import { ElectronCollectionCoordinator } from '../src/electron-coordinator'
import type { Collection } from '../../db/src'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
} from '../src/protocol'

/**
 * # Does an Electron renderer reload read its rows before it writes a term?
 *
 * Law and source: reloads must stay fast (an accepted persistence goal,
 * issues #2204 and #2205). An Electron renderer elects a leader per
 * Collection with Web Locks and reserves a durable election term in the main
 * process. On a reload, that term write must not run ahead of the database
 * work the renderer had already queued when the leader lock was granted,
 * unless a caller needed a leader first. The renderer's queued reads are its
 * hydration scopes (startup reads and on-demand subset reads), the renderer
 * analogue of a Browser page's shared scheduler queue. Its writes take the
 * writer Web Lock, which also orders them against a term write.
 *
 * Model: from the history alone. Every Collection is created and preloaded in
 * one task. The Web Locks standard invokes a granted callback from a queued
 * task, and Chromium's lock manager answers across a process boundary, so a
 * grant arrives at least one task after the request. By then every startup
 * hydration has begun, so each one is queued at every grant. The expected order is therefore: every
 * Collection's startup row read completes before any term write begins. A
 * leader need cuts the wait short: a local write started during the startup
 * read must settle, and its Collection's term may precede other reads.
 *
 * History grammar: 1, 2, or 3 Collections × a grant one or three tasks after
 * the request, plus a leader-need cell with a local write issued during the
 * startup read. Each IPC reply resolves on a later task, like a round trip to
 * the main process. Excluded: Node's Web Locks run a granted callback
 * synchronously, before the next microtask. No standard lock manager does
 * that, so the driver always adds at least one task.
 *
 * Production path and observation: the real renderer persistence,
 * ElectronCollectionCoordinator (Node's Web Locks and BroadcastChannel), the
 * real main-process handler, and a real SQLite file. The `ipcMain` double
 * forwards each envelope in process and records, at the main boundary, when
 * each row read replies and when each `reserveLeadershipTerm` request arrives.
 * The recorder keeps every event in order, so a missing or repeated read is
 * visible.
 *
 * Limits: a real Electron main process and real IPC latency are not run here.
 * Restart and generation rotation re-subscribe are not covered.
 */

type Row = { id: string; title: string }
type IpcEvent = {
  kind: `read` | `term` | `write` | `subset`
  collectionId: string
}
type IpcHandler = (
  event: unknown,
  request: ElectronPersistenceRequestEnvelope,
) => Promise<ElectronPersistenceResponseEnvelope>

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function isRowRead(request: ElectronPersistenceRequestEnvelope): boolean {
  if (request.method === `scanRows`) return true
  if (request.method !== `loadResumeSnapshot`) return false
  return request.payload.ctx?.includeRows !== false
}

function mainProcess(
  filename: string,
  holdRead?: { collectionId: string; released: Promise<void> },
  holdWrite?: { collectionId: string; released: Promise<void> },
) {
  const driver = new BetterSqlite3SQLiteDriver({ filename })
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
  const events: Array<IpcEvent> = []
  const inFlight = new Map<string, number>()
  const invoke: ElectronPersistenceInvoke = async (_channel, request) => {
    inFlight.set(request.method, (inFlight.get(request.method) ?? 0) + 1)
    try {
      return await handle(request)
    } finally {
      inFlight.set(request.method, inFlight.get(request.method)! - 1)
    }
  }
  const handle = async (request: ElectronPersistenceRequestEnvelope) => {
    if (request.method === `reserveLeadershipTerm`) {
      events.push({ kind: `term`, collectionId: request.collectionId })
    }
    await nextTask()
    const response = await handler!(undefined, request)
    await nextTask()
    if (isRowRead(request) && request.collectionId === holdRead?.collectionId) {
      await holdRead.released
    }
    if (isRowRead(request)) {
      events.push({ kind: `read`, collectionId: request.collectionId })
    }
    if (request.method === `loadSubset`) {
      // A managed Collection's request names its physical cache ID.
      const logicalId =
        request.resolution?.logicalCollectionId ?? request.collectionId
      if (logicalId === holdRead?.collectionId) {
        await holdRead.released
      }
      events.push({ kind: `subset`, collectionId: request.collectionId })
    }
    if (request.method === `applyCommittedTx`) {
      if (request.collectionId === holdWrite?.collectionId) {
        await holdWrite.released
      }
      events.push({ kind: `write`, collectionId: request.collectionId })
    }
    return response
  }
  return {
    invoke,
    events,
    inFlight: (method: string) => inFlight.get(method) ?? 0,
    close: () => {
      dispose()
      driver.close()
    },
  }
}

function openCollections(
  invoke: ElectronPersistenceInvoke,
  dbName: string,
  ids: ReadonlyArray<string>,
) {
  const coordinator = new ElectronCollectionCoordinator({ dbName })
  const persistence = createElectronSQLitePersistence({ coordinator, invoke })
  const collections = ids.map((id) =>
    createCollection(
      persistedCollectionOptions<Row, string>({
        id,
        getKey: (row) => row.id,
        persistence,
        schemaVersion: 1,
      }),
    ),
  )
  return { coordinator, collections }
}

async function closeAll(session: {
  coordinator: ElectronCollectionCoordinator
  collections: Array<Collection<Row, string>>
}) {
  for (const collection of session.collections) await collection.cleanup()
  session.coordinator.dispose()
}

// Deliver each leader-lock grant `extraTasks` tasks after Node's synchronous
// grant, as a standard lock manager would.
function delayLeaderGrants(
  dbName: string,
  extraTasks: number,
  manual: ReadonlyMap<string, Promise<void>> = new Map(),
): () => void {
  const locks = navigator.locks
  const request = locks.request.bind(locks)
  const patched = ((
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<unknown>,
    maybeCallback?: LockGrantedCallback<unknown>,
  ) => {
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    const granted: LockGrantedCallback<unknown> = async (lock) => {
      const prefix = `tsdb:leader:${dbName}:`
      if (name.startsWith(prefix)) {
        for (let task = 0; task < extraTasks; task++) await nextTask()
        await manual.get(name.slice(prefix.length))
      }
      return callback(lock)
    }
    return typeof optionsOrCallback === `function`
      ? request(name, granted)
      : request(name, optionsOrCallback, granted)
  }) as typeof locks.request
  locks.request = patched
  return () => {
    locks.request = request
  }
}

// Every term begins only after every startup row read queued at its grant.
function orderViolations(
  events: ReadonlyArray<IpcEvent>,
  ids: ReadonlyArray<string>,
  exempt: ReadonlySet<string> = new Set(),
): Array<string> {
  const violations: Array<string> = []
  for (const id of ids) {
    const term = events.findIndex(
      (e) => e.kind === `term` && e.collectionId === id,
    )
    if (term === -1) {
      violations.push(`${id}: no term`)
      continue
    }
    if (exempt.has(id)) continue
    for (const read of ids) {
      const readAt = events.findIndex(
        (e) => e.kind === `read` && e.collectionId === read,
      )
      if (readAt === -1) violations.push(`${read}: no startup read`)
      else if (readAt > term) violations.push(`${id} term before ${read} read`)
    }
  }
  return violations
}

async function waitFor(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (condition()) return
    await nextTask()
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function reload(options: {
  count: number
  extraGrantTasks: number
  localWriteWhileReadHeld?: boolean
}) {
  const ids = Array.from({ length: options.count }, (_, i) => `reload-${i}`)
  const directory = mkdtempSync(join(tmpdir(), `electron-reload-order-`))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, `state.sqlite`)
  const dbName = `electron-reload-${Math.random().toString(36).slice(2)}`

  const fill = mainProcess(filename)
  const filler = openCollections(fill.invoke, dbName, ids)
  await Promise.all(filler.collections.map((c) => c.preload()))
  for (const collection of filler.collections) {
    await collection.insert({ id: `row`, title: collection.id }).isPersisted
      .promise
  }
  await closeAll(filler)
  await waitFor(() => fill.events.length > 0, `fill`)
  fill.close()

  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const main = mainProcess(
    filename,
    options.localWriteWhileReadHeld
      ? { collectionId: ids[1]!, released }
      : undefined,
  )
  onTestFinished(() => {
    release()
    main.close()
  })
  const restore = delayLeaderGrants(dbName, options.extraGrantTasks)
  onTestFinished(restore)
  const session = openCollections(main.invoke, dbName, ids)
  onTestFinished(() => closeAll(session))
  const preloads = session.collections.map((c) => c.preload())
  let writeSettledWhileHeld: boolean | undefined
  if (options.localWriteWhileReadHeld) {
    // The other Collection's startup read stays queued work until release.
    await preloads[0]
    let settled = false
    const write = session.collections[0]!.insert({
      id: `local`,
      title: `local`,
    }).isPersisted.promise.then(() => {
      settled = true
    })
    await waitFor(() => settled, `local write while the read is held`).catch(
      () => undefined,
    )
    writeSettledWhileHeld = settled
    release()
    await write
  }
  await Promise.all(preloads)
  await waitFor(
    () => ids.every((id) => session.coordinator.isLeader(id)),
    `reloaded leaders`,
  )
  return { ids, events: [...main.events], writeSettledWhileHeld }
}

// A local write on the first Collection is held in the main process when the
// second Collection's lock is granted. That write is queued database work, so
// the second term must wait for it, although the second startup read is done.
async function reloadWithWriteQueuedAtGrant() {
  const ids = [`reload-0`, `reload-1`]
  const directory = mkdtempSync(join(tmpdir(), `electron-reload-write-`))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, `state.sqlite`)
  const dbName = `electron-reload-${Math.random().toString(36).slice(2)}`
  const fill = mainProcess(filename)
  const filler = openCollections(fill.invoke, dbName, ids)
  await Promise.all(filler.collections.map((c) => c.preload()))
  await closeAll(filler)
  fill.close()

  let releaseWrite!: () => void
  const writeReleased = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  let grantSecond!: () => void
  const secondGranted = new Promise<void>((resolve) => {
    grantSecond = resolve
  })
  const main = mainProcess(filename, undefined, {
    collectionId: ids[0]!,
    released: writeReleased,
  })
  onTestFinished(() => {
    releaseWrite()
    grantSecond()
    main.close()
  })
  onTestFinished(
    delayLeaderGrants(dbName, 1, new Map([[ids[1]!, secondGranted]])),
  )
  const session = openCollections(main.invoke, dbName, ids)
  onTestFinished(() => closeAll(session))
  await Promise.all(session.collections.map((c) => c.preload()))
  const write = session.collections[0]!.insert({ id: `local`, title: `x` })
    .isPersisted.promise
  await waitFor(
    () =>
      main.events.some((e) => e.kind === `term` && e.collectionId === ids[0]),
    `first term`,
  )
  // Let the write reach the main process before the second grant.
  for (let task = 0; task < 10; task++) await nextTask()
  grantSecond()
  for (let task = 0; task < 20; task++) await nextTask()
  const secondTermWhileWriteHeld = main.events.some(
    (e) => e.kind === `term` && e.collectionId === ids[1],
  )
  releaseWrite()
  await write
  await waitFor(() => session.coordinator.isLeader(ids[1]!), `second leader`)
  return { secondTermWhileWriteHeld, events: [...main.events] }
}

// An on-demand Collection's first subset read is reload work outside any
// startup hydration and outside the writer lock. It is held in the main
// process when another Collection's lock is granted; that term must wait.
async function reloadWithSubsetQueuedAtGrant() {
  const ids = [`reload-subset`, `reload-1`]
  const directory = mkdtempSync(join(tmpdir(), `electron-reload-subset-`))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, `state.sqlite`)
  const dbName = `electron-reload-${Math.random().toString(36).slice(2)}`
  let releaseSubset!: () => void
  const subsetReleased = new Promise<void>((resolve) => {
    releaseSubset = resolve
  })
  let grantSecond!: () => void
  const secondGranted = new Promise<void>((resolve) => {
    grantSecond = resolve
  })
  const main = mainProcess(filename, {
    collectionId: ids[0]!,
    released: subsetReleased,
  })
  onTestFinished(() => {
    releaseSubset()
    grantSecond()
    main.close()
  })
  onTestFinished(
    delayLeaderGrants(dbName, 1, new Map([[ids[1]!, secondGranted]])),
  )
  const coordinator = new ElectronCollectionCoordinator({ dbName })
  const persistence = createElectronSQLitePersistence({
    coordinator,
    invoke: main.invoke,
  })
  const onDemand = createCollection(
    persistedCollectionOptions<Row, string>({
      id: ids[0]!,
      getKey: (row) => row.id,
      persistence,
      schemaVersion: 1,
      syncMode: `on-demand`,
      sync: { sync: ({ markReady }) => markReady() },
    }),
  )
  const eager = createCollection(
    persistedCollectionOptions<Row, string>({
      id: ids[1]!,
      getKey: (row) => row.id,
      persistence,
      schemaVersion: 1,
    }),
  )
  onTestFinished(async () => {
    await onDemand.cleanup()
    await eager.cleanup()
    coordinator.dispose()
  })
  await Promise.all([onDemand.preload(), eager.preload()])
  const subset = Promise.resolve(onDemand._sync.loadSubset({}))
  await waitFor(() => main.inFlight(`loadSubset`) > 0, `subset in flight`)
  grantSecond()
  for (let task = 0; task < 20; task++) await nextTask()
  const termWhileSubsetHeld = main.events.some(
    (e) => e.kind === `term` && e.collectionId === ids[1],
  )
  releaseSubset()
  await subset
  await waitFor(() => coordinator.isLeader(ids[1]!), `second leader`)
  return { termWhileSubsetHeld }
}

describe(`Electron reload election-order oracle`, () => {
  it.each(
    [1, 2, 3].flatMap((count) =>
      [1, 3].map((extraGrantTasks) => ({ count, extraGrantTasks })),
    ),
  )(
    `writes $count reloaded terms after every queued startup read (grant +$extraGrantTasks tasks)`,
    async ({ count, extraGrantTasks }) => {
      const { ids, events } = await reload({ count, extraGrantTasks })
      expect(orderViolations(events, ids)).toEqual([])
      // The recorder saw each startup read exactly once.
      expect(
        ids.map(
          (id) =>
            events.filter((e) => e.kind === `read` && e.collectionId === id)
              .length,
        ),
      ).toEqual(ids.map(() => 1))
    },
  )

  it(`settles a local write while another startup read is still queued`, async () => {
    const { ids, events, writeSettledWhileHeld } = await reload({
      count: 2,
      extraGrantTasks: 1,
      localWriteWhileReadHeld: true,
    })
    // A local write needs a leader, so its Collection elects at once; the
    // held read keeps the other Collection's term behind it.
    expect(writeSettledWhileHeld).toBe(true)
    expect(orderViolations(events, ids, new Set([ids[0]!]))).toEqual([])
  })

  it(`writes a reloaded term after a write already queued at its grant`, async () => {
    const { secondTermWhileWriteHeld, events } =
      await reloadWithWriteQueuedAtGrant()
    expect(secondTermWhileWriteHeld).toBe(false)
    const writeAt = events.findIndex((e) => e.kind === `write`)
    const secondTerm = events.findIndex(
      (e) => e.kind === `term` && e.collectionId === `reload-1`,
    )
    expect(writeAt).toBeGreaterThan(-1)
    expect(secondTerm).toBeGreaterThan(writeAt)
  })

  it(`writes a reloaded term after a subset read already queued at its grant`, async () => {
    const { termWhileSubsetHeld } = await reloadWithSubsetQueuedAtGrant()
    expect(termWhileSubsetHeld).toBe(false)
  })
})
