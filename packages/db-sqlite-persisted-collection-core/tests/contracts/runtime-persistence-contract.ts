import { IR, createCollection } from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import {
  
  
  
  
  persistedCollectionOptions
} from '../../src'
import type {PersistedCollectionCoordinator, PersistedCollectionPersistence, PersistenceAdapter, SQLiteDriver} from '../../src';

export type RuntimePersistenceContractTodo = {
  id: string
  title: string
  score: number
}

export type RuntimePersistenceDatabaseHarness = {
  createDriver: () => SQLiteDriver
  cleanup: () => void
}

export type RuntimePersistenceContractFactory = {
  createDatabaseHarness: () => RuntimePersistenceDatabaseHarness
  createAdapter: (
    driver: SQLiteDriver,
  ) => PersistenceAdapter<RuntimePersistenceContractTodo, string>
  createPersistence: (
    driver: SQLiteDriver,
    coordinator?: PersistedCollectionCoordinator,
  ) => PersistedCollectionPersistence<RuntimePersistenceContractTodo, string>
  createCoordinator: () => PersistedCollectionCoordinator
}

async function withDatabaseHarness<T>(
  createHarness: () => RuntimePersistenceDatabaseHarness,
  fn: (harness: RuntimePersistenceDatabaseHarness) => Promise<T>,
): Promise<T> {
  const harness = createHarness()
  try {
    return await fn(harness)
  } finally {
    harness.cleanup()
  }
}

export function runRuntimePersistenceContractSuite(
  suiteName: string,
  factory: RuntimePersistenceContractFactory,
): void {
  describe(suiteName, () => {
    it(`adapts runtime driver through the shared SQLite core adapter`, async () => {
      await withDatabaseHarness(
        factory.createDatabaseHarness,
        async ({ createDriver }) => {
          const driver = createDriver()
          const adapter = factory.createAdapter(driver)
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
        },
      )
    })

    it(`persists collection writes that are readable from a second adapter instance`, async () => {
      await withDatabaseHarness(
        factory.createDatabaseHarness,
        async ({ createDriver }) => {
          const writerDriver = createDriver()
          const readerDriver = createDriver()

          const writerPersistence = factory.createPersistence(writerDriver)
          const collection = createCollection(
            persistedCollectionOptions<RuntimePersistenceContractTodo, string>({
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

          const readerAdapter = factory.createAdapter(readerDriver)
          const loadedRows = await readerAdapter.loadSubset(`todos`, {})
          expect(loadedRows).toHaveLength(1)
          expect(loadedRows[0]?.key).toBe(`persisted`)
          expect(loadedRows[0]?.value.title).toBe(`Persisted from collection`)
        },
      )
    })

    it(`allows overriding the coordinator`, async () => {
      await withDatabaseHarness(
        factory.createDatabaseHarness,
        async ({ createDriver }) => {
          const driver = createDriver()
          const coordinator = factory.createCoordinator()
          const persistence = factory.createPersistence(driver, coordinator)

          expect(persistence.coordinator).toBe(coordinator)
        },
      )
    })
  })
}
