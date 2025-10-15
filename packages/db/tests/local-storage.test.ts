import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/index"
import { localStorageCollectionOptions } from "../src/local-storage"
import { createTransaction } from "../src/transactions"
import {
  NoStorageAvailableError,
  NoStorageEventApiError,
  StorageKeyRequiredError,
} from "../src/errors"
import type { StorageEventApi } from "../src/local-storage"

// Mock storage implementation for testing that properly implements Storage interface
class MockStorage implements Storage {
  private store: Record<string, string> = {}

  get length(): number {
    return Object.keys(this.store).length
  }

  getItem(key: string): string | null {
    return this.store[key] || null
  }

  setItem(key: string, value: string): void {
    this.store[key] = value
  }

  removeItem(key: string): void {
    delete this.store[key]
  }

  clear(): void {
    this.store = {}
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store)
    return keys[index] || null
  }
}

// Mock storage event API for testing
class MockStorageEventApi implements StorageEventApi {
  private listeners: Array<(event: StorageEvent) => void> = []

  addEventListener(
    type: `storage`,
    listener: (event: StorageEvent) => void
  ): void {
    this.listeners.push(listener)
  }

  removeEventListener(
    type: `storage`,
    listener: (event: StorageEvent) => void
  ): void {
    const index = this.listeners.indexOf(listener)
    if (index > -1) {
      this.listeners.splice(index, 1)
    }
  }

  // Helper method for tests to trigger storage events
  triggerStorageEvent(event: StorageEvent): void {
    this.listeners.forEach((listener) => listener(event))
  }
}

// Test interface for todo items
interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: Date
}

