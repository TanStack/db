import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Temporal } from 'temporal-polyfill'
import { expect } from 'vitest'
import { SQLiteCorePersistenceAdapter } from '../src'
import { harnessScope } from './contracts/harness-scope'
import type { SQLInputValue } from 'node:sqlite'
import type { SQLiteDriver } from '../src'

// Fixtures for the SQLite typed-value oracle and its ordinary scenario tests. The
// oracle in `sqlite-temporal-value-oracle.test.ts` owns the typed-value law.

export const collectionId = `typed-values`

// Explicit native-type observations catch same-class objects whose enumerable
// fields are empty. Deep equality alone can miss a changed Temporal value.
export function observe(value: unknown): unknown {
  if (value instanceof Date) return { kind: `Date`, text: value.toISOString() }
  if (value instanceof Temporal.Instant) {
    return { kind: `Instant`, text: value.toString() }
  }
  if (value instanceof Temporal.PlainDate) {
    return { kind: `PlainDate`, text: value.toString() }
  }
  if (Array.isArray(value)) return value.map(observe)
  if (value !== null && typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, observe(entry)]),
    )
  }
  return value
}

export function check(
  actual: unknown,
  expected: unknown,
  checkpoint: string,
  assertion: typeof expect.soft = expect,
): void {
  assertion(observe(actual), checkpoint).toStrictEqual(expected)
}

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
