import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteDriverContractSuite } from '../../db-persistence-core/tests/contracts/sqlite-driver-contract'
import { ExpoSQLiteDriver } from '../src/expo-sqlite-driver'
import { createExpoSQLiteTestDatabase } from './helpers/expo-sqlite-test-db'
import type { SQLiteDriverContractHarness } from '../../db-persistence-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-expo-driver-contract-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createExpoSQLiteTestDatabase({
    filename: dbPath,
  })
  const driver = new ExpoSQLiteDriver({ database })

  return {
    driver,
    cleanup: async () => {
      try {
        await database.closeAsync()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteDriverContractSuite(`expo sqlite driver`, createDriverHarness)
