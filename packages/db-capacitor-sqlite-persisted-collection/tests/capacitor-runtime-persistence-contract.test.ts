import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCapacitorSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { CapacitorSQLiteDriver } from '../src/capacitor-sqlite-driver'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import { SingleProcessCoordinator } from '../../db-sqlite-persisted-collection-core/src'
import { createCapacitorSQLiteTestDatabase } from './helpers/capacitor-sqlite-test-db'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type { CapacitorSQLiteDatabaseLike } from '../src/capacitor-sqlite-driver'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

type RuntimePersistenceFactory = (options: {
  database: CapacitorSQLiteDatabaseLike
  coordinator?: PersistedCollectionCoordinator
}) => PersistedCollectionPersistence<RuntimePersistenceContractTodo, string>

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-capacitor-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const databases = new Set<
    ReturnType<typeof createCapacitorSQLiteTestDatabase>
  >()

  return {
    createDriver: () => {
      const database = createCapacitorSQLiteTestDatabase({
        filename: dbPath,
      })
      const driver = new CapacitorSQLiteDriver({ database })
      databases.add(database)
      return driver
    },
    cleanup: async () => {
      for (const database of databases) {
        try {
          await database.close()
        } catch {
          // Ignore cleanup failures from already-closed handles.
        }
      }
      databases.clear()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

const runtimePersistenceSuites: ReadonlyArray<{
  name: string
  createPersistence: RuntimePersistenceFactory
}> = [
  {
    name: `capacitor`,
    createPersistence: (options) => createCapacitorSQLitePersistence(options),
  },
]

for (const suite of runtimePersistenceSuites) {
  runRuntimePersistenceContractSuite(
    `${suite.name} runtime persistence helpers`,
    {
      createDatabaseHarness: createRuntimeDatabaseHarness,
      createAdapter: (driver) =>
        suite.createPersistence({
          database: (driver as CapacitorSQLiteDriver).getDatabase(),
        }).adapter,
      createPersistence: (driver, coordinator) =>
        suite.createPersistence({
          database: (driver as CapacitorSQLiteDriver).getDatabase(),
          coordinator,
        }),
      createCoordinator: () => new SingleProcessCoordinator(),
    },
  )
}

for (const suite of runtimePersistenceSuites) {
  describe(`capacitor runtime persistence helper parity (${suite.name})`, () => {
    it(`defaults coordinator to SingleProcessCoordinator`, () => {
      const runtimeHarness = createRuntimeDatabaseHarness()
      const driver = runtimeHarness.createDriver()
      try {
        const persistence = suite.createPersistence({
          database: (driver as CapacitorSQLiteDriver).getDatabase(),
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
        const persistence = suite.createPersistence({
          database: (driver as CapacitorSQLiteDriver).getDatabase(),
          coordinator,
        })
        expect(persistence.coordinator).toBe(coordinator)
      } finally {
        runtimeHarness.cleanup()
      }
    })

    it(`infers schema policy from sync mode`, async () => {
      const tempDirectory = mkdtempSync(
        join(tmpdir(), `db-capacitor-schema-infer-`),
      )
      const dbPath = join(tempDirectory, `state.sqlite`)
      const collectionId = `todos`
      const firstDatabase = createCapacitorSQLiteTestDatabase({
        filename: dbPath,
      })

      try {
        const firstPersistence = suite.createPersistence({
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
        await firstDatabase.close()
      }

      const secondDatabase = createCapacitorSQLiteTestDatabase({
        filename: dbPath,
      })
      try {
        const secondPersistence = suite.createPersistence({
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
        await secondDatabase.close()
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    })
  })
}