describe(`localStorage collection`, () => {
  let mockStorage: MockStorage
  let mockStorageEventApi: MockStorageEventApi

  beforeEach(() => {
    mockStorage = new MockStorage()
    mockStorageEventApi = new MockStorageEventApi()
  })

  afterEach(() => {
    mockStorage.clear()
    vi.clearAllMocks()
  })

  describe(`basic functionality`, () => {
    it(`should create a localStorage collection with required config`, () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      expect(collection).toBeDefined()
      expect(collection.utils.clearStorage).toBeDefined()
      expect(collection.utils.getStorageSize).toBeDefined()
    })

    it(`should default id to local-collection:storageKey pattern`, () => {
      const options = localStorageCollectionOptions<Todo>({
        storageKey: `my-todos`,
        storage: mockStorage,
        storageEventApi: mockStorageEventApi,
        getKey: (todo) => todo.id,
      })

      expect(options.id).toBe(`local-collection:my-todos`)
    })

    it(`should use provided id when specified`, () => {
      const options = localStorageCollectionOptions<Todo>({
        storageKey: `my-todos`,
        id: `custom-collection-id`,
        storage: mockStorage,
        storageEventApi: mockStorageEventApi,
        getKey: (todo) => todo.id,
      })

      expect(options.id).toBe(`custom-collection-id`)
    })

    it(`should throw error when storageKey is missing`, () => {
      expect(() =>
        localStorageCollectionOptions({
          storageKey: ``,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (item: any) => item.id,
        })
      ).toThrow(StorageKeyRequiredError)
    })

    it(`should throw error when no storage is available`, () => {
      // Mock window to be undefined globally
      const originalWindow = globalThis.window
      // @ts-ignore - Temporarily delete window to test error condition
      delete globalThis.window

      expect(() =>
        localStorageCollectionOptions({
          storageKey: `test`,
          storageEventApi: mockStorageEventApi,
          getKey: (item: any) => item.id,
        })
      ).toThrow(NoStorageAvailableError)

      // Restore window
      globalThis.window = originalWindow
    })

    it(`should throw error when no storage event API is available`, () => {
      // Mock window to be undefined globally
      const originalWindow = globalThis.window
      // @ts-ignore - Temporarily delete window to test error condition
      delete globalThis.window

      expect(() =>
        localStorageCollectionOptions({
          storageKey: `test`,
          storage: mockStorage,
          getKey: (item: any) => item.id,
        })
      ).toThrow(NoStorageEventApiError)

      // Restore window
      globalThis.window = originalWindow
    })
  })

  describe(`data persistence`, () => {
    it(`should load existing data from storage on initialization`, () => {
      // Pre-populate storage with new versioned format
      const existingTodos = {
        "1": {
          versionKey: `test-version-1`,
          data: {
            id: `1`,
            title: `Existing Todo`,
            completed: false,
            createdAt: new Date(),
          },
        },
      }

      mockStorage.setItem(`todos`, JSON.stringify(existingTodos))

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      // Should load the existing data
      expect(collection.size).toBe(1)
      expect(collection.get(`1`)?.title).toBe(`Existing Todo`)

      subscription.unsubscribe()
    })

    it(`should handle corrupted storage data gracefully`, () => {
      // Set invalid JSON data
      mockStorage.setItem(`todos`, `invalid json data`)

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Should initialize with empty collection
      expect(collection.size).toBe(0)
    })

    it(`should handle empty storage gracefully`, () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Should initialize with empty collection
      expect(collection.size).toBe(0)
    })
  })

  describe(`mutation handlers with storage operations`, () => {
    it(`should persist data even without mutation handlers`, async () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
          // No onInsert, onUpdate, or onDelete handlers provided
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      const todo: Todo = {
        id: `1`,
        title: `Test Todo Without Handlers`,
        completed: false,
        createdAt: new Date(),
      }

      // Insert without handlers should still persist
      const insertTx = collection.insert(todo)
      await insertTx.isPersisted.promise

      // Check that it was saved to storage
      let storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      let parsed = JSON.parse(storedData!)
      expect(parsed[`1`].data.title).toBe(`Test Todo Without Handlers`)

      // Update without handlers should still persist
      const updateTx = collection.update(`1`, (draft) => {
        draft.title = `Updated Without Handlers`
      })
      await updateTx.isPersisted.promise

      // Check that update was saved to storage
      storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      parsed = JSON.parse(storedData!)
      expect(parsed[`1`].data.title).toBe(`Updated Without Handlers`)

      // Delete without handlers should still persist
      const deleteTx = collection.delete(`1`)
      await deleteTx.isPersisted.promise

      // Check that deletion was saved to storage
      storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      parsed = JSON.parse(storedData!)
      expect(parsed[`1`]).toBeUndefined()

      subscription.unsubscribe()
    })

    it(`should call mutation handlers when provided and still persist data`, async () => {
      const insertSpy = vi.fn().mockResolvedValue({ success: true })
      const updateSpy = vi.fn().mockResolvedValue({ success: true })
      const deleteSpy = vi.fn().mockResolvedValue({ success: true })

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
          onInsert: insertSpy,
          onUpdate: updateSpy,
          onDelete: deleteSpy,
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      const todo: Todo = {
        id: `1`,
        title: `Test Todo With Handlers`,
        completed: false,
        createdAt: new Date(),
      }

      // Insert should call handler AND persist
      const insertTx = collection.insert(todo)
      await insertTx.isPersisted.promise

      expect(insertSpy).toHaveBeenCalledOnce()
      let storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      let parsed = JSON.parse(storedData!)
      expect(parsed[`1`].data.title).toBe(`Test Todo With Handlers`)

      // Update should call handler AND persist
      const updateTx = collection.update(`1`, (draft) => {
        draft.title = `Updated With Handlers`
      })
      await updateTx.isPersisted.promise

      expect(updateSpy).toHaveBeenCalledOnce()
      storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      parsed = JSON.parse(storedData!)
      expect(parsed[`1`].data.title).toBe(`Updated With Handlers`)

      // Delete should call handler AND persist
      const deleteTx = collection.delete(`1`)
      await deleteTx.isPersisted.promise

      expect(deleteSpy).toHaveBeenCalledOnce()
      storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      parsed = JSON.parse(storedData!)
      expect(parsed[`1`]).toBeUndefined()

      subscription.unsubscribe()
    })

    it(`should perform insert operations and update storage`, async () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
          onInsert: () => Promise.resolve({ success: true }),
        })
      )

      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      // When a collection has mutation handlers, calling insert() automatically creates
      // a transaction and calls the onInsert handler
      const tx = collection.insert(todo)
      await tx.isPersisted.promise

      // Check that it was saved to storage with version key structure
      const storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()

      const parsed = JSON.parse(storedData!)
      expect(typeof parsed).toBe(`object`)
      expect(parsed[`1`]).toBeDefined()
      expect(parsed[`1`].versionKey).toBeDefined()
      expect(typeof parsed[`1`].versionKey).toBe(`string`)
      expect(parsed[`1`].data.id).toBe(`1`)
      expect(parsed[`1`].data.title).toBe(`Test Todo`)
    })

    it(`should perform update operations and update storage`, async () => {
      // Pre-populate storage
      const initialData = {
        "1": {
          versionKey: `initial-version`,
          data: {
            id: `1`,
            title: `Initial Todo`,
            completed: false,
            createdAt: new Date(),
          },
        },
      }
      mockStorage.setItem(`todos`, JSON.stringify(initialData))

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
          onUpdate: () => Promise.resolve({ success: true }),
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      // Update the todo - this automatically creates a transaction and calls onUpdate
      const tx = collection.update(`1`, (draft) => {
        draft.title = `Updated Todo`
      })
      await tx.isPersisted.promise

      // Check that it was updated in storage with a new version key
      const storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()

      const parsed = JSON.parse(storedData!)
      expect(parsed[`1`].versionKey).not.toBe(`initial-version`) // Should have new version key
      expect(parsed[`1`].data.title).toBe(`Updated Todo`)

      subscription.unsubscribe()
    })

    it(`should perform delete operations and update storage`, async () => {
      // Pre-populate storage
      const initialData = {
        "1": {
          versionKey: `test-version`,
          data: {
            id: `1`,
            title: `To Delete`,
            completed: false,
            createdAt: new Date(),
          },
        },
      }
      mockStorage.setItem(`todos`, JSON.stringify(initialData))

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
          onDelete: () => Promise.resolve({ success: true }),
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      // Delete the todo - this automatically creates a transaction and calls onDelete
      const tx = collection.delete(`1`)
      await tx.isPersisted.promise

      // Check that it was removed from storage
      const storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()

      const parsed = JSON.parse(storedData!)
      expect(parsed[`1`]).toBeUndefined()

      subscription.unsubscribe()
    })
  })

  describe(`cross-tab synchronization`, () => {
    it(`should detect changes from other tabs using version keys`, () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      // Simulate data being added from another tab
      const newTodoData = {
        "1": {
          versionKey: `from-other-tab`,
          data: {
            id: `1`,
            title: `From Another Tab`,
            completed: false,
            createdAt: new Date(),
          },
        },
      }

      // Directly update storage (simulating another tab)
      mockStorage.setItem(`todos`, JSON.stringify(newTodoData))

      // Create a mock storage event (avoiding JSDOM constructor issues)
      const storageEvent = {
        type: `storage`,
        key: `todos`,
        oldValue: null,
        newValue: JSON.stringify(newTodoData),
        url: `http://localhost`,
        storageArea: mockStorage,
      } as unknown as StorageEvent

      // Trigger the storage event
      mockStorageEventApi.triggerStorageEvent(storageEvent)

      // The collection should now have the new todo
      expect(collection.size).toBe(1)
      expect(collection.get(`1`)?.title).toBe(`From Another Tab`)

      subscription.unsubscribe()
    })

    it(`should ignore storage events for different keys`, () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Create a mock storage event for different key
      const storageEvent = {
        type: `storage`,
        key: `other-key`,
        oldValue: null,
        newValue: JSON.stringify({ test: `data` }),
        url: `http://localhost`,
        storageArea: mockStorage,
      } as unknown as StorageEvent

      // Trigger the storage event
      mockStorageEventApi.triggerStorageEvent(storageEvent)

      // Collection should remain empty
      expect(collection.size).toBe(0)
    })

    it(`should ignore storage events from different storage areas`, () => {
      const otherStorage = new MockStorage()

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Create a mock storage event from different storage area
      const storageEvent = {
        type: `storage`,
        key: `todos`,
        oldValue: null,
        newValue: JSON.stringify({ test: `data` }),
        url: `http://localhost`,
        storageArea: otherStorage,
      } as unknown as StorageEvent

      // Trigger the storage event
      mockStorageEventApi.triggerStorageEvent(storageEvent)

      // Collection should remain empty
      expect(collection.size).toBe(0)
    })
  })

  describe(`utility functions`, () => {
    it(`should clear storage`, () => {
      mockStorage.setItem(`todos`, JSON.stringify({ test: `data` }))

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      collection.utils.clearStorage()

      expect(mockStorage.getItem(`todos`)).toBeNull()
    })

    it(`should get storage size`, () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      expect(collection.utils.getStorageSize()).toBe(0)

      mockStorage.setItem(`todos`, JSON.stringify({ test: `data` }))

      const size = collection.utils.getStorageSize()
      expect(size).toBeGreaterThan(0)
    })
  })

  describe(`getSyncMetadata`, () => {
    it(`should return correct metadata`, () => {
      const options = localStorageCollectionOptions<Todo>({
        storageKey: `todos`,
        storage: mockStorage,
        storageEventApi: mockStorageEventApi,
        getKey: (todo) => todo.id,
      })

      const metadata = options.sync.getSyncMetadata?.()

      expect(metadata).toEqual({
        storageKey: `todos`,
        storageType: `custom`,
      })
    })
  })

  describe(`version key change detection`, () => {
    it(`should detect version key changes for updates`, () => {
      // Pre-populate storage
      const initialData = {
        "1": {
          versionKey: `version-1`,
          data: {
            id: `1`,
            title: `Initial`,
            completed: false,
            createdAt: new Date(),
          },
        },
      }
      mockStorage.setItem(`todos`, JSON.stringify(initialData))

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      expect(collection.size).toBe(1)
      expect(collection.get(`1`)?.title).toBe(`Initial`)

      // Simulate change from another tab with different version key but same data
      const updatedData = {
        "1": {
          versionKey: `version-2`, // Different version key
          data: {
            id: `1`,
            title: `Updated`, // Different title
            completed: false,
            createdAt: new Date(),
          },
        },
      }

      mockStorage.setItem(`todos`, JSON.stringify(updatedData))

      // Create a mock storage event
      const storageEvent = {
        type: `storage`,
        key: `todos`,
        oldValue: JSON.stringify(initialData),
        newValue: JSON.stringify(updatedData),
        url: `http://localhost`,
        storageArea: mockStorage,
      } as unknown as StorageEvent

      mockStorageEventApi.triggerStorageEvent(storageEvent)

      // Should detect the change based on version key difference
      expect(collection.size).toBe(1)
      expect(collection.get(`1`)?.title).toBe(`Updated`)

      subscription.unsubscribe()
    })

    it(`should not trigger unnecessary updates for same version key`, () => {
      const changesSpy = vi.fn()

      // Pre-populate storage
      const initialData = {
        "1": {
          versionKey: `version-1`,
          data: {
            id: `1`,
            title: `Same`,
            completed: false,
            createdAt: new Date(),
          },
        },
      }
      mockStorage.setItem(`todos`, JSON.stringify(initialData))

      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Subscribe to changes to monitor
      collection.subscribeChanges(changesSpy)

      // Simulate "change" from another tab with same version key
      const sameData = {
        "1": {
          versionKey: `version-1`, // Same version key
          data: {
            id: `1`,
            title: `Same`,
            completed: false,
            createdAt: new Date(),
          },
        },
      }

      mockStorage.setItem(`todos`, JSON.stringify(sameData))

      // Create a mock storage event
      const storageEvent = {
        type: `storage`,
        key: `todos`,
        oldValue: JSON.stringify(initialData),
        newValue: JSON.stringify(sameData),
        url: `http://localhost`,
        storageArea: mockStorage,
      } as unknown as StorageEvent

      mockStorageEventApi.triggerStorageEvent(storageEvent)

      // Should not trigger any changes since version key is the same
      expect(changesSpy).not.toHaveBeenCalled()
    })
  })

  describe(`Manual transactions with acceptMutations`, () => {
    it(`should accept and persist mutations from manual transactions to storage`, async () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      // Subscribe to trigger sync
      const subscription = collection.subscribeChanges(() => {})

      const tx = createTransaction({
        mutationFn: async ({ transaction }: any) => {
          // Simulate API call success
          await Promise.resolve()
          // Accept mutations for local-storage collection
          collection.utils.acceptMutations(transaction)
        },
        autoCommit: false,
      })

      const todo1: Todo = {
        id: `tx-1`,
        title: `Manual Tx Insert`,
        completed: false,
        createdAt: new Date(),
      }

      const todo2: Todo = {
        id: `tx-2`,
        title: `Manual Tx Insert 2`,
        completed: false,
        createdAt: new Date(),
      }

      // Create mutations in the transaction
      tx.mutate(() => {
        collection.insert(todo1)
        collection.insert(todo2)
      })

      // Items should be in collection optimistically
      expect(collection.has(`tx-1`)).toBe(true)
      expect(collection.has(`tx-2`)).toBe(true)

      await tx.commit()

      // Items should still be in collection after commit
      expect(collection.get(`tx-1`)?.title).toBe(`Manual Tx Insert`)
      expect(collection.get(`tx-2`)?.title).toBe(`Manual Tx Insert 2`)

      // Items should be persisted to storage
      const storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      const parsed = JSON.parse(storedData!)
      expect(parsed[`tx-1`].data.title).toBe(`Manual Tx Insert`)
      expect(parsed[`tx-2`].data.title).toBe(`Manual Tx Insert 2`)

      subscription.unsubscribe()
    })

    it(`should only accept mutations for the specific collection`, async () => {
      const collection1 = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos-1`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      const collection2 = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos-2`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      const subscription1 = collection1.subscribeChanges(() => {})
      const subscription2 = collection2.subscribeChanges(() => {})

      const tx = createTransaction({
        mutationFn: async ({ transaction }: any) => {
          await Promise.resolve()
          // Only accept mutations for collection1
          collection1.utils.acceptMutations(transaction)
        },
        autoCommit: false,
      })

      tx.mutate(() => {
        collection1.insert({
          id: `c1-item`,
          title: `Collection 1`,
          completed: false,
          createdAt: new Date(),
        })
        collection2.insert({
          id: `c2-item`,
          title: `Collection 2`,
          completed: false,
          createdAt: new Date(),
        })
      })

      await tx.commit()

      // First collection mutations should be persisted to storage
      const stored1 = mockStorage.getItem(`todos-1`)
      expect(stored1).toBeDefined()
      const parsed1 = JSON.parse(stored1!)
      expect(parsed1[`c1-item`].data.title).toBe(`Collection 1`)

      // Second collection mutations should NOT be in storage (remains optimistic)
      const stored2 = mockStorage.getItem(`todos-2`)
      expect(stored2).toBeNull()

      subscription1.unsubscribe()
      subscription2.unsubscribe()
    })

    it(`should handle insert, update, and delete mutations with correct storage updates`, async () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      const subscription = collection.subscribeChanges(() => {})

      // Pre-populate collection and storage
      const existingTodo: Todo = {
        id: `existing`,
        title: `Existing`,
        completed: false,
        createdAt: new Date(),
      }
      const existingTx = collection.insert(existingTodo)
      await existingTx.isPersisted.promise

      const tx = createTransaction({
        mutationFn: async ({ transaction }: any) => {
          await Promise.resolve()
          collection.utils.acceptMutations(transaction)
        },
        autoCommit: false,
      })

      tx.mutate(() => {
        collection.insert({
          id: `new`,
          title: `New Item`,
          completed: false,
          createdAt: new Date(),
        })
        collection.update(`existing`, (draft) => {
          draft.title = `Updated Item`
        })
        collection.delete(`new`)
      })

      await tx.commit()

      // Check storage state
      const storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      const parsed = JSON.parse(storedData!)

      // Updated item should be in storage with new title
      expect(parsed[`existing`].data.title).toBe(`Updated Item`)
      // Deleted item should not be in storage
      expect(parsed[`new`]).toBeUndefined()

      subscription.unsubscribe()
    })

    it(`should correctly use mutation.key for delete operations`, async () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      const subscription = collection.subscribeChanges(() => {})

      // Pre-populate with an item
      const todo: Todo = {
        id: `to-delete`,
        title: `Will be deleted`,
        completed: false,
        createdAt: new Date(),
      }
      const insertTx = collection.insert(todo)
      await insertTx.isPersisted.promise

      const tx = createTransaction({
        mutationFn: async ({ transaction }: any) => {
          await Promise.resolve()
          collection.utils.acceptMutations(transaction)
        },
        autoCommit: false,
      })

      tx.mutate(() => {
        collection.delete(`to-delete`)
      })

      await tx.commit()

      // Item should be deleted from storage
      const storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      const parsed = JSON.parse(storedData!)
      expect(parsed[`to-delete`]).toBeUndefined()

      // Collection should also not have the item
      expect(collection.has(`to-delete`)).toBe(false)

      subscription.unsubscribe()
    })

    it(`should rollback mutations when transaction fails`, async () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      const subscription = collection.subscribeChanges(() => {})

      const tx = createTransaction({
        mutationFn: async () => {
          await Promise.resolve()
          throw new Error(`API failed`)
        },
        autoCommit: false,
      })

      tx.mutate(() => {
        collection.insert({
          id: `rollback-test`,
          title: `Should Rollback`,
          completed: false,
          createdAt: new Date(),
        })
      })

      // Item should be present optimistically
      expect(collection.has(`rollback-test`)).toBe(true)

      try {
        await tx.commit()
      } catch {
        // Expected to fail
      }

      // Catch the rejected promise to avoid unhandled rejection
      tx.isPersisted.promise.catch(() => {})

      // Item should be rolled back from collection
      expect(collection.has(`rollback-test`)).toBe(false)

      // Item should not be in storage
      const storedData = mockStorage.getItem(`todos`)
      if (storedData) {
        const parsed = JSON.parse(storedData)
        expect(parsed[`rollback-test`]).toBeUndefined()
      }

      subscription.unsubscribe()
    })

    it(`should work when called after API operations (recommended pattern)`, async () => {
      const collection = createCollection(
        localStorageCollectionOptions<Todo>({
          storageKey: `todos`,
          storage: mockStorage,
          storageEventApi: mockStorageEventApi,
          getKey: (todo) => todo.id,
        })
      )

      const subscription = collection.subscribeChanges(() => {})

      const tx = createTransaction({
        mutationFn: async ({ transaction }: any) => {
          // Simulate API call
          await Promise.resolve()
          // Accept mutations AFTER API call (recommended for consistency)
          collection.utils.acceptMutations(transaction)
        },
        autoCommit: false,
      })

      tx.mutate(() => {
        collection.insert({
          id: `after-api`,
          title: `After API`,
          completed: false,
          createdAt: new Date(),
        })
      })

      await tx.commit()

      // Should be in collection
      expect(collection.get(`after-api`)?.title).toBe(`After API`)

      // Should be in storage
      const storedData = mockStorage.getItem(`todos`)
      expect(storedData).toBeDefined()
      const parsed = JSON.parse(storedData!)
      expect(parsed[`after-api`].data.title).toBe(`After API`)

      subscription.unsubscribe()
    })
  })
})
