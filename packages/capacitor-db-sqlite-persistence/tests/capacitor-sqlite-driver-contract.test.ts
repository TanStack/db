import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe } from 'vitest'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'
import { CapacitorSQLiteDriver } from '../src/capacitor-sqlite-driver'
import { createCapacitorSQLiteTestDatabase } from './helpers/capacitor-sqlite-test-db'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'

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

describe(`Capacitor SQLite driver satisfies the shared SQLite driver contract`, () => {
  runSQLiteDriverContractSuite(`capacitor sqlite driver`, createDriverHarness)
})
