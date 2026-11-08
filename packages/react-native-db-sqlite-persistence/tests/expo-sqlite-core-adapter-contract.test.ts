import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe } from 'vitest'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-core-adapter-contract'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import type { SQLiteCoreAdapterHarnessFactory } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-core-adapter-contract'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-expo-sqlite-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createOpSQLiteTestDatabase({
    filename: dbPath,
    resultShape: `statement-array`,
  })
  const driver = new OpSQLiteDriver({
    database,
    arrayResultMode: `statement-results`,
  })

  const adapter = new SQLiteCorePersistenceAdapter({
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

describe(`expo-sqlite-core-adapter-contract.test`, () => {
  runSQLiteCoreAdapterContractSuite(
    `SQLiteCorePersistenceAdapter (expo op-sqlite driver harness)`,
    createHarness,
  )
})
