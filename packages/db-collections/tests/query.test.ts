import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/query-core"
import { createQueryCollection } from "../src/query"
import type { QueryCollectionConfig } from "../src/query"

interface TestItem {
  id: string
  name: string
  value?: number
}

const getId = (item: TestItem) => item.id

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
      getId,
    }

    const collection = createQueryCollection(config)

    // Wait for the query to complete and collection to update
    await vi.waitFor(
      () => {
        expect(queryFn).toHaveBeenCalledTimes(1)
        // Collection.state is a Map<string, T> (via the derivedState.state getter)
        expect(collection.state.size).toBeGreaterThan(0)
      },
      {
        timeout: 1000, // Give it a reasonable timeout
        interval: 50, // Check frequently
      }
    )

    // Additional wait for internal processing if necessary
    await flushPromises()

    // Verify the collection state contains our items
    expect(collection.state.size).toBe(initialItems.length)
    expect(collection.state.get(`1`)).toEqual(initialItems[0])
    expect(collection.state.get(`2`)).toEqual(initialItems[1])

    // Verify the synced data
    expect(collection.syncedData.state.size).toBe(initialItems.length)
    expect(collection.syncedData.state.get(`1`)).toEqual(initialItems[0])
    expect(collection.syncedData.state.get(`2`)).toEqual(initialItems[1])
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
      getId,
    }

    const collection = createQueryCollection(config)

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.state.size).toBeGreaterThan(0)
    })

    // Verify initial state
    expect(collection.state.size).toBe(initialItems.length)
    expect(collection.state.get(`1`)).toEqual(initialItems[0])
    expect(collection.state.get(`2`)).toEqual(initialItems[1])

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
    await collection.refetch()

    expect(queryFn).toHaveBeenCalledTimes(2)
    // Check for update, addition, and removal
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(`1`)).toBe(true)
    expect(collection.state.has(`3`)).toBe(true)
    expect(collection.state.has(`2`)).toBe(false)

    // Verify the final state more thoroughly
    expect(collection.state.get(`1`)).toEqual(updatedItem)
    expect(collection.state.get(`3`)).toEqual(newItem)
    expect(collection.state.get(`2`)).toBeUndefined()

    // Now update the data again.
    const item4 = { id: `4`, name: `Item 4` }
    currentItems = [...currentItems, item4]

    // Refetch the query to trigger a refetch.
    await collection.refetch()

    // Verify expected.
    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(collection.state.size).toBe(3)
    expect(collection.state.get(`4`)).toEqual(item4)
  })

  it(`should handle query errors gracefully`, async () => {
    const queryKey = [`errorItems`]
    const testError = new Error(`Test query error`)
    const initialItem = { id: `1`, name: `Initial Item` }

    // Mock console.error to verify it's called with our error
    const consoleErrorSpy = vi
      .spyOn(console, `error`)
      .mockImplementation(() => {})

    // First call succeeds, second call fails
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce([initialItem])
      .mockRejectedValueOnce(testError)

    const collection = createQueryCollection({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getId,
      retry: 0, // Disable retries for this test case
    })

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.state.size).toBe(1)
      expect(collection.state.get(`1`)).toEqual(initialItem)
    })

    // Trigger an error by refetching
    await collection.refetch()

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
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(`1`)).toEqual(initialItem)

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

    const collection = createQueryCollection({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getId,
    })

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
    expect(collection.state.size).toBe(0)

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

    const collection = createQueryCollection({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getId,
    })

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.state.size).toBe(1)
      expect(collection.state.get(`1`)).toEqual(initialItem)
    })

    // Store the initial state object reference to check if it changes
    const initialStateRef = collection.state.get(`1`)
    consoleSpy.mockClear()

    // Trigger first refetch - should not cause an update due to shallow equality
    await collection.refetch()

    expect(queryFn).toHaveBeenCalledTimes(2)
    // Verify refetch was logged
    expect(
      consoleSpy.mock.calls.some((call) =>
        call[0].includes(`Refetch successful for ${String(queryKey)}`)
      )
    ).toBe(true)

    // Since the data is identical (though a different object reference),
    // the state object reference should remain the same due to shallow equality
    expect(collection.state.get(`1`)).toBe(initialStateRef) // Same reference

    consoleSpy.mockClear()

    // Trigger second refetch - should cause an update due to actual data change
    await collection.refetch()

    expect(queryFn).toHaveBeenCalledTimes(3)
    // Verify refetch was logged
    expect(
      consoleSpy.mock.calls.some((call) =>
        call[0].includes(`Refetch successful for ${String(queryKey)}`)
      )
    ).toBe(true)

    // Now the state should be updated with the new value
    const updatedItem = collection.state.get(`1`)
    expect(updatedItem).not.toBe(initialStateRef) // Different reference
    expect(updatedItem).toEqual({ id: `1`, name: `Test Item`, count: 43 }) // Updated value

    consoleSpy.mockRestore()
  })

  it(`should use the provided getId function to identify items`, async () => {
    const queryKey = [`customKeyTest`]

    // Items with a non-standard ID field
    const items = [
      { customId: `item1`, name: `First Item` },
      { customId: `item2`, name: `Second Item` },
    ]

    const queryFn = vi.fn().mockResolvedValue(items)

    // Create a spy for the getId function
    const getIdSpy = vi.fn((item: any) => item.customId)

    const collection = createQueryCollection({
      id: `test`,
      queryClient,
      queryKey,
      queryFn,
      getId: getIdSpy,
    })

    // Wait for initial data to load
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.state.size).toBe(items.length)
    })

    // Verify getId was called for each item
    expect(getIdSpy).toHaveBeenCalledTimes(items.length)
    items.forEach((item) => {
      expect(getIdSpy).toHaveBeenCalledWith(item)
    })

    // Verify items are stored with the custom keys
    expect(collection.state.has(`item1`)).toBe(true)
    expect(collection.state.has(`item2`)).toBe(true)
    expect(collection.state.get(`item1`)).toEqual(items[0])
    expect(collection.state.get(`item2`)).toEqual(items[1])

    // Now update an item and add a new one
    const updatedItems = [
      { customId: `item1`, name: `Updated First Item` }, // Updated
      { customId: `item3`, name: `Third Item` }, // New
      // item2 removed
    ]

    // Reset the spy to track new calls
    getIdSpy.mockClear()
    queryFn.mockResolvedValueOnce(updatedItems)

    // Trigger a refetch
    await collection.refetch()

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(collection.state.size).toBe(updatedItems.length)

    // Verify getId was called at least once for each item
    // It may be called multiple times per item during the diffing process
    expect(getIdSpy).toHaveBeenCalled()
    updatedItems.forEach((item) => {
      expect(getIdSpy).toHaveBeenCalledWith(item)
    })

    // Verify the state reflects the changes
    expect(collection.state.has(`item1`)).toBe(true)
    expect(collection.state.has(`item2`)).toBe(false) // Removed
    expect(collection.state.has(`item3`)).toBe(true) // Added
    expect(collection.state.get(`item1`)).toEqual(updatedItems[0])
    expect(collection.state.get(`item3`)).toEqual(updatedItems[1])
  })
})
