import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = new BetterSqlite3SQLiteDriver({ filename: dbPath })

  return {
    driver,
    cleanup: () => {
      try {
        driver.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteDriverContractSuite(`better-sqlite3 node driver`, createDriverHarness)
