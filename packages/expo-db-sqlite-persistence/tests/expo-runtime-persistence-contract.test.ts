import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createExpoSQLitePersistence, persistedCollectionOptions } from '../src'
import { createExpoSQLiteDriver } from '../src/expo-sqlite-driver'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/runtime-persistence-contract'
import { SingleProcessCoordinator } from '../../db-sqlite-persistence-core/src'
import { createExpoSQLiteTestDatabase } from './helpers/expo-sqlite-test-db'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
} from '@tanstack/db-sqlite-persistence-core'
import type { ExpoSQLiteDatabaseLike } from '../src/expo-sqlite-driver'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persistence-core/tests/contracts/runtime-persistence-contract'

type RuntimePersistenceFactory = (options: {
  database: ExpoSQLiteDatabaseLike
  coordinator?: PersistedCollectionCoordinator
}) => PersistedCollectionPersistence<RuntimePersistenceContractTodo, string>

type SQLiteDriverWithDatabase = ReturnType<typeof createExpoSQLiteDriver> & {
  __tanstackDbDatabase: ExpoSQLiteDatabaseLike
}

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-expo-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const drivers = new Set<SQLiteDriverWithDatabase>()
  const databases = new Set<ReturnType<typeof createExpoSQLiteTestDatabase>>()

  return {
    createDriver: () => {
      const database = createExpoSQLiteTestDatabase({
        filename: dbPath,
      })
      const driver = Object.assign(createExpoSQLiteDriver({ database }), {
        __tanstackDbDatabase: database,
      })
      databases.add(database)
      drivers.add(driver)
      return driver
    },
    cleanup: async () => {
      for (const database of databases) {
        try {
          await database.closeAsync()
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

const createPersistence: RuntimePersistenceFactory = (options) =>
  createExpoSQLitePersistence(options)

runRuntimePersistenceContractSuite(`expo runtime persistence helpers`, {
  createDatabaseHarness: createRuntimeDatabaseHarness,
  createAdapter: (driver) =>
    createPersistence({
      database: (driver as SQLiteDriverWithDatabase).__tanstackDbDatabase,
    }).adapter,
  createPersistence: (driver, coordinator) =>
    createPersistence({
      database: (driver as SQLiteDriverWithDatabase).__tanstackDbDatabase,
      coordinator,
    }),
  createCoordinator: () => new SingleProcessCoordinator(),
})

describe(`expo runtime persistence helper parity`, () => {
  it(`defaults coordinator to SingleProcessCoordinator`, async () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver() as ReturnType<
      typeof createExpoSQLiteDriver
    >
    try {
      const persistence = createExpoSQLitePersistence({
        database: await driver.getDatabase(),
      })
      expect(persistence.coordinator).toBeInstanceOf(SingleProcessCoordinator)
    } finally {
      await runtimeHarness.cleanup()
    }
  })

  it(`allows overriding the default coordinator`, async () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver() as ReturnType<
      typeof createExpoSQLiteDriver
    >
    try {
      const coordinator = new SingleProcessCoordinator()
      const persistence = createExpoSQLitePersistence({
        database: await driver.getDatabase(),
        coordinator,
      })
      expect(persistence.coordinator).toBe(coordinator)
    } finally {
      await runtimeHarness.cleanup()
    }
  })

  it(`infers schema policy from sync mode`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-expo-schema-infer-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstDatabase = createExpoSQLiteTestDatabase({
      filename: dbPath,
    })

    try {
      const firstPersistence = createExpoSQLitePersistence<
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
      await firstDatabase.closeAsync()
    }

    const secondDatabase = createExpoSQLiteTestDatabase({
      filename: dbPath,
    })
    try {
      const secondPersistence = createExpoSQLitePersistence<
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
      await secondDatabase.closeAsync()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
