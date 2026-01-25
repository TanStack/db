import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexedDB } from 'fake-indexeddb'
import {
  clear,
  createObjectStore,
  deleteByKey,
  deleteDatabase,
  executeTransaction,
  getAll,
  getAllKeys,
  getByKey,
  openDatabase,
  put,
} from '../src/wrapper.js'

interface TestItem {
  id: string
  name: string
  value?: number
}

describe(`IndexedDB Wrapper`, () => {
  const testDbName = `test-db`
  let db: IDBDatabase | null = null

  afterEach(async () => {
    // Close database connection if open
    if (db) {
      db.close()
      db = null
    }
    // Clean up test database
    await deleteDatabase(testDbName, indexedDB)
  })

  // Helper to get a store from the stores record (handles the index signature type)
  function getStore(
    stores: Record<string, IDBObjectStore>,
    name: string,
  ): IDBObjectStore {
    const store = stores[name]
    if (!store) {
      throw new Error(`Store ${name} not found`)
    }
    return store
  }

  describe(`openDatabase`, () => {
    it(`should successfully open a database`, async () => {
      db = await openDatabase(testDbName, 1, undefined, indexedDB)

      expect(db).toBeDefined()
      expect(db.name).toBe(testDbName)
      expect(db.version).toBe(1)
    })

    it(`should call upgrade callback with correct parameters`, async () => {
      const upgradeFn = vi.fn()

      db = await openDatabase(
        testDbName,
        1,
        (database, oldVersion, newVersion, transaction) => {
          upgradeFn(database, oldVersion, newVersion, transaction)
        },
        indexedDB,
      )

      expect(upgradeFn).toHaveBeenCalledTimes(1)
      expect(upgradeFn).toHaveBeenCalledWith(
        expect.objectContaining({ name: testDbName }),
        0, // oldVersion for new database
        1, // newVersion
        expect.objectContaining({ mode: `versionchange` }),
      )
    })

    it(`should handle version upgrades correctly`, async () => {
      // First, create version 1
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          database.createObjectStore(`store1`, { keyPath: `id` })
        },
        indexedDB,
      )
      db.close()
      db = null

      // Now upgrade to version 2
      const upgradeFn = vi.fn()
      db = await openDatabase(
        testDbName,
        2,
        (database, oldVersion, newVersion, _transaction) => {
          upgradeFn(oldVersion, newVersion)
          if (oldVersion < 2) {
            database.createObjectStore(`store2`, { keyPath: `id` })
          }
        },
        indexedDB,
      )

      expect(upgradeFn).toHaveBeenCalledWith(1, 2)
      expect(db.objectStoreNames.contains(`store1`)).toBe(true)
      expect(db.objectStoreNames.contains(`store2`)).toBe(true)
    })

    it(`should reject when upgrade callback throws an error`, async () => {
      await expect(
        openDatabase(
          testDbName,
          1,
          () => {
            throw new Error(`Upgrade failed intentionally`)
          },
          indexedDB,
        ),
      ).rejects.toThrow(`Database upgrade failed`)
    })
  })

  describe(`createObjectStore`, () => {
    it(`should create object store during upgrade`, async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `testStore`)
        },
        indexedDB,
      )

      expect(db.objectStoreNames.contains(`testStore`)).toBe(true)
    })

    it(`should create object store with keyPath`, async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `testStore`, { keyPath: `id` })
        },
        indexedDB,
      )

      const tx = db.transaction(`testStore`, `readonly`)
      const store = tx.objectStore(`testStore`)
      expect(store.keyPath).toBe(`id`)
    })

    it(`should create object store with autoIncrement`, async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `testStore`, { autoIncrement: true })
        },
        indexedDB,
      )

      const tx = db.transaction(`testStore`, `readonly`)
      const store = tx.objectStore(`testStore`)
      expect(store.autoIncrement).toBe(true)
    })

    it(`should create object store with both keyPath and autoIncrement`, async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `testStore`, {
            keyPath: `id`,
            autoIncrement: true,
          })
        },
        indexedDB,
      )

      const tx = db.transaction(`testStore`, `readonly`)
      const store = tx.objectStore(`testStore`)
      expect(store.keyPath).toBe(`id`)
      expect(store.autoIncrement).toBe(true)
    })

    it(`should throw when creating duplicate object store`, async () => {
      await expect(
        openDatabase(
          testDbName,
          1,
          (database) => {
            createObjectStore(database, `testStore`)
            createObjectStore(database, `testStore`) // Duplicate
          },
          indexedDB,
        ),
      ).rejects.toThrow(`already exists`)
    })
  })

  describe(`executeTransaction`, () => {
    beforeEach(async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
          createObjectStore(database, `users`, { keyPath: `id` })
        },
        indexedDB,
      )
    })

    it(`should execute read transaction`, async () => {
      // First add some data
      const tx = db!.transaction(`items`, `readwrite`)
      const store = tx.objectStore(`items`)
      store.put({ id: `1`, name: `test` })
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onerror = reject
      })

      // Now read via executeTransaction
      const result = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (transaction, stores) => {
          return new Promise((resolve) => {
            const request = getStore(stores, `items`).get(`1`)
            request.onsuccess = () => resolve(request.result)
          })
        },
      )

      expect(result).toEqual({ id: `1`, name: `test` })
    })

    it(`should execute write transaction`, async () => {
      const result = await executeTransaction(
        db!,
        `items`,
        `readwrite`,
        async (transaction, stores) => {
          return new Promise((resolve) => {
            const request = getStore(stores, `items`).put({
              id: `1`,
              name: `test`,
            })
            request.onsuccess = () => resolve(`done`)
          })
        },
      )

      expect(result).toBe(`done`)

      // Verify the data was written
      const readResult = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (transaction, stores) => {
          return new Promise((resolve) => {
            const request = getStore(stores, `items`).get(`1`)
            request.onsuccess = () => resolve(request.result)
          })
        },
      )

      expect(readResult).toEqual({ id: `1`, name: `test` })
    })

    it(`should provide correct stores to callback`, async () => {
      const storeNames: Array<string> = []

      await executeTransaction(
        db!,
        [`items`, `users`],
        `readonly`,
        (transaction, stores) => {
          storeNames.push(...Object.keys(stores))
        },
      )

      expect(storeNames).toContain(`items`)
      expect(storeNames).toContain(`users`)
      expect(storeNames.length).toBe(2)
    })

    it(`should auto-complete transaction after sync callback`, async () => {
      // The executeTransaction promise should resolve after
      // the transaction completes, not just when the callback returns
      await executeTransaction(
        db!,
        `items`,
        `readwrite`,
        (transaction, stores) => {
          getStore(stores, `items`).put({ id: `1`, name: `test` })
        },
      )

      // Verify data was persisted - if transaction completed, data should be there
      const item = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getByKey<TestItem>(getStore(stores, `items`), `1`)
        },
      )

      expect(item).toEqual({ id: `1`, name: `test` })
    })

    it(`should reject when accessing non-existent store`, async () => {
      await expect(
        executeTransaction(db!, `nonExistent`, `readonly`, () => {}),
      ).rejects.toThrow(`nonExistent`)
    })

    it(`should handle sync callbacks`, async () => {
      const result = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        (_transaction, _stores) => {
          return `sync result`
        },
      )

      expect(result).toBe(`sync result`)
    })

    it(`should handle async callbacks that don't use await`, async () => {
      // The wrapper resolves when transaction completes
      // For async callbacks that return immediately without awaiting
      // the transaction may complete before the async return
      const result = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        () => {
          return Promise.resolve(`async result`)
        },
      )

      expect(result).toBe(`async result`)
    })

    it(`should abort transaction when callback throws synchronously`, async () => {
      await expect(
        executeTransaction(db!, `items`, `readonly`, () => {
          throw new Error(`Sync error`)
        }),
      ).rejects.toThrow()
    })

    it(`should abort transaction when callback rejects asynchronously`, async () => {
      await expect(
        executeTransaction(db!, `items`, `readonly`, () => {
          return Promise.reject(new Error(`Async error`))
        }),
      ).rejects.toThrow()
    })
  })

  describe(`getAll`, () => {
    beforeEach(async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
        },
        indexedDB,
      )
    })

    it(`should return all items from store`, async () => {
      // Add test data
      await executeTransaction(
        db!,
        `items`,
        `readwrite`,
        async (tx, stores) => {
          const itemsStore = getStore(stores, `items`)
          await put<TestItem>(itemsStore, { id: `1`, name: `Item 1` })
          await put<TestItem>(itemsStore, { id: `2`, name: `Item 2` })
          await put<TestItem>(itemsStore, { id: `3`, name: `Item 3` })
        },
      )

      // Get all items
      const items = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getAll<TestItem>(getStore(stores, `items`))
        },
      )

      expect(items).toHaveLength(3)
      expect(items).toContainEqual({ id: `1`, name: `Item 1` })
      expect(items).toContainEqual({ id: `2`, name: `Item 2` })
      expect(items).toContainEqual({ id: `3`, name: `Item 3` })
    })

    it(`should return empty array for empty store`, async () => {
      const items = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getAll<TestItem>(getStore(stores, `items`))
        },
      )

      expect(items).toEqual([])
    })
  })

  describe(`getAllKeys`, () => {
    beforeEach(async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
        },
        indexedDB,
      )
    })

    it(`should return all keys from store`, async () => {
      // Add test data
      await executeTransaction(
        db!,
        `items`,
        `readwrite`,
        async (tx, stores) => {
          const itemsStore = getStore(stores, `items`)
          await put<TestItem>(itemsStore, { id: `a`, name: `Item A` })
          await put<TestItem>(itemsStore, { id: `b`, name: `Item B` })
          await put<TestItem>(itemsStore, { id: `c`, name: `Item C` })
        },
      )

      // Get all keys
      const keys = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getAllKeys(getStore(stores, `items`))
        },
      )

      expect(keys).toHaveLength(3)
      expect(keys).toContain(`a`)
      expect(keys).toContain(`b`)
      expect(keys).toContain(`c`)
    })

    it(`should return empty array for empty store`, async () => {
      const keys = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getAllKeys(getStore(stores, `items`))
        },
      )

      expect(keys).toEqual([])
    })
  })

  describe(`getByKey`, () => {
    beforeEach(async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
        },
        indexedDB,
      )
    })

    it(`should return item by key`, async () => {
      // Add test data
      await executeTransaction(
        db!,
        `items`,
        `readwrite`,
        async (tx, stores) => {
          await put<TestItem>(getStore(stores, `items`), {
            id: `test-id`,
            name: `Test Item`,
            value: 42,
          })
        },
      )

      // Get by key
      const item = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getByKey<TestItem>(getStore(stores, `items`), `test-id`)
        },
      )

      expect(item).toEqual({ id: `test-id`, name: `Test Item`, value: 42 })
    })

    it(`should return undefined for non-existent key`, async () => {
      const item = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getByKey<TestItem>(getStore(stores, `items`), `non-existent`)
        },
      )

      expect(item).toBeUndefined()
    })
  })

  describe(`put`, () => {
    beforeEach(async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
          createObjectStore(database, `noKeyPath`)
        },
        indexedDB,
      )
    })

    it(`should insert new item`, async () => {
      const key = await executeTransaction(
        db!,
        `items`,
        `readwrite`,
        async (tx, stores) => {
          return put<TestItem>(getStore(stores, `items`), {
            id: `new`,
            name: `New Item`,
          })
        },
      )

      expect(key).toBe(`new`)

      // Verify it was stored
      const item = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getByKey<TestItem>(getStore(stores, `items`), `new`)
        },
      )

      expect(item).toEqual({ id: `new`, name: `New Item` })
    })

    it(`should update existing item`, async () => {
      // Insert initial item
      await executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
        await put<TestItem>(getStore(stores, `items`), {
          id: `update`,
          name: `Original`,
        })
      })

      // Update the item
      await executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
        await put<TestItem>(getStore(stores, `items`), {
          id: `update`,
          name: `Updated`,
        })
      })

      // Verify it was updated
      const item = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getByKey<TestItem>(getStore(stores, `items`), `update`)
        },
      )

      expect(item).toEqual({ id: `update`, name: `Updated` })
    })

    it(`should support explicit key for stores without keyPath`, async () => {
      const key = await executeTransaction(
        db!,
        `noKeyPath`,
        `readwrite`,
        async (tx, stores) => {
          return put(getStore(stores, `noKeyPath`), { name: `Data` }, `explicit-key`)
        },
      )

      expect(key).toBe(`explicit-key`)

      // Verify it was stored with explicit key
      const item = await executeTransaction(
        db!,
        `noKeyPath`,
        `readonly`,
        async (tx, stores) => {
          return getByKey(getStore(stores, `noKeyPath`), `explicit-key`)
        },
      )

      expect(item).toEqual({ name: `Data` })
    })
  })

  describe(`deleteByKey`, () => {
    beforeEach(async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
        },
        indexedDB,
      )
    })

    it(`should delete item by key`, async () => {
      // Add test data
      await executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
        await put<TestItem>(getStore(stores, `items`), {
          id: `delete-me`,
          name: `To Delete`,
        })
      })

      // Verify it exists
      let item = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getByKey<TestItem>(getStore(stores, `items`), `delete-me`)
        },
      )
      expect(item).toBeDefined()

      // Delete it
      await executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
        await deleteByKey(getStore(stores, `items`), `delete-me`)
      })

      // Verify it's gone
      item = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getByKey<TestItem>(getStore(stores, `items`), `delete-me`)
        },
      )
      expect(item).toBeUndefined()
    })

    it(`should succeed when deleting non-existent key`, async () => {
      // Deleting non-existent key should not throw
      await expect(
        executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
          await deleteByKey(getStore(stores, `items`), `non-existent`)
        }),
      ).resolves.not.toThrow()
    })
  })

  describe(`clear`, () => {
    beforeEach(async () => {
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
        },
        indexedDB,
      )
    })

    it(`should remove all items from store`, async () => {
      // Add test data
      await executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
        const itemsStore = getStore(stores, `items`)
        await put<TestItem>(itemsStore, { id: `1`, name: `Item 1` })
        await put<TestItem>(itemsStore, { id: `2`, name: `Item 2` })
        await put<TestItem>(itemsStore, { id: `3`, name: `Item 3` })
      })

      // Verify items exist
      let items = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getAll<TestItem>(getStore(stores, `items`))
        },
      )
      expect(items).toHaveLength(3)

      // Clear the store
      await executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
        await clear(getStore(stores, `items`))
      })

      // Verify all items are gone
      items = await executeTransaction(
        db!,
        `items`,
        `readonly`,
        async (tx, stores) => {
          return getAll<TestItem>(getStore(stores, `items`))
        },
      )
      expect(items).toEqual([])
    })

    it(`should succeed on empty store`, async () => {
      // Clear empty store should not throw
      await expect(
        executeTransaction(db!, `items`, `readwrite`, async (tx, stores) => {
          await clear(getStore(stores, `items`))
        }),
      ).resolves.not.toThrow()
    })
  })

  describe(`deleteDatabase`, () => {
    it(`should delete existing database`, async () => {
      // Create a database
      db = await openDatabase(
        testDbName,
        1,
        (database) => {
          createObjectStore(database, `items`, { keyPath: `id` })
        },
        indexedDB,
      )

      // Close it first
      db.close()
      db = null

      // Delete the database
      await expect(
        deleteDatabase(testDbName, indexedDB),
      ).resolves.not.toThrow()

      // Verify it was deleted by opening fresh (version should be 0 upgrade)
      const upgradeFn = vi.fn()
      db = await openDatabase(
        testDbName,
        1,
        (database, oldVersion) => {
          upgradeFn(oldVersion)
        },
        indexedDB,
      )

      // Old version should be 0 (new database)
      expect(upgradeFn).toHaveBeenCalledWith(0)
    })

    it(`should succeed when deleting non-existent database`, async () => {
      // Deleting non-existent database should succeed silently
      await expect(
        deleteDatabase(`non-existent-db-name`, indexedDB),
      ).resolves.not.toThrow()
    })
  })
})
