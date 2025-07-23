import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "../src/query"
import type {
  CollectionImpl,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  Transaction,
  TransactionWithMutations,
  UpdateMutationFnParams,
} from "@tanstack/db"
import type { QueryCollectionConfig } from "../src/query"

interface TestItem {
  id: string
  name: string
  value?: number
}

const getKey = (item: TestItem) => item.id

// Helper to advance timers and allow microtasks to flush
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`QueryCollection`, () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          // Setting a low staleTime and cacheTime to ensure queries can be refetched easily in tests
          // and GC'd quickly if not observed.
          staleTime: 0,
          retry: false, // Disable retries for tests to avoid delays
        },
      },
    })
  })

  afterEach(() => {
    // Ensure all queries are properly cleaned up after each test
    queryClient.clear()
  })

  it(`should initialize and fetch initial data`, async () => {
    const queryKey = [`testItems`]
    const initialItems: Array<TestItem> = [
      { id: `1`, name: `Item 1` },
      { id: `2`, name: `Item 2` },
    ]

    const queryFn = vi.fn().mockResolvedValue(initialItems)

    const config: QueryCollectionConfig<TestItem> = {
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey,
      startSync: true,
    }

    const options = queryCollectionOptions(config)
    const collection = createCollection(options)

    // Wait for the query to complete and collection to update
    await vi.waitFor(
      () => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(collection.size).toBeGreaterThan(0)
      },
      {
        timeout: 1000, // Give it a reasonable timeout
        interval: 50, // Check frequently
      }
    )

    // Additional wait for internal processing if necessary
    await flushPromises()

    // Verify the collection state contains our items
    expect(collection.size).toBe(initialItems.length)
    expect(collection.get(`1`)).toEqual(initialItems[0])
    expect(collection.get(`2`)).toEqual(initialItems[1])

    // Verify the synced data
    expect(collection.syncedData.size).toBe(initialItems.length)
    expect(collection.syncedData.get(`1`)).toEqual(initialItems[0])
    expect(collection.syncedData.get(`2`)).toEqual(initialItems[1])
  })

  it(`should update collection when query data changes`, async () => {
    const queryKey = [`testItems`]
    const initialItems: Array<TestItem> = [
      { id: `1`, name: `Item 1` },
      { id: `2`, name: `Item 2` },
    ]

    // We'll use this to control what the queryFn returns in each call
    let currentItems = [...initialItems]

    const queryFn = vi
      .fn()
      .mockImplementation(() => Promise.resolve(currentItems))

    const config: QueryCollectionConfig<TestItem> = {
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey,
      startSync: true,
    }

    const options = queryCollectionOptions(config)
    const collection = createCollection(options)

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.size).toBeGreaterThan(0)
    })

    // Verify initial state
    expect(collection.size).toBe(initialItems.length)
    expect(collection.get(`1`)).toEqual(initialItems[0])
    expect(collection.get(`2`)).toEqual(initialItems[1])

    // Now update the data that will be returned by queryFn
    // 1. Modify an existing item
    // 2. Add a new item
    // 3. Remove an existing item
    const updatedItem = { id: `1`, name: `Item 1 Updated` }
    const newItem = { id: `3`, name: `Item 3` }
    currentItems = [
      updatedItem, // Modified
      newItem, // Added
      // Item 2 removed
    ]

    // Refetch the query.
    await collection.utils.refetch()

    expect(queryFn).toHaveBeenCalledTimes(2)
    // Check for update, addition, and removal
    expect(collection.size).toBe(2)
    expect(collection.has(`1`)).toBe(true)
    expect(collection.has(`3`)).toBe(true)
    expect(collection.has(`2`)).toBe(false)

    // Verify the final state more thoroughly
    expect(collection.get(`1`)).toEqual(updatedItem)
    expect(collection.get(`3`)).toEqual(newItem)
    expect(collection.get(`2`)).toBeUndefined()

    // Now update the data again.
    const item4 = { id: `4`, name: `Item 4` }
    currentItems = [...currentItems, item4]

    // Refetch the query to trigger a refetch.
    await collection.utils.refetch()

    // Verify expected.
    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(collection.size).toBe(3)
    expect(collection.get(`4`)).toEqual(item4)
  })

  it(`should handle query errors gracefully`, async () => {
    const queryKey = [`errorItems`]
    const testError = new Error(`Test query error`)
    const initialItem = { id: `1`, name: `Initial Item` }

    // Mock console.error to verify it's called with our error
    const consoleErrorSpy = vi
      .spyOn(console, `error`)
      .mockImplementation(() => {})

    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([initialItem])
      .mockRejectedValueOnce(testError)

    const options = queryCollectionOptions({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey,
      startSync: true,
      retry: 0, // Disable retries for this test case
    })
    const collection = createCollection(options)

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.size).toBe(1)
      expect(collection.get(`1`)).toEqual(initialItem)
    })

    // Trigger an error by refetching
    await collection.utils.refetch()

    // Wait for the error to be logged
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(consoleErrorSpy).toHaveBeenCalled()

    // Verify the error was logged correctly
    const errorCallArgs = consoleErrorSpy.mock.calls.find((call) =>
      call[0].includes(`[QueryCollection] Error observing query`)
    )
    expect(errorCallArgs).toBeDefined()
    expect(errorCallArgs?.[1]).toBe(testError)

    // The collection should maintain its previous state
    expect(collection.size).toBe(1)
    expect(collection.get(`1`)).toEqual(initialItem)

    // Clean up the spy
    consoleErrorSpy.mockRestore()
  })

  it(`should validate that queryFn returns an array of objects`, async () => {
    const queryKey = [`invalidData`]
    const consoleErrorSpy = vi
      .spyOn(console, `error`)
      .mockImplementation(() => {})

    // Mock queryFn to return invalid data (not an array of objects)
    const queryFn = vi.fn().mockResolvedValue(`not an array` as any)

    const options = queryCollectionOptions({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey,
      startSync: true,
    })
    const collection = createCollection(options)

    // Wait for the query to execute
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
    })

    // Verify the validation error was logged
    await vi.waitFor(() => {
      const errorCallArgs = consoleErrorSpy.mock.calls.find((call) =>
        call[0].includes(
          `[QueryCollection] queryFn did not return an array of objects`
        )
      )
      expect(errorCallArgs).toBeDefined()
    })

    // The collection state should remain empty or unchanged
    // Since we're not setting any initial data, we expect the state to be empty
    expect(collection.size).toBe(0)

    // Clean up the spy
    consoleErrorSpy.mockRestore()
  })

  it(`should use shallow equality to avoid unnecessary updates`, async () => {
    const queryKey = [`shallowEqualityTest`]
    const initialItem = { id: `1`, name: `Test Item`, count: 42 }

    // First query returns the initial item
    // Second query returns a new object with the same properties (different reference)
    // Third query returns an object with an actual change
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([initialItem])
      .mockResolvedValueOnce([{ ...initialItem }]) // Same data, different object reference
      .mockResolvedValueOnce([{ ...initialItem, count: 43 }]) // Actually changed data

    // Spy on console.log to detect when commits happen
    const consoleSpy = vi.spyOn(console, `log`)

    const options = queryCollectionOptions({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey,
      startSync: true,
    })
    const collection = createCollection(options)

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.size).toBe(1)
      expect(collection.get(`1`)).toEqual(initialItem)
    })

    // Store the initial state object reference to check if it changes
    const initialStateRef = collection.get(`1`)
    consoleSpy.mockClear()

    // Trigger first refetch - should not cause an update due to shallow equality
    await collection.utils.refetch()

    expect(queryFn).toHaveBeenCalledTimes(2)

    // Since the data is identical (though a different object reference),
    // the state object reference should remain the same due to shallow equality
    expect(collection.get(`1`)).toBe(initialStateRef) // Same reference

    consoleSpy.mockClear()

    // Trigger second refetch - should cause an update due to actual data change
    await collection.utils.refetch()

    expect(queryFn).toHaveBeenCalledTimes(3)

    // Now the state should be updated with the new value
    const updatedItem = collection.get(`1`)
    expect(updatedItem).not.toBe(initialStateRef) // Different reference
    expect(updatedItem).toEqual({ id: `1`, name: `Test Item`, count: 43 }) // Updated value

    consoleSpy.mockRestore()
  })

  it(`should use the provided getKey function to identify items`, async () => {
    const queryKey = [`customKeyTest`]

    // Items with a non-standard ID field
    const items = [
      { customId: `item1`, name: `First Item` },
      { customId: `item2`, name: `Second Item` },
    ]

    const queryFn = vi.fn().mockResolvedValue(items)

    // Create a spy for the getKey function
    const getKeySpy = vi.fn((item: any) => item.customId)

    const options = queryCollectionOptions({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey: getKeySpy,
      startSync: true,
    })
    const collection = createCollection(options)

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.size).toBe(items.length)
    })

    // Verify getKey was called for each item
    expect(getKeySpy).toHaveBeenCalledTimes(items.length * 2)
    items.forEach((item) => {
      expect(getKeySpy).toHaveBeenCalledWith(item)
    })

    // Verify items are stored with the custom keys
    expect(collection.has(`item1`)).toBe(true)
    expect(collection.has(`item2`)).toBe(true)
    expect(collection.get(`item1`)).toEqual(items[0])
    expect(collection.get(`item2`)).toEqual(items[1])

    // Now update an item and add a new one
    const updatedItems = [
      { customId: `item1`, name: `Updated First Item` }, // Updated
      { customId: `item3`, name: `Third Item` }, // New
      // item2 removed
    ]

    // Reset the spy to track new calls
    getKeySpy.mockClear()
    queryFn.mockResolvedValueOnce(updatedItems)

    // Trigger a refetch
    await collection.utils.refetch()

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(collection.size).toBe(updatedItems.length)

    // Verify getKey was called at least once for each item
    // It may be called multiple times per item during the diffing process
    expect(getKeySpy).toHaveBeenCalled()
    updatedItems.forEach((item) => {
      expect(getKeySpy).toHaveBeenCalledWith(item)
    })

    // Verify the state reflects the changes
    expect(collection.has(`item1`)).toBe(true)
    expect(collection.has(`item2`)).toBe(false) // Removed
    expect(collection.has(`item3`)).toBe(true) // Added
    expect(collection.get(`item1`)).toEqual(updatedItems[0])
    expect(collection.get(`item3`)).toEqual(updatedItems[1])
  })

  describe(`Direct persistence handlers`, () => {
    it(`should pass through direct persistence handlers to collection options`, () => {
      const queryKey = [`directPersistenceTest`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      // Create mock handlers
      const onInsert = vi.fn().mockResolvedValue(undefined)
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const onDelete = vi.fn().mockResolvedValue(undefined)

      const config: QueryCollectionConfig<TestItem> = {
        id: `test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        onInsert,
        onUpdate,
        onDelete,
      }

      const options = queryCollectionOptions(config)

      // Verify that the handlers were passed to the collection options
      expect(options.onInsert).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(options.onDelete).toBeDefined()
    })

    it(`should wrap handlers and call the original handler`, async () => {
      const queryKey = [`handlerTest`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      // Create a mock transaction for testing
      const mockTransaction = {
        id: `test-transaction`,
      } as Transaction<TestItem>
      const insertMockParams: InsertMutationFnParams<TestItem> = {
        transaction: mockTransaction as TransactionWithMutations<TestItem>,
        // @ts-ignore not testing this
        collection: {} as CollectionImpl,
      }
      const updateMockParams: UpdateMutationFnParams<TestItem> = {
        transaction: mockTransaction as TransactionWithMutations<TestItem>,
        // @ts-ignore not testing this
        collection: {} as CollectionImpl,
      }
      const deleteMockParams: DeleteMutationFnParams<TestItem> = {
        transaction: mockTransaction as TransactionWithMutations<TestItem>,
        // @ts-ignore not testing this
        collection: {} as CollectionImpl,
      }

      // Create handlers
      const onInsert = vi.fn().mockResolvedValue(undefined)
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const onDelete = vi.fn().mockResolvedValue(undefined)

      const config: QueryCollectionConfig<TestItem> = {
        id: `test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        onInsert,
        onUpdate,
        onDelete,
      }

      const options = queryCollectionOptions(config)

      // Call the wrapped handlers
      await options.onInsert!(insertMockParams)
      await options.onUpdate!(updateMockParams)
      await options.onDelete!(deleteMockParams)

      // Verify the original handlers were called
      expect(onInsert).toHaveBeenCalledWith(insertMockParams)
      expect(onUpdate).toHaveBeenCalledWith(updateMockParams)
      expect(onDelete).toHaveBeenCalledWith(deleteMockParams)
    })

    it(`should call refetch based on handler return value`, async () => {
      // Create a mock transaction for testing
      const mockTransaction = {
        id: `test-transaction`,
      } as Transaction<TestItem>
      const insertMockParams: InsertMutationFnParams<TestItem> = {
        transaction: mockTransaction as TransactionWithMutations<TestItem>,
        // @ts-ignore not testing this
        collection: {} as CollectionImpl,
      }

      // Create handlers with different return values
      const onInsertDefault = vi.fn().mockResolvedValue(undefined) // Default behavior should refetch
      const onInsertFalse = vi.fn().mockResolvedValue({ refetch: false }) // No refetch

      // Create a spy on the refetch function itself
      const refetchSpy = vi.fn().mockResolvedValue(undefined)

      // Create configs with the handlers
      const configDefault: QueryCollectionConfig<TestItem> = {
        id: `test-default`,
        queryClient,
        queryKey: [`refetchTest`, `default`],
        queryFn: vi.fn().mockResolvedValue([{ id: `1`, name: `Item 1` }]),
        getKey,
        onInsert: onInsertDefault,
      }

      const configFalse: QueryCollectionConfig<TestItem> = {
        id: `test-false`,
        queryClient,
        queryKey: [`refetchTest`, `false`],
        queryFn: vi.fn().mockResolvedValue([{ id: `1`, name: `Item 1` }]),
        getKey,
        onInsert: onInsertFalse,
      }

      // Mock the queryClient.refetchQueries method which is called by collection.utils.refetch()
      vi.spyOn(queryClient, `refetchQueries`).mockImplementation(refetchSpy)

      // Test case 1: Default behavior (undefined return) should trigger refetch
      const optionsDefault = queryCollectionOptions(configDefault)
      await optionsDefault.onInsert!(insertMockParams)

      // Verify handler was called and refetch was triggered
      expect(onInsertDefault).toHaveBeenCalledWith(insertMockParams)
      expect(refetchSpy).toHaveBeenCalledTimes(1)

      // Reset mocks
      refetchSpy.mockClear()

      // Test case 2: Explicit { refetch: false } should not trigger refetch
      const optionsFalse = queryCollectionOptions(configFalse)
      await optionsFalse.onInsert!(insertMockParams)

      // Verify handler was called but refetch was NOT triggered
      expect(onInsertFalse).toHaveBeenCalledWith(insertMockParams)
      expect(refetchSpy).not.toHaveBeenCalled()

      // Restore original function
      vi.restoreAllMocks()
    })
  })

  // Tests for lifecycle management
  describe(`lifecycle management`, () => {
    it(`should properly cleanup query and collection when collection is cleaned up`, async () => {
      const queryKey = [`cleanup-test`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `cleanup-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data to load
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(collection.size).toBe(1)
      })

      // Cleanup the collection
      await collection.cleanup()

      // Verify collection status
      expect(collection.status).toBe(`cleaned-up`)

      // Note: Query cleanup happens during sync cleanup, not collection cleanup
      // We're mainly verifying the collection cleanup works without errors
    })

    it(`should call cancelQueries and removeQueries on sync cleanup`, async () => {
      const queryKey = [`sync-cleanup-test`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `sync-cleanup-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      // Spy on the queryClient methods that should be called during sync cleanup
      const cancelQueriesSpy = vi
        .spyOn(queryClient, `cancelQueries`)
        .mockResolvedValue()
      const removeQueriesSpy = vi.spyOn(queryClient, `removeQueries`)

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data to load
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(collection.size).toBe(1)
      })

      // Cleanup the collection which should trigger sync cleanup
      await collection.cleanup()

      // Wait a bit to ensure all async operations complete
      await flushPromises()

      // Verify collection status
      expect(collection.status).toBe(`cleaned-up`)

      // Verify that the TanStack Query cleanup methods were called
      expect(cancelQueriesSpy).toHaveBeenCalledWith({ queryKey })
      expect(removeQueriesSpy).toHaveBeenCalledWith({ queryKey })

      // Restore spies
      cancelQueriesSpy.mockRestore()
      removeQueriesSpy.mockRestore()
    })

    it(`should handle multiple cleanup calls gracefully`, async () => {
      const queryKey = [`multiple-cleanup-test`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `multiple-cleanup-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data
      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
      })

      // Call cleanup multiple times
      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)

      await collection.cleanup()
      await collection.cleanup()

      // Should handle multiple cleanups gracefully
      expect(collection.status).toBe(`cleaned-up`)
    })

    it(`should restart sync when collection is accessed after cleanup`, async () => {
      const queryKey = [`restart-sync-test`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `restart-sync-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(collection.size).toBe(1)
      })

      // Cleanup
      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)

      // Access collection data to restart sync
      const unsubscribe = collection.subscribeChanges(() => {})

      // Should restart sync (might be ready immediately if query is cached)
      expect([`loading`, `ready`]).toContain(collection.status)

      unsubscribe()
    })

    it(`should handle query lifecycle during restart cycle`, async () => {
      const queryKey = [`restart-lifecycle-test`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `restart-lifecycle-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      // Spy on queryClient methods
      const cancelQueriesSpy = vi
        .spyOn(queryClient, `cancelQueries`)
        .mockResolvedValue()
      const removeQueriesSpy = vi.spyOn(queryClient, `removeQueries`)

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data
      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
      })

      // Cleanup which should call query cleanup methods
      await collection.cleanup()
      await flushPromises()
      expect(collection.status).toBe(`cleaned-up`)

      // Verify cleanup methods were called
      expect(cancelQueriesSpy).toHaveBeenCalledWith({ queryKey })
      expect(removeQueriesSpy).toHaveBeenCalledWith({ queryKey })

      // Clear the spies to track new calls
      cancelQueriesSpy.mockClear()
      removeQueriesSpy.mockClear()

      // Restart by accessing collection
      const unsubscribe = collection.subscribeChanges(() => {})

      // Should restart sync
      expect([`loading`, `ready`]).toContain(collection.status)

      // Cleanup again to verify the new sync cleanup works
      unsubscribe()
      await collection.cleanup()
      await flushPromises()

      // Verify cleanup methods were called again for the restarted sync
      expect(cancelQueriesSpy).toHaveBeenCalledWith({ queryKey })
      expect(removeQueriesSpy).toHaveBeenCalledWith({ queryKey })

      // Restore spies
      cancelQueriesSpy.mockRestore()
      removeQueriesSpy.mockRestore()
    })

    it(`should handle query invalidation and refetch properly`, async () => {
      const queryKey = [`invalidation-test`]
      let items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockImplementation(() => Promise.resolve(items))

      const config: QueryCollectionConfig<TestItem> = {
        id: `invalidation-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(collection.size).toBe(1)
      })

      // Update data for next fetch
      items = [
        { id: `1`, name: `Updated Item 1` },
        { id: `2`, name: `Item 2` },
      ]

      // Invalidate and refetch
      await queryClient.invalidateQueries({ queryKey })

      // Wait for refetch to complete
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(collection.size).toBe(2)
      })

      expect(collection.get(`1`)).toEqual({ id: `1`, name: `Updated Item 1` })
      expect(collection.get(`2`)).toEqual({ id: `2`, name: `Item 2` })
    })

    it(`should handle concurrent query operations`, async () => {
      const queryKey = [`concurrent-test`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `concurrent-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data
      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
      })

      // Perform concurrent operations
      const promises = [
        collection.utils.refetch(),
        collection.utils.refetch(),
        collection.utils.refetch(),
      ]

      // All should complete without errors
      await Promise.all(promises)

      // Collection should remain in a consistent state
      expect(collection.size).toBe(1)
      expect(collection.get(`1`)).toEqual({ id: `1`, name: `Item 1` })
    })

    it(`should handle query state transitions properly`, async () => {
      const queryKey = [`state-transition-test`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `state-transition-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Initially loading
      expect(collection.status).toBe(`loading`)

      // Wait for data to load
      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
        expect(collection.status).toBe(`ready`)
      })

      // Trigger a refetch which should transition to loading and back to ready
      const refetchPromise = collection.utils.refetch()

      // Should transition back to ready after refetch
      await refetchPromise
      expect(collection.status).toBe(`ready`)
    })

    it(`should properly handle subscription lifecycle`, async () => {
      const queryKey = [`subscription-lifecycle-test`]
      let items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockImplementation(() => Promise.resolve(items))

      const config: QueryCollectionConfig<TestItem> = {
        id: `subscription-lifecycle-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data
      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
      })

      // Create multiple subscriptions
      const changeHandler1 = vi.fn()
      const changeHandler2 = vi.fn()

      const unsubscribe1 = collection.subscribeChanges(changeHandler1)
      const unsubscribe2 = collection.subscribeChanges(changeHandler2)

      // Change the data and trigger a refetch
      items = [{ id: `1`, name: `Item 1 Updated` }]
      await collection.utils.refetch()

      // Wait for changes to propagate
      await vi.waitFor(() => {
        expect(collection.get(`1`)?.name).toBe(`Item 1 Updated`)
      })

      // Both handlers should have been called
      expect(changeHandler1).toHaveBeenCalled()
      expect(changeHandler2).toHaveBeenCalled()

      // Unsubscribe one
      unsubscribe1()
      changeHandler1.mockClear()
      changeHandler2.mockClear()

      // Change data again and trigger another refetch
      items = [{ id: `1`, name: `Item 1 Updated Again` }]
      await collection.utils.refetch()

      // Wait for changes to propagate
      await vi.waitFor(() => {
        expect(collection.get(`1`)?.name).toBe(`Item 1 Updated Again`)
      })

      // Only the second handler should be called
      expect(changeHandler1).not.toHaveBeenCalled()
      expect(changeHandler2).toHaveBeenCalled()

      // Cleanup
      unsubscribe2()
    })

    it(`should handle query cancellation gracefully`, async () => {
      const queryKey = [`cancellation-test`]
      let resolvePromise: (value: Array<TestItem>) => void
      const queryPromise = new Promise<Array<TestItem>>((resolve) => {
        resolvePromise = resolve
      })
      const queryFn = vi.fn().mockReturnValue(queryPromise)

      const config: QueryCollectionConfig<TestItem> = {
        id: `cancellation-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Collection should be in loading state
      expect(collection.status).toBe(`loading`)

      // Cancel by cleaning up before query resolves
      await collection.cleanup()

      // Now resolve the promise
      resolvePromise!([{ id: `1`, name: `Item 1` }])

      // Wait a bit to ensure any async operations complete
      await flushPromises()

      // Collection should be cleaned up and not have processed the data
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.size).toBe(0)
    })

    it(`should maintain data consistency during rapid updates`, async () => {
      const queryKey = [`rapid-updates-test`]
      let updateCount = 0
      const queryFn = vi.fn().mockImplementation(() => {
        updateCount++
        return Promise.resolve([{ id: `1`, name: `Item ${updateCount}` }])
      })

      const config: QueryCollectionConfig<TestItem> = {
        id: `rapid-updates-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial data
      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
      })

      // Perform rapid updates
      const updatePromises = []
      for (let i = 0; i < 5; i++) {
        updatePromises.push(collection.utils.refetch())
      }

      await Promise.all(updatePromises)

      // Collection should be in a consistent state
      expect(collection.size).toBe(1)
      expect(collection.status).toBe(`ready`)

      // The final data should reflect one of the updates
      const finalItem = collection.get(`1`)
      expect(finalItem?.name).toMatch(/^Item \d+$/)
    })
  })

  it(`should call markReady when queryFn returns an empty array`, async () => {
    const queryKey = [`emptyArrayTest`]
    const queryFn = vi.fn().mockResolvedValue([])

    const config: QueryCollectionConfig<TestItem> = {
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey,
      startSync: true,
    }

    const options = queryCollectionOptions(config)
    const collection = createCollection(options)

    // Wait for the query to complete
    await vi.waitFor(
      () => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        // The collection should be marked as ready even with empty array
        expect(collection.status).toBe(`ready`)
      },
      {
        timeout: 1000,
        interval: 50,
      }
    )

    // Verify the collection is empty but ready
    expect(collection.size).toBe(0)
    expect(collection.status).toBe(`ready`)
  })
})
