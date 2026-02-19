import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runSQLiteDriverContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'
import { CloudflareDOSQLiteDriver } from '../src/do-driver'
import { InvalidPersistedCollectionConfigError } from '../../db-sqlite-persisted-collection-core/src'
import { createBetterSqliteDoStorageHarness } from './helpers/better-sqlite-do-storage'
import type { SQLiteDriverContractHarness } from '../../db-sqlite-persisted-collection-core/tests/contracts/sqlite-driver-contract'

function createDriverHarness(): SQLiteDriverContractHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-driver-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const storageHarness = createBetterSqliteDoStorageHarness({
    filename: dbPath,
  })
  const driver = new CloudflareDOSQLiteDriver({
    storage: storageHarness.storage,
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

runSQLiteDriverContractSuite(
  `cloudflare durable object sqlite driver`,
  createDriverHarness,
)

describe(`cloudflare durable object sqlite driver (native transaction mode)`, () => {
  it(`uses storage.transaction when available`, async () => {
    const executedSql = new Array<string>()
    let transactionCalls = 0
    const driver = new CloudflareDOSQLiteDriver({
      storage: {
        sql: {
          exec: (sql) => {
            executedSql.push(sql)
            if (sql.startsWith(`SELECT`)) {
              return [{ value: 1 }]
            }
            return []
          },
        },
        transaction: async (fn) => {
          transactionCalls++
          return fn()
        },
      },
    })

    await driver.transaction(async (transactionDriver) => {
      await transactionDriver.run(`INSERT INTO todos (id) VALUES (?)`, [`1`])
      const rows = await transactionDriver.query<{ value: number }>(
        `SELECT 1 AS value`,
      )
      expect(rows).toEqual([{ value: 1 }])
    })

    expect(transactionCalls).toBe(1)
    expect(executedSql).toContain(`INSERT INTO todos (id) VALUES (?)`)
    expect(executedSql).not.toContain(`BEGIN IMMEDIATE`)
    expect(executedSql).not.toContain(`COMMIT`)
  })

  it(`throws a clear error for nested transactions in native transaction mode`, async () => {
    const driver = new CloudflareDOSQLiteDriver({
      storage: {
        sql: {
          exec: () => [],
        },
        transaction: async (fn) => fn(),
      },
    })

    await expect(
      driver.transaction(async (transactionDriver) =>
        transactionDriver.transaction((_nestedDriver) =>
          Promise.resolve(undefined),
        ),
      ),
    ).rejects.toBeInstanceOf(InvalidPersistedCollectionConfigError)

    await expect(
      driver.transaction(async (transactionDriver) =>
        transactionDriver.transaction((_nestedDriver) =>
          Promise.resolve(undefined),
        ),
      ),
    ).rejects.toThrow(`Nested SQL savepoints are not supported`)
  })
})
