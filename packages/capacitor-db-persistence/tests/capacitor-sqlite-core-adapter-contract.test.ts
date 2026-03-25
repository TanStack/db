import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteCoreAdapterContractSuite } from '../../db-persistence-core/tests/contracts/sqlite-core-adapter-contract'
import { CapacitorSQLiteDriver } from '../src/capacitor-sqlite-driver'
import { SQLiteCorePersistenceAdapter } from '../../db-persistence-core/src'
import { createCapacitorSQLiteTestDatabase } from './helpers/capacitor-sqlite-test-db'
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-persistence-core/tests/contracts/sqlite-core-adapter-contract'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-capacitor-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createCapacitorSQLiteTestDatabase({
    filename: dbPath,
  })
  const driver = new CapacitorSQLiteDriver({ database })

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
    cleanup: async () => {
      await database.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter (capacitor sqlite driver harness)`,
  createHarness,
)
