import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import { CloudflareDOSQLiteDriver } from '../src'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persisted-collection-core/src'
import { createBetterSqliteDoStorageHarness } from './helpers/better-sqlite-do-storage'
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-sql-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const storageHarness = createBetterSqliteDoStorageHarness({
    filename: dbPath,
  })
  const driver = new CloudflareDOSQLiteDriver({
    sql: storageHarness.sql,
  })
  const adapter = new SQLiteCorePersistenceAdapter<
    SQLiteCoreAdapterContractTodo,
    string
  >({
    driver,
    ...options,
  })

  return {
    adapter,
    driver,
    cleanup: () => {
      try {
        storageHarness.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter (cloudflare do sqlite driver harness)`,
  createHarness,
)
