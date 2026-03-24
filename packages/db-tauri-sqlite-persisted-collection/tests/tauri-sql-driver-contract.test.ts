import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'
import { TauriSQLiteDriver } from '../src/tauri-sql-driver'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-tauri-sqlite-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  const driver = new TauriSQLiteDriver({ database })

  return {
    driver,
    cleanup: async () => {
      try {
        database.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteDriverContractSuite(`tauri sqlite driver`, createDriverHarness)
