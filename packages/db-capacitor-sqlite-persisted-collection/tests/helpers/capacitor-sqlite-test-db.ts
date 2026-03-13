import BetterSqlite3 from 'better-sqlite3'
import type { CapacitorSQLiteDatabaseLike } from '../../src/capacitor-sqlite-driver'

export type CapacitorSQLiteTestDatabase = CapacitorSQLiteDatabaseLike & {
  close: () => Promise<void>
  getNativeDatabase?: () => InstanceType<typeof BetterSqlite3>
}

export function createCapacitorSQLiteTestDatabase(options: {
  filename: string
}): CapacitorSQLiteTestDatabase {
  const nativeDatabase = new BetterSqlite3(options.filename)
  let isTransactionActive = false

  return {
    open: () => Promise.resolve(),
    close: () => {
      nativeDatabase.close()
      return Promise.resolve()
    },
    execute: (statements: string) => {
      nativeDatabase.exec(statements)
      return Promise.resolve({
        changes: {
          changes: 0,
        },
      })
    },
    query: (statement: string, values: Array<unknown> = []) => {
      const prepared = nativeDatabase.prepare(statement)
      const rows =
        values.length > 0 ? prepared.all(...values) : prepared.all()
      return Promise.resolve({
        values: rows,
      })
    },
    run: (statement: string, values: Array<unknown> = []) => {
      const prepared = nativeDatabase.prepare(statement)
      const result =
        values.length > 0 ? prepared.run(...values) : prepared.run()
      return Promise.resolve({
        changes: {
          changes: result.changes,
          lastId: Number(result.lastInsertRowid),
        },
      })
    },
    beginTransaction: () => {
      nativeDatabase.exec(`BEGIN IMMEDIATE`)
      isTransactionActive = true
      return Promise.resolve({
        changes: {
          changes: 0,
        },
      })
    },
    commitTransaction: () => {
      nativeDatabase.exec(`COMMIT`)
      isTransactionActive = false
      return Promise.resolve({
        changes: {
          changes: 0,
        },
      })
    },
    rollbackTransaction: () => {
      nativeDatabase.exec(`ROLLBACK`)
      isTransactionActive = false
      return Promise.resolve({
        changes: {
          changes: 0,
        },
      })
    },
    isTransactionActive: () =>
      Promise.resolve({
        result: isTransactionActive,
      }),
    getNativeDatabase: () => nativeDatabase,
  } as unknown as CapacitorSQLiteTestDatabase
}
