/**
 * # Receiving witness: persisted demand coverage over the React Native driver
 *
 * Law and authority: the receiving contract
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`)
 * holds the histories and records the sessions. The law is
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * owns it across its cells. This file is the React Native host. It checks the same law
 * through the wrapper `createReactNativeSQLitePersistence`, over the op-sqlite-shaped driver in `tests/helpers/op-sqlite-test-db.ts`.
 *
 * Histories: every history of `RECEIVING_HISTORIES`, each with its own database
 * file. Session 1 is online and takes the history's steps. Session 2 is offline
 * and opens a new driver on the same file, with its upstream as the history says.
 *
 * Production path: each session builds a `persistedCollectionOptions`
 * Collection over `createReactNativeSQLitePersistence` and runs the query's preload. Session 1 closes
 * its driver before session 2 opens.
 *
 * Observations: the records of both sessions, judged by the shared judge
 * (`persisted-demand-coverage-model-oracle.ts`) at each session 2 checkpoint.
 *
 * Limits: No device runs here. The helper backs the driver with better-sqlite3 unless a runtime factory is supplied (`TANSTACK_DB_MOBILE_SQLITE_FACTORY_MODULE`), in which case this witness uses that factory like the conformance suite. It does not run on a device or simulator, and it does not cover the native OP-SQLite binding unless a runtime factory is supplied. The sessions are two driver instances in one process over one file, not an app restart.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createReactNativeSQLitePersistence } from '../src'
import { createOpSQLiteTestDatabase } from '../tests/helpers/op-sqlite-test-db'
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

const DESCRIBE = `react native persisted demand coverage (receiving witness)`

describe(DESCRIBE, () => {
  it.each(RECEIVING_HISTORIES)(
    `$description`,
    async (history) => {
      const dir = mkdtempSync(join(tmpdir(), `rn-demand-coverage-`))
      dirs.push(dir)
      const filename = join(dir, `state.sqlite`)

      const { session1, session2 } = await recordReceivingHistory(
        history,
        () => {
          const database = createOpSQLiteTestDatabase({
            filename,
            resultShape: `statement-array`,
          })
          return Promise.resolve({
            persistence: createReactNativeSQLitePersistence({
              database,
              arrayResultMode: `statement-results`,
            }),
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
