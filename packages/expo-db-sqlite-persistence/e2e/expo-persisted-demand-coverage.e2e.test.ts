/**
 * # Receiving witness: persisted demand coverage over the Expo driver
 *
 * Law and authority: the receiving contract
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`)
 * holds the histories and records the sessions. The law is
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * owns it across its cells. This file is the Expo host. It checks the same law
 * through the wrapper `createExpoSQLitePersistence`, over the expo-sqlite-shaped driver in `tests/helpers/expo-sqlite-test-db.ts`.
 *
 * Histories: every history of `RECEIVING_HISTORIES`, each with its own database
 * file. Session 1 is online and takes the history's steps. Session 2 is offline
 * and opens a new driver on the same file, with its upstream as the history says.
 *
 * Production path: each session builds a `persistedCollectionOptions`
 * Collection over `createExpoSQLitePersistence` and runs the query's preload. Session 1 closes
 * its driver before session 2 opens.
 *
 * Observations: the records of both sessions, judged by the shared judge
 * (`persisted-demand-coverage-model-oracle.ts`) at each session 2 checkpoint.
 *
 * Limits: No device runs here. The helper backs the driver with better-sqlite3 unless a runtime factory is supplied (`TANSTACK_DB_MOBILE_SQLITE_FACTORY_MODULE`). The emulator runtime lane (`TANSTACK_DB_EXPO_RUNTIME_PLATFORM`) skips this witness, as it skips the conformance suite, because that lane runs the native driver through its own app. The sessions are two driver instances in one process over one file, not an app restart.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createExpoSQLitePersistence } from '../src'
import { createExpoSQLiteTestDatabase } from '../tests/helpers/expo-sqlite-test-db'
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

const DESCRIBE = `expo persisted demand coverage (receiving witness)`

// The emulator lane runs the native driver; this witness runs the shimmed driver.
const runtimePlatform = process.env.TANSTACK_DB_EXPO_RUNTIME_PLATFORM?.trim()
const describeShimmedDriver = runtimePlatform ? describe.skip : describe

describeShimmedDriver(DESCRIBE, () => {
  it.each(RECEIVING_HISTORIES)(
    `$description`,
    async (history) => {
      const dir = mkdtempSync(join(tmpdir(), `expo-demand-coverage-`))
      dirs.push(dir)
      const filename = join(dir, `state.sqlite`)

      const { session1, session2 } = await recordReceivingHistory(
        history,
        () => {
          const database = createExpoSQLiteTestDatabase({ filename })
          return Promise.resolve({
            persistence: createExpoSQLitePersistence({ database }),
            close: async () => {
              await database.closeAsync()
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
