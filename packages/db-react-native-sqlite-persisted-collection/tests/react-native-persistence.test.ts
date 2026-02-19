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

const activeCleanupFns: Array<() => void | Promise<void>> = []

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

it(`persists data across app restart (close and reopen)`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-restart`

  const firstDatabase = createOpSQLiteTestDatabase({ filename: dbPath })
  const firstPersistence = createReactNativeSQLitePersistence<Todo, string>({
    database: firstDatabase,
  })
  const firstAdapter = firstPersistence.adapter

  await firstAdapter.applyCommittedTx(collectionId, {
    txId: `tx-restart-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
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
  await Promise.resolve(firstDatabase.close())

  const secondDatabase = createOpSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => Promise.resolve(secondDatabase.close()))
  const secondPersistence = createReactNativeSQLitePersistence<Todo, string>({
    database: secondDatabase,
  })
  const secondAdapter = secondPersistence.adapter

  const rows = await secondAdapter.loadSubset(collectionId, {})
  expect(rows).toEqual([
    {
      key: `1`,
      value: {
        id: `1`,
        title: `Survives restart`,
        score: 10,
      },
    },
  ])
})

it(`shared react-native api persists across expo-style restart`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-restart-expo`

  const firstDatabase = createOpSQLiteTestDatabase({ filename: dbPath })
  const firstPersistence = createReactNativeSQLitePersistence<Todo, string>({
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
  const secondPersistence = createReactNativeSQLitePersistence<Todo, string>({
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

  const persistence = createReactNativeSQLitePersistence<Todo, string>({
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

  const reactNativePersistence = createReactNativeSQLitePersistence<
    Todo,
    string
  >({
    database,
  })
  const sharedApiPersistence = createReactNativeSQLitePersistence<Todo, string>(
    {
      database,
    },
  )

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

  const persistence = createReactNativeSQLitePersistence<Todo, string>({
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

  const persistence = createReactNativeSQLitePersistence<Todo, string>({
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
