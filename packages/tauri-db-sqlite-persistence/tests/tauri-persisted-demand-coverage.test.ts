/**
 * # Receiving witness: persisted demand coverage over the Tauri driver
 *
 * Law and authority: the receiving contract
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`)
 * holds the histories and records the sessions. The law is
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * owns it across its cells. This file is the Tauri host. It checks the same law
 * through the wrapper `createTauriSQLitePersistence`, over the better-sqlite3 stand-in in `tests/helpers/tauri-sql-test-db.ts`.
 *
 * Histories: every history of `RECEIVING_HISTORIES`, each with its own database
 * file. Session 1 is online and takes the history's steps. Session 2 is offline
 * and opens a new driver on the same file, with its upstream as the history says.
 *
 * Production path: each session builds a `persistedCollectionOptions`
 * Collection over `createTauriSQLitePersistence` and runs the query's preload. Session 1 closes
 * its driver before session 2 opens.
 *
 * Observations: the records of both sessions, judged by the shared judge
 * (`persisted-demand-coverage-model-oracle.ts`) at each session 2 checkpoint.
 *
 * Limits: It runs in this package's existing unit suite, which already exercises the wrapper over that stand-in. It does not run the Tauri runtime (`tauri-plugin-sql` in a Rust process). The Tauri e2e (`e2e/run-tauri-e2e.ts`) that would run the native path needs `cargo`, which is not installed here, so that path is not covered. The sessions are two driver instances in one process over one file, not an app restart.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTauriSQLitePersistence } from '../src'
import {
  RECEIVING_HISTORIES,
  coverageRecords,
  recordReceivingHistory,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import { coverageViolations } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'

const dirs: Array<string> = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

const DESCRIBE = `tauri persisted demand coverage (receiving witness)`

describe(DESCRIBE, () => {
  it.each(RECEIVING_HISTORIES)(
    `$description`,
    async (history) => {
      const dir = mkdtempSync(join(tmpdir(), `tauri-demand-coverage-`))
      dirs.push(dir)
      const filename = join(dir, `state.sqlite`)

      const { session1, session2 } = await recordReceivingHistory(
        history,
        () => {
          const database = createTauriSQLiteTestDatabase({ filename })
          return Promise.resolve({
            persistence: createTauriSQLitePersistence({ database }),
            close: async () => {
              await database.close()
            },
          })
        },
      )
      // Positive witness: session 2 asked the offline source for the demand.
      expect(session2.sent.length).toBeGreaterThan(0)
      const records = coverageRecords(history, session1, session2)
      expect(coverageViolations(records.beforeDeadline)).toEqual([])
      expect(coverageViolations(records.afterDeadline)).toEqual([])
    },
    60_000,
  )
})
