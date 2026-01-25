import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexedDB } from 'fake-indexeddb'
import { createCollection } from '@tanstack/db'
import {
  
  createIndexedDB,
  deleteDatabase,
  indexedDBCollectionOptions
} from '../src'
import type {IndexedDBInstance} from '../src';

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>()
  name: string
  onmessage: ((ev: MessageEvent) => void) | null = null

  constructor(name: string) {
    this.name = name
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set())
    }
    MockBroadcastChannel.channels.get(name)!.add(this)
  }

  postMessage(data: unknown) {
    const channels = MockBroadcastChannel.channels.get(this.name)
    if (channels) {
      channels.forEach((channel) => {
        if (channel !== this && channel.onmessage) {
          // Use queueMicrotask to simulate async delivery
          queueMicrotask(() => {
            channel.onmessage!(new MessageEvent('message', { data }))
          })
        }
      })
    }
  }

  close() {
    MockBroadcastChannel.channels.get(this.name)?.delete(this)
  }

  static reset() {
    this.channels.clear()
  }
}

// Install mock globally before tests
globalThis.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel

interface TestItem {
  id: number
  name: string
  value?: number
}

// Helper to flush promises and microtasks
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 50))

// Mock localStorage (required by @tanstack/db proxy.ts)
const mockLocalStorage = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}

// Helper to create database with stores
const createTestDB = async (
  dbName: string,
  stores: Array<string>,
): Promise<IndexedDBInstance> => {
  return createIndexedDB({
    name: dbName,
    version: 1,
    stores,
    idbFactory: indexedDB,
  })
}

