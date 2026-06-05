import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createNodeSQLitePersistence, persistedCollectionOptions } from '../src'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import { SingleProcessCoordinator } from '../../db-sqlite-persistence-core/src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/runtime-persistence-contract'
import type {
  RuntimePersistenceContractTodo,
  RuntimePersistenceDatabaseHarness,
} from '../../db-sqlite-persistence-core/tests/contracts/runtime-persistence-contract'

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
    createNodeSQLitePersistence({
      database: (driver as BetterSqlite3SQLiteDriver).getDatabase(),
    }).adapter,
  createPersistence: (driver, coordinator) =>
    createNodeSQLitePersistence({
      database: (driver as BetterSqlite3SQLiteDriver).getDatabase(),
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
        database: (driver as BetterSqlite3SQLiteDriver).getDatabase(),
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
        database: (driver as BetterSqlite3SQLiteDriver).getDatabase(),
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
      const persistence = createNodeSQLitePersistence({
        database,
      })

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

  it(`prunes applied_tx rows past the default age backstop`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-default-prune-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `default-prune`
    const database = new BetterSqlite3(dbPath)

    try {
      const persistence = createNodeSQLitePersistence({ database })

      await persistence.adapter.applyCommittedTx(collectionId, {
        txId: `tx-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: { id: `1`, title: `old`, score: 1 },
          },
        ],
      })

      // Backdate the first row well beyond the 24h default age backstop.
      database
        .prepare(
          `UPDATE applied_tx SET applied_at = 0 WHERE collection_id = ? AND seq = 1`,
        )
        .run(collectionId)

      await persistence.adapter.applyCommittedTx(collectionId, {
        txId: `tx-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `insert`,
            key: `2`,
            value: { id: `2`, title: `new`, score: 2 },
          },
        ],
      })

      const appliedRows = database
        .prepare(
          `SELECT seq FROM applied_tx WHERE collection_id = ? ORDER BY seq ASC`,
        )
        .all(collectionId) as Array<{ seq: number }>
      expect(appliedRows.map((row) => row.seq)).toEqual([2])
    } finally {
      database.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`leaves applied_tx rows untouched when pruning is disabled`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-no-prune-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `no-prune`
    const database = new BetterSqlite3(dbPath)

    try {
      const persistence = createNodeSQLitePersistence({
        database,
        appliedTxPruneMaxRows: 0,
        appliedTxPruneMaxAgeSeconds: 0,
      })

      await persistence.adapter.applyCommittedTx(collectionId, {
        txId: `tx-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: { id: `1`, title: `old`, score: 1 },
          },
        ],
      })

      database
        .prepare(
          `UPDATE applied_tx SET applied_at = 0 WHERE collection_id = ? AND seq = 1`,
        )
        .run(collectionId)

      await persistence.adapter.applyCommittedTx(collectionId, {
        txId: `tx-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `insert`,
            key: `2`,
            value: { id: `2`, title: `new`, score: 2 },
          },
        ],
      })

      const appliedRows = database
        .prepare(
          `SELECT seq FROM applied_tx WHERE collection_id = ? ORDER BY seq ASC`,
        )
        .all(collectionId) as Array<{ seq: number }>
      expect(appliedRows.map((row) => row.seq)).toEqual([1, 2])
    } finally {
      database.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`infers schema policy from sync mode`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-schema-infer-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `todos`
    const firstDatabase = new BetterSqlite3(dbPath)

    try {
      const firstPersistence = createNodeSQLitePersistence({
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
      firstDatabase.close()
    }

    const secondDatabase = new BetterSqlite3(dbPath)
    try {
      const secondPersistence = createNodeSQLitePersistence({
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
      secondDatabase.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
