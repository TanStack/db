import { describe, expect, it } from "vitest"
import { createCollection } from "@tanstack/db"
import {
  addRxPlugin,
  createRxDatabase,
  getFromMapOrCreate,
} from "rxdb/plugins/core"
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv"
import { OPEN_RXDB_SUBSCRIPTIONS, rxdbCollectionOptions } from "../src/rxdb"
import type { RxCollection } from "rxdb/plugins/core"
import type { RxDBCollectionConfig } from "../src/rxdb"

type TestDocType = {
  id: string
  name: string
}
type RxCollections = { test: RxCollection<TestDocType> }

// Helper to advance timers and allow microtasks to flush
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`RxDB Integration`, () => {
  addRxPlugin(RxDBDevModePlugin)

  let dbNameId = 0
  function getTestData(amount: number): Array<TestDocType> {
    return new Array(amount).fill(0).map((_v, i) => {
      return {
        id: i + 1 + ``,
        name: `Item ` + (i + 1),
      }
    })
  }

  async function getDatababase(
    initialDocs: Array<TestDocType> = [],
    dbId = dbNameId++
  ) {
    const db = await createRxDatabase<RxCollections, unknown, unknown, unknown>(
      {
        name: `my-rxdb-` + dbId,
        ignoreDuplicate: true,
        storage: wrappedValidateAjvStorage({
          storage: getRxStorageMemory(),
        }),
      }
    )
    const collections = await db.addCollections<RxCollections>({
      test: {
        schema: {
          version: 0,
          type: `object`,
          primaryKey: `id`,
          properties: {
            id: {
              type: `string`,
              maxLength: 100,
            },
            name: {
              type: `string`,
              maxLength: 9,
            },
          },
        },
      },
    })
    const rxCollection: RxCollection<TestDocType> = collections.test
    if (initialDocs.length > 0) {
      const insertResult = await rxCollection.bulkInsert(initialDocs)
      expect(insertResult.error.length).toBe(0)
    }
    return db
  }

  async function createTestState(
    initialDocs: Array<TestDocType> = [],
    config: Partial<RxDBCollectionConfig<TestDocType, any>> = {}
  ) {
    const db = await getDatababase(initialDocs, dbNameId++)
    const rxCollection: RxCollection<TestDocType> = db.test
    const options = rxdbCollectionOptions({
      rxCollection: rxCollection,
      startSync: true,
      /**
       * In tests we use a small batch size
       * to ensure iteration works.
       */
      syncBatchSize: 10,
      ...config,
    })

    const collection = createCollection(options)
    await collection.stateWhenReady()

    return {
      collection,
      rxCollection,
      db,
    }
  }

  describe(`sync`, () => {
    it(`should initialize and fetch initial data`, async () => {
      const initialItems = getTestData(2)

      const { collection, db } = await createTestState(initialItems)

      // Verify the collection state contains our items
      expect(collection.size).toBe(initialItems.length)
      expect(collection.get(`1`)).toEqual(initialItems[0])
      expect(collection.get(`2`)).toEqual(initialItems[1])

      // Verify the synced data
      expect(collection.syncedData.size).toBe(initialItems.length)
      expect(collection.syncedData.get(`1`)).toEqual(initialItems[0])
      expect(collection.syncedData.get(`2`)).toEqual(initialItems[1])

      await db.remove()
    })

    it(`should initialize and fetch initial data with many documents`, async () => {
      const docsAmount = 25 // > 10 to force multiple batches
      const initialItems = getTestData(docsAmount)
      const { collection, db } = await createTestState(initialItems)

      // All docs should be present after initial sync
      expect(collection.size).toBe(docsAmount)
      expect(collection.syncedData.size).toBe(docsAmount)

      // Spot-check a few positions
      expect(collection.get(`1`)).toEqual({ id: `1`, name: `Item 1` })
      expect(collection.get(`10`)).toEqual({ id: `10`, name: `Item 10` })
      expect(collection.get(`11`)).toEqual({ id: `11`, name: `Item 11` })
      expect(collection.get(`25`)).toEqual({ id: `25`, name: `Item 25` })

      // Ensure no gaps
      for (let i = 1; i <= docsAmount; i++) {
        expect(collection.has(String(i))).toBe(true)
      }

      await db.remove()
    })

    it(`should update the collection when RxDB changes data`, async () => {
      const initialItems = getTestData(2)

      const { collection, rxCollection, db } =
        await createTestState(initialItems)

      // inserts
      const doc = await rxCollection.insert({ id: `3`, name: `inserted` })
      expect(collection.get(`3`).name).toEqual(`inserted`)

      // updates
      await doc.getLatest().patch({ name: `updated` })
      expect(collection.get(`3`).name).toEqual(`updated`)

      // deletes
      await doc.getLatest().remove()
      expect(collection.get(`3`)).toEqual(undefined)

      await db.remove()
    })

    it(`should update RxDB when the collection changes data`, async () => {
      const initialItems = getTestData(2)

      const { collection, rxCollection, db } =
        await createTestState(initialItems)

      // inserts
      const tx = collection.insert({ id: `3`, name: `inserted` })
      await tx.isPersisted.promise
      let doc = await rxCollection.findOne(`3`).exec(true)
      expect(doc.name).toEqual(`inserted`)

      // updates
      collection.update(`3`, (d) => {
        d.name = `updated`
      })
      expect(collection.get(`3`).name).toEqual(`updated`)
      await collection.stateWhenReady()
      await rxCollection.database.requestIdlePromise()
      doc = await rxCollection.findOne(`3`).exec(true)
      expect(doc.name).toEqual(`updated`)

      // deletes
      collection.delete(`3`)
      await rxCollection.database.requestIdlePromise()
      const mustNotBeFound = await rxCollection.findOne(`3`).exec()
      expect(mustNotBeFound).toEqual(null)

      await db.remove()
    })
  })

  describe(`lifecycle management`, () => {
    it(`should call unsubscribe when collection is cleaned up`, async () => {
      const { collection, rxCollection, db } = await createTestState()

      await collection.cleanup()

      const subs = getFromMapOrCreate(
        OPEN_RXDB_SUBSCRIPTIONS,
        rxCollection,
        () => new Set()
      )
      expect(subs.size).toEqual(0)

      await db.remove()
    })

    it(`should restart sync when collection is accessed after cleanup`, async () => {
      const initialItems = getTestData(2)
      const { collection, rxCollection, db } =
        await createTestState(initialItems)

      await collection.cleanup()
      await flushPromises()
      expect(collection.status).toBe(`cleaned-up`)

      // insert into RxDB while cleaned-up
      await rxCollection.insert({ id: `3`, name: `Item 3` })

      // Access collection data to restart sync
      const unsubscribe = collection.subscribeChanges(() => {})

      await collection.toArrayWhenReady()
      expect(collection.get(`3`).name).toEqual(`Item 3`)

      unsubscribe()
      await db.remove()
    })
  })

  /**
   * Here we simulate having multiple browser tabs
   * open where the data should still be in sync.
   */
  describe(`multi tab`, () => {
    it(`should update the state accross instances`, async () => {
      const dbid = dbNameId++
      const db1 = await getDatababase([], dbid)
      const db2 = await getDatababase(getTestData(2), dbid)

      const col1 = createCollection(
        rxdbCollectionOptions({
          rxCollection: db1.test,
          startSync: true,
        })
      )
      const col2 = createCollection(
        rxdbCollectionOptions({
          rxCollection: db2.test,
          startSync: true,
        })
      )
      await col1.stateWhenReady()
      await col2.stateWhenReady()

      // tanstack-db writes
      col1.insert({ id: `t1`, name: `t1` })
      col2.insert({ id: `t2`, name: `t2` })
      await db1.test.findOne(`t1`).exec(true)
      await db1.test.findOne(`t2`).exec(true)
      await db2.test.findOne(`t1`).exec(true)
      await db2.test.findOne(`t2`).exec(true)
      expect(col2.get(`t1`)).toBeTruthy()
      expect(col1.get(`t2`)).toBeTruthy()

      // RxDB writes
      await db1.test.insert({ id: `rx1`, name: `rx1` })
      await db2.test.insert({ id: `rx2`, name: `rx2` })
      expect(col2.get(`rx1`)).toBeTruthy()
      expect(col1.get(`rx2`)).toBeTruthy()

      db1.remove()
      db2.remove()
    })
  })

  describe(`error handling`, () => {
    it.skip(`should rollback the transaction on invalid data that does not match the RxCollection schema`, async () => {
      const initialItems = getTestData(2)
      const { collection, db } = await createTestState(initialItems)

      // INSERT
      await expect(async () => {
        const tx = collection.insert({
          id: `3`,
          name: `invalid`,
          foo: `bar`,
        })
        await tx.isPersisted.promise
      }).rejects.toThrow(/schema validation error/)
      expect(collection.has(`3`)).toBe(false)

      // UPDATE
      await expect(async () => {
        const tx = collection.update(`2`, (d) => {
          d.name = `invalid`
          d.foo = `bar`
        })
        await tx.isPersisted.promise
      }).rejects.toThrow(/schema validation error/)
      expect(collection.get(`2`).name).toBe(`Item 2`)

      await db.remove()
    })
  })
})
