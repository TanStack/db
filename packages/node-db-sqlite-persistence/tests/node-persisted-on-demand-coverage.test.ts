/**
 * # Receiving witness: persisted demand coverage over better-sqlite3
 *
 * Law and authority: the receiving contract
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`)
 * states the law, owns the histories and their expected checkpoints, and runs
 * the sessions. The law is `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`;
 * the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * owns it across its cells. This file is the better-sqlite3 host. It checks
 * the same law over the real better-sqlite3 driver and
 * `createNodeSQLitePersistence`, which the primary oracle does not exercise
 * (it runs `node:sqlite` through a test driver).
 *
 * Histories: every history of `RECEIVING_HISTORIES`, each with its own
 * database file in a temp directory. Session 1 is online and takes the
 * history's steps. Session 2 is offline and opens a new connection to the same
 * file. Its upstream load never answers, or rejects at once, as the history says.
 *
 * Production path: each session builds a `persistedCollectionOptions`
 * Collection over `createNodeSQLitePersistence({ database })` and runs the
 * query's preload. Session 1 closes its database before session 2 opens.
 *
 * Observations and checkpoints (session 2 only, read by the contract):
 * - `beforeDeadline`: 100 ms after the upstream load is forwarded.
 * - `afterDeadline`: after polling up to 2 500 ms for the query to leave
 *   `loading`.
 * Each history's `expected` holds the outcome the law gives at both
 * checkpoints. The positive witness is `upstreamCalls > 0`: the offline source
 * was asked before any settlement.
 *
 * Mutant evidence (run in a temporary copy, see the coverage map): with
 * `SESSION_2_WAIT_MS = 60_000` in the contract, the covered histories stay
 * loading at `afterDeadline` and fail. With `covered-upstream-fails-at-once`
 * changed to `never-answers`, that history stays loading and fails.
 *
 * Limits: one driver (better-sqlite3, file database, single process
 * coordinator). It does not cover the browser OPFS driver (see the browser
 * witness), a second process, or multi-tab coordination. The bookkeeping is
 * observed only through the public query status and rows.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { createNodeSQLitePersistence } from '../src'
import {
  RECEIVING_HISTORIES,
  coverageRecords,
  recordReceivingHistory,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import { coverageViolations } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'

const dirs: Array<string> = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe(`node better-sqlite3 persisted demand coverage (receiving witness)`, () => {
  it.each(RECEIVING_HISTORIES)(`$description`, async (history) => {
    const dir = mkdtempSync(join(tmpdir(), `node-pod-`))
    dirs.push(dir)
    const path = join(dir, `db.sqlite`)

    const { session1, session2 } = await recordReceivingHistory(history, () => {
      const database = new BetterSqlite3(path)
      return Promise.resolve({
        persistence: createNodeSQLitePersistence({ database }),
        close: () => {
          database.close()
          return Promise.resolve()
        },
      })
    })
    // Positive witness: session 2 asked the offline source for the demand.
    expect(session2.sent.length).toBeGreaterThan(0)
    const records = coverageRecords(history, session1, session2)
    expect(coverageViolations(records.beforeDeadline)).toEqual([])
    expect(coverageViolations(records.afterDeadline)).toEqual([])
  })
})
