/**
 * Chromium receiving witness for persisted demand coverage. It runs one
 * session per page load over the same OPFS database. The Playwright spec
 * (`persisted-on-demand-coverage.opfs.spec.ts`) navigates the page from
 * session 1 to session 2, so session 2 is a later page over the same storage.
 *
 * # Law and authority
 *
 * With `initialRender: { strategy: 'network-first', networkTimeoutMs }` on a
 * persisted `syncMode: 'on-demand'` Collection, a demand that an earlier
 * online session loaded settles from storage in a later offline session once
 * the wait has passed. A never-loaded demand stays loading. A row deleted
 * after coverage ends coverage. An ordered window (`orderBy rank`, `limit 2`)
 * settles only while its restore holds the rows it held when it settled.
 * Authority: `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`.
 * This file is a receiving witness: it checks the law over real OPFS with the
 * wa-sqlite worker driver, which the primary oracle does not run.
 *
 * # Histories
 *
 * Session 1 (online) loads D (`group = 'a'`) or the window
 * `group = 'a' orderBy rank limit 2` through real loads, then, for some
 * histories, changes the source. The law histories are the ones in the node
 * witness: `covered`, `never`, `deleted` (filter); `covered`, `replaced`
 * (window). Session 2 is offline: its upstream load is forwarded and never
 * answered. All five run with the default single-process coordinator, the
 * only coordinator the law covers.
 *
 * One further history pins documented out-of-scope behavior. With
 * `BrowserCollectionCoordinator`, a covered demand stays loading in session 2
 * after the wait. This pins the statement in `docs/guides/sqlite-persistence.md`
 * ("Only the default single-process coordinator supports this"). It pins that
 * guide statement, not the law. If coverage is later extended to multi-tab
 * coordinators, this history changes with the guide.
 *
 * # Production path
 *
 * Each session opens `openBrowserWASQLiteOPFSDatabase` and
 * `createBrowserWASQLitePersistence`, then builds the Collection with
 * `persistedCollectionOptions`. The coordinated history also passes a
 * `BrowserCollectionCoordinator`. Session 1 closes its database (and
 * coordinator, if any) before the page navigates.
 *
 * # Observations and checkpoints (session 2)
 *
 * - `beforeDeadline`: after the upstream load is forwarded and 100 ms have
 *   passed, while the wait (`SESSION_2_WAIT_MS`) has not. Every history must
 *   still be loading.
 * - `afterDeadline`: after polling up to `AFTER_DEADLINE_POLL_MS` for the
 *   query to leave loading. Law histories: covered histories must be ready with
 *   the restored rows, others still loading. The coordinated history: loading.
 * - Positive witness: session 2 forwarded at least one upstream load.
 *
 * Mutant evidence: with `SESSION_2_WAIT_MS = 60_000`, the covered law
 * histories stay loading at `afterDeadline` and the spec fails.
 *
 * # Limits
 *
 * One driver (wa-sqlite over OPFS in Chromium, one tab at a time). It does not
 * cover Firefox or WebKit, real multi-tab coordination, or the Electron and
 * Node drivers (the node witness covers better-sqlite3).
 */
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../src/index'

type Row = { id: string; group: string; rank: number; value: string }
type Shape = `filter` | `window`
type Session1History = `covered` | `never` | `deleted` | `replaced`

export type Observation = {
  status: string
  rows?: Array<string>
  upstreamCalls: number
  // The rows the Collection holds, whatever the query status. Session 2 sees
  // the restored rows here even while its query is still loading.
  visible: Array<string>
}

export type Session2Result = {
  beforeDeadline: Observation
  afterDeadline: Observation
}

declare global {
  interface Window {
    __persistedOnDemandSession1?: `complete` | `failed`
    __persistedOnDemandSession1Error?: string
    __persistedOnDemandSession2?: Session2Result
    __persistedOnDemandSession2Error?: string
  }
}

const SESSION_2_WAIT_MS = 1000
const AFTER_DEADLINE_POLL_MS = 2500

const A1: Row = { id: `a1`, group: `a`, rank: 1, value: `v1` }
const A2: Row = { id: `a2`, group: `a`, rank: 2, value: `v1` }
const A3: Row = { id: `a3`, group: `a`, rank: 3, value: `v1` }
const A15: Row = { id: `a15`, group: `a`, rank: 1.5, value: `v1` }

type Upstream = {
  calls: Array<LoadSubsetOptions>
  pendingCount: () => number
  answer: (rows: ReadonlyArray<Row>) => Promise<void>
  write: (rows: ReadonlyArray<Row>) => Promise<void>
  remove: (rows: ReadonlyArray<Row>) => Promise<void>
}

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

// Each load waits until the page answers it. An answer writes its rows in one
// sync transaction and then settles every pending load.
function onDemandSource(
  persistence: PersistedCollectionPersistence,
  waitMs: number,
): { collection: Collection<Row, string, any>; upstream: Upstream } {
  const pending: Array<() => void> = []
  let write: ((rows: ReadonlyArray<Row>) => void) | undefined
  let remove: ((rows: ReadonlyArray<Row>) => void) | undefined
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
      id: `browser-persisted-on-demand-coverage`,
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

// Opens one session's storage. `close` releases the coordinator and the
// database so that the next page can open the same OPFS file.
async function openSession(
  databaseName: string,
  coordinated: boolean,
): Promise<{
  persistence: PersistedCollectionPersistence
  close: () => Promise<void>
}> {
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  // Without a coordinator the wrapper uses the default single-process
  // coordinator, the only one the law covers (guide: sqlite-persistence.md).
  const coordinator = coordinated
    ? new BrowserCollectionCoordinator({ dbName: databaseName })
    : undefined
  const persistence = createBrowserWASQLitePersistence({
    database,
    ...(coordinator ? { coordinator } : {}),
    schemaMismatchPolicy: `reset`,
  })
  return {
    persistence,
    close: async () => {
      coordinator?.dispose()
      await database.close?.()
    },
  }
}

// Session 1 is online. It answers each real load so that the rows in OPFS
// come only from the wrapper.
async function runSession1(
  databaseName: string,
  shape: Shape,
  history: Session1History,
  coordinated: boolean,
): Promise<void> {
  const { persistence, close } = await openSession(databaseName, coordinated)
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
  databaseName: string,
  shape: Shape,
  coordinated: boolean,
): Promise<Session2Result> {
  const { persistence, close } = await openSession(databaseName, coordinated)
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
    visible: collection.toArray.map((row) => row.id).sort(),
  })
  try {
    void query.preload().catch(() => undefined)
    if (!(await until(() => upstream.calls.length > 0, 10_000))) {
      throw new Error(`session 2 never forwarded an upstream load`)
    }
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

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const phase = params.get(`phase`)
  const shape = params.get(`shape`) as Shape
  const history = params.get(`history`) as Session1History
  const coordinated = params.get(`coordinator`) === `browser`
  const databaseName = params.get(`db`)
  if (!databaseName) throw new Error(`missing db parameter`)
  if (phase === `1`) {
    try {
      await runSession1(databaseName, shape, history, coordinated)
      window.__persistedOnDemandSession1 = `complete`
    } catch (error) {
      window.__persistedOnDemandSession1Error = String(error)
      window.__persistedOnDemandSession1 = `failed`
    }
    return
  }
  try {
    window.__persistedOnDemandSession2 = await runSession2(
      databaseName,
      shape,
      coordinated,
    )
  } catch (error) {
    window.__persistedOnDemandSession2Error = String(error)
  }
}

void main()
