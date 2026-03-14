import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import { ExpoSQLiteDriver } from '../src'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persisted-collection-core/src'
import { createExpoSQLiteTestDatabase } from './helpers/expo-sqlite-test-db'
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-expo-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createExpoSQLiteTestDatabase({
    filename: dbPath,
  })
  const driver = new ExpoSQLiteDriver({ database })

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
      await database.closeAsync()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter (expo-sqlite driver harness)`,
  createHarness,
)
