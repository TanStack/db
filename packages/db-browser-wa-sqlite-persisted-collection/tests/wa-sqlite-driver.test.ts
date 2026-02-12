import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'
import { BrowserWASQLiteDriver } from '../src/wa-sqlite-driver'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-browser-wa-sqlite-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const database = createWASQLiteTestDatabase({ filename: dbPath })
  const driver = new BrowserWASQLiteDriver({ database })

  return {
    driver,
    cleanup: () => {
      try {
        void driver.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteDriverContractSuite(`browser wa-sqlite driver`, createDriverHarness)
