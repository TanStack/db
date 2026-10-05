import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { createOpSQLiteTestDatabase } from './helpers/op-sqlite-test-db'

type Todo = {
  id: string
  title: string
  score: number
}

type Cleanup = () => void | Promise<void>

const activeCleanupFns: Array<Cleanup> = []

async function withFailurePreservingCleanup<T>(
  run: (cleanups: Array<Cleanup>) => Promise<T>,
  cleanups: Array<Cleanup>,
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    outcome = { ok: true, value: await run(cleanups) }
  } catch (error) {
    outcome = { ok: false, error }
  }

  const cleanupErrors: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (!outcome.ok) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [outcome.error, ...cleanupErrors],
        `react-native restart oracle and cleanup failed`,
        { cause: outcome.error },
      )
    }
    throw outcome.error
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      `react-native restart oracle cleanup failed`,
      { cause: cleanupErrors[0] },
    )
  }
  return outcome.value
}

function once(cleanup: Cleanup): Cleanup {
  let attempted = false
  return async () => {
    if (attempted) return
    attempted = true
    await cleanup()
  }
}

afterEach(async () => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    await Promise.resolve(cleanupFn?.())
  }
})

function createTempSqlitePath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-rn-persistence-test-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

const collectionRegistryQuery = `SELECT collection_id, table_name, tombstone_table_name, schema_version
  FROM collection_registry
  WHERE collection_id = ?`

const restartStreamPosition = {
  latestTerm: 5,
  latestSeq: 8,
  latestRowVersion: 13,
} as const

/**
 * Restart law: an existing collection_registry mapping is authoritative after
 * close/reopen, and its exact stream position and stored rows remain readable.
 * The first ordinary-row connection seeds the fixed witness; the reopened
 * executeAsync columnar connection exercises the production adapter boundary.
 * This better-sqlite3 shim cannot close native op-sqlite device coverage.
 */
it(`reuses a pre-populated registry with exact stream and rows after close and reopen`, async () => {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-rn-persistence-restart-oracle-`),
  )
  const dbPath = join(tempDirectory, `state.sqlite`)
  const collectionId = `todos-restart`

  await withFailurePreservingCleanup(
    async (cleanups) => {
      const firstDatabase = createOpSQLiteTestDatabase({ filename: dbPath })
      const closeFirstDatabase = once(() =>
        Promise.resolve(firstDatabase.close()),
      )
      cleanups.unshift(closeFirstDatabase)
      const firstAdapter = createReactNativeSQLitePersistence({
        database: firstDatabase,
      }).adapter

      await firstAdapter.applyCommittedTx(collectionId, {
        txId: `tx-restart-1`,
        term: 5,
        seq: 8,
        rowVersion: 13,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Survives restart`,
              score: 10,
            },
          },
        ],
      })

      const firstNativeDatabase = firstDatabase.getNativeDatabase?.()
      if (!firstNativeDatabase) {
        throw new Error(`restart oracle requires the local SQLite shim`)
      }
      const registryBeforeRestart = firstNativeDatabase
        .prepare(collectionRegistryQuery)
        .all(collectionId)
      expect(registryBeforeRestart).toEqual([
        {
          collection_id: collectionId,
          table_name: expect.stringMatching(/^c_[a-z2-7]+_[0-9a-z]+$/),
          tombstone_table_name: expect.stringMatching(
            /^t_[a-z2-7]+_[0-9a-z]+$/,
          ),
          schema_version: 1,
        },
      ])
      if (!firstAdapter.getStreamPosition) {
        throw new Error(`restart oracle requires stream-position support`)
      }
      expect(await firstAdapter.getStreamPosition(collectionId)).toEqual(
        restartStreamPosition,
      )

      await closeFirstDatabase()

      const secondDatabase = createOpSQLiteTestDatabase({
        filename: dbPath,
        resultShape: `execute-async-columnar`,
      })
      cleanups.unshift(() => Promise.resolve(secondDatabase.close()))
      const secondNativeDatabase = secondDatabase.getNativeDatabase?.()
      if (!secondNativeDatabase) {
        throw new Error(`restart oracle requires the reopened SQLite shim`)
      }
      expect(
        secondNativeDatabase.prepare(collectionRegistryQuery).all(collectionId),
      ).toEqual(registryBeforeRestart)

      const secondAdapter = createReactNativeSQLitePersistence({
        database: secondDatabase,
      }).adapter
      if (!secondAdapter.getStreamPosition) {
        throw new Error(`restart oracle requires stream-position support`)
      }
      expect(await secondAdapter.getStreamPosition(collectionId)).toEqual(
        restartStreamPosition,
      )
      await expect(secondAdapter.loadSubset(collectionId, {})).resolves.toEqual(
        [
          {
            key: `1`,
            value: {
              id: `1`,
              title: `Survives restart`,
              score: 10,
            },
          },
        ],
      )
      expect(
        secondNativeDatabase.prepare(collectionRegistryQuery).all(collectionId),
      ).toEqual(registryBeforeRestart)
    },
    [() => rmSync(tempDirectory, { recursive: true, force: true })],
  )
})

