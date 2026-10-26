import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteCorePersistenceAdapter } from '../src'
import { harnessScope } from './contracts/harness-scope'
import type { SQLInputValue } from 'node:sqlite'
import type { SQLiteDriver } from '../src'

// Fixtures for the SQLite typed-value oracle and its ordinary scenario tests. The
// oracle in `sqlite-temporal-value-oracle.test.ts` owns the typed-value law.

export const collectionId = `typed-values`

export function binding(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  )
    return value
  throw new Error(`Unexpected SQLite binding: ${String(value)}`)
}

export function createDriver(database: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
      Promise.resolve(
        database.prepare(sql).all(...params.map(binding)) as Array<T>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(binding))
      return Promise.resolve()
    },
    transaction: async (task) => {
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await task(driver)
        database.exec(`COMMIT`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return driver
}

export const scope = harnessScope(() => {
  const directory = mkdtempSync(join(tmpdir(), `db-temporal-oracle-`))
  let database: DatabaseSync | undefined
  function close(): void {
    database?.close()
    database = undefined
  }
  return {
    open() {
      close()
      database = new DatabaseSync(join(directory, `state.sqlite`))
      return {
        database,
        adapter: new SQLiteCorePersistenceAdapter({
          driver: createDriver(database),
        }),
      }
    },
    cleanup() {
      try {
        close()
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
})
