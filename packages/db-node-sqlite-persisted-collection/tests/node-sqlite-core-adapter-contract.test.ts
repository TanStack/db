import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import { BetterSqlite3SQLiteDriver } from '../src'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persisted-collection-core/src'
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
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
        driver.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter (better-sqlite3 node driver)`,
  createHarness,
)