it(`shared react-native api persists across expo-style restart`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-restart-expo`

  const firstDatabase = createOpSQLiteTestDatabase({ filename: dbPath })
  const firstPersistence = createReactNativeSQLitePersistence({
    database: firstDatabase,
  })
  const firstAdapter = firstPersistence.adapter

  await firstAdapter.applyCommittedTx(collectionId, {
    txId: `tx-restart-expo-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [
      {
        type: `insert`,
        key: `1`,
        value: {
          id: `1`,
          title: `Expo survives restart`,
          score: 10,
        },
      },
    ],
  })
  await Promise.resolve(firstDatabase.close())

  const secondDatabase = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(secondDatabase.close()))
  const secondPersistence = createReactNativeSQLitePersistence({
    database: secondDatabase,
  })
  const secondAdapter = secondPersistence.adapter

  const rows = await secondAdapter.loadSubset(collectionId, {})
  expect(rows).toEqual([
    {
      key: `1`,
      value: {
        id: `1`,
        title: `Expo survives restart`,
        score: 10,
      },
    },
  ])
})

it(`keeps all committed rows under rapid mutation bursts`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-burst`
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const persistence = createReactNativeSQLitePersistence({
    database,
  })
  const adapter = persistence.adapter

  const burstSize = 50
  for (let index = 0; index < burstSize; index++) {
    const rowId = String(index + 1)
    await adapter.applyCommittedTx(collectionId, {
      txId: `tx-burst-${rowId}`,
      term: 1,
      seq: index + 1,
      rowVersion: index + 1,
      mutations: [
        {
          type: `insert`,
          key: rowId,
          value: {
            id: rowId,
            title: `Todo ${rowId}`,
            score: index,
          },
        },
      ],
    })
  }

  const rows = await adapter.loadSubset(collectionId, {})
  expect(rows).toHaveLength(burstSize)
})

it(`uses a single react-native api across runtime aliases`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-entrypoints`
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const reactNativePersistence = createReactNativeSQLitePersistence({
    database,
  })
  const sharedApiPersistence = createReactNativeSQLitePersistence({
    database,
  })

  await reactNativePersistence.adapter.applyCommittedTx(collectionId, {
    txId: `tx-entrypoint-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [
      {
        type: `insert`,
        key: `1`,
        value: {
          id: `1`,
          title: `Entry point parity`,
          score: 1,
        },
      },
    ],
  })

  const rows = await sharedApiPersistence.adapter.loadSubset(collectionId, {})
  expect(rows[0]?.value.title).toBe(`Entry point parity`)
})

it(`resumes persisted sync after simulated background/foreground transitions`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-lifecycle`
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const persistence = createReactNativeSQLitePersistence({
    database,
  })
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (todo) => todo.id,
      persistence,
      syncMode: `eager`,
    }),
  )
  activeCleanupFns.push(() => collection.cleanup())

  await collection.stateWhenReady()

  const initialInsert = collection.insert({
    id: `1`,
    title: `Before background`,
    score: 1,
  })
  await initialInsert.isPersisted.promise
  expect(collection.get(`1`)?.title).toBe(`Before background`)

  await collection.cleanup()
  collection.startSyncImmediate()
  await collection.stateWhenReady()

  const postResumeInsert = collection.insert({
    id: `2`,
    title: `Post resume write`,
    score: 2,
  })
  await postResumeInsert.isPersisted.promise
  expect(collection.get(`2`)?.title).toBe(`Post resume write`)

  const persistedRows = await persistence.adapter.loadSubset(collectionId, {})
  expect(persistedRows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: `1`,
      }),
      expect.objectContaining({
        key: `2`,
      }),
    ]),
  )
})

it(`shared api resumes persisted sync in expo-style lifecycle`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-lifecycle-expo`
  const database = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(database.close()))

  const persistence = createReactNativeSQLitePersistence({
    database,
  })
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (todo) => todo.id,
      persistence,
      syncMode: `eager`,
    }),
  )
  activeCleanupFns.push(() => collection.cleanup())

  await collection.stateWhenReady()

  const initialInsert = collection.insert({
    id: `1`,
    title: `Before background`,
    score: 1,
  })
  await initialInsert.isPersisted.promise
  expect(collection.get(`1`)?.title).toBe(`Before background`)

  await collection.cleanup()
  collection.startSyncImmediate()
  await collection.stateWhenReady()

  const postResumeInsert = collection.insert({
    id: `2`,
    title: `Post resume write`,
    score: 2,
  })
  await postResumeInsert.isPersisted.promise
  expect(collection.get(`2`)?.title).toBe(`Post resume write`)

  const persistedRows = await persistence.adapter.loadSubset(collectionId, {})
  expect(persistedRows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: `1`,
      }),
      expect.objectContaining({
        key: `2`,
      }),
    ]),
  )
})
