/**
 * Renderer driver for the persisted demand coverage witness in
 * `tests/persisted-demand-coverage.electron.e2e.test.ts`. It runs in a real
 * Electron renderer and calls the real main process over real IPC through
 * `createElectronSQLitePersistence`. The test runs the app twice: phase `1`
 * is an online session that loads each history's demand, then changes the
 * source. Phase `2` is a later, separate app launch over the same database
 * file, with its upstream load never answered. The law, the histories, and the
 * checkpoints are those of the node witness
 * (`packages/node-db-sqlite-persistence/tests/node-persisted-on-demand-coverage.test.ts`).
 * This driver records what it observes; the test owns the assertions.
 */
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { persistedCollectionOptions } from '@tanstack/db-sqlite-persistence-core'
import { createElectronSQLitePersistence } from '../../../src/renderer'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceResponseEnvelope,
} from '../../../src/protocol'

type Row = { id: string; group: string; rank: number; value: string }
type Shape = `filter` | `window`
type Session1History = `covered` | `never` | `deleted` | `replaced`

type Observation = {
  status: string
  rows?: Array<string>
  upstreamCalls: number
}

type Upstream = {
  calls: Array<LoadSubsetOptions>
  pendingCount: () => number
  answer: (rows: ReadonlyArray<Row>) => Promise<void>
  write: (rows: ReadonlyArray<Row>) => Promise<void>
  remove: (rows: ReadonlyArray<Row>) => Promise<void>
}

type HistoryResult = {
  name: string
  error?: string
  beforeDeadline?: Observation
  afterDeadline?: Observation
}

type Bridge = {
  invoke: (channel: string, ...args: Array<unknown>) => Promise<unknown>
}

declare global {
  interface Window {
    demandBridge: Bridge
  }
}

// The same wait the node witness uses for session 2, and the same polls.
const SESSION_2_WAIT_MS = 1000
const AFTER_DEADLINE_POLL_MS = 2500

const A1: Row = { id: `a1`, group: `a`, rank: 1, value: `v1` }
const A2: Row = { id: `a2`, group: `a`, rank: 2, value: `v1` }
const A3: Row = { id: `a3`, group: `a`, rank: 3, value: `v1` }
const A15: Row = { id: `a15`, group: `a`, rank: 1.5, value: `v1` }

const HISTORIES: ReadonlyArray<{
  name: string
  shape: Shape
  session1: Session1History
}> = [
  { name: `covered`, shape: `filter`, session1: `covered` },
  { name: `never`, shape: `filter`, session1: `never` },
  { name: `deleted`, shape: `filter`, session1: `deleted` },
  { name: `window-covered`, shape: `window`, session1: `covered` },
  { name: `window-replaced`, shape: `window`, session1: `replaced` },
]

const bridge = window.demandBridge
const invoke: ElectronPersistenceInvoke = (channel, request) =>
  bridge.invoke(
    channel,
    request,
  ) as Promise<ElectronPersistenceResponseEnvelope>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await sleep(10)
  }
  return true
}

// Each load waits until the driver answers it. An answer writes its rows in
// one sync transaction and then settles every pending load.
function onDemandSource(
  persistence: PersistedCollectionPersistence,
  waitMs: number,
): { collection: Collection<Row, string, any>; upstream: Upstream } {
  const pending: Array<() => void> = []
  let write: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  let remove: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  const upstream: Upstream = {
    calls: [],
    pendingCount: () => pending.length,
    answer: async (rows) => {
      await write?.(rows)
      for (const settle of pending.splice(0)) settle()
    },
    write: async (rows) => {
      await write?.(rows)
    },
    remove: async (rows) => {
      await remove?.(rows)
    },
  }
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `electron-persisted-on-demand-coverage`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: waitMs },
      persistence,
      sync: {
        sync: (params) => {
          write = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `insert`, value })
            return params.commit()
          }
          remove = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `delete`, value })
            return params.commit()
          }
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              upstream.calls.push(options)
              return new Promise<void>((resolve) => {
                pending.push(resolve)
              })
            },
          }
        },
      },
    }),
  )
  return { collection, upstream }
}

