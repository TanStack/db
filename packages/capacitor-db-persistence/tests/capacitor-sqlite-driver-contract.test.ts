import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteDriverContractSuite } from '../../db-persistence-core/tests/contracts/sqlite-driver-contract'
import { CapacitorSQLiteDriver } from '../src/capacitor-sqlite-driver'
import { createCapacitorSQLiteTestDatabase } from './helpers/capacitor-sqlite-test-db'
import type { SQLiteDriverContractHarness } from '../../db-persistence-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-capacitor-sqlite-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createCapacitorSQLiteTestDatabase({ filename: dbPath })
  const driver = new CapacitorSQLiteDriver({ database })

  return {
    driver,
    cleanup: async () => {
      try {
        await database.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteDriverContractSuite(`capacitor sqlite driver`, createDriverHarness)
