import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import type { CapacitorSQLiteDatabaseLike } from '../../../src/capacitor-sqlite-driver'

export type NativeCapacitorSQLiteTestDatabase = CapacitorSQLiteDatabaseLike & {
  open: () => Promise<void>
  close: () => Promise<void>
  getDatabaseName: () => string
}

function hashString(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash.toString(36)
}

function createDatabaseName(runId: string, filename: string): string {
  const suffix = hashString(filename)
  return `tanstack_db_capacitor_e2e_${runId}_${suffix}`
}

export function createNativeCapacitorSQLiteTestDatabaseFactory(options: {
  sqlite?: SQLiteConnection
  runId: string
}): (databaseOptions: {
  filename: string
}) => NativeCapacitorSQLiteTestDatabase {
  const sqlite = options.sqlite ?? new SQLiteConnection(CapacitorSQLite)

  return ({ filename }) => {
    const databaseName = createDatabaseName(options.runId, filename)
    const connectionPromise = (async () => {
      const database = await sqlite.createConnection(
        databaseName,
        false,
        `no-encryption`,
        1,
        false,
      )
      await database.open()
      return database
    })()

    return {
      open: async () => {
        await connectionPromise
      },
      close: async () => {
        const database = await connectionPromise
        try {
          await database.close()
        } catch {}

        try {
          await sqlite.closeConnection(databaseName, false)
        } catch {}
      },
      execute: async (statements, transaction, isSQL92) => {
        const database = await connectionPromise
        return database.execute(statements, transaction, isSQL92)
      },
      query: async (statement, values, isSQL92) => {
        const database = await connectionPromise
        return database.query(statement, values, isSQL92)
      },
      run: async (statement, values, transaction, returnMode, isSQL92) => {
        const database = await connectionPromise
        return database.run(statement, values, transaction, returnMode, isSQL92)
      },
      getDatabaseName: () => databaseName,
    }
  }
}