function queryFor(shape: Shape, source: Collection<Row, string, any>) {
  return shape === `filter`
    ? createLiveQueryCollection((q) =>
        q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
      )
    : createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => eq(row.group, `a`))
          .orderBy(({ row }) => row.rank)
          .limit(2),
      )
}

// Opens the main-process session over one history's database file. The
// renderer's persistence then reaches that file only through IPC.
async function openSession(filename: string): Promise<{
  persistence: PersistedCollectionPersistence
  close: () => Promise<void>
}> {
  await bridge.invoke(`demand:session`, filename)
  return {
    persistence: createElectronSQLitePersistence({ invoke }),
    close: async () => {
      await bridge.invoke(`demand:close-session`)
    },
  }
}

// Session 1 is online. It answers each real load so that the rows in SQLite
// come only from the wrapper.
async function runSession1(
  filename: string,
  shape: Shape,
  history: Session1History,
): Promise<void> {
  const { persistence, close } = await openSession(filename)
  const { collection, upstream } = onDemandSource(persistence, 0)
  const query = queryFor(shape, collection)
  try {
    if (history === `never`) return
    const rows = shape === `filter` ? [A1, A2] : [A1, A2, A3]
    const preloaded = query.preload()
    const state = { settled: false }
    void preloaded.then(
      () => (state.settled = true),
      () => (state.settled = true),
    )
    for (let i = 0; i < 100 && !state.settled; i++) {
      if (upstream.pendingCount() > 0) await upstream.answer(rows)
      await sleep(10)
    }
    await preloaded
    // Positive witness: session 1 holds a1 and a2 online, for both shapes.
    const held = query.toArray.map((row) => row.id).sort()
    if (held.join(`,`) !== `a1,a2`) {
      throw new Error(`session 1 held ${held.join(`,`)}, expected a1,a2`)
    }
    if (history === `deleted`) await upstream.remove([A1])
    if (history === `replaced`) {
      await upstream.remove([A1])
      await upstream.write([A15])
    }
    await sleep(50)
  } finally {
    await query.cleanup()
    await collection.cleanup()
    await close()
  }
}

// Session 2 is offline: its upstream load is forwarded and never answered.
async function runSession2(
  filename: string,
  shape: Shape,
): Promise<{ beforeDeadline: Observation; afterDeadline: Observation }> {
  const { persistence, close } = await openSession(filename)
  const { collection, upstream } = onDemandSource(
    persistence,
    SESSION_2_WAIT_MS,
  )
  const query = queryFor(shape, collection)
  const observe = (): Observation => ({
    status: query.status,
    rows:
      query.status === `ready`
        ? query.toArray.map((row) => row.id).sort()
        : undefined,
    upstreamCalls: upstream.calls.length,
  })
  try {
    void query.preload().catch(() => undefined)
    // Positive witness: session 2 asks the offline source for the demand.
    await until(() => upstream.calls.length > 0, 10_000)
    await sleep(100)
    const beforeDeadline = observe()
    await until(() => query.status !== `loading`, AFTER_DEADLINE_POLL_MS)
    const afterDeadline = observe()
    return { beforeDeadline, afterDeadline }
  } finally {
    await query.cleanup()
    await collection.cleanup()
    await close()
  }
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const phase = params.get(`phase`)
  const dir = params.get(`dir`)!
  const results: Array<HistoryResult> = []
  for (const [index, history] of HISTORIES.entries()) {
    const filename = `${dir}/h${index}.sqlite`
    try {
      if (phase === `1`) {
        await runSession1(filename, history.shape, history.session1)
        results.push({ name: history.name })
      } else {
        const observed = await runSession2(filename, history.shape)
        results.push({ name: history.name, ...observed })
      }
    } catch (error) {
      results.push({
        name: history.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  await bridge.invoke(`demand:result`, JSON.stringify({ phase, results }))
}

void run()
