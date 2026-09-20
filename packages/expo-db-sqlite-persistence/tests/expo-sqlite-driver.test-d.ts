import { describe, it } from 'vitest'
import { createExpoSQLitePersistence } from '../src'
import {
  ExpoSQLiteDriver,
  createExpoSQLiteDriver,
} from '../src/expo-sqlite-driver'
import type { SQLiteDatabase } from 'expo-sqlite'
import type { ExpoSQLiteDatabaseLike } from '../src'

// Law: the adapter's structural boundary accepts the installed Expo vendor
// database itself while retaining the exclusive-transaction requirement.
describe(`Expo SQLite driver types`, () => {
  it(`accepts the vendor database returned by expo-sqlite`, () => {
    const database = null as unknown as SQLiteDatabase

    createExpoSQLitePersistence({ database })
    createExpoSQLiteDriver({ database })
    new ExpoSQLiteDriver({ database })

    const compatible: ExpoSQLiteDatabaseLike = database
    void compatible
  })

  it(`rejects databases without an exclusive transaction boundary`, () => {
    const database = {
      execAsync: (_sql: string) => Promise.resolve(),
      getAllAsync: <T>(_sql: string) => Promise.resolve([] as Array<T>),
      runAsync: (_sql: string) =>
        Promise.resolve({ changes: 0, lastInsertRowId: 0 }),
    }

    createExpoSQLitePersistence({
      // @ts-expect-error persistence requires exclusive transactions
      database,
    })
  })
})
