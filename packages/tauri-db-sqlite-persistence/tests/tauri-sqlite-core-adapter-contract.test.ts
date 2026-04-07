import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-core-adapter-contract'
import { TauriSQLiteDriver } from '../src/tauri-sql-driver'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'
import type { SQLiteCoreAdapterHarnessFactory } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-core-adapter-contract'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-tauri-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  const driver = new TauriSQLiteDriver({ database })

  const adapter = new SQLiteCorePersistenceAdapter({
    driver,
    ...options,
  })

  return {
    adapter,
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

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter (tauri sqlite driver harness)`,
  createHarness,
)
