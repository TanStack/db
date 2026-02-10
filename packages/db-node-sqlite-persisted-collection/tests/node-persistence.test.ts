import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SingleProcessCoordinator,
  createBetterSqlite3Driver,
  createNodeSQLitePersistence,
} from '../src'
import {
  
  
  runRuntimePersistenceContractSuite
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import type {RuntimePersistenceContractTodo, RuntimePersistenceDatabaseHarness} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract';

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const drivers = new Set<ReturnType<typeof createBetterSqlite3Driver>>()

  return {
    createDriver: () => {
      const driver = createBetterSqlite3Driver({ filename: dbPath })
      drivers.add(driver)
      return driver
    },
    cleanup: () => {
      for (const driver of drivers) {
        try {
          driver.close()
        } catch {
          // ignore cleanup errors from already-closed handles
        }
      }
      drivers.clear()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

runRuntimePersistenceContractSuite(`node runtime persistence helpers`, {
  createDatabaseHarness: createRuntimeDatabaseHarness,
  createAdapter: (driver) =>
    createNodeSQLitePersistence<RuntimePersistenceContractTodo, string>({
      driver,
    }).adapter,
  createPersistence: (driver, coordinator) =>
    createNodeSQLitePersistence<RuntimePersistenceContractTodo, string>({
      driver,
      coordinator,
    }),
  createCoordinator: () => new SingleProcessCoordinator(),
})

describe(`node persistence helpers`, () => {
  it(`defaults coordinator to SingleProcessCoordinator`, () => {
    const runtimeHarness = createRuntimeDatabaseHarness()
    const driver = runtimeHarness.createDriver()
    try {
      const persistence = createNodeSQLitePersistence({
        driver,
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
      const persistence = createNodeSQLitePersistence({
        driver,
        coordinator,
      })

      expect(persistence.coordinator).toBe(coordinator)
    } finally {
      runtimeHarness.cleanup()
    }
  })
})
