import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  createTauriSQLitePersistence as createIndexPersistence,
  persistedCollectionOptions,
} from '../src'
import { createTauriSQLitePersistence as createTauriPersistence } from '../src/tauri'
import { createTauriSQLiteTestDatabase } from './helpers/tauri-sql-test-db'

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
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-tauri-persistence-test-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

it(`persists data across app restart (close and reopen)`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-restart`

  const firstDatabase = createTauriSQLiteTestDatabase({ filename: dbPath })
  const firstPersistence = createTauriPersistence<Todo, string>({
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

  const secondDatabase = createTauriSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(async () => {
    await Promise.resolve(secondDatabase.close())
  })
  const secondPersistence = createTauriPersistence<Todo, string>({
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

it(`shares the same runtime behavior through index and tauri entrypoints`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-entrypoints`
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(async () => {
    await Promise.resolve(database.close())
  })

  const indexPersistence = createIndexPersistence<Todo, string>({ database })
  const tauriPersistence = createTauriPersistence<Todo, string>({ database })

  await indexPersistence.adapter.applyCommittedTx(collectionId, {
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

  const rows = await tauriPersistence.adapter.loadSubset(collectionId, {})
  expect(rows[0]?.value.title).toBe(`Entry point parity`)
})

it(`resumes persisted sync after cleanup and restart`, async () => {
  const dbPath = createTempSqlitePath()
  const collectionId = `todos-lifecycle`
  const database = createTauriSQLiteTestDatabase({ filename: dbPath })
  activeCleanupFns.push(async () => {
    await Promise.resolve(database.close())
  })

  const persistence = createTauriPersistence<Todo, string>({
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
    title: `Before cleanup`,
    score: 1,
  })
  await initialInsert.isPersisted.promise
  expect(collection.get(`1`)?.title).toBe(`Before cleanup`)

  await collection.cleanup()
  collection.startSyncImmediate()
  await collection.stateWhenReady()

  const resumedInsert = collection.insert({
    id: `2`,
    title: `After restart`,
    score: 2,
  })
  await resumedInsert.isPersisted.promise
  expect(collection.get(`2`)?.title).toBe(`After restart`)

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
