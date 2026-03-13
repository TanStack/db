import BetterSqlite3 from 'better-sqlite3'
import type { CapacitorSQLiteDatabaseLike } from '../../src/capacitor-sqlite-driver'

export type CapacitorSQLiteTestDatabase = CapacitorSQLiteDatabaseLike & {
  close: () => Promise<void>
  getNativeDatabase?: () => InstanceType<typeof BetterSqlite3>
}

export type CapacitorSQLiteTestDatabaseFactory = (options: {
  filename: string
}) => CapacitorSQLiteTestDatabase

declare global {
  var __tanstackDbCreateCapacitorSQLiteTestDatabase:
    | CapacitorSQLiteTestDatabaseFactory
    | undefined
}

export function createCapacitorSQLiteTestDatabase(options: {
  filename: string
}): CapacitorSQLiteTestDatabase {
  if (
    typeof globalThis.__tanstackDbCreateCapacitorSQLiteTestDatabase ===
    `function`
  ) {
    return globalThis.__tanstackDbCreateCapacitorSQLiteTestDatabase(options)
  }

  const nativeDatabase = new BetterSqlite3(options.filename)
  let isTransactionActive = false

  return {
    open: async () => {},
    close: async () => {
      nativeDatabase.close()
    },
    execute: async (statements: string) => {
      nativeDatabase.exec(statements)
      return {
        changes: {
          changes: 0,
        },
      }
    },
    query: async (statement: string, values: Array<unknown> = []) => {
      const prepared = nativeDatabase.prepare(statement)
      const rows =
        values.length > 0 ? prepared.all(...values) : prepared.all()
      return {
        values: rows,
      }
    },
    run: async (statement: string, values: Array<unknown> = []) => {
      const prepared = nativeDatabase.prepare(statement)
      const result =
        values.length > 0 ? prepared.run(...values) : prepared.run()
      return {
        changes: {
          changes: result.changes,
          lastId: Number(result.lastInsertRowid),
        },
      }
    },
    beginTransaction: async () => {
      nativeDatabase.exec(`BEGIN IMMEDIATE`)
      isTransactionActive = true
      return {
        changes: {
          changes: 0,
        },
      }
    },
    commitTransaction: async () => {
      nativeDatabase.exec(`COMMIT`)
      isTransactionActive = false
      return {
        changes: {
          changes: 0,
        },
      }
    },
    rollbackTransaction: async () => {
      nativeDatabase.exec(`ROLLBACK`)
      isTransactionActive = false
      return {
        changes: {
          changes: 0,
        },
      }
    },
    isTransactionActive: async () => ({
      result: isTransactionActive,
    }),
    getNativeDatabase: () => nativeDatabase,
  } as unknown as CapacitorSQLiteTestDatabase
}
