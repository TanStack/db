import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCloudflareDOSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { CloudflareDOSQLiteDriver } from '../src/do-driver'
import { SingleProcessCoordinator } from '../../db-sqlite-persisted-collection-core/src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import { createBetterSqliteDoStorageHarness } from './helpers/better-sqlite-do-storage'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const activeStorageHarnesses = new Set<
    ReturnType<typeof createBetterSqliteDoStorageHarness>
  >()

  return {
    createDriver: () => {
      const storageHarness = createBetterSqliteDoStorageHarness({
        filename: dbPath,
      })
      activeStorageHarnesses.add(storageHarness)
      return new CloudflareDOSQLiteDriver({
        storage: storageHarness.storage,
      })
    },
    cleanup: () => {
      for (const storageHarness of activeStorageHarnesses) {
        try {
          storageHarness.close()
        } catch {
          // ignore cleanup errors from already-closed handles
        }
      }
      activeStorageHarnesses.clear()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runRuntimePersistenceContractSuite(`cloudflare durable object runtime helpers`, {
  createDatabaseHarness: createRuntimeDatabaseHarness,
  createAdapter: (driver) =>
    createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>({
      storage: (driver as CloudflareDOSQLiteDriver).getStorage(),
    }).adapter,
  createPersistence: (driver, coordinator) =>
    createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>({
      storage: (driver as CloudflareDOSQLiteDriver).getStorage(),
      coordinator,
    }),
  createCoordinator: () => new SingleProcessCoordinator(),
})

describe(`cloudflare durable object persistence helpers`, () => {
  it(`defaults coordinator to SingleProcessCoordinator`, () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver()

    try {
      const persistence = createCloudflareDOSQLitePersistence({
        storage: (driver as CloudflareDOSQLiteDriver).getStorage(),
      })
      expect(persistence.coordinator).toBeInstanceOf(SingleProcessCoordinator)
    } finally {
      runtimeHarness.cleanup()
    }
  })

  it(`infers mode from sync presence and keeps schema per collection`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-cf-do-schema-infer-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const firstPersistence = createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>(
      {
        storage: firstStorageHarness.storage,
      },
    )

    try {
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
      firstStorageHarness.close()
    }

    const secondStorageHarness = createBetterSqliteDoStorageHarness({
      filename: dbPath,
    })
    const secondPersistence = createCloudflareDOSQLitePersistence<RuntimePersistenceContractTodo, string>(
      {
        storage: secondStorageHarness.storage,
      },
    )
    try {
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
      secondStorageHarness.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
