import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'
import { createCloudflareDOSQLiteDriver } from '../src'
import { createBetterSqliteDoStorageHarness } from './helpers/better-sqlite-do-storage'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-driver-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const storageHarness = createBetterSqliteDoStorageHarness({
    filename: dbPath,
  })
  const driver = createCloudflareDOSQLiteDriver({
    sql: storageHarness.sql,
  })

  return {
    driver,
    cleanup: () => {
      try {
        storageHarness.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

runSQLiteDriverContractSuite(`cloudflare durable object sqlite driver`, createDriverHarness)
