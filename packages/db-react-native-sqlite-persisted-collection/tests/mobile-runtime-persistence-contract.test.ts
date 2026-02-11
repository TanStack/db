import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SingleProcessCoordinator,
  createExpoSQLitePersistence,
  createOpSQLiteDriver,
  createReactNativeSQLitePersistence,
} from '../src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  SQLiteDriver,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

type RuntimePersistenceFactory = (options: {
  driver: SQLiteDriver
  schemaVersion?: number
  coordinator?: PersistedCollectionCoordinator
}) => PersistedCollectionPersistence<RuntimePersistenceContractTodo, string>

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-mobile-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const drivers = new Set<ReturnType<typeof createOpSQLiteDriver>>()
  const databases = new Set<ReturnType<typeof createOpSQLiteTestDatabase>>()

  return {
    createDriver: () => {
      const database = createOpSQLiteTestDatabase({
        filename: dbPath,
        resultShape: `statement-array`,
      })
      const driver = createOpSQLiteDriver({ database })
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
    name: `expo`,
    createPersistence: (options) => createExpoSQLitePersistence(options),
  },
]

for (const suite of runtimePersistenceSuites) {
  runRuntimePersistenceContractSuite(
    `${suite.name} runtime persistence helpers`,
    {
      createDatabaseHarness: createRuntimeDatabaseHarness,
      createAdapter: (driver) => suite.createPersistence({ driver }).adapter,
      createPersistence: (driver, coordinator) =>
        suite.createPersistence({ driver, coordinator }),
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
        const persistence = suite.createPersistence({ driver })
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
          driver,
          coordinator,
        })
        expect(persistence.coordinator).toBe(coordinator)
      } finally {
        runtimeHarness.cleanup()
      }
    })

    it(`infers schema policy from sync mode`, async () => {
      const tempDirectory = mkdtempSync(join(tmpdir(), `db-mobile-schema-infer-`))
      const dbPath = join(tempDirectory, `state.sqlite`)
      const collectionId = `todos`
      const firstDatabase = createOpSQLiteTestDatabase({
        filename: dbPath,
        resultShape: `statement-array`,
      })
      const firstDriver = createOpSQLiteDriver({ database: firstDatabase })

      try {
        const firstPersistence = suite.createPersistence({
          driver: firstDriver,
          schemaVersion: 1,
        })
        await firstPersistence.adapter.applyCommittedTx(collectionId, {
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
        })
      } finally {
        await Promise.resolve(firstDatabase.close())
      }

      const secondDatabase = createOpSQLiteTestDatabase({
        filename: dbPath,
        resultShape: `statement-array`,
      })
      const secondDriver = createOpSQLiteDriver({ database: secondDatabase })
      try {
        const secondPersistence = suite.createPersistence({
          driver: secondDriver,
          schemaVersion: 2,
        })

        const syncAbsentPersistence =
          secondPersistence.resolvePersistenceForMode?.(`sync-absent`) ??
          secondPersistence
        await expect(
          syncAbsentPersistence.adapter.loadSubset(collectionId, {}),
        ).rejects.toThrow(`Schema version mismatch`)

        const syncPresentPersistence =
          secondPersistence.resolvePersistenceForMode?.(`sync-present`) ??
          secondPersistence
        const rows = await syncPresentPersistence.adapter.loadSubset(
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
