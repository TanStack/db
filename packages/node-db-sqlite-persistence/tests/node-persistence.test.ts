import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { createCollection, createTransaction } from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { createNodeSQLitePersistence, persistedCollectionOptions } from '../src'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import { SingleProcessCoordinator } from '../../db-sqlite-persistence-core/src'
import { runRuntimePersistenceContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/runtime-persistence-contract'
import type { SQLitePullSinceResult } from '../../db-sqlite-persistence-core/src'
import type { SyncConfig } from '@tanstack/db'
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
  it(`persists an awaited immediate write behind a pending source write`, async () => {
    const database = new BetterSqlite3(`:memory:`)
    const id = `awaited-immediate-source`
    const persistence = createNodeSQLitePersistence({ database })
    type Row = { id: string; title: string }
    let source!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    const collection = createCollection(
      persistedCollectionOptions<Row, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
          },
        },
        persistence,
      }),
    )
    let releaseHandler!: () => void
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    let handlerEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      handlerEntered = resolve
    })
    const mutation = createTransaction({
      mutationFn: async () => {
        handlerEntered()
        await handlerGate
        source.begin({ immediate: true })
        source.write({
          type: `update`,
          value: { id: `row`, title: `three` },
        })
        await source.commit()
      },
    })
    const abort = new AbortController()
    try {
      await collection.stateWhenReady()
      source.begin()
      source.write({ type: `insert`, value: { id: `row`, title: `one` } })
      await source.commit()

      mutation.mutate(() => {
        collection.insert({ id: `local`, title: `optimistic` })
      })
      await entered
      source.begin()
      source.write({ type: `update`, value: { id: `row`, title: `two` } })
      const predecessor = Promise.resolve(source.commit(abort.signal))
      void predecessor.catch(() => undefined)
      releaseHandler()
      await Promise.all([predecessor, mutation.isPersisted.promise])

      expect(collection.get(`row`)?.title).toBe(`three`)
      expect(
        (await persistence.adapter.loadSubset(id, {})).find(
          ({ key }) => key === `row`,
        )?.value,
      ).toEqual({ id: `row`, title: `three` })
    } finally {
      releaseHandler()
      abort.abort()
      await collection.cleanup()
      database.close()
    }
  })

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

  it(`forces full reload when pullSince starts before pruned replay rows`, async () => {
    const tempDirectory = mkdtempSync(
      join(tmpdir(), `db-node-pruned-pull-since-`),
    )
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `pruned-pull-since`
    const database = new BetterSqlite3(dbPath)

    try {
      const persistence = createNodeSQLitePersistence({
        database,
        appliedTxPruneMaxRows: 2,
        appliedTxPruneMaxAgeSeconds: 0,
      })

      for (const seq of [1, 2, 3]) {
        await persistence.adapter.applyCommittedTx(collectionId, {
          txId: `tx-${seq}`,
          term: 1,
          seq,
          rowVersion: seq,
          mutations: [
            {
              type: `insert`,
              key: String(seq),
              value: { id: String(seq), title: `todo-${seq}`, score: seq },
            },
          ],
        })
      }

      const adapter = persistence.adapter as typeof persistence.adapter & {
        pullSince: (
          collectionId: string,
          fromRowVersion: number,
        ) => Promise<SQLitePullSinceResult<string | number>>
      }
      const result = await adapter.pullSince(collectionId, 0)

      expect(result.requiresFullReload).toBe(true)
    } finally {
      database.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`prunes applied_tx rows past explicit row cap`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-row-prune-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const collectionId = `row-prune`
    const database = new BetterSqlite3(dbPath)

    try {
      const persistence = createNodeSQLitePersistence({
        database,
        appliedTxPruneMaxRows: 2,
        appliedTxPruneMaxAgeSeconds: 0,
      })

      for (const seq of [1, 2, 3]) {
        await persistence.adapter.applyCommittedTx(collectionId, {
          txId: `tx-${seq}`,
          term: 1,
          seq,
          rowVersion: seq,
          mutations: [
            {
              type: `insert`,
              key: String(seq),
              value: { id: String(seq), title: `todo-${seq}`, score: seq },
            },
          ],
        })
      }

      const appliedRows = database
        .prepare(
          `SELECT seq FROM applied_tx WHERE collection_id = ? ORDER BY seq ASC`,
        )
        .all(collectionId) as Array<{ seq: number }>
      expect(appliedRows.map((row) => row.seq)).toEqual([2, 3])
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
