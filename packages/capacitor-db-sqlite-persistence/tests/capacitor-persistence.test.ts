import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  createCapacitorSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { createCapacitorSQLiteTestDatabase } from './helpers/capacitor-sqlite-test-db'

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
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-capacitor-persistence-test-`),
  )
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

it(`persists data across app restart (close and reopen)`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-restart`

  const firstDatabase = createCapacitorSQLiteTestDatabase({ filename: dbPath })
  const firstPersistence = createCapacitorSQLitePersistence<Todo, string>({
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
  await firstDatabase.close()

  const secondDatabase = createCapacitorSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => secondDatabase.close())
  const secondPersistence = createCapacitorSQLitePersistence<Todo, string>({
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

it(`keeps all committed rows under rapid mutation bursts`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-burst`
  const database = createCapacitorSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => database.close())

  const persistence = createCapacitorSQLitePersistence<Todo, string>({
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

it(`shares persistence across multiple collections on one database`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createCapacitorSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => database.close())

  const persistence = createCapacitorSQLitePersistence<Todo, string>({
    database,
  })

  await persistence.adapter.applyCommittedTx(`todos-a`, {
    txId: `tx-a-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [
      {
        type: `insert`,
        key: `a1`,
        value: {
          id: `a1`,
          title: `A`,
          score: 1,
        },
      },
    ],
  })

  await persistence.adapter.applyCommittedTx(`todos-b`, {
    txId: `tx-b-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [
      {
        type: `insert`,
        key: `b1`,
        value: {
          id: `b1`,
          title: `B`,
          score: 2,
        },
      },
    ],
  })

  const rowsA = await persistence.adapter.loadSubset(`todos-a`, {})
  const rowsB = await persistence.adapter.loadSubset(`todos-b`, {})

  expect(rowsA.map((row) => row.key)).toEqual([`a1`])
  expect(rowsB.map((row) => row.key)).toEqual([`b1`])
})

it(`resumes persisted sync after simulated app lifecycle transitions`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-lifecycle`
  const database = createCapacitorSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(() => database.close())

  const persistence = createCapacitorSQLitePersistence<Todo, string>({
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

  await collection.cleanup()
  collection.startSyncImmediate()
  await collection.stateWhenReady()

  const postResumeInsert = collection.insert({
    id: `2`,
    title: `Post resume write`,
    score: 2,
  })
  await postResumeInsert.isPersisted.promise

  const persistedRows = await persistence.adapter.loadSubset(collectionId, {})
  expect(persistedRows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: `1` }),
      expect.objectContaining({ key: `2` }),
    ]),
  )
})
