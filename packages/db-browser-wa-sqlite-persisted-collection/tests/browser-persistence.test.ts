import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { BrowserWASQLiteDriver } from '../src/wa-sqlite-driver'
import { SingleProcessCoordinator } from '../../db-sqlite-persisted-collection-core/src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-browser-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const drivers = new Set<BrowserWASQLiteDriver>()

  return {
    createDriver: () => {
      const database = createWASQLiteTestDatabase({
        filename: dbPath,
      })
      const driver = new BrowserWASQLiteDriver({ database })
      drivers.add(driver)
      return driver
    },
    cleanup: async () => {
      for (const driver of drivers) {
        try {
          await driver.close()
        } catch {
          // ignore cleanup errors from already-closed handles
        }
      }
      drivers.clear()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runRuntimePersistenceContractSuite(
  `browser wa-sqlite runtime persistence helpers`,
  {
    createDatabaseHarness: createRuntimeDatabaseHarness,
    createAdapter: (driver) =>
      createBrowserWASQLitePersistence<RuntimePersistenceContractTodo, string>({
        database: (driver as BrowserWASQLiteDriver).getDatabase(),
      }).adapter,
    createPersistence: (driver, coordinator) =>
      createBrowserWASQLitePersistence<RuntimePersistenceContractTodo, string>({
        database: (driver as BrowserWASQLiteDriver).getDatabase(),
        coordinator,
      }),
    createCoordinator: () => new SingleProcessCoordinator(),
  },
)

describe(`browser wa-sqlite persistence helpers`, () => {
  it(`defaults coordinator to SingleProcessCoordinator`, () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver()
    try {
      const persistence = createBrowserWASQLitePersistence({
        database: (driver as BrowserWASQLiteDriver).getDatabase(),
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
      const persistence = createBrowserWASQLitePersistence({
        database: (driver as BrowserWASQLiteDriver).getDatabase(),
        coordinator,
      })
      expect(persistence.coordinator).toBe(coordinator)
    } finally {
      runtimeHarness.cleanup()
    }
  })

  it(`infers schema policy from sync mode`, async () => {
    const tempDirectory = mkdtempSync(
      join(tmpdir(), `db-browser-schema-infer-`),
    )
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstDatabase = createWASQLiteTestDatabase({ filename: dbPath })

    try {
      const firstPersistence = createBrowserWASQLitePersistence<
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
      await Promise.resolve(firstDatabase.close?.())
    }

    const secondDatabase = createWASQLiteTestDatabase({ filename: dbPath })
    try {
      const secondPersistence = createBrowserWASQLitePersistence<
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
      await Promise.resolve(secondDatabase.close?.())
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
