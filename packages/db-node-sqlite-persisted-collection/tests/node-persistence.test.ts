import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SingleProcessCoordinator,
  createBetterSqlite3Driver,
  createNodeSQLitePersistence,
} from '../src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

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

  it(`infers schema policy from sync mode`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-schema-infer-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstDriver = createBetterSqlite3Driver({ filename: dbPath })

    try {
      const firstPersistence = createNodeSQLitePersistence<RuntimePersistenceContractTodo, string>(
        {
          driver: firstDriver,
          schemaVersion: 1,
        },
      )
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
      firstDriver.close()
    }

    const secondDriver = createBetterSqlite3Driver({ filename: dbPath })
    try {
      const secondPersistence = createNodeSQLitePersistence<RuntimePersistenceContractTodo, string>(
        {
          driver: secondDriver,
          schemaVersion: 2,
        },
      )

      const syncAbsentPersistence =
        secondPersistence.resolvePersistenceForMode?.(`sync-absent`) ??
        secondPersistence
      await expect(
        syncAbsentPersistence.adapter.loadSubset(collectionId, {}),
      ).rejects.toThrow(`Schema version mismatch`)

      const syncPresentPersistence =
        secondPersistence.resolvePersistenceForMode?.(`sync-present`) ??
        secondPersistence
      const rows = await syncPresentPersistence.adapter.loadSubset(collectionId, {})
      expect(rows).toEqual([])
    } finally {
      secondDriver.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
