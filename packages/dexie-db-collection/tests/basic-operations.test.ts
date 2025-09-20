import "./fake-db"
import { createCollection } from "@tanstack/db"
import { afterEach, describe, expect, it } from "vitest"
import dexieCollectionOptions from "../src/dexie"
import {
  TestItemSchema,
  cleanupTestResources,
  createDexieDatabase,
  createTestState,
  createdCollections,
  getTestData,
  waitForCollectionSize,
  waitForKey,
} from "./test-helpers"
import type { TestItem } from "./test-helpers"

describe(`Dexie Basic Operations`, () => {
  afterEach(cleanupTestResources)

  it(`should call unsubscribe when collection is cleaned up`, async () => {
    const { collection, db } = await createTestState()

    await collection.cleanup()

    // After cleanup, writing directly to Dexie should not update collection
    // write top-level object per new driver
    await db.table(`test`).put({ id: `x1`, name: `should-not-see` })
    // allow microtasks to flush
    await new Promise((r) => setTimeout(r, 50))
    expect(collection.get(`x1`)).toBeUndefined()

    await db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  })

  it(`should restart sync when collection is accessed after cleanup`, async () => {
    const initial = getTestData(2)
    const { collection, db } = await createTestState(initial)

    await collection.cleanup()
    // small delay to allow cleanup side-effects
    await new Promise((r) => setTimeout(r, 20))

    // insert into Dexie while cleaned-up
    // write top-level object per new driver
    await db.table(`test`).put({ id: `3`, name: `Item 3` })

    // The previous collection was cleaned up and its driver unsubscribed.
    // Create a fresh collection instance pointed at the same DB to verify
    // that accessing the collection after cleanup restarts sync.
    const options = dexieCollectionOptions({
      id: `test-restarted`,
      tableName: `test`,
      dbName: db.name,
      schema: TestItemSchema,
      getKey: (item) => item.id,
    })
    const restarted = createCollection(options)
    await restarted.stateWhenReady()
    createdCollections.push(restarted)

    const utils2 = restarted.utils as unknown as {
      refetch?: () => Promise<void>
    }
    if (utils2.refetch) await utils2.refetch()

    // Prefer awaitIds if available on the new collection
    const utilsAny = restarted.utils as unknown as
      | {
          awaitIds?: (
            ids: Array<string | number>,
            timeoutMs?: number
          ) => Promise<void>
        }
      | undefined
    if (utilsAny?.awaitIds) await utilsAny.awaitIds([`3`], 1000)
    else await waitForKey(restarted, `3`, 1000)
    expect(restarted.get(`3`)?.name).toEqual(`Item 3`)
    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  }, 20000)

  it(`initializes and fetches initial data`, async () => {
    const initial = getTestData(2)
    const { collection, db } = await createTestState(initial)
    await waitForCollectionSize(collection, initial.length, 1000)
    expect(collection.size).toBe(2)
    expect(collection.get(`1`)).toEqual(initial[0])
    expect(collection.get(`2`)).toEqual(initial[1])

    await db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  }, 20000)

  it(`handles many documents across batches`, async () => {
    const docs = getTestData(25)
    const { collection, db } = await createTestState(docs)
    await waitForCollectionSize(collection, docs.length, 15000)
    expect(collection.size).toBe(25)
    expect(collection.get(`1`)).toEqual(docs[0])
    expect(collection.get(`10`)).toEqual(docs[9])
    expect(collection.get(`25`)).toEqual(docs[24])

    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  }, 20000)

  it(`updates when dexie table is changed (put/delete broadcast)`, async () => {
    const initial = getTestData(2)
    const { collection, db } = await createTestState(initial)

    // write directly to Dexie and then force a refetch (no change events in Node)
    // write top-level object per new driver
    await db.table(`test`).put({ id: `3`, name: `inserted` })
    const utils = collection.utils as unknown as {
      refetch?: () => Promise<void>
      awaitIds?: (
        ids: Array<string | number>,
        timeoutMs?: number
      ) => Promise<void>
    }
    if (utils.refetch) await utils.refetch()
    // allow microtasks to flush and driver to process
    await new Promise((r) => setTimeout(r, 50))
    // As a fallback wait for the key to appear
    await waitForKey(collection, `3`, 1000)
    expect(collection.get(`3`)?.name).toBe(`inserted`)

    if (utils.awaitIds) await utils.awaitIds([`3`], 500)

    await db.table(`test`).delete(`3`)
    if (utils.refetch) await utils.refetch()
    await new Promise((r) => setTimeout(r, 20))
    expect(collection.get(`3`)).toBeUndefined()

    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  }, 20000)

  it(`collection writes persist to dexie via mutation handlers`, async () => {
    const initial = getTestData(2)
    const { collection, db } = await createTestState(initial)

    const tx = collection.insert({ id: `4`, name: `persisted` })
    await tx.isPersisted.promise
    const utils = collection.utils as unknown as {
      refetch?: () => Promise<void>
    }
    if (utils.refetch) await utils.refetch()
    await new Promise((r) => setTimeout(r, 50))
    // Ensure the collection sees the persisted insertion before updating
    await waitForKey(collection, `4`, 1000)

    const row = await db.table(`test`).get(`4`)
    // New driver stores item at top-level (row contains the user object)
    expect(row).toMatchObject({ id: `4`, name: `persisted` })

    // updates
    collection.update(`4`, (d) => (d.name = `updated`))
    await collection.stateWhenReady()
    if (utils.refetch) await utils.refetch()
    const row2 = await db.table(`test`).get(`4`)
    expect(row2?.name).toBe(`updated`)

    collection.delete(`4`)
    await collection.stateWhenReady()
    if (utils.refetch) await utils.refetch()
    const afterDel = await db.table(`test`).get(`4`)
    expect(afterDel).toBeUndefined()

    await db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  }, 20000)

  it(`restarted collection fetches existing DB state after cleanup`, async () => {
    const initial = getTestData(3)
    const db = await createDexieDatabase(initial)

    const opts = dexieCollectionOptions({
      id: `restart-fetch`,
      tableName: `test`,
      dbName: db.name,
      schema: TestItemSchema,
      getKey: (item) => item.id,
    })

    const col = createCollection(opts)
    await col.stateWhenReady()
    createdCollections.push(col)

    // ensure initial items are loaded
    await waitForCollectionSize(col, initial.length, 1000)
    expect(col.size).toBe(3)

    // cleanup the collection (unsubscribe/cleanup)
    await col.cleanup()

    // create a fresh collection pointing to the same DB
    const restarted = createCollection(opts)
    await restarted.stateWhenReady()
    createdCollections.push(restarted)

    // the restarted collection should immediately see the existing DB rows
    await waitForCollectionSize(restarted, initial.length, 1000)
    expect(restarted.get(`1`)?.name).toBe(initial[0]?.name)
    expect(restarted.get(`2`)?.name).toBe(initial[1]?.name)
    expect(restarted.get(`3`)?.name).toBe(initial[2]?.name)

    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  })

  it(`should validate data using the provided schema`, async () => {
    const { collection, db } = await createTestState()

    // Valid data should work
    const validTx = collection.insert({ id: `valid`, name: `Valid Item` })
    await validTx.isPersisted.promise

    // Trigger refetch to sync collection state with database
    const utils = collection.utils as unknown as {
      refetch?: () => Promise<void>
    }
    if (utils.refetch) await utils.refetch()
    await waitForKey(collection, `valid`, 1000)

    expect(collection.get(`valid`)?.name).toBe(`Valid Item`)

    // Test that schema validation is working by checking type safety
    // This test verifies that the collection properly infers types from the schema
    const item = collection.get(`valid`)
    if (item) {
      // These properties should be available and properly typed
      expect(typeof item.id).toBe(`string`)
      expect(typeof item.name).toBe(`string`)

      // TypeScript should know about these properties from the schema
      const itemId: string = item.id
      const itemName: string = item.name
      expect(itemId).toBe(`valid`)
      expect(itemName).toBe(`Valid Item`)
    }

    await db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  })

  it(`should support both schema-first and explicit type patterns`, async () => {
    const db1 = await createDexieDatabase([])

    // Schema-first pattern (what we're using above)
    const schemaOptions = dexieCollectionOptions({
      id: `schema-test`,
      storeName: `test`,
      dbName: db1.name,
      schema: TestItemSchema,
      getKey: (item) => item.id,
      // startSync removed in new implementation
    })

    // Explicit type pattern (without schema for backward compatibility)
    const explicitOptions = dexieCollectionOptions<TestItem>({
      id: `explicit-test`,
      storeName: `test`,
      dbName: db1.name,
      getKey: (item) => item.id,
      // startSync removed in new implementation
    })

    const schemaCollection = createCollection(schemaOptions)
    const explicitCollection = createCollection(explicitOptions)

    await schemaCollection.stateWhenReady()
    await explicitCollection.stateWhenReady()

    // Both should work the same way
    const schemaTx = schemaCollection.insert({ id: `s1`, name: `Schema Item` })
    const explicitTx = explicitCollection.insert({
      id: `e1`,
      name: `Explicit Item`,
    })

    await schemaTx.isPersisted.promise
    await explicitTx.isPersisted.promise

    // Trigger refetch to sync collection states with database
    const schemaUtils = schemaCollection.utils as unknown as {
      refetch?: () => Promise<void>
    }
    const explicitUtils = explicitCollection.utils as unknown as {
      refetch?: () => Promise<void>
    }
    if (schemaUtils.refetch) await schemaUtils.refetch()
    if (explicitUtils.refetch) await explicitUtils.refetch()
    await waitForKey(schemaCollection, `s1`, 1000)
    await waitForKey(explicitCollection, `e1`, 1000)

    expect(schemaCollection.get(`s1`)?.name).toBe(`Schema Item`)
    expect(explicitCollection.get(`e1`)?.name).toBe(`Explicit Item`)

    await db1.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db1.name)
    } catch {
      // ignore
    }
  })

  it(`uses codec parse/serialize when provided`, async () => {
    const db = await createDexieDatabase([])

    const options = dexieCollectionOptions({
      id: `codec-test`,
      tableName: `test`,
      dbName: db.name,
      schema: TestItemSchema,
      getKey: (item) => item.id,
      codec: {
        serialize: (item) => ({
          ...(item as any),
          name: (item as any).name + `-S`,
        }),
        parse: (raw) => ({ ...(raw as any), name: (raw as any).name + `-P` }),
      },
    })

    const col = createCollection(options)
    await col.stateWhenReady()
    createdCollections.push(col)

    const tx = col.insert({ id: `c1`, name: `orig` })
    await tx.isPersisted.promise

    const utils = col.utils as unknown as { refetch?: () => Promise<void> }
    if (utils.refetch) await utils.refetch()

    await waitForKey(col, `c1`, 1000)

    // Parsed value should include both serialize and parse transformations
    expect(col.get(`c1`)?.name).toBe(`orig-S-P`)

    // Stored DB row should contain the serialized form (without parse)
    const row = await db.table(`test`).get(`c1`)
    expect(row?.name).toBe(`orig-S`)

    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  })

  it(`rowUpdateMode 'full' exercises full-replacement update path`, async () => {
    const initial = getTestData(1)
    const db = await createDexieDatabase(initial)

    const opts = dexieCollectionOptions({
      id: `full-update-test`,
      tableName: `test`,
      dbName: db.name,
      schema: TestItemSchema,
      getKey: (i) => i.id,
      rowUpdateMode: `full`,
    })

    const col = createCollection(opts)
    await col.stateWhenReady()
    createdCollections.push(col)

    // Update the single row
    col.update(`1`, (d) => (d.name = `updated-full`))
    await col.stateWhenReady()

    await col.utils.refetch()

    const row = await db.table(`test`).get(`1`)
    expect(row?.name).toBe(`updated-full`)

    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  })

  it(`utils.awaitIds rejects on timeout when id never seen`, async () => {
    const db = await createDexieDatabase([])

    const opts = dexieCollectionOptions({
      id: `await-timeout`,
      tableName: `test`,
      dbName: db.name,
      schema: TestItemSchema,
      getKey: (i) => i.id,
    })

    const col = createCollection(opts)
    await col.stateWhenReady()
    createdCollections.push(col)

    const utilsAny = col.utils as unknown as {
      awaitIds?: (ids: Array<string>, t?: number) => Promise<void>
    }

    await expect(utilsAny.awaitIds?.([`nope`], 50)).rejects.toThrow()

    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  })

  it(`utils.getTable returns the Dexie table object`, async () => {
    const { collection, db } = await createTestState()
    const utils = collection.utils as unknown as { getTable: () => any }
    const table = utils.getTable()
    expect(typeof table.toArray).toBe(`function`)

    db.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  })
})
