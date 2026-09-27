import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  createTauriSQLitePersistence as createIndexPersistence,
  persistedCollectionOptions,
} from '../src'
import { createTauriSQLitePersistence as createTauriPersistence } from '../src/tauri'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'
import type { TauriSQLiteDatabaseLike } from '../src/tauri'

type Todo = {
  id: string
  title: string
  score: number
}

const activeCleanupFns: Array<() => void | Promise<void>> = []

afterEach(async () => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    await Promise.resolve(cleanupFn?.())
  }
})

function createTempSqlitePath(): string {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-tauri-persistence-test-`),
  )
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

function rethrowDatabaseErrorsAsStrings(
  database: TauriSQLiteDatabaseLike,
): TauriSQLiteDatabaseLike {
  return {
    ...database,
    execute: async (...args) => {
      try {
        return await database.execute(...args)
      } catch (error) {
        throw error instanceof Error ? error.message : String(error)
      }
    },
  }
}

function registerDatabaseCleanup(
  database: TauriSQLiteDatabaseLike,
): () => Promise<void> {
  let closed = false
  const close = async () => {
    if (closed) {
      return
    }
    await database.close()
    closed = true
  }
  activeCleanupFns.push(close)
  return close
}

/**
 * Migration law (#1711): adding an already-present migration column is an
 * idempotent no-op even when the Tauri bridge rejects with a string. Seed a
 * real legacy SQLite table, drive migration through the Tauri driver and core
 * adapter, then close and reopen once both migration columns exist. PRAGMA,
 * exact legacy bytes, and public rows are the checkpoints. The unrelated-error
 * control proves the classifier does not turn arbitrary string failures into
 * success. This Better SQLite fixture reproduces Tauri's error boundary but is
 * not a native Tauri runtime receipt.
 */
it(`migrates and reopens a legacy database when Tauri reports duplicate columns as strings`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-string-migration`

  const seedDatabase = createTauriSQLiteTestDatabase({ filename: dbPath })
  const closeSeedDatabase = registerDatabaseCleanup(seedDatabase)
  await seedDatabase.execute(
    `CREATE TABLE applied_tx (
       collection_id TEXT NOT NULL,
       term INTEGER NOT NULL,
       seq INTEGER NOT NULL,
       tx_id TEXT NOT NULL,
       row_version INTEGER NOT NULL,
       replay_json TEXT,
       applied_at INTEGER NOT NULL,
       PRIMARY KEY (collection_id, term, seq)
     )`,
  )
  await seedDatabase.execute(
    `INSERT INTO applied_tx (
       collection_id,
       term,
       seq,
       tx_id,
       row_version,
       replay_json,
       applied_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      collectionId,
      1,
      1,
      `legacy-tx`,
      1,
      `{"mutations":[]}`,
      Math.floor(Date.now() / 1000),
    ],
  )
  await closeSeedDatabase()

  const migrationDatabase = rethrowDatabaseErrorsAsStrings(
    createTauriSQLiteTestDatabase({ filename: dbPath }),
  )
  const closeMigrationDatabase = registerDatabaseCleanup(migrationDatabase)
  const migrationPersistence = createTauriPersistence({
    database: migrationDatabase,
  })

  await migrationPersistence.adapter.applyCommittedTx(collectionId, {
    txId: `post-migration-tx`,
    term: 1,
    seq: 2,
    rowVersion: 2,
    mutations: [
      {
        type: `insert`,
        key: `1`,
        value: {
          id: `1`,
          title: `Survives migration`,
          score: 1,
        },
      },
    ],
  })

  const migratedColumns = await migrationDatabase.select<
    Array<{ name: string }>
  >(`PRAGMA table_info(applied_tx)`)
  expect(migratedColumns.map((column) => column.name)).toEqual(
    expect.arrayContaining([`replay_json`, `replay_requires_full_reload`]),
  )
  expect(
    await migrationDatabase.select<
      Array<{ tx_id: string; replay_json: string | null }>
    >(
      `SELECT tx_id, replay_json
       FROM applied_tx
       WHERE tx_id = 'legacy-tx'`,
    ),
  ).toEqual([{ tx_id: `legacy-tx`, replay_json: `{"mutations":[]}` }])
  await closeMigrationDatabase()

  const reopenedDatabase = rethrowDatabaseErrorsAsStrings(
    createTauriSQLiteTestDatabase({ filename: dbPath }),
  )
  registerDatabaseCleanup(reopenedDatabase)
  const reopenedPersistence = createTauriPersistence({
    database: reopenedDatabase,
  })

  await expect(
    reopenedPersistence.adapter.loadSubset(collectionId, {}),
  ).resolves.toEqual([
    {
      key: `1`,
      value: {
        id: `1`,
        title: `Survives migration`,
        score: 1,
      },
    },
  ])
  expect(
    await reopenedDatabase.select<
      Array<{ tx_id: string; replay_json: string | null }>
    >(
      `SELECT tx_id, replay_json
       FROM applied_tx
       WHERE tx_id = 'legacy-tx'`,
    ),
  ).toEqual([{ tx_id: `legacy-tx`, replay_json: `{"mutations":[]}` }])
})

it(`propagates unrelated string failures from a Tauri migration`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  registerDatabaseCleanup(database)
  const failingDatabase: TauriSQLiteDatabaseLike = {
    ...database,
    execute: async (sql, bindValues) => {
      if (sql.includes(`ALTER TABLE applied_tx ADD COLUMN replay_json`)) {
        throw `database is locked`
      }
      return database.execute(sql, bindValues)
    },
  }
  const persistence = createTauriPersistence({ database: failingDatabase })

  await expect(
    persistence.adapter.loadSubset(`todos-unrelated-migration-error`, {}),
  ).rejects.toBe(`database is locked`)
})

it(`persists data across app restart (close and reopen)`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-restart`

  const firstDatabase = createTauriSQLiteTestDatabase({ filename: dbPath })
  const firstPersistence = createTauriPersistence({
    database: firstDatabase,
  })
  const firstAdapter = firstPersistence.adapter

  await firstAdapter.applyCommittedTx(collectionId, {
    txId: `tx-restart-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [
      {
        type: `insert`,
        key: `1`,
        value: {
          id: `1`,
          title: `Survives restart`,
          score: 10,
        },
      },
    ],
  })
  await Promise.resolve(firstDatabase.close())

  const secondDatabase = createTauriSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(async () => {
    await Promise.resolve(secondDatabase.close())
  })
  const secondPersistence = createTauriPersistence({
    database: secondDatabase,
  })
  const secondAdapter = secondPersistence.adapter

  const rows = await secondAdapter.loadSubset(collectionId, {})
  expect(rows).toEqual([
    {
      key: `1`,
      value: {
        id: `1`,
        title: `Survives restart`,
        score: 10,
      },
    },
  ])
})

it(`shares the same runtime behavior through index and tauri entrypoints`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-entrypoints`
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(async () => {
    await Promise.resolve(database.close())
  })

  const indexPersistence = createIndexPersistence({ database })
  const tauriPersistence = createTauriPersistence({ database })

  await indexPersistence.adapter.applyCommittedTx(collectionId, {
    txId: `tx-entrypoint-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [
      {
        type: `insert`,
        key: `1`,
        value: {
          id: `1`,
          title: `Entry point parity`,
          score: 1,
        },
      },
    ],
  })

  const rows = await tauriPersistence.adapter.loadSubset(collectionId, {})
  expect(rows[0]?.value.title).toBe(`Entry point parity`)
})

it(`resumes persisted sync after cleanup and restart`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-lifecycle`
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(async () => {
    await Promise.resolve(database.close())
  })

  const persistence = createTauriPersistence({
    database,
  })
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (todo) => todo.id,
      persistence,
      syncMode: `eager`,
    }),
  )
  activeCleanupFns.push(() => collection.cleanup())

  await collection.stateWhenReady()
  const initialInsert = collection.insert({
    id: `1`,
    title: `Before cleanup`,
    score: 1,
  })
  await initialInsert.isPersisted.promise
  expect(collection.get(`1`)?.title).toBe(`Before cleanup`)

  await collection.cleanup()
  collection.startSyncImmediate()
  await collection.stateWhenReady()

  const resumedInsert = collection.insert({
    id: `2`,
    title: `After restart`,
    score: 2,
  })
  await resumedInsert.isPersisted.promise
  expect(collection.get(`2`)?.title).toBe(`After restart`)

  const persistedRows = await persistence.adapter.loadSubset(collectionId, {})
  expect(persistedRows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: `1`,
      }),
      expect.objectContaining({
        key: `2`,
      }),
    ]),
  )
})
