import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  BetterSqlite3SQLiteDriver,
  createNodeSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { SingleProcessCoordinator } from '../../db-sqlite-persisted-collection-core/src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-persistence-contract'

function createRuntimeDatabaseHarness(): RuntimePersistenceDatabaseHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const drivers = new Set<BetterSqlite3SQLiteDriver>()

  return {
    createDriver: () => {
      const driver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
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

  it(`accepts a bare better-sqlite3 database handle`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-direct-db-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const database = new BetterSqlite3(dbPath)

    try {
      const persistence = createNodeSQLitePersistence<RuntimePersistenceContractTodo, string>(
        {
          database,
        },
      )

      await persistence.adapter.applyCommittedTx(collectionId, {
        txId: `tx-direct-db-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `from raw database`,
              score: 1,
            },
          },
        ],
      })

      const rows = await persistence.adapter.loadSubset(collectionId, {})
      expect(rows).toEqual([
        {
          key: `1`,
          value: {
            id: `1`,
            title: `from raw database`,
            score: 1,
          },
        },
      ])
    } finally {
      database.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`infers schema policy from sync mode`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-schema-infer-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstDriver = new BetterSqlite3SQLiteDriver({ filename: dbPath })

    try {
      const firstPersistence = createNodeSQLitePersistence<RuntimePersistenceContractTodo, string>(
        {
          driver: firstDriver,
        },
      )
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
      firstDriver.close()
    }

    const secondDriver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
    try {
      const secondPersistence = createNodeSQLitePersistence<RuntimePersistenceContractTodo, string>(
        {
          driver: secondDriver,
        },
      )
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
      secondDriver.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
