import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe } from 'vitest'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'
import { TauriSQLiteDriver } from '../src/tauri-sql-driver'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-tauri-sqlite-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  const driver = new TauriSQLiteDriver({ database })

  return {
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

describe(`Tauri SQL plugin driver satisfies the shared SQLite driver contract`, () => {
  runSQLiteDriverContractSuite(`tauri sqlite driver`, createDriverHarness)
})