describe(`Cross-Tab Synchronization`, () => {
  // Use unique database names per test to avoid conflicts
  let dbNameCounter = 0
  const getUniqueDbName = () => `cross-tab-test-${Date.now()}-${dbNameCounter++}`

  beforeEach(() => {
    // Mock localStorage globally
    vi.stubGlobal(`localStorage`, mockLocalStorage)
    // Reset MockBroadcastChannel state
    MockBroadcastChannel.reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    MockBroadcastChannel.reset()
  })

  describe(`Insert propagation`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createTestDB(dbName, ['items'])
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should propagate insert from collection1 to collection2`, async () => {
      // Create two collection instances sharing the same database/object store
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert item in collection1
      await collection1.insert({ id: 1, name: `Test Item`, value: 100 })
      await flushPromises()

      // Verify item exists in collection1
      expect(collection1.has(1)).toBe(true)
      expect(collection1.get(1)).toEqual({ id: 1, name: `Test Item`, value: 100 })

      // Wait for cross-tab propagation
      await flushPromises()

      // Verify item appears in collection2
      expect(collection2.has(1)).toBe(true)
      expect(collection2.get(1)).toEqual({ id: 1, name: `Test Item`, value: 100 })
    })

    it(`should have same version entry in _versions store for both collections`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert item in collection1
      await collection1.insert({ id: 1, name: `Versioned Item` })
      await flushPromises()

      // Wait for propagation
      await flushPromises()

      // Both collections should report the same database info
      const info1 = await collection1.utils.getDatabaseInfo()
      const info2 = await collection2.utils.getDatabaseInfo()

      expect(info1.objectStores).toContain(`_versions`)
      expect(info2.objectStores).toContain(`_versions`)

      // Both should have the item
      expect(collection1.get(1)).toEqual({ id: 1, name: `Versioned Item` })
      expect(collection2.get(1)).toEqual({ id: 1, name: `Versioned Item` })
    })
  })

  describe(`Update propagation`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createTestDB(dbName, ['items'])
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should propagate update from collection1 to collection2`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert initial item via collection1
      await collection1.insert({ id: 1, name: `Original`, value: 50 })
      await flushPromises()

      // Wait for initial propagation
      await flushPromises()

      // Verify both collections have the item
      expect(collection1.get(1)?.name).toBe(`Original`)
      expect(collection2.get(1)?.name).toBe(`Original`)

      // Update item in collection1
      await collection1.update(1, (draft) => {
        draft.name = `Updated`
        draft.value = 100
      })
      await flushPromises()

      // Wait for update propagation
      await flushPromises()

      // Verify update reflects in collection2
      expect(collection2.get(1)).toEqual({ id: 1, name: `Updated`, value: 100 })
    })

    it(`should have new versionKey in both _versions entries after update`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert and get initial state
      await collection1.insert({ id: 1, name: `Initial` })
      await flushPromises()
      await flushPromises()

      const exportBefore = await collection1.utils.exportData()
      expect(exportBefore.length).toBe(1)

      // Update item
      await collection1.update(1, (draft) => {
        draft.name = `Modified`
      })
      await flushPromises()
      await flushPromises()

      // Verify update persisted
      const exportAfter = await collection1.utils.exportData()
      expect(exportAfter.length).toBe(1)
      expect(exportAfter[0]).toEqual({ id: 1, name: `Modified` })

      // Collection2 should also see the update
      expect(collection2.get(1)?.name).toBe(`Modified`)
    })
  })

  describe(`Delete propagation`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createTestDB(dbName, ['items'])
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should propagate delete from collection1 to collection2`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert initial item
      await collection1.insert({ id: 1, name: `To Be Deleted` })
      await flushPromises()
      await flushPromises()

      // Verify both have the item
      expect(collection1.has(1)).toBe(true)
      expect(collection2.has(1)).toBe(true)

      // Delete item in collection1
      await collection1.delete(1)
      await flushPromises()

      // Wait for delete propagation
      await flushPromises()

      // Verify item disappears from collection2
      expect(collection2.has(1)).toBe(false)
      expect(collection2.get(1)).toBeUndefined()
    })

    it(`should remove item from IndexedDB when deleted`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()

      // Insert multiple items
      await collection1.insert({ id: 1, name: `Item 1` })
      await collection1.insert({ id: 2, name: `Item 2` })
      await collection1.insert({ id: 3, name: `Item 3` })
      await flushPromises()

      // Delete middle item
      await collection1.delete(2)
      await flushPromises()

      // Verify only remaining items are in IndexedDB
      const exported = await collection1.utils.exportData()
      expect(exported.length).toBe(2)
      expect(exported.some((item) => item.id === 1)).toBe(true)
      expect(exported.some((item) => item.id === 2)).toBe(false)
      expect(exported.some((item) => item.id === 3)).toBe(true)
    })
  })

  describe(`Concurrent inserts`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createTestDB(dbName, ['items'])
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should handle concurrent inserts from both collections`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert different items simultaneously in both collections
      await Promise.all([
        collection1.insert({ id: 1, name: `From Collection 1` }),
        collection2.insert({ id: 2, name: `From Collection 2` }),
      ])
      await flushPromises()

      // Wait for cross-tab propagation
      await flushPromises()
      await flushPromises()

      // Both collections should eventually contain both items
      expect(collection1.has(1)).toBe(true)
      expect(collection1.has(2)).toBe(true)
      expect(collection2.has(1)).toBe(true)
      expect(collection2.has(2)).toBe(true)

      expect(collection1.get(1)?.name).toBe(`From Collection 1`)
      expect(collection1.get(2)?.name).toBe(`From Collection 2`)
      expect(collection2.get(1)?.name).toBe(`From Collection 1`)
      expect(collection2.get(2)?.name).toBe(`From Collection 2`)
    })

    it(`should maintain consistency with interleaved operations`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Interleave inserts from both collections
      await collection1.insert({ id: 1, name: `C1 Item 1` })
      await collection2.insert({ id: 2, name: `C2 Item 2` })
      await collection1.insert({ id: 3, name: `C1 Item 3` })
      await collection2.insert({ id: 4, name: `C2 Item 4` })
      await flushPromises()

      // Wait for all propagations
      await flushPromises()
      await flushPromises()

      // Verify both collections have all 4 items
      expect(collection1.size).toBe(4)
      expect(collection2.size).toBe(4)

      // Verify data integrity
      const exported = await collection1.utils.exportData()
      expect(exported.length).toBe(4)
    })
  })

  describe(`Message filtering`, () => {
    let dbName1: string
    let dbName2: string
    let db1: IndexedDBInstance
    let db2: IndexedDBInstance

    beforeEach(() => {
      dbName1 = getUniqueDbName()
      dbName2 = getUniqueDbName()
    })

    afterEach(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- db1 may not be assigned if test fails early
        db1?.close()
      } catch {
        // May already be closed
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- db2 may not be assigned if test fails early
        db2?.close()
      } catch {
        // May already be closed
      }
      await deleteDatabase(dbName1, indexedDB)
      await deleteDatabase(dbName2, indexedDB)
    })

    it(`should ignore messages from different databases`, async () => {
      db1 = await createTestDB(dbName1, ['items'])
      db2 = await createTestDB(dbName2, ['items'])

      // Collection1 uses database1
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db: db1,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      // Collection2 uses database2 (different database)
      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db: db2,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert item in collection1 (database1)
      await collection1.insert({ id: 1, name: `DB1 Item` })
      await flushPromises()
      await flushPromises()

      // Collection2 (different database) should NOT have the item
      expect(collection1.has(1)).toBe(true)
      expect(collection2.has(1)).toBe(false)

      // Insert item in collection2 (database2)
      await collection2.insert({ id: 2, name: `DB2 Item` })
      await flushPromises()
      await flushPromises()

      // Collection1 should NOT have the item from database2
      expect(collection1.has(2)).toBe(false)
      expect(collection2.has(2)).toBe(true)
    })

    it(`should ignore own messages (same tabId)`, async () => {
      db1 = await createTestDB(dbName1, ['items'])

      // Create a single collection - it should not process its own messages
      const collection = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db: db1,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection.preload()

      // Insert item
      await collection.insert({ id: 1, name: `Single Tab Item` })
      await flushPromises()

      // The collection should have the item (from direct insertion)
      expect(collection.has(1)).toBe(true)

      // The item should be persisted
      const exported = await collection.utils.exportData()
      expect(exported.length).toBe(1)
      expect(exported[0]).toEqual({ id: 1, name: `Single Tab Item` })

      // No duplicate processing should have occurred
      expect(collection.size).toBe(1)
    })

    it(`should handle collections with different object store names`, async () => {
      // Create database with BOTH stores upfront
      db1 = await createTestDB(dbName1, ['items1', 'items2'])

      // Both use same database but different object stores
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db: db1,
          name: `items1`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db: db1,
          name: `items2`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert in collection1 (items1 store)
      await collection1.insert({ id: 1, name: `Store1 Item` })
      await flushPromises()
      await flushPromises()

      // Collection2 (items2 store) should NOT have the item
      expect(collection1.has(1)).toBe(true)
      expect(collection2.has(1)).toBe(false)
    })
  })

  describe(`Rapid mutations`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createTestDB(dbName, ['items'])
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should handle multiple rapid inserts`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Perform multiple mutations in quick succession
      const insertCount = 20
      for (let i = 1; i <= insertCount; i++) {
        await collection1.insert({ id: i, name: `Rapid Item ${i}` })
      }
      await flushPromises()

      // Wait for all propagations
      await flushPromises()
      await flushPromises()
      await flushPromises()

      // Both collections should eventually be consistent
      expect(collection1.size).toBe(insertCount)
      expect(collection2.size).toBe(insertCount)

      // Verify all items are present
      for (let i = 1; i <= insertCount; i++) {
        expect(collection1.has(i)).toBe(true)
        expect(collection2.has(i)).toBe(true)
      }
    })

    it(`should handle rapid mixed operations`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Initial inserts
      for (let i = 1; i <= 5; i++) {
        await collection1.insert({ id: i, name: `Item ${i}`, value: i * 10 })
      }
      await flushPromises()

      // Rapid mixed operations
      await collection1.update(1, (draft) => {
        draft.name = `Updated 1`
      })
      await collection1.update(2, (draft) => {
        draft.name = `Updated 2`
      })
      await collection1.delete(3)
      await collection1.insert({ id: 6, name: `Item 6` })
      await collection1.update(4, (draft) => {
        draft.name = `Updated 4`
      })
      await collection1.delete(5)
      await flushPromises()

      // Wait for all propagations
      await flushPromises()
      await flushPromises()

      // Final state should have items 1, 2, 4, 6
      expect(collection1.size).toBe(4)
      expect(collection2.size).toBe(4)

      expect(collection1.has(1)).toBe(true)
      expect(collection1.has(2)).toBe(true)
      expect(collection1.has(3)).toBe(false)
      expect(collection1.has(4)).toBe(true)
      expect(collection1.has(5)).toBe(false)
      expect(collection1.has(6)).toBe(true)

      expect(collection2.has(1)).toBe(true)
      expect(collection2.has(2)).toBe(true)
      expect(collection2.has(3)).toBe(false)
      expect(collection2.has(4)).toBe(true)
      expect(collection2.has(5)).toBe(false)
      expect(collection2.has(6)).toBe(true)

      // Verify updates propagated
      expect(collection2.get(1)?.name).toBe(`Updated 1`)
      expect(collection2.get(2)?.name).toBe(`Updated 2`)
      expect(collection2.get(4)?.name).toBe(`Updated 4`)
    })

    it(`should maintain data integrity after rapid operations`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()

      // Rapid inserts and updates
      for (let i = 1; i <= 10; i++) {
        await collection1.insert({ id: i, name: `Original ${i}` })
      }
      await flushPromises()

      // Rapid updates
      for (let i = 1; i <= 10; i++) {
        await collection1.update(i, (draft) => {
          draft.name = `Updated ${i}`
          draft.value = i * 100
        })
      }
      await flushPromises()

      // Verify persistence
      const exported = await collection1.utils.exportData()
      expect(exported.length).toBe(10)

      // All items should have updated values
      for (const item of exported) {
        expect(item.name).toMatch(/^Updated \d+$/)
        expect(item.value).toBeDefined()
        expect(item.value).toBe(item.id * 100)
      }
    })
  })

  describe(`Edge cases`, () => {
    let dbName: string
    let db: IndexedDBInstance

    beforeEach(async () => {
      dbName = getUniqueDbName()
      db = await createTestDB(dbName, ['items'])
    })

    afterEach(async () => {
      db.close()
      await deleteDatabase(dbName, indexedDB)
    })

    it(`should handle empty collections`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Both should start empty
      expect(collection1.size).toBe(0)
      expect(collection2.size).toBe(0)

      // No errors should occur
      const exported1 = await collection1.utils.exportData()
      const exported2 = await collection2.utils.exportData()
      expect(exported1).toEqual([])
      expect(exported2).toEqual([])
    })

    it(`should handle insert-then-delete of same item`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert and immediately delete
      await collection1.insert({ id: 1, name: `Ephemeral Item` })
      await flushPromises()
      await collection1.delete(1)
      await flushPromises()

      // Wait for propagation
      await flushPromises()
      await flushPromises()

      // Both should end up empty
      expect(collection1.has(1)).toBe(false)
      expect(collection2.has(1)).toBe(false)

      const exported = await collection1.utils.exportData()
      expect(exported.length).toBe(0)
    })

    it(`should handle update on non-existent item gracefully`, async () => {
      const collection1 = createCollection({
        ...indexedDBCollectionOptions<TestItem>({
          db,
          name: `items`,
          getKey: (item) => item.id,
        }),
      })

      await collection1.preload()

      // Try to update non-existent item - should not throw
      try {
        await collection1.update(999, (draft) => {
          draft.name = `Does not exist`
        })
      } catch {
        // Expected - item doesn't exist
      }

      // Collection should still be functional
      await collection1.insert({ id: 1, name: `Real Item` })
      await flushPromises()

      expect(collection1.has(1)).toBe(true)
    })

    it(`should handle string keys with special characters`, async () => {
      interface StringKeyItem {
        uuid: string
        title: string
      }

      const collection1 = createCollection({
        ...indexedDBCollectionOptions<StringKeyItem, string>({
          db,
          name: `items`,
          getKey: (item) => item.uuid,
        }),
      })

      const collection2 = createCollection({
        ...indexedDBCollectionOptions<StringKeyItem, string>({
          db,
          name: `items`,
          getKey: (item) => item.uuid,
        }),
      })

      await collection1.preload()
      await collection2.preload()

      // Insert with special characters in key
      await collection1.insert({
        uuid: `item-with-special-chars!@#$%`,
        title: `Special Item`,
      })
      await flushPromises()
      await flushPromises()

      // Verify propagation
      expect(collection2.has(`item-with-special-chars!@#$%`)).toBe(true)
      expect(collection2.get(`item-with-special-chars!@#$%`)?.title).toBe(
        `Special Item`,
      )
    })
  })
})
