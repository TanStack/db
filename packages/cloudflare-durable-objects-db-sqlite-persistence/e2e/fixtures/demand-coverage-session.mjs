// @ts-nocheck
/**
 * Durable Object side of the persisted demand coverage witness
 * (`e2e/cloudflare-persisted-demand-coverage.e2e.test.ts`). The worker runs
 * one session per request, against the Durable Object's own storage, through
 * the real `createCloudflareDOSQLitePersistence`. The test restarts wrangler
 * between session 1 and session 2, so session 2 reads what workerd persisted.
 * The law, the histories, and the checkpoints are those of the node witness
 * (`packages/node-db-sqlite-persistence/tests/node-persisted-on-demand-coverage.test.ts`).
 * This module records what it observes; the test owns the assertions.
 */
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import {
  createCloudflareDOSQLitePersistence,
  persistedCollectionOptions,
} from '../../dist/esm/index.js'

const COLLECTION_ID = `cloudflare-persisted-on-demand-coverage`
// The same wait the node witness uses for session 2, and the same polls.
const SESSION_2_WAIT_MS = 1000
const AFTER_DEADLINE_POLL_MS = 2500

const A1 = { id: `a1`, group: `a`, rank: 1, value: `v1` }
const A2 = { id: `a2`, group: `a`, rank: 2, value: `v1` }
const A3 = { id: `a3`, group: `a`, rank: 3, value: `v1` }
const A15 = { id: `a15`, group: `a`, rank: 1.5, value: `v1` }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await sleep(10)
  }
  return true
}

// Each load waits until the session answers it. An answer writes its rows in
// one sync transaction, then settles every pending load.
function onDemandSource(persistence, waitMs) {
  const pending = []
  let write
  let remove
  const upstream = {
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
    persistedCollectionOptions({
      id: COLLECTION_ID,
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
            loadSubset: (options) => {
              upstream.calls.push(options)
              return new Promise((resolve) => {
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

function queryFor(shape, source) {
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

// Session 1 is online. Each history makes the source answer or change rows
// through real loads, so the rows in Durable Object storage come only from the
// wrapper.
async function runSession1(storage, shape, history) {
  const persistence = createCloudflareDOSQLitePersistence({ storage })
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
  }
}

// Session 2 is offline: its upstream load is forwarded and never answered.
async function runSession2(storage, shape) {
  const persistence = createCloudflareDOSQLitePersistence({ storage })
  const { collection, upstream } = onDemandSource(
    persistence,
    SESSION_2_WAIT_MS,
  )
  const query = queryFor(shape, collection)
  const observe = () => ({
    status: query.status,
    rows:
      query.status === `ready`
        ? query.toArray.map((row) => row.id).sort()
        : undefined,
    upstreamCalls: upstream.calls.length,
  })
  try {
    void query.preload().catch(() => undefined)
    await until(() => upstream.calls.length > 0, 10_000)
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

// Runs one session. `phase` is `session1` (online, loads and changes rows) or
// `session2` (offline, returns observations). Errors reject to the caller.
export async function runDemandCoverageSession(storage, body) {
  if (body.phase === `session1`) {
    await runSession1(storage, body.shape, body.history)
    return { phase: `session1` }
  }
  return { phase: `session2`, ...(await runSession2(storage, body.shape)) }
}
