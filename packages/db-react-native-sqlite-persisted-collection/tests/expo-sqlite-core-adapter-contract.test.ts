import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'
import {
  createExpoSQLitePersistenceAdapter,
  createOpSQLiteDriver,
} from '../src'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import type {
  SQLiteCoreAdapterContractTodo,
  SQLiteCoreAdapterHarnessFactory,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-core-adapter-contract'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-expo-sqlite-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createOpSQLiteTestDatabase({
    filename: dbPath,
    resultShape: `statement-array`,
  })
  const driver = createOpSQLiteDriver({ database })

  const adapter = createExpoSQLitePersistenceAdapter<
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
      await Promise.resolve(database.close())
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter (expo op-sqlite driver harness)`,
  createHarness,
)
