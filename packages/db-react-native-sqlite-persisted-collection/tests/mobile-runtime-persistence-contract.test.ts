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

type RuntimePersistenceFactory = (
  options: {
    driver: SQLiteDriver
    coordinator?: PersistedCollectionCoordinator
  },
) => PersistedCollectionPersistence<RuntimePersistenceContractTodo, string>

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
    cleanup: () => {
      for (const database of databases) {
        try {
          void Promise.resolve(database.close())
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
  })
}
