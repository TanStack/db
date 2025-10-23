import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "../src/query"
import type { QueryFunctionContext } from "@tanstack/query-core"
import type {
  CollectionImpl,
  DeleteMutationFnParams,
  InsertMutationFnParams,
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
    expect(collection._state.syncedData.size).toBe(initialItems.length)
    expect(collection._state.syncedData.get(`1`)).toEqual(initialItems[0])
    expect(collection._state.syncedData.get(`2`)).toEqual(initialItems[1])
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

    const queryFn: (
      context: QueryFunctionContext<any>
    ) => Promise<Array<TestItem>> = vi
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
    const queryFn: (
      context: QueryFunctionContext<any>
    ) => Promise<Array<TestItem>> = vi
      .fn()
      .mockResolvedValue(`not an array` as any)

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
          `@tanstack/query-db-collection: queryFn must return an array of objects`
        )
      )
      expect(errorCallArgs).toBeDefined()
    })

    // The collection state should remain empty or unchanged
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
    const queryFn: (
      context: QueryFunctionContext<any>
    ) => Promise<Array<TestItem>> = vi
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

  it(`should pass meta property to queryFn context`, async () => {
    const queryKey = [`metaTest`]
    const meta = { errorMessage: `Failed to load items` }
    const queryFn = vi.fn().mockResolvedValueOnce([])

    const config: QueryCollectionConfig<TestItem> = {
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getKey,
      meta,
      startSync: true,
    }

    const options = queryCollectionOptions(config)
    createCollection(options)

    // Wait for query to execute
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
    })

    // Verify queryFn was called with the correct context, including the meta object
    expect(queryFn).toHaveBeenCalledWith(expect.objectContaining({ meta }))
  })

  describe(`Select method testing`, () => {
    type MetaDataType<T> = {
      metaDataOne: string
      metaDataTwo: string
      data: Array<T>
    }

    const initialMetaData: MetaDataType<TestItem> = {
      metaDataOne: `example metadata`,
      metaDataTwo: `example metadata`,
      data: [
        {
          id: `1`,
          name: `First Item`,
        },
        {
          id: `2`,
          name: `Second Item`,
        },
      ],
    }

    it(`Select extracts array from metadata`, async () => {
      const queryKey = [`select-test`]

      const queryFn = vi.fn().mockResolvedValue(initialMetaData)
      const select = vi.fn().mockReturnValue(initialMetaData.data)

      const options = queryCollectionOptions({
        id: `test`,
        queryClient,
        queryKey,
        queryFn,
        select,
        getKey,
        startSync: true,
      })
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(select).toHaveBeenCalledTimes(1)
        expect(collection.size).toBeGreaterThan(0)
      })

      expect(collection.size).toBe(initialMetaData.data.length)
      expect(collection.get(`1`)).toEqual(initialMetaData.data[0])
      expect(collection.get(`2`)).toEqual(initialMetaData.data[1])
    })

    it(`Throws error if select returns non array`, async () => {
      const queryKey = [`select-test`]
      const consoleErrorSpy = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})

      const queryFn = vi.fn().mockResolvedValue(initialMetaData)
      // Returns non-array
      const select = vi.fn().mockReturnValue(initialMetaData)

      const options = queryCollectionOptions({
        id: `test`,
        queryClient,
        queryKey,
        queryFn,
        select,
        getKey,
        startSync: true,
      })
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(select).toHaveBeenCalledTimes(1)
      })

      // Verify the validation error was logged
      await vi.waitFor(() => {
        const errorCallArgs = consoleErrorSpy.mock.calls.find((call) =>
          call[0].includes(
            `@tanstack/query-db-collection: select() must return an array of objects`
          )
        )
        expect(errorCallArgs).toBeDefined()
      })

      expect(collection.size).toBe(0)

      // Clean up the spy
      consoleErrorSpy.mockRestore()
    })

    it(`Whole response is cached in QueryClient when used with select option`, async () => {
      const queryKey = [`select-test`]

      const queryFn = vi.fn().mockResolvedValue(initialMetaData)
      const select = vi.fn().mockReturnValue(initialMetaData.data)

      const options = queryCollectionOptions({
        id: `test`,
        queryClient,
        queryKey,
        queryFn,
        select,
        getKey,
        startSync: true,
      })
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        expect(select).toHaveBeenCalledTimes(1)
        expect(collection.size).toBe(2)
      })

      // Verify that the query cache state exists along with its metadata
      const initialCache = queryClient.getQueryData(
        queryKey
      ) as MetaDataType<TestItem>
      expect(initialCache).toEqual(initialMetaData)
    })
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

      // Create mock transactions for testing with proper types
      const insertTransaction = {
        id: `test-transaction-insert`,
        mutations: [] as any,
      } as TransactionWithMutations<TestItem, `insert`>

      const updateTransaction = {
        id: `test-transaction-update`,
        mutations: [] as any,
      } as TransactionWithMutations<TestItem, `update`>

      const deleteTransaction = {
        id: `test-transaction-delete`,
        mutations: [] as any,
      } as TransactionWithMutations<TestItem, `delete`>

      const insertMockParams: InsertMutationFnParams<TestItem> = {
        transaction: insertTransaction,
        // @ts-ignore not testing this
        collection: {} as CollectionImpl,
      }
      const updateMockParams: UpdateMutationFnParams<TestItem> = {
        transaction: updateTransaction,
        // @ts-ignore not testing this
        collection: {} as CollectionImpl,
      }
      const deleteMockParams: DeleteMutationFnParams<TestItem> = {
        transaction: deleteTransaction,
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
      // Create a mock transaction for testing with proper type
      const insertTransaction = {
        id: `test-transaction-insert`,
        mutations: [] as any,
      } as TransactionWithMutations<TestItem, `insert`>

      const insertMockParams: InsertMutationFnParams<TestItem> = {
        transaction: insertTransaction,
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

      // Verify initial subscriber state - startSync=true, so even with no subscribers of the collection, there should
      // be an active subscription to the query
      expect(collection.subscriberCount).toBe(0)
      expect(collection.status).toBe(`ready`)

      // Add explicit subscribers to test cleanup with active subscribers
      const subscription1 = collection.subscribeChanges(() => {})
      const subscription2 = collection.subscribeChanges(() => {})
      expect(collection.subscriberCount).toBe(2)

      // Cleanup the collection which should trigger sync cleanup
      await collection.cleanup()

      // Wait a bit to ensure all async operations complete
      await flushPromises()

      // Verify collection status
      expect(collection.status).toBe(`cleaned-up`)

      // Verify that cleanup methods are called regardless of subscriber state
      expect(cancelQueriesSpy).toHaveBeenCalledWith({ queryKey })
      expect(removeQueriesSpy).toHaveBeenCalledWith({ queryKey })

      // Verify subscribers can be safely cleaned up after collection cleanup
      subscription1.unsubscribe()
      subscription2.unsubscribe()
      expect(collection.subscriberCount).toBe(0)

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

      // Add subscribers to test consistency during multiple cleanups
      const subscription1 = collection.subscribeChanges(() => {})
      const subscription2 = collection.subscribeChanges(() => {})
      expect(collection.subscriberCount).toBe(2)

      // Call cleanup multiple times - subscriber count should remain consistent
      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.subscriberCount).toBe(2) // Subscribers still tracked

      await collection.cleanup()
      await collection.cleanup()

      // Should handle multiple cleanups gracefully with consistent subscriber state
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.subscriberCount).toBe(2) // Still consistent

      // Verify subscribers can be safely unsubscribed after multiple cleanups
      subscription1.unsubscribe()
      expect(collection.subscriberCount).toBe(1)
      subscription2.unsubscribe()
      expect(collection.subscriberCount).toBe(0)
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

      // Verify initial subscriber state
      expect(collection.subscriberCount).toBe(0) // startSync: true with no explicit subscribers

      // Add a subscriber before cleanup
      const preCleanupSubscription = collection.subscribeChanges(() => {})
      expect(collection.subscriberCount).toBe(1)

      // Cleanup - should handle active subscribers gracefully
      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)

      // Subscriber count should remain tracked even after cleanup
      expect(collection.subscriberCount).toBe(1)
      preCleanupSubscription.unsubscribe() // Clean up old subscriber
      expect(collection.subscriberCount).toBe(0)

      // Access collection data to restart sync with new subscriber
      const postCleanupSubscription = collection.subscribeChanges(() => {})
      expect(collection.subscriberCount).toBe(1) // Subscriber count tracking works after restart

      // Should restart sync (might be ready immediately if query is cached)
      expect([`loading`, `ready`]).toContain(collection.status)

      postCleanupSubscription.unsubscribe()
      expect(collection.subscriberCount).toBe(0)
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
      const subscription = collection.subscribeChanges(() => {})

      // Should restart sync
      expect([`loading`, `ready`]).toContain(collection.status)

      // Cleanup again to verify the new sync cleanup works
      subscription.unsubscribe()
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

      // Verify initial subscriber count - startSync=true means the query should be active
      expect(collection.subscriberCount).toBe(0)
      expect(collection.status).toBe(`ready`)

      // Create multiple subscriptions and track count changes
      const changeHandler1 = vi.fn()
      const changeHandler2 = vi.fn()

      const subscription1 = collection.subscribeChanges(changeHandler1)
      expect(collection.subscriberCount).toBe(1) // 0 → 1

      const subscription2 = collection.subscribeChanges(changeHandler2)
      expect(collection.subscriberCount).toBe(2) // 1 → 2

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

      // Unsubscribe one and verify count tracking
      subscription1.unsubscribe()
      expect(collection.subscriberCount).toBe(1) // 2 → 1

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

      // Final cleanup - verify query remains active due to startSync: true
      subscription2.unsubscribe()
      expect(collection.subscriberCount).toBe(0) // 1 → 0
      expect(collection.status).toBe(`ready`) // Still ready due to startSync: true
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

    it(`should manage startSync vs subscriber count priority correctly`, async () => {
      const queryKey1 = [`startSyncTruePriorityTest`]
      const queryKey2 = [`startSyncFalsePriorityTest`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn1 = vi.fn().mockResolvedValue(items)
      const queryFn2 = vi.fn().mockResolvedValue(items)

      // Test case 1: startSync=true should keep query active even with 0 subscribers
      const config1: QueryCollectionConfig<TestItem> = {
        id: `startSyncTrueTest`,
        queryClient,
        queryKey: queryKey1,
        queryFn: queryFn1,
        getKey,
        startSync: true,
      }

      const options1 = queryCollectionOptions(config1)
      const collection1 = createCollection(options1)

      await vi.waitFor(() => {
        expect(collection1.status).toBe(`ready`)
      })

      expect(collection1.subscriberCount).toBe(0)
      expect(queryFn1).toHaveBeenCalled()
      expect(collection1.status).toBe(`ready`) // Active due to startSync: true

      // Test case 2: startSync=false should rely purely on subscriber count
      const config2: QueryCollectionConfig<TestItem> = {
        id: `startSyncFalseTest`,
        queryClient,
        queryKey: queryKey2,
        queryFn: queryFn2,
        getKey,
        startSync: false,
      }

      const options2 = queryCollectionOptions(config2)
      const collection2 = createCollection(options2)

      await flushPromises()

      expect(collection2.subscriberCount).toBe(0)
      expect(queryFn2).not.toHaveBeenCalled() // Should not be called without subscribers
      expect(collection2.status).toBe(`idle`) // Inactive due to startSync: false + no subscribers

      // Add subscriber to collection2 -> should now activate
      const subscription = collection2.subscribeChanges(() => {})

      await vi.waitFor(() => expect(collection2.status).toBe(`ready`))

      expect(collection2.subscriberCount).toBe(1)
      expect(queryFn2).toHaveBeenCalled() // Now called due to subscriber

      // Remove subscriber -> query may still be active but subscriber count drops
      subscription.unsubscribe()
      expect(collection2.subscriberCount).toBe(0)

      // Verify the core logic: startSync || subscriberCount > 0
      // collection1: startSync=true, subscriberCount=0 -> active
      // collection2: startSync=false, subscriberCount=0 -> depends on implementation
      expect(collection1.status).toBe(`ready`) // Always active with startSync: true
    })
  })

  describe(`Manual Sync Operations`, () => {
    it(`should provide sync methods for manual collection updates`, async () => {
      const queryKey = [`sync-test`]
      const initialItems: Array<TestItem> = [
        { id: `1`, name: `Item 1`, value: 10 },
        { id: `2`, name: `Item 2`, value: 20 },
      ]

      const queryFn = vi.fn().mockResolvedValue(initialItems)

      const config: QueryCollectionConfig<TestItem> = {
        id: `sync-test-collection`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for collection to be ready
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
        expect(collection.size).toBe(2)
      })

      // Test writeInsert
      const newItem: TestItem = { id: `3`, name: `Item 3`, value: 30 }
      collection.utils.writeInsert(newItem)

      expect(collection.size).toBe(3)
      expect(collection.get(`3`)).toEqual(newItem)

      // Test writeUpdate
      collection.utils.writeUpdate({ id: `1`, name: `Updated Item 1` })

      const updatedItem = collection.get(`1`)
      expect(updatedItem?.name).toBe(`Updated Item 1`)
      expect(updatedItem?.value).toBe(10) // Should preserve other fields

      // Test writeUpsert (update existing)
      collection.utils.writeUpsert({
        id: `2`,
        name: `Upserted Item 2`,
        value: 25,
      })

      const upsertedItem = collection.get(`2`)
      expect(upsertedItem?.name).toBe(`Upserted Item 2`)
      expect(upsertedItem?.value).toBe(25)

      // Test writeUpsert (insert new)
      collection.utils.writeUpsert({ id: `4`, name: `New Item 4`, value: 40 })

      expect(collection.size).toBe(4)
      expect(collection.get(`4`)).toEqual({
        id: `4`,
        name: `New Item 4`,
        value: 40,
      })

      // Test writeDelete
      collection.utils.writeDelete(`3`)

      expect(collection.size).toBe(3)
      expect(collection.has(`3`)).toBe(false)

      // Test batch operations
      collection.utils.writeInsert([
        { id: `5`, name: `Item 5`, value: 50 },
        { id: `6`, name: `Item 6`, value: 60 },
      ])

      expect(collection.size).toBe(5)
      expect(collection.get(`5`)?.name).toBe(`Item 5`)
      expect(collection.get(`6`)?.name).toBe(`Item 6`)

      // Test batch delete
      collection.utils.writeDelete([`5`, `6`])

      expect(collection.size).toBe(3)
      expect(collection.has(`5`)).toBe(false)
      expect(collection.has(`6`)).toBe(false)

      // Test writeBatch with mixed operations
      collection.utils.writeBatch(() => {
        collection.utils.writeInsert({
          id: `7`,
          name: `Batch Insert`,
          value: 70,
        })
        collection.utils.writeUpdate({ id: `4`, name: `Batch Updated Item 4` })
        collection.utils.writeUpsert({
          id: `8`,
          name: `Batch Upsert`,
          value: 80,
        })
        collection.utils.writeDelete(`1`)
      })

      expect(collection.size).toBe(4) // 3 - 1 (delete) + 2 (insert + upsert) = 4
      expect(collection.get(`7`)?.name).toBe(`Batch Insert`)
      expect(collection.get(`4`)?.name).toBe(`Batch Updated Item 4`)
      expect(collection.get(`8`)?.name).toBe(`Batch Upsert`)
      expect(collection.has(`1`)).toBe(false)
    })

    it(`should handle sync method errors appropriately`, async () => {
      const queryKey = [`sync-error-test`]
      const initialItems: Array<TestItem> = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(initialItems)

      const config: QueryCollectionConfig<TestItem> = {
        id: `sync-error-test-collection`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for collection to be ready
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      // Test missing key error in writeUpdate
      expect(() => {
        collection.utils.writeUpdate({ id: `999`, name: `Missing` })
      }).toThrow(/does not exist/)

      // Test missing key error in writeDelete
      expect(() => {
        collection.utils.writeDelete(`999`)
      }).toThrow(/does not exist/)
    })

    it(`should handle writeBatch validation errors`, async () => {
      const queryKey = [`sync-batch-error-test`]
      const initialItems: Array<TestItem> = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(initialItems)

      const config: QueryCollectionConfig<TestItem> = {
        id: `sync-batch-error-test-collection`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for collection to be ready
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      // Test duplicate keys within batch
      expect(() => {
        collection.utils.writeBatch(() => {
          collection.utils.writeInsert({ id: `2`, name: `Item 2` })
          collection.utils.writeUpdate({ id: `2`, name: `Updated Item 2` })
        })
      }).toThrow(/Duplicate key.*found within batch operations/)

      // Test updating non-existent item in batch
      expect(() => {
        collection.utils.writeBatch(() => {
          collection.utils.writeUpdate({ id: `999`, name: `Missing` })
        })
      }).toThrow(/does not exist/)

      // Test deleting non-existent item in batch
      expect(() => {
        collection.utils.writeBatch(() => {
          collection.utils.writeDelete(`999`)
        })
      }).toThrow(/does not exist/)
    })

    it(`should update query cache when using sync methods`, async () => {
      const queryKey = [`sync-cache-test`]
      const initialItems: Array<TestItem> = [
        { id: `1`, name: `Item 1`, value: 10 },
        { id: `2`, name: `Item 2`, value: 20 },
      ]

      const queryFn = vi.fn().mockResolvedValue(initialItems)

      const config: QueryCollectionConfig<TestItem> = {
        id: `sync-cache-test-collection`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for collection to be ready
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
        expect(collection.size).toBe(2)
      })

      // Verify initial query cache state
      const initialCache = queryClient.getQueryData(queryKey) as Array<TestItem>
      expect(initialCache).toHaveLength(2)
      expect(initialCache).toEqual(initialItems)

      // Test writeInsert updates cache
      const newItem = { id: `3`, name: `Item 3`, value: 30 }
      collection.utils.writeInsert(newItem)

      const cacheAfterInsert = queryClient.getQueryData(
        queryKey
      ) as Array<TestItem>
      expect(cacheAfterInsert).toHaveLength(3)
      expect(cacheAfterInsert).toContainEqual(newItem)

      // Test writeUpdate updates cache
      collection.utils.writeUpdate({ id: `1`, name: `Updated Item 1` })

      const cacheAfterUpdate = queryClient.getQueryData(
        queryKey
      ) as Array<TestItem>
      expect(cacheAfterUpdate).toHaveLength(3)
      const updatedItem = cacheAfterUpdate.find((item) => item.id === `1`)
      expect(updatedItem?.name).toBe(`Updated Item 1`)
      expect(updatedItem?.value).toBe(10) // Original value preserved
      // Test writeDelete updates cache
      collection.utils.writeDelete(`2`)

      const cacheAfterDelete = queryClient.getQueryData(
        queryKey
      ) as Array<TestItem>
      expect(cacheAfterDelete).toHaveLength(2)
      expect(cacheAfterDelete).not.toContainEqual({
        id: `2`,
        name: `Item 2`,
        value: 20,
      })

      // Test writeUpsert updates cache
      collection.utils.writeUpsert({ id: `4`, name: `Item 4`, value: 40 })

      const cacheAfterUpsert = queryClient.getQueryData(
        queryKey
      ) as Array<TestItem>
      expect(cacheAfterUpsert).toHaveLength(3)
      expect(cacheAfterUpsert).toContainEqual({
        id: `4`,
        name: `Item 4`,
        value: 40,
      })

      // Test writeBatch updates cache with multiple operations
      collection.utils.writeBatch(() => {
        collection.utils.writeInsert({
          id: `5`,
          name: `Batch Item 5`,
          value: 50,
        })
        collection.utils.writeUpdate({ id: `3`, name: `Batch Updated Item 3` })
        collection.utils.writeDelete(`1`)
        collection.utils.writeUpsert({
          id: `6`,
          name: `Batch Item 6`,
          value: 60,
        })
      })

      const cacheAfterBatch = queryClient.getQueryData(
        queryKey
      ) as Array<TestItem>
      expect(cacheAfterBatch).toHaveLength(4) // 3 - 1 (delete) + 1 (insert) + 1 (upsert) = 4

      // Verify specific changes from batch
      expect(cacheAfterBatch).not.toContainEqual(
        expect.objectContaining({ id: `1` })
      )
      expect(cacheAfterBatch).toContainEqual({
        id: `5`,
        name: `Batch Item 5`,
        value: 50,
      })
      expect(cacheAfterBatch).toContainEqual({
        id: `6`,
        name: `Batch Item 6`,
        value: 60,
      })

      const batchUpdatedItem = cacheAfterBatch.find((item) => item.id === `3`)
      expect(batchUpdatedItem?.name).toBe(`Batch Updated Item 3`)
      expect(batchUpdatedItem?.value).toBe(30) // Original value preserved

      // Verify cache and collection are in sync
      expect(cacheAfterBatch.length).toBe(collection.size)
      expect(new Set(cacheAfterBatch)).toEqual(new Set(collection.toArray))
    })

    it(`should maintain cache consistency during error scenarios`, async () => {
      const queryKey = [`sync-cache-error-test`]
      const initialItems: Array<TestItem> = [
        { id: `1`, name: `Item 1` },
        { id: `2`, name: `Item 2` },
      ]

      const queryFn = vi.fn().mockResolvedValue(initialItems)

      const config: QueryCollectionConfig<TestItem> = {
        id: `sync-cache-error-test-collection`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for collection to be ready
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      // Get initial cache state
      const initialCache = queryClient.getQueryData(queryKey) as Array<TestItem>
      expect(initialCache).toHaveLength(2)

      // Try to update non-existent item (should throw and not update cache)
      expect(() => {
        collection.utils.writeUpdate({ id: `999`, name: `Should Fail` })
      }).toThrow()

      // Verify cache wasn't modified
      const cacheAfterError = queryClient.getQueryData(
        queryKey
      ) as Array<TestItem>
      expect(cacheAfterError).toEqual(initialCache)
      expect(cacheAfterError).toHaveLength(2)

      // Try batch with duplicate keys (should throw and not update cache)
      expect(() => {
        collection.utils.writeBatch(() => {
          collection.utils.writeInsert({ id: `3`, name: `Item 3` })
          collection.utils.writeUpdate({ id: `3`, name: `Duplicate` })
        })
      }).toThrow(/Duplicate key/)

      // Verify cache wasn't modified
      const cacheAfterBatchError = queryClient.getQueryData(
        queryKey
      ) as Array<TestItem>
      expect(cacheAfterBatchError).toEqual(initialCache)
      expect(cacheAfterBatchError).toHaveLength(2)
      expect(collection.size).toBe(2)
    })

    it(`should throw error for async callbacks in writeBatch`, async () => {
      const queryKey = [`asyncBatch`]
      const initialItems: Array<TestItem> = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(initialItems)

      const config: QueryCollectionConfig<TestItem> = {
        id: `async-batch-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
      })

      // Test async callback throws error
      expect(() => {
        collection.utils.writeBatch(async () => {
          await Promise.resolve()
          collection.utils.writeInsert({ id: `2`, name: `Item 2` })
        })
      }).toThrow(/async callbacks/)

      // Verify no changes were made
      expect(collection.size).toBe(1)
    })

    it(`should prevent nested writeBatch calls`, async () => {
      const queryKey = [`nestedBatch`]
      const initialItems: Array<TestItem> = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(initialItems)

      const config: QueryCollectionConfig<TestItem> = {
        id: `nested-batch-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.size).toBe(1)
      })

      // Test nested writeBatch throws error
      expect(() => {
        collection.utils.writeBatch(() => {
          collection.utils.writeInsert({ id: `2`, name: `Item 2` })

          // Attempt nested batch
          collection.utils.writeBatch(() => {
            collection.utils.writeInsert({ id: `3`, name: `Item 3` })
          })
        })
      }).toThrow(/nest writeBatch/)

      // Verify no operations succeeded due to nested batch error
      expect(collection.size).toBe(1)
      expect(collection.has(`2`)).toBe(false)
      expect(collection.has(`3`)).toBe(false)
    })

    it(`should handle concurrent writeBatch calls from different collections`, async () => {
      const queryKey1 = [`collection1`]
      const queryKey2 = [`collection2`]
      const initialItems1: Array<TestItem> = [{ id: `1`, name: `Item 1` }]
      const initialItems2: Array<TestItem> = [{ id: `a`, name: `Item A` }]

      const queryFn1 = vi.fn().mockResolvedValue(initialItems1)
      const queryFn2 = vi.fn().mockResolvedValue(initialItems2)

      const config1: QueryCollectionConfig<TestItem> = {
        id: `collection-1`,
        queryClient,
        queryKey: queryKey1,
        queryFn: queryFn1,
        getKey,
        startSync: true,
      }

      const config2: QueryCollectionConfig<TestItem> = {
        id: `collection-2`,
        queryClient,
        queryKey: queryKey2,
        queryFn: queryFn2,
        getKey,
        startSync: true,
      }

      const options1 = queryCollectionOptions(config1)
      const options2 = queryCollectionOptions(config2)
      const collection1 = createCollection(options1)
      const collection2 = createCollection(options2)

      await vi.waitFor(() => {
        expect(collection1.size).toBe(1)
        expect(collection2.size).toBe(1)
      })

      // Execute batches concurrently (simulated by interleaving)
      let batch1Started = false
      let batch2Started = false

      collection1.utils.writeBatch(() => {
        batch1Started = true
        collection1.utils.writeInsert({ id: `2`, name: `Item 2` })

        // Start second batch while first is still active
        collection2.utils.writeBatch(() => {
          batch2Started = true
          collection2.utils.writeInsert({ id: `b`, name: `Item B` })
        })

        collection1.utils.writeInsert({ id: `3`, name: `Item 3` })
      })

      // Verify both batches executed successfully
      expect(batch1Started).toBe(true)
      expect(batch2Started).toBe(true)

      // Verify collection 1 has correct items
      expect(collection1.size).toBe(3)
      expect(collection1.has(`1`)).toBe(true)
      expect(collection1.has(`2`)).toBe(true)
      expect(collection1.has(`3`)).toBe(true)

      // Verify collection 2 has correct items
      expect(collection2.size).toBe(2)
      expect(collection2.has(`a`)).toBe(true)
      expect(collection2.has(`b`)).toBe(true)
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

  it(`should read the state of a query that is already ready`, async () => {
    // Populate the query cache, so the query will immediately be loaded
    const queryKey = [`raceConditionTest`]
    const initialItems: Array<TestItem> = [
      { id: `1`, name: `Cached Item 1` },
      { id: `2`, name: `Cached Item 2` },
    ]
    const queryFn: (
      context: QueryFunctionContext<any>
    ) => Promise<Array<TestItem>> = vi.fn().mockReturnValue(initialItems)
    await queryClient.prefetchQuery({ queryKey, queryFn })

    // The collection should immediately be ready
    const collection = createCollection(
      queryCollectionOptions({
        id: `test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
        staleTime: 60000, // uses the prefetched value without a refetch
      })
    )
    expect(collection.status).toBe(`ready`)
    expect(collection.size).toBe(2)
    expect(Array.from(collection.values())).toEqual(
      expect.arrayContaining(initialItems)
    )
  })

  describe(`subscriber count tracking and auto-subscription`, () => {
    it(`should not auto-subscribe when startSync=false and no subscribers`, async () => {
      const queryKey = [`noSubscriptionTest`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `noSubscriptionTest`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: false,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Give it time to potentially subscribe (it shouldn't)
      await flushPromises()

      expect(collection.subscriberCount).toBe(0)
      expect(collection.status).toBe(`idle`) // Should remain idle without startSync or subscribers
      expect(queryFn).not.toHaveBeenCalled() // Query should not be executed
    })

    it(`should subscribe/unsubscribe based on subscriber count transitions`, async () => {
      const queryKey = [`countTransitionTest`]
      const items = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `countTransition`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: false, // Start unsubscribed
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Should start unsubscribed
      expect(collection.subscriberCount).toBe(0)
      expect(collection.status).toBe(`idle`)

      // Add a subscriber -> should subscribe and load data
      const subscription1 = collection.subscribeChanges(() => {})

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      expect(collection.subscriberCount).toBe(1)
      expect(queryFn).toHaveBeenCalled()

      // Add another subscriber - should not trigger additional queries
      const initialCallCount = queryFn.mock.calls.length
      const subscription2 = collection.subscribeChanges(() => {})
      expect(collection.subscriberCount).toBe(2)

      await flushPromises()
      expect(queryFn.mock.calls.length).toBe(initialCallCount) // No additional calls

      // Remove first subscriber - should still be subscribed
      subscription1.unsubscribe()
      expect(collection.subscriberCount).toBe(1)
      expect(collection.status).toBe(`ready`)

      // Remove last subscriber -> query should remain active but collection subscriber count drops to 0
      subscription2.unsubscribe()
      expect(collection.subscriberCount).toBe(0)
    })
  })

  describe(`Error Handling`, () => {
    // Helper to create test collection with common configuration
    const createErrorHandlingTestCollection = (
      testId: string,
      queryFn: ReturnType<typeof vi.fn>
    ) => {
      const config: QueryCollectionConfig<TestItem> = {
        id: testId,
        queryClient,
        queryKey: [testId],
        queryFn,
        getKey,
        startSync: true,
        retry: false,
      }
      const options = queryCollectionOptions(config)
      return createCollection(options)
    }

    it(`should track error state, count, and support recovery`, async () => {
      const initialData = [{ id: `1`, name: `Item 1` }]
      const updatedData = [{ id: `1`, name: `Updated Item 1` }]
      const errors = [new Error(`First error`), new Error(`Second error`)]

      const queryFn = vi
        .fn()
        .mockResolvedValueOnce(initialData) // Initial success
        .mockRejectedValueOnce(errors[0]) // First error
        .mockRejectedValueOnce(errors[1]) // Second error
        .mockResolvedValueOnce(updatedData) // Recovery

      const collection = createErrorHandlingTestCollection(
        `error-tracking-test`,
        queryFn
      )

      // Wait for initial success - no errors
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
        expect(collection.utils.lastError()).toBeUndefined()
        expect(collection.utils.isError()).toBe(false)
        expect(collection.utils.errorCount()).toBe(0)
      })

      // First error - count increments
      await collection.utils.refetch()
      await vi.waitFor(() => {
        expect(collection.utils.lastError()).toBe(errors[0])
        expect(collection.utils.errorCount()).toBe(1)
        expect(collection.utils.isError()).toBe(true)
      })

      // Second error - count increments again
      await collection.utils.refetch()
      await vi.waitFor(() => {
        expect(collection.utils.lastError()).toBe(errors[1])
        expect(collection.utils.errorCount()).toBe(2)
        expect(collection.utils.isError()).toBe(true)
      })

      // Successful refetch resets error state
      await collection.utils.refetch()
      await vi.waitFor(() => {
        expect(collection.utils.lastError()).toBeUndefined()
        expect(collection.utils.isError()).toBe(false)
        expect(collection.utils.errorCount()).toBe(0)
        expect(collection.get(`1`)).toEqual(updatedData[0])
      })
    })

    it(`should support manual error recovery with clearError`, async () => {
      const recoveryData = [{ id: `1`, name: `Item 1` }]
      const testError = new Error(`Test error`)

      const queryFn = vi
        .fn()
        .mockRejectedValueOnce(testError)
        .mockResolvedValueOnce(recoveryData)
        .mockRejectedValueOnce(testError)

      const collection = createErrorHandlingTestCollection(
        `clear-error-test`,
        queryFn
      )

      // Wait for initial error
      await vi.waitFor(() => {
        expect(collection.utils.isError()).toBe(true)
        expect(collection.utils.errorCount()).toBe(1)
      })

      // Manual error clearing triggers refetch
      await collection.utils.clearError()

      expect(collection.utils.lastError()).toBeUndefined()
      expect(collection.utils.isError()).toBe(false)
      expect(collection.utils.errorCount()).toBe(0)

      await vi.waitFor(() => {
        expect(collection.get(`1`)).toEqual(recoveryData[0])
      })

      // Refetch on rejection should throw an error
      await expect(collection.utils.clearError()).rejects.toThrow(testError)
      expect(collection.utils.lastError()).toBe(testError)
      expect(collection.utils.isError()).toBe(true)
      expect(collection.utils.errorCount()).toBe(1)
    })

    it(`should maintain collection functionality despite errors and persist error state`, async () => {
      const initialData = [
        { id: `1`, name: `Item 1` },
        { id: `2`, name: `Item 2` },
      ]
      const testError = new Error(`Query error`)

      const queryFn = vi
        .fn()
        .mockResolvedValueOnce(initialData)
        .mockRejectedValue(testError)

      const collection = createErrorHandlingTestCollection(
        `functionality-with-errors-test`,
        queryFn
      )

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
        expect(collection.size).toBe(2)
      })

      // Cause error
      await collection.utils.refetch()
      await vi.waitFor(() => {
        expect(collection.utils.errorCount()).toBe(1)
        expect(collection.utils.isError()).toBe(true)
      })

      // Collection operations still work with cached data
      expect(collection.size).toBe(2)
      expect(collection.get(`1`)).toEqual(initialData[0])
      expect(collection.get(`2`)).toEqual(initialData[1])

      // Manual write operations work and clear error state
      const newItem = { id: `3`, name: `Manual Item` }
      collection.utils.writeInsert(newItem)
      expect(collection.size).toBe(3)
      expect(collection.get(`3`)).toEqual(newItem)

      await flushPromises()

      // Manual writes clear error state
      expect(collection.utils.lastError()).toBeUndefined()
      expect(collection.utils.isError()).toBe(false)
      expect(collection.utils.errorCount()).toBe(0)

      // Create error state again for persistence test
      await collection.utils.refetch()
      await vi.waitFor(() => expect(collection.utils.isError()).toBe(true))

      const originalError = collection.utils.lastError()
      const originalErrorCount = collection.utils.errorCount()

      // Read-only operations don't affect error state
      expect(collection.has(`1`)).toBe(true)
      const changeHandler = vi.fn()
      const subscription = collection.subscribeChanges(changeHandler)

      expect(collection.utils.lastError()).toBe(originalError)
      expect(collection.utils.isError()).toBe(true)
      expect(collection.utils.errorCount()).toBe(originalErrorCount)

      subscription.unsubscribe()
    })

    it(`should handle custom error objects correctly`, async () => {
      interface CustomError {
        code: string
        message: string
        details?: Record<string, unknown>
      }
      const customError: CustomError = {
        code: `NETWORK_ERROR`,
        message: `Failed to fetch data`,
        details: { retryAfter: 5000 },
      }

      // Start with error immediately - no initial success needed
      const queryFn = vi.fn().mockRejectedValue(customError)

      const config: QueryCollectionConfig<
        TestItem,
        typeof queryFn,
        CustomError
      > = {
        id: `custom-error-test`,
        queryClient,
        queryKey: [`custom-error-test`],
        queryFn,
        getKey,
        startSync: true,
        retry: false,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for collection to be ready (even with error)
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
        expect(collection.utils.isError()).toBe(true)
      })

      // Verify custom error is accessible with all its properties
      const lastError = collection.utils.lastError()
      expect(lastError).toBe(customError)
      expect(lastError?.code).toBe(`NETWORK_ERROR`)
      expect(lastError?.message).toBe(`Failed to fetch data`)
      expect(lastError?.details?.retryAfter).toBe(5000)
      expect(collection.utils.errorCount()).toBe(1)
    })

    it(`should persist error state after collection cleanup`, async () => {
      const testError = new Error(`Persistent error`)

      // Start with error immediately
      const queryFn = vi.fn().mockRejectedValue(testError)

      const collection = createErrorHandlingTestCollection(
        `error-persistence-cleanup-test`,
        queryFn
      )

      // Wait for collection to be ready (even with error)
      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
        expect(collection.utils.isError()).toBe(true)
      })

      // Verify error state before cleanup
      expect(collection.utils.lastError()).toBe(testError)
      expect(collection.utils.errorCount()).toBe(1)

      // Cleanup collection
      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)

      // Error state should persist after cleanup
      expect(collection.utils.isError()).toBe(true)
      expect(collection.utils.lastError()).toBe(testError)
      expect(collection.utils.errorCount()).toBe(1)
    })

    it(`should increment errorCount only after final failure when using Query retries`, async () => {
      const testError = new Error(`Retry test error`)
      const retryCount = 2
      const totalAttempts = retryCount + 1

      // Create a queryFn that fails consistently
      const queryFn = vi.fn().mockRejectedValue(testError)

      // Create collection with retry enabled (2 retries = 3 total attempts)
      const config: QueryCollectionConfig<TestItem> = {
        id: `retry-semantics-test`,
        queryClient,
        queryKey: [`retry-semantics-test`],
        queryFn,
        getKey,
        startSync: true,
        retry: retryCount, // This will result in 3 total attempts (initial + 2 retries)
        retryDelay: 5, // Short delay for faster tests
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for all retry attempts to complete and final failure
      await vi.waitFor(
        () => {
          expect(collection.status).toBe(`ready`) // Should be ready even with error
          expect(queryFn).toHaveBeenCalledTimes(totalAttempts)
          expect(collection.utils.isError()).toBe(true)
        },
        { timeout: 2000 }
      )

      // Error count should only increment once after all retries are exhausted
      // This ensures we track "consecutive post-retry failures," not per-attempt failures
      expect(collection.utils.errorCount()).toBe(1)
      expect(collection.utils.lastError()).toBe(testError)
      expect(collection.utils.isError()).toBe(true)

      // Reset attempt counter for second test
      queryFn.mockClear()

      // Trigger another refetch which should also retry and fail
      await collection.utils.refetch()

      // Wait for the second set of retries to complete
      await vi.waitFor(
        () => {
          expect(queryFn).toHaveBeenCalledTimes(totalAttempts)
        },
        { timeout: 2000 }
      )

      // Error count should now be 2 (two post-retry failures)
      expect(collection.utils.errorCount()).toBe(2)
      expect(collection.utils.lastError()).toBe(testError)
      expect(collection.utils.isError()).toBe(true)
    })
  })

  describe(`preload()`, () => {
    it(`should resolve preload() even without startSync or subscribers`, async () => {
      const queryKey = [`preload-test`]
      const items: Array<TestItem> = [
        { id: `1`, name: `Item 1` },
        { id: `2`, name: `Item 2` },
      ]

      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `preload-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        // Note: NOT setting startSync: true
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Collection should be idle initially
      expect(collection.status).toBe(`idle`)
      expect(queryFn).not.toHaveBeenCalled()

      // Preload should resolve without any subscribers
      await collection.preload()

      // After preload, collection should be ready and queryFn should have been called
      expect(collection.status).toBe(`ready`)
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.size).toBe(items.length)
      expect(collection.get(`1`)).toEqual(items[0])
      expect(collection.get(`2`)).toEqual(items[1])
    })

    it(`should not call queryFn multiple times if preload() is called concurrently`, async () => {
      const queryKey = [`preload-concurrent-test`]
      const items: Array<TestItem> = [{ id: `1`, name: `Item 1` }]

      const queryFn = vi.fn().mockResolvedValue(items)

      const config: QueryCollectionConfig<TestItem> = {
        id: `preload-concurrent-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Call preload() multiple times concurrently
      const promises = [
        collection.preload(),
        collection.preload(),
        collection.preload(),
      ]

      await Promise.all(promises)

      // queryFn should only be called once despite multiple preload() calls
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.status).toBe(`ready`)
      expect(collection.size).toBe(items.length)
    })

    it(`should allow writeDelete in onDelete handler to write to synced store`, async () => {
      const queryKey = [`writeDelete-in-onDelete-test`]
      const items: Array<TestItem> = [
        { id: `1`, name: `Item 1` },
        { id: `2`, name: `Item 2` },
      ]

      const queryFn = vi.fn().mockResolvedValue(items)

      const onDelete = vi.fn(async ({ transaction, collection }) => {
        const deletedItem = transaction.mutations[0]?.original
        // Call writeDelete inside onDelete handler - this should work without throwing
        collection.utils.writeDelete(deletedItem.id)
        return { refetch: false }
      })

      const config: QueryCollectionConfig<TestItem> = {
        id: `writeDelete-in-onDelete-test`,
        queryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
        onDelete,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
        expect(collection.size).toBe(2)
      })

      const transaction = collection.delete(`1`)
      await transaction.isPersisted.promise

      // Verify the fix: writeDelete should work, transaction completes, item is deleted
      expect(transaction.state).toBe(`completed`)
      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(collection.has(`1`)).toBe(false)
      expect(collection.size).toBe(1)
    })
  })

  describe(`QueryClient defaultOptions`, () => {
    it(`should respect defaultOptions from QueryClient when not overridden`, async () => {
      // Create a QueryClient with custom defaultOptions
      const customQueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10000, // 10 seconds
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      })

      const queryKey = [`defaultOptionsTest`]
      const items: Array<TestItem> = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      // Create a collection without specifying staleTime or retry
      const config: QueryCollectionConfig<TestItem> = {
        id: `defaultOptionsTest`,
        queryClient: customQueryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      // Verify queryFn was called once
      expect(queryFn).toHaveBeenCalledTimes(1)

      // Verify the query has the correct staleTime from defaultOptions
      const query = customQueryClient.getQueryCache().find({ queryKey })
      expect((query?.options as any).staleTime).toBe(10000)

      // Clean up
      customQueryClient.clear()
    })

    it(`should override defaultOptions when explicitly provided in queryCollectionOptions`, async () => {
      // Create a QueryClient with custom defaultOptions
      const customQueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10000, // 10 seconds default
            retry: 2,
          },
        },
      })

      const queryKey = [`overrideOptionsTest`]
      const items: Array<TestItem> = [{ id: `1`, name: `Item 1` }]
      const queryFn = vi.fn().mockResolvedValue(items)

      // Create a collection WITH explicit staleTime override
      const config: QueryCollectionConfig<TestItem> = {
        id: `overrideOptionsTest`,
        queryClient: customQueryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
        staleTime: 100, // Override to 100ms
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      // Verify the query uses the overridden staleTime (100ms), not the default (10000ms)
      const query = customQueryClient.getQueryCache().find({ queryKey })
      expect((query?.options as any).staleTime).toBe(100)

      // Clean up
      customQueryClient.clear()
    })

    it(`should use retry from QueryClient defaultOptions when not overridden`, async () => {
      let callCount = 0
      // Create a QueryClient with custom retry defaultOption
      const customQueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2, // Retry 2 times
            retryDelay: 1, // 1ms delay for fast test
          },
        },
      })

      const queryKey = [`retryDefaultOptionsTest`]
      const queryFn = vi.fn().mockImplementation(() => {
        callCount++
        // Fail on first 2 attempts, succeed on 3rd
        if (callCount <= 2) {
          return Promise.reject(new Error(`Attempt ${callCount} failed`))
        }
        return Promise.resolve([{ id: `1`, name: `Item 1` }])
      })

      // Create a collection without specifying retry
      const config: QueryCollectionConfig<TestItem> = {
        id: `retryDefaultOptionsTest`,
        queryClient: customQueryClient,
        queryKey,
        queryFn,
        getKey,
        startSync: true,
      }

      const options = queryCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for the query to eventually succeed (after retries)
      await vi.waitFor(
        () => {
          expect(collection.status).toBe(`ready`)
        },
        { timeout: 2000 }
      )

      // Should have called queryFn 3 times (initial + 2 retries)
      expect(callCount).toBe(3)

      // Clean up
      customQueryClient.clear()
    })
  })
})
