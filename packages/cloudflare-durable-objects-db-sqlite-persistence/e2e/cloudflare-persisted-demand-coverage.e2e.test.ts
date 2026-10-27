/**
 * # Receiving witness: persisted demand coverage over Cloudflare Durable Objects
 *
 * Law (`docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`):
 * with `initialRender: { strategy: 'network-first', networkTimeoutMs }` on a
 * persisted `syncMode: 'on-demand'` Collection, a demand that an earlier
 * online session loaded settles from storage in a later offline session once
 * the wait has passed. A never-loaded demand stays loading. A row deleted
 * after coverage ends coverage. An ordered window (`orderBy rank`, `limit 2`)
 * settles only while its restore holds the rows it held when it settled.
 *
 * Authority: the primary oracle owns the law across its cells. This file is a
 * receiving witness: it checks the same law through the Cloudflare Durable
 * Object persistence (`createCloudflareDOSQLitePersistence`) inside a real
 * workerd runtime started by `wrangler dev --local --persist-to`. The primary
 * oracle does not run workerd. The node witness covers better-sqlite3.
 *
 * Histories (each history has its own wrangler persist directory):
 * - `covered`: session 1 is online and loads D (`group = 'a'`) with a1 and a2.
 * - `never`: session 1 never asks for D.
 * - `deleted`: session 1 loads D, then the source deletes a1.
 * - `window-covered`: session 1 loads `group = 'a' orderBy rank limit 2` with
 *   a1, a2, a3 in the source, so the window holds a1 and a2.
 * - `window-replaced`: as `window-covered`, then the source deletes a1 and
 *   inserts a15 at rank 1.5, below the boundary.
 * Session 2 is offline: its upstream load is recorded and never answers.
 *
 * Production path: the test starts wrangler and posts session 1 to the
 * Durable Object (`/demand-session`, phase `session1`). The Durable Object
 * runs the session in `e2e/fixtures/demand-coverage-session.mjs` over its own
 * storage. The test stops wrangler, then starts it again over the same
 * persist directory and posts session 2 (phase `session2`). Session 2 runs
 * the query's preload with a wait of `SESSION_2_WAIT_MS`.
 *
 * Observations and checkpoints (session 2 only, read inside the Durable
 * Object):
 * - `beforeDeadline`: after the upstream load is forwarded and 100 ms have
 *   passed, while the wait has not passed. Every history must still be loading.
 * - `afterDeadline`: after polling up to `AFTER_DEADLINE_POLL_MS` for the
 *   query to leave loading. Covered histories must be ready with the restored
 *   rows. Other histories must still be loading.
 * - Positive witness: session 2's upstream load was forwarded, so the offline
 *   source was asked. Session 1 also checks that it held a1 and a2 online.
 *
 * Mutant evidence (run in a temporary copy, see the coverage map): with
 * `SESSION_2_WAIT_MS = 60_000` in the Durable Object driver, the covered
 * histories stay loading at `afterDeadline` and fail.
 *
 * Limits: local workerd with the Durable Object's SQLite storage, one
 * Durable Object name, and a process restart between the sessions. It does not
 * cover deployed Cloudflare, the browser or React adapter, or multi-object
 * coordination. The bookkeeping is observed only through the public query
 * status and rows.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { postJson, startWranglerRuntime } from './fixtures/wrangler-runtime'

type Shape = `filter` | `window`
type Session1History = `covered` | `never` | `deleted` | `replaced`
type Observation = {
  status: string
  rows?: Array<string>
  upstreamCalls: number
}
type Session2Rows = {
  phase: `session2`
  beforeDeadline: Observation
  afterDeadline: Observation
}

const HISTORIES: ReadonlyArray<{
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

describe(`cloudflare durable object persisted demand coverage (wrangler local, receiving witness)`, () => {
  it.each(HISTORIES)(
    `$name`,
    async ({ shape, session1, settles }) => {
      const tempDirectory = mkdtempSync(join(tmpdir(), `db-cloudflare-demand-`))
      const persistPath = join(tempDirectory, `wrangler-state`)
      try {
        // Session 1 is online. It runs in one wrangler process, then stops.
        const first = await startWranglerRuntime({ persistPath })
        try {
          const session1Result = await postJson<{ phase: `session1` }>(
            first,
            `/demand-session`,
            { phase: `session1`, shape, history: session1 },
          )
          // Positive witness: session 1 held a1 and a2 online.
          expect(session1Result).toEqual({
            ok: true,
            rows: { phase: `session1` },
          })
        } finally {
          await first.stop()
        }

        // Session 2 is a later process over the same persist directory.
        const second = await startWranglerRuntime({ persistPath })
        try {
          const session2 = await postJson<Session2Rows>(
            second,
            `/demand-session`,
            { phase: `session2`, shape },
          )
          if (!session2.ok) {
            throw new Error(`${session2.error.name}: ${session2.error.message}`)
          }
          const { beforeDeadline, afterDeadline } = session2.rows ?? {
            beforeDeadline: undefined,
            afterDeadline: undefined,
          }
          // Every history waits for the network before it may settle.
          expect(beforeDeadline?.status).toBe(`loading`)
          // Positive witness: session 2 asked the offline source.
          expect(afterDeadline?.upstreamCalls).toBeGreaterThan(0)
          expect({
            status: afterDeadline?.status,
            rows: afterDeadline?.rows,
          }).toEqual(
            settles
              ? { status: `ready`, rows: [`a1`, `a2`] }
              : { status: `loading`, rows: undefined },
          )
        } finally {
          await second.stop()
        }
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
    90_000,
  )
})
