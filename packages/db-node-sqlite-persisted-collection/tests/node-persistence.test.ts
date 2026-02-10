import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IR, createCollection } from '@tanstack/db'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SingleProcessCoordinator,
  createBetterSqlite3Driver,
  createNodeSQLitePersistence,
  createNodeSQLitePersistenceAdapter,
  persistedCollectionOptions,
} from '../src'

type Todo = {
  id: string
  title: string
  score: number
}

type PersistenceHarness = {
  dbPath: string
}

const activeCleanupFns: Array<() => void> = []

afterEach(() => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    cleanupFn?.()
  }
})

function createPersistenceHarness(): PersistenceHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-persistence-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return { dbPath }
}

describe(`node persistence helpers`, () => {
  it(`adapts better-sqlite3 driver through the shared SQLite core adapter`, async () => {
    const { dbPath } = createPersistenceHarness()
    const driver = createBetterSqlite3Driver({ filename: dbPath })
    activeCleanupFns.push(() => {
      driver.close()
    })

    const adapter = createNodeSQLitePersistenceAdapter<Todo, string>({
      driver,
    })
    const collectionId = `todos`

    await adapter.applyCommittedTx(collectionId, {
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
            title: `First`,
            score: 10,
          },
        },
      ],
    })

    const loadedRows = await adapter.loadSubset(collectionId, {
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(`1`)]),
    })
    expect(loadedRows).toEqual([
      {
        key: `1`,
        value: {
          id: `1`,
          title: `First`,
          score: 10,
        },
      },
    ])
  })

  it(`provides default single-process coordinator wiring for persistedCollectionOptions`, async () => {
    const { dbPath } = createPersistenceHarness()
    const writerDriver = createBetterSqlite3Driver({ filename: dbPath })
    activeCleanupFns.push(() => {
      writerDriver.close()
    })

    const writerPersistence = createNodeSQLitePersistence<Todo, string>({
      driver: writerDriver,
    })
    expect(writerPersistence.coordinator).toBeInstanceOf(SingleProcessCoordinator)

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `todos`,
        getKey: (todo) => todo.id,
        persistence: writerPersistence,
      }),
    )

    await collection.stateWhenReady()
    const insertTx = collection.insert({
      id: `persisted`,
      title: `Persisted from collection`,
      score: 42,
    })
    await insertTx.isPersisted.promise

    const readerDriver = createBetterSqlite3Driver({ filename: dbPath })
    activeCleanupFns.push(() => {
      readerDriver.close()
    })
    const readerAdapter = createNodeSQLitePersistenceAdapter<Todo, string>({
      driver: readerDriver,
    })

    const loadedRows = await readerAdapter.loadSubset(`todos`, {})
    expect(loadedRows).toHaveLength(1)
    expect(loadedRows[0]?.key).toBe(`persisted`)
    expect(loadedRows[0]?.value.title).toBe(`Persisted from collection`)
  })

  it(`allows overriding the default coordinator`, () => {
    const { dbPath } = createPersistenceHarness()
    const driver = createBetterSqlite3Driver({ filename: dbPath })
    activeCleanupFns.push(() => {
      driver.close()
    })

    const coordinator = new SingleProcessCoordinator()
    const persistence = createNodeSQLitePersistence<Todo, string>({
      driver,
      coordinator,
    })

    expect(persistence.coordinator).toBe(coordinator)
  })
})
