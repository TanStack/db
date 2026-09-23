import { describe, it } from 'vitest'
import { createExpoSQLitePersistence } from '../src'
import {
  ExpoSQLiteDriver,
  createExpoSQLiteDriver,
} from '../src/expo-sqlite-driver'
import type { SQLiteDatabase } from 'expo-sqlite'
import type { ExpoSQLiteDatabaseLike } from '../src'

/**
 * The public driver boundary accepts Expo's installed `SQLiteDatabase` while
 * retaining its exclusive-transaction requirement. It also preserves the
 * generic `SQLiteDriver.transaction<T>` result even though Expo's native
 * `withExclusiveTransactionAsync` boundary returns `Promise<void>`.
 *
 * These compile-time checkpoints cover structural database compatibility and
 * the returned `Promise<T>`. The paired runtime test observes the callback value
 * only after the native exclusive transaction boundary settles.
 */
describe(`Expo SQLite driver types`, () => {
  it(`accepts the vendor database returned by expo-sqlite`, () => {
    const database = null as unknown as SQLiteDatabase

    createExpoSQLitePersistence({ database })
    createExpoSQLiteDriver({ database })
    new ExpoSQLiteDriver({ database })

    const compatible: ExpoSQLiteDatabaseLike = database
    void compatible
  })

  it(`preserves the transaction callback result type`, () => {
    const database = null as unknown as SQLiteDatabase
    const driver = new ExpoSQLiteDriver({ database })

    const result = driver.transaction(async (transactionDriver) => {
      void transactionDriver
      return { status: `committed` as const }
    })
    const expected: Promise<{ readonly status: `committed` }> = result
    void expected
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
