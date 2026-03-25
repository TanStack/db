import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createTauriSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { TauriSQLiteDriver } from '../src/tauri-sql-driver'
import { runRuntimePersistenceContractSuite } from '../../db-persistence-core/tests/contracts/runtime-persistence-contract'
import { SingleProcessCoordinator } from '../../db-persistence-core/src'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-persistence-core/tests/contracts/runtime-persistence-contract'

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-tauri-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const drivers = new Set<TauriSQLiteDriver>()
  const databases = new Set<ReturnType<typeof createTauriSQLiteTestDatabase>>()

  return {
    createDriver: () => {
      const database = createTauriSQLiteTestDatabase({ filename: dbPath })
      const driver = new TauriSQLiteDriver({ database })
      databases.add(database)
      drivers.add(driver)
      return driver
    },
    cleanup: async () => {
      for (const database of databases) {
        try {
          await Promise.resolve(database.close())
        } catch {
          // ignore cleanup errors from already-closed handles
        }
      }
      databases.clear()
      drivers.clear()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runRuntimePersistenceContractSuite(`tauri runtime persistence helpers`, {
  createDatabaseHarness: createRuntimeDatabaseHarness,
  createAdapter: (driver) =>
    createTauriSQLitePersistence<RuntimePersistenceContractTodo, string>({
      database: (driver as TauriSQLiteDriver).getDatabase(),
    }).adapter,
  createPersistence: (driver, coordinator) =>
    createTauriSQLitePersistence<RuntimePersistenceContractTodo, string>({
      database: (driver as TauriSQLiteDriver).getDatabase(),
      coordinator,
    }),
  createCoordinator: () => new SingleProcessCoordinator(),
})

describe(`tauri runtime persistence helpers`, () => {
  it(`caches adapters by schema policy and schema version`, () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver()
    try {
      const persistence = createTauriSQLitePersistence<
        RuntimePersistenceContractTodo,
        string
      >({
        database: (driver as TauriSQLiteDriver).getDatabase(),
      })
      const resolvePersistenceForCollection =
        persistence.resolvePersistenceForCollection
      expect(resolvePersistenceForCollection).toBeTypeOf(`function`)
      if (resolvePersistenceForCollection === undefined) {
        throw new Error(
          `resolvePersistenceForCollection must be available for runtime helpers`,
        )
      }

      const syncAbsentDefault = resolvePersistenceForCollection({
        collectionId: `todos-a`,
        mode: `sync-absent`,
      })
      const syncAbsentDefaultAgain = resolvePersistenceForCollection({
        collectionId: `todos-b`,
        mode: `sync-absent`,
      })
      const syncPresentDefault = resolvePersistenceForCollection({
        collectionId: `todos-c`,
        mode: `sync-present`,
      })
      const schemaVersionOne = resolvePersistenceForCollection({
        collectionId: `todos-d`,
        mode: `sync-absent`,
        schemaVersion: 1,
      })
      const schemaVersionOneAgain = resolvePersistenceForCollection({
        collectionId: `todos-e`,
        mode: `sync-absent`,
        schemaVersion: 1,
      })
      const schemaVersionTwo = resolvePersistenceForCollection({
        collectionId: `todos-f`,
        mode: `sync-absent`,
        schemaVersion: 2,
      })

      expect(syncAbsentDefault.adapter).toBe(syncAbsentDefaultAgain.adapter)
      expect(syncAbsentDefault.adapter).not.toBe(syncPresentDefault.adapter)
      expect(schemaVersionOne.adapter).toBe(schemaVersionOneAgain.adapter)
      expect(schemaVersionOne.adapter).not.toBe(schemaVersionTwo.adapter)
    } finally {
      runtimeHarness.cleanup()
    }
  })

  it(`defaults coordinator to SingleProcessCoordinator`, () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver()
    try {
      const persistence = createTauriSQLitePersistence({
        database: (driver as TauriSQLiteDriver).getDatabase(),
      })
      expect(persistence.coordinator).toBeInstanceOf(SingleProcessCoordinator)
    } finally {
      runtimeHarness.cleanup()
    }
  })

  it(`allows overriding the default coordinator`, () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver()
    try {
      const coordinator = new SingleProcessCoordinator()
      const persistence = createTauriSQLitePersistence({
        database: (driver as TauriSQLiteDriver).getDatabase(),
        coordinator,
      })
      expect(persistence.coordinator).toBe(coordinator)
    } finally {
      runtimeHarness.cleanup()
    }
  })

  it(`infers schema policy from sync mode`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-tauri-schema-infer-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstDatabase = createTauriSQLiteTestDatabase({ filename: dbPath })

    try {
      const firstPersistence = createTauriSQLitePersistence<
        RuntimePersistenceContractTodo,
        string
      >({
        database: firstDatabase,
      })
      const firstCollectionOptions = persistedCollectionOptions<
        RuntimePersistenceContractTodo,
        string
      >({
        id: collectionId,
        schemaVersion: 1,
        getKey: (todo) => todo.id,
        persistence: firstPersistence,
      })

      await firstCollectionOptions.persistence.adapter.applyCommittedTx(
        collectionId,
        {
          txId: `tx-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `before mismatch`,
                score: 1,
              },
            },
          ],
        },
      )
    } finally {
      await Promise.resolve(firstDatabase.close())
    }

    const secondDatabase = createTauriSQLiteTestDatabase({ filename: dbPath })
    try {
      const secondPersistence = createTauriSQLitePersistence<
        RuntimePersistenceContractTodo,
        string
      >({
        database: secondDatabase,
      })
      const syncAbsentOptions = persistedCollectionOptions<
        RuntimePersistenceContractTodo,
        string
      >({
        id: collectionId,
        schemaVersion: 2,
        getKey: (todo) => todo.id,
        persistence: secondPersistence,
      })
      await expect(
        syncAbsentOptions.persistence.adapter.loadSubset(collectionId, {}),
      ).rejects.toThrow(`Schema version mismatch`)

      const syncPresentOptions = persistedCollectionOptions<
        RuntimePersistenceContractTodo,
        string
      >({
        id: collectionId,
        schemaVersion: 2,
        getKey: (todo) => todo.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: secondPersistence,
      })
      const rows = await syncPresentOptions.persistence.adapter.loadSubset(
        collectionId,
        {},
      )
      expect(rows).toEqual([])
    } finally {
      await Promise.resolve(secondDatabase.close())
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
