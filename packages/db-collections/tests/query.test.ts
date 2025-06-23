import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "../src/query"
import type {
  MutationFnParams,
  Transaction,
  TransactionWithMutations,
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
      const mockParams: MutationFnParams<TestItem> = {
        transaction: mockTransaction as TransactionWithMutations<TestItem>,
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
      await options.onInsert!(mockParams)
      await options.onUpdate!(mockParams)
      await options.onDelete!(mockParams)

      // Verify the original handlers were called
      expect(onInsert).toHaveBeenCalledWith(mockParams)
      expect(onUpdate).toHaveBeenCalledWith(mockParams)
      expect(onDelete).toHaveBeenCalledWith(mockParams)
    })

    it(`should call refetch based on handler return value`, async () => {
      // Create a mock transaction for testing
      const mockTransaction = {
        id: `test-transaction`,
      } as Transaction<TestItem>
      const mockParams: MutationFnParams<TestItem> = {
        transaction: mockTransaction as TransactionWithMutations<TestItem>,
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
      await optionsDefault.onInsert!(mockParams)

      // Verify handler was called and refetch was triggered
      expect(onInsertDefault).toHaveBeenCalledWith(mockParams)
      expect(refetchSpy).toHaveBeenCalledTimes(1)

      // Reset mocks
      refetchSpy.mockClear()

      // Test case 2: Explicit { refetch: false } should not trigger refetch
      const optionsFalse = queryCollectionOptions(configFalse)
      await optionsFalse.onInsert!(mockParams)

      // Verify handler was called but refetch was NOT triggered
      expect(onInsertFalse).toHaveBeenCalledWith(mockParams)
      expect(refetchSpy).not.toHaveBeenCalled()

      // Restore original function
      vi.restoreAllMocks()
    })
  })
})
