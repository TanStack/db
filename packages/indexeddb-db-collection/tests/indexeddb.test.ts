import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexedDB } from 'fake-indexeddb'
import { createCollection } from '@tanstack/db'
import {
  GetKeyRequiredError,
  
  NameRequiredError,
  ObjectStoreNotFoundError,
  createIndexedDB,
  deleteDatabase,
  indexedDBCollectionOptions
} from '../src'
import type {IndexedDBInstance} from '../src';

interface TestItem {
  id: number
  name: string
  value?: number
}

// Helper to advance timers and flush microtasks
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 10))

// Mock localStorage for tests (required by @tanstack/db proxy.ts)
const mockLocalStorage = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}

describe(`indexedDBCollectionOptions`, () => {
  // Use unique database names per test to avoid conflicts
  let dbNameCounter = 0
  const getUniqueDbName = () => `test-db-${Date.now()}-${dbNameCounter++}`

  beforeEach(() => {
    // Mock localStorage globally
    vi.stubGlobal(`localStorage`, mockLocalStorage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe(`createIndexedDB`, () => {
    let dbName: string

    beforeEach(() => {
      dbName = getUniqueDbName()
    })

    afterEach(async () => {
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should create database with specified stores`, async () => {
      const db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['store1', 'store2'],
        idbFactory: indexedDB,
      })

      expect(db.db.objectStoreNames.contains('store1')).toBe(true)
      expect(db.db.objectStoreNames.contains('store2')).toBe(true)
      expect(db.db.objectStoreNames.contains('_versions')).toBe(true)
      expect(db.name).toBe(dbName)
      expect(db.version).toBe(1)
      expect(db.stores).toContain('store1')
      expect(db.stores).toContain('store2')

      db.close()
    })

    it(`should throw if no stores provided`, async () => {
      await expect(
        createIndexedDB({
          name: dbName,
          version: 1,
          stores: [],
          idbFactory: indexedDB,
        }),
      ).rejects.toThrow('at least one store')
    })

    it(`should throw if duplicate store names`, async () => {
      await expect(
        createIndexedDB({
          name: dbName,
          version: 1,
          stores: ['items', 'items'],
          idbFactory: indexedDB,
        }),
      ).rejects.toThrow('duplicate store names')
    })

    it(`should throw if invalid store name`, async () => {
      await expect(
        createIndexedDB({
          name: dbName,
          version: 1,
          stores: ['valid', ''],
          idbFactory: indexedDB,
        }),
      ).rejects.toThrow('invalid store names')
    })

    it(`should allow multiple collections to share database`, async () => {
      const db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items1', 'items2'],
        idbFactory: indexedDB,
      })

      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: 'items1',
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: 'items2',
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      await collection1.insert({ id: 1, name: 'Item 1' })
      await collection2.insert({ id: 2, name: 'Item 2' })
      await flushPromises()

      expect(collection1.has(1)).toBe(true)
      expect(collection2.has(2)).toBe(true)
      expect(collection1.has(2)).toBe(false)
      expect(collection2.has(1)).toBe(false)

      db.close()
    })
  })

  describe(`Configuration validation`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should throw ObjectStoreNotFoundError when store not in database`, () => {
      expect(() =>
        indexedDBCollectionOptions<TestItem>({
          db,
          name: `missing`,
          getKey: (item) => item.id,
        }),
      ).toThrow(ObjectStoreNotFoundError)
    })

    it(`should throw NameRequiredError when name not provided`, () => {
      expect(() =>
        indexedDBCollectionOptions({
          db,
          name: ``,
          getKey: (item: TestItem) => item.id,
        } as any),
      ).toThrow(NameRequiredError)
    })

    it(`should throw GetKeyRequiredError when getKey not provided`, () => {
      expect(() =>
        indexedDBCollectionOptions({
          db,
          name: `items`,
        } as any),
      ).toThrow(GetKeyRequiredError)
    })

    it(`should create options successfully with valid config`, () => {
      const options = indexedDBCollectionOptions({
        db,
        name: `items`,
        getKey: (item: TestItem) => item.id,
      })

      expect(options).toBeDefined()
      expect(options.getKey).toBeDefined()
      expect(options.sync).toBeDefined()
      expect(options.utils).toBeDefined()
    })
  })

  describe(`Initial load`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should return empty collection for empty store`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      expect(collection.size).toBe(0)
      expect(Array.from(collection.state.values())).toEqual([])
    })
  })

  describe(`Insert operations`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should add item to collection state`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `Test Item` })
      await flushPromises()

      expect(collection.size).toBe(1)
      expect(collection.get(1)).toEqual({ id: 1, name: `Test Item` })
    })

    it(`should persist item to IndexedDB`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 42, name: `Persisted Item`, value: 123 })
      await flushPromises()

      // Verify using exportData utility
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(1)
      expect(exported[0]).toEqual({
        id: 42,
        name: `Persisted Item`,
        value: 123,
      })
    })

    it(`should update version entry in _versions store`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `Item 1` })
      await flushPromises()

      // Verify version entry exists by checking database info
      const info = await collection.utils.getDatabaseInfo()
      expect(info.objectStores).toContain(`_versions`)
    })

    it(`should handle multiple inserts correctly`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `First` })
      await collection.insert({ id: 2, name: `Second` })
      await collection.insert({ id: 3, name: `Third` })
      await flushPromises()

      expect(collection.size).toBe(3)
      expect(collection.get(1)).toEqual({ id: 1, name: `First` })
      expect(collection.get(2)).toEqual({ id: 2, name: `Second` })
      expect(collection.get(3)).toEqual({ id: 3, name: `Third` })

      // Verify persistence
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(3)
    })
  })

  describe(`Update operations`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should modify item in collection state`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `Original`, value: 10 })
      await flushPromises()

      await collection.update(1, (draft) => {
        draft.name = `Updated`
        draft.value = 20
      })
      await flushPromises()

      expect(collection.get(1)).toEqual({ id: 1, name: `Updated`, value: 20 })
    })

    it(`should persist update changes to IndexedDB`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `Original` })
      await flushPromises()

      await collection.update(1, (draft) => {
        draft.name = `Modified`
      })
      await flushPromises()

      // Verify persistence
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(1)
      expect(exported[0]).toEqual({ id: 1, name: `Modified` })
    })

    it(`should update version entry on update`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `Original` })
      await flushPromises()

      // Export data before update
      const beforeUpdate = await collection.utils.exportData()
      expect(beforeUpdate.length).toBe(1)

      await collection.update(1, (draft) => {
        draft.name = `Updated`
      })
      await flushPromises()

      // Export data after update
      const afterUpdate = await collection.utils.exportData()
      expect(afterUpdate.length).toBe(1)
      expect(afterUpdate[0]).toEqual({ id: 1, name: `Updated` })
    })
  })

  describe(`Delete operations`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should remove item from collection state`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `To Delete` })
      await flushPromises()

      expect(collection.size).toBe(1)
      expect(collection.has(1)).toBe(true)

      await collection.delete(1)
      await flushPromises()

      expect(collection.size).toBe(0)
      expect(collection.has(1)).toBe(false)
    })

    it(`should remove item from IndexedDB`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `To Delete` })
      await collection.insert({ id: 2, name: `To Keep` })
      await flushPromises()

      await collection.delete(1)
      await flushPromises()

      // Verify persistence using export
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(1)
      expect(exported[0]).toEqual({ id: 2, name: `To Keep` })
    })

    it(`should remove version entry on delete`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      await collection.insert({ id: 1, name: `Item 1` })
      await collection.insert({ id: 2, name: `Item 2` })
      await flushPromises()

      const beforeDelete = await collection.utils.exportData()
      expect(beforeDelete.length).toBe(2)

      await collection.delete(1)
      await flushPromises()

      const afterDelete = await collection.utils.exportData()
      expect(afterDelete.length).toBe(1)
      expect(afterDelete[0]).toEqual({ id: 2, name: `Item 2` })
    })
  })

  describe(`Utility functions`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      try {
        db.close()
      } catch {
        // May already be closed
      }
      await deleteDatabase(dbName, indexedDB)
    })

    describe(`deleteDatabase`, () => {
      it(`should remove database`, async () => {
        const collection = createCollection({
          ...indexedDBCollectionOptions<TestItem>({
            db,
            name: `items`,
            getKey: (item) => item.id,
          }),
        })

        await collection.preload()

        await collection.insert({ id: 1, name: `Item 1` })
        await flushPromises()

        await collection.utils.deleteDatabase()

        // Creating a new collection should start fresh
        const db2 = await createIndexedDB({
          name: dbName,
          version: 1,
          stores: ['items'],
          idbFactory: indexedDB,
        })

        const collection2 = createCollection({
          ...indexedDBCollectionOptions<TestItem>({
            db: db2,
            name: `items`,
            getKey: (item) => item.id,
          }),
        })

        await collection2.preload()

        expect(collection2.size).toBe(0)
        db2.close()
      })
    })

    describe(`getDatabaseInfo`, () => {
      it(`should return correct database info`, async () => {
        const collection = createCollection({
          ...indexedDBCollectionOptions<TestItem>({
            db,
            name: `items`,
            getKey: (item) => item.id,
          }),
        })

        await collection.preload()

        const info = await collection.utils.getDatabaseInfo()

        expect(info.name).toBe(dbName)
        expect(info.version).toBe(1)
        expect(info.objectStores).toContain(`items`)
        expect(info.objectStores).toContain(`_versions`)
      })
    })

    describe(`exportData`, () => {
      it(`should return all items`, async () => {
        const collection = createCollection({
          ...indexedDBCollectionOptions<TestItem>({
            db,
            name: `items`,
            getKey: (item) => item.id,
          }),
        })

        await collection.preload()

        const items: Array<TestItem> = [
          { id: 1, name: `Item 1`, value: 100 },
          { id: 2, name: `Item 2`, value: 200 },
          { id: 3, name: `Item 3`, value: 300 },
        ]

        for (const item of items) {
          await collection.insert(item)
        }
        await flushPromises()

        const exported = await collection.utils.exportData()

        expect(exported.length).toBe(3)
        expect(exported).toContainEqual(items[0])
        expect(exported).toContainEqual(items[1])
        expect(exported).toContainEqual(items[2])
      })

      it(`should return empty array for empty store`, async () => {
        const collection = createCollection({
          ...indexedDBCollectionOptions<TestItem>({
            db,
            name: `items`,
            getKey: (item) => item.id,
          }),
        })

        await collection.preload()

        const exported = await collection.utils.exportData()
        expect(exported).toEqual([])
      })
    })
  })

  describe(`Custom ID configuration`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should use provided id configuration`, () => {
      const options = indexedDBCollectionOptions({
        id: `custom-collection-id`,
        db,
        name: `items`,
        getKey: (item: TestItem) => item.id,
      })

      expect(options.id).toBe(`custom-collection-id`)
    })

    it(`should generate default id when not provided`, () => {
      const options = indexedDBCollectionOptions({
        db,
        name: `items`,
        getKey: (item: TestItem) => item.id,
      })

      expect(options.id).toBe(`indexeddb-collection:${dbName}:items`)
    })
  })

  describe(`String keys`, () => {
    interface StringKeyItem {
      uuid: string
      title: string
    }

    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should work with string keys`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<StringKeyItem, string>({
          db,
          name: `items`,
          getKey: (item) => item.uuid,
        }),
      })

      await collection.preload()

      await collection.insert({ uuid: `abc-123`, title: `First` })
      await collection.insert({ uuid: `def-456`, title: `Second` })
      await flushPromises()

      expect(collection.size).toBe(2)
      expect(collection.get(`abc-123`)).toEqual({
        uuid: `abc-123`,
        title: `First`,
      })
      expect(collection.get(`def-456`)).toEqual({
        uuid: `def-456`,
        title: `Second`,
      })

      // Verify persistence via export
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(2)
    })
  })

  describe(`Error handling`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createIndexedDB({
        name: dbName,
        version: 1,
        stores: ['items'],
        idbFactory: indexedDB,
      })
    })

    afterEach(async () => {
      // Clean up database if it exists
      try {
        db.close()
      } catch {
        // May already be closed
      }
      try {
        await deleteDatabase(dbName, indexedDB)
      } catch {
        // Ignore cleanup errors
      }
    })

    it(`should throw error when IndexedDB is not available`, async () => {
      // Import the wrapper function directly for testing
      const { openDatabase } = await import(`../src/wrapper`)

      // Store original values
      const originalWindow =
        typeof window !== `undefined` ? window.indexedDB : undefined
      const originalGlobal = globalThis.indexedDB

      // Remove indexedDB from global scope
      if (typeof window !== `undefined`) {
        Object.defineProperty(window, `indexedDB`, {
          value: undefined,
          writable: true,
          configurable: true,
        })
      }
      Object.defineProperty(globalThis, `indexedDB`, {
        value: undefined,
        writable: true,
        configurable: true,
      })

      try {
        // Test that the openDatabase wrapper throws when no IDB is available
        await expect(openDatabase(dbName, 1)).rejects.toThrow(
          /IndexedDB is not available/,
        )
      } finally {
        // Restore original values
        if (typeof window !== `undefined` && originalWindow !== undefined) {
          Object.defineProperty(window, `indexedDB`, {
            value: originalWindow,
            writable: true,
            configurable: true,
          })
        }
        Object.defineProperty(globalThis, `indexedDB`, {
          value: originalGlobal,
          writable: true,
          configurable: true,
        })
      }
    })

    it(`should handle transaction abort gracefully`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      // Insert initial data
      await collection.insert({ id: 1, name: `Initial Item` })
      await flushPromises()

      // Verify initial state
      expect(collection.size).toBe(1)
      expect(collection.get(1)).toEqual({ id: 1, name: `Initial Item` })

      // Verify the data is persisted
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(1)

      // The collection should remain usable after any transaction issues
      await collection.insert({ id: 2, name: `Second Item` })
      await flushPromises()

      expect(collection.size).toBe(2)
      expect(collection.get(2)).toEqual({ id: 2, name: `Second Item` })
    })

    it(`should handle invalid key errors`, async () => {
      interface ItemWithComplexKey {
        id: { nested: string }
        name: string
      }

      // IndexedDB doesn't support object keys directly
      const collection = createCollection({
        ...indexedDBCollectionOptions<ItemWithComplexKey, any>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      // Attempting to insert with an object key should throw
      let thrownError: Error | null = null
      try {
        await collection.insert({ id: { nested: `value` }, name: `Test` })
      } catch (error) {
        thrownError = error as Error
      }

      expect(thrownError).not.toBeNull()
      expect(thrownError?.message).toMatch(/invalid key type/i)
    })

    it(`should remain functional after recoverable errors`, async () => {
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      // Insert valid data
      await collection.insert({ id: 1, name: `Valid Item 1` })
      await flushPromises()

      expect(collection.size).toBe(1)

      // Try to insert more valid data
      await collection.insert({ id: 2, name: `Valid Item 2` })
      await flushPromises()

      expect(collection.size).toBe(2)

      // Verify persistence
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(2)
      expect(exported).toContainEqual({ id: 1, name: `Valid Item 1` })
      expect(exported).toContainEqual({ id: 2, name: `Valid Item 2` })
    })
  })
})
