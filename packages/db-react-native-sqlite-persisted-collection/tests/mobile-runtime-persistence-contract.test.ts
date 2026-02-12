import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { OpSQLiteDriver } from '../src/op-sqlite-driver'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import { SingleProcessCoordinator } from '../../db-sqlite-persisted-collection-core/src'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type { OpSQLiteDatabaseLike } from '../src/op-sqlite-driver'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

type RuntimePersistenceFactory = (options: {
  database: OpSQLiteDatabaseLike
  coordinator?: PersistedCollectionCoordinator
}) => PersistedCollectionPersistence<RuntimePersistenceContractTodo, string>

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-mobile-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const drivers = new Set<OpSQLiteDriver>()
  const databases = new Set<ReturnType<typeof createOpSQLiteTestDatabase>>()

  return {
    createDriver: () => {
      const database = createOpSQLiteTestDatabase({
        filename: dbPath,
        resultShape: `statement-array`,
      })
      const driver = new OpSQLiteDriver({ database })
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

const runtimePersistenceSuites: ReadonlyArray<{
  name: string
  createPersistence: RuntimePersistenceFactory
}> = [
  {
    name: `react-native`,
    createPersistence: (options) => createReactNativeSQLitePersistence(options),
  },
  {
    // Expo runtime uses the same React Native API.
    name: `expo-runtime`,
    createPersistence: (options) => createReactNativeSQLitePersistence(options),
  },
]

for (const suite of runtimePersistenceSuites) {
  runRuntimePersistenceContractSuite(
    `${suite.name} runtime persistence helpers`,
    {
      createDatabaseHarness: createRuntimeDatabaseHarness,
      createAdapter: (driver) =>
        suite.createPersistence({
          database: (driver as OpSQLiteDriver).getDatabase(),
        }).adapter,
      createPersistence: (driver, coordinator) =>
        suite.createPersistence({
          database: (driver as OpSQLiteDriver).getDatabase(),
          coordinator,
        }),
      createCoordinator: () => new SingleProcessCoordinator(),
    },
  )
}

for (const suite of runtimePersistenceSuites) {
  describe(`mobile runtime persistence helper parity (${suite.name})`, () => {
    it(`defaults coordinator to SingleProcessCoordinator`, () => {
      const runtimeHarness = createRuntimeDatabaseHarness()
      const driver = runtimeHarness.createDriver()
      try {
        const persistence = suite.createPersistence({
          database: (driver as OpSQLiteDriver).getDatabase(),
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
          database: (driver as OpSQLiteDriver).getDatabase(),
          coordinator,
        })
        expect(persistence.coordinator).toBe(coordinator)
      } finally {
        runtimeHarness.cleanup()
      }
    })

    it(`infers schema policy from sync mode`, async () => {
      const tempDirectory = mkdtempSync(
        join(tmpdir(), `db-mobile-schema-infer-`),
      )
      const dbPath = join(tempDirectory, `state.sqlite`)
      const collectionId = `todos`
      const firstDatabase = createOpSQLiteTestDatabase({
        filename: dbPath,
        resultShape: `statement-array`,
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
        await Promise.resolve(firstDatabase.close())
      }

      const secondDatabase = createOpSQLiteTestDatabase({
        filename: dbPath,
        resultShape: `statement-array`,
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
        await Promise.resolve(secondDatabase.close())
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    })
  })
}
