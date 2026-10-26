/**
 * # Receiving witness: persisted demand coverage over better-sqlite3
 *
 * Law (`docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`):
 * with `initialRender: { strategy: 'network-first', networkTimeoutMs }` on a
 * persisted `syncMode: 'on-demand'` Collection, a demand that an earlier
 * online session loaded settles from SQLite in a later offline session once
 * the wait has passed. A never-loaded demand stays loading. A row deleted
 * after coverage ends coverage. An ordered window (`orderBy rank`, `limit 2`)
 * settles only while its restore holds the rows it held when it settled.
 *
 * Authority: the primary oracle owns the law across all its cells. This file
 * is a receiving witness: it checks the same law over the real better-sqlite3
 * driver and `createNodeSQLitePersistence`, which the primary oracle does not
 * exercise (it runs `node:sqlite` through a test driver).
 *
 * Histories (each has two sessions over one database file in a temp dir):
 * - `covered`: session 1 is online and loads D (`group = 'a'`) with a1 and a2.
 * - `never`: session 1 never asks for D.
 * - `deleted`: session 1 loads D, then the source deletes a1.
 * - window `covered`: session 1 loads `group = 'a' orderBy rank limit 2` with
 *   a1, a2, a3 in the source, so the window holds a1 and a2.
 * - window `replaced`: as window `covered`, then the source deletes a1 and
 *   inserts a15 at rank 1.5, below the boundary.
 * Session 2 is offline: its upstream load is recorded and never answers.
 *
 * Production path: session 2 creates a `persistedCollectionOptions` Collection
 * over `createNodeSQLitePersistence({ database })`, with a wait of
 * `SESSION_2_WAIT_MS`, and runs the query's preload. Session 2 reads the
 * same file as session 1 through a new connection.
 *
 * Observations and checkpoints (session 2 only):
 * - `beforeDeadline`: after the upstream load is forwarded and 100 ms have
 *   passed, while the wait has not passed. Every history must still be loading.
 * - `afterDeadline`: after polling up to `AFTER_DEADLINE_POLL_MS` for the
 *   query to leave loading. Covered histories must be ready with the restored
 *   rows. Other histories must still be loading.
 * - Positive witness: session 2's upstream load was forwarded, so the
 *   offline source was asked. A settlement without that call would not be a
 *   settlement from the source's answer.
 *
 * Mutant evidence (run in a temporary copy, see the coverage map): with
 * `SESSION_2_WAIT_MS = 60_000`, the covered histories stay loading at
 * `afterDeadline` and fail.
 *
 * Limits: this is one driver (better-sqlite3, file database, single process
 * coordinator). It does not cover the browser OPFS driver (see the browser
 * witness), a second process, or multi-tab coordination. The bookkeeping is
 * observed only through the public query status and rows.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { createNodeSQLitePersistence, persistedCollectionOptions } from '../src'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { BetterSqlite3Database } from '../src'

type Row = { id: string; group: string; rank: number; value: string }
type Shape = `filter` | `window`
type Session1History = `covered` | `never` | `deleted` | `replaced`

const SESSION_2_WAIT_MS = 1000
const AFTER_DEADLINE_POLL_MS = 2500

const A1: Row = { id: `a1`, group: `a`, rank: 1, value: `v1` }
const A2: Row = { id: `a2`, group: `a`, rank: 2, value: `v1` }
const A3: Row = { id: `a3`, group: `a`, rank: 3, value: `v1` }
const A15: Row = { id: `a15`, group: `a`, rank: 1.5, value: `v1` }

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

// A generic on-demand source. Each load waits until the test answers it.
// An answer writes its rows in one sync transaction, then settles every
// pending load.
function onDemandSource(
  persistence: ReturnType<typeof createNodeSQLitePersistence>,
  waitMs: number,
): { collection: Collection<Row, string, any>; upstream: Upstream } {
  const pending: Array<() => void> = []
  let write: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  let remove: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  const upstream: Upstream = {
    calls: [],
    pendingCount: () => pending.length,
    // A load settles after its rows are durable (law 7 in ARCHITECTURE.md).
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
      id: `node-persisted-on-demand-coverage`,
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

function filterQuery(source: Collection<Row, string, any>) {
  return createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
  )
}

function windowQuery(source: Collection<Row, string, any>) {
  return createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .where(({ row }) => eq(row.group, `a`))
      .orderBy(({ row }) => row.rank)
      .limit(2),
  )
}

function queryFor(shape: Shape, source: Collection<Row, string, any>) {
  return shape === `filter` ? filterQuery(source) : windowQuery(source)
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

// Session 1 is online. Each history makes the source answer or change rows
// through real loads, so the rows in SQLite come only from the wrapper.
async function runSession1(
  database: BetterSqlite3Database,
  shape: Shape,
  history: Session1History,
): Promise<void> {
  const persistence = createNodeSQLitePersistence({ database })
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
    expect(query.toArray.map((row) => row.id).sort()).toEqual([`a1`, `a2`])
    if (history === `deleted`) await upstream.remove([A1])
    if (history === `replaced`) {
      await upstream.remove([A1])
      await upstream.write([A15])
    }
    await sleep(50)
  } finally {
    await query.cleanup()
    await collection.cleanup()
  }
}

// Session 2 is offline: its upstream load is forwarded and never answered.
async function runSession2(
  database: BetterSqlite3Database,
  shape: Shape,
): Promise<{ beforeDeadline: Observation; afterDeadline: Observation }> {
  const persistence = createNodeSQLitePersistence({ database })
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
    // Positive witness: session 2 asked the offline source for the demand.
    expect(await until(() => upstream.calls.length > 0, 1000)).toBe(true)
    await sleep(100)
    const beforeDeadline = observe()
    await until(() => query.status !== `loading`, AFTER_DEADLINE_POLL_MS)
    const afterDeadline = observe()
    return { beforeDeadline, afterDeadline }
  } finally {
    await query.cleanup()
    await collection.cleanup()
  }
}

const SCENARIOS: ReadonlyArray<{
  name: string
  shape: Shape
  session1: Session1History
  settles: boolean
}> = [
  {
    name: `covered demand settles offline with its restored rows`,
    shape: `filter`,
    session1: `covered`,
    settles: true,
  },
  {
    name: `never-loaded demand stays loading offline`,
    shape: `filter`,
    session1: `never`,
    settles: false,
  },
  {
    name: `covered demand stays loading after a source delete of one row`,
    shape: `filter`,
    session1: `deleted`,
    settles: false,
  },
  {
    name: `covered ordered window settles offline`,
    shape: `window`,
    session1: `covered`,
    settles: true,
  },
  {
    name: `covered ordered window stays loading after a row replaced below the boundary`,
    shape: `window`,
    session1: `replaced`,
    settles: false,
  },
]

const dirs: Array<string> = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe(`node better-sqlite3 persisted demand coverage (receiving witness)`, () => {
  it.each(SCENARIOS)(`$name`, async ({ shape, session1, settles }) => {
    const dir = mkdtempSync(join(tmpdir(), `node-pod-`))
    dirs.push(dir)
    const path = join(dir, `db.sqlite`)

    const first = new BetterSqlite3(path)
    try {
      await runSession1(first, shape, session1)
    } finally {
      first.close()
    }

    const second = new BetterSqlite3(path)
    try {
      const { beforeDeadline, afterDeadline } = await runSession2(second, shape)
      // Every history waits for the network before it may settle.
      expect(beforeDeadline.status).toBe(`loading`)
      // Positive witness: session 2 asked the offline source. An ordered
      // window may also issue its tie-boundary load, so the count is not 1.
      expect(afterDeadline.upstreamCalls).toBeGreaterThan(0)
      expect({
        status: afterDeadline.status,
        rows: afterDeadline.rows,
      }).toEqual(
        settles
          ? { status: `ready`, rows: [`a1`, `a2`] }
          : { status: `loading`, rows: undefined },
      )
    } finally {
      second.close()
    }
  })
})
