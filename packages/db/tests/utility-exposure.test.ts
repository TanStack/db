import { describe, expect, test } from "vitest"
import { createCollection } from "../src/collection"
import type { CollectionConfig, SyncConfig, UtilsRecord } from "../src/types"

// Mock utility functions for testing
interface TestUtils extends UtilsRecord {
  testFn: (input: string) => string
  asyncFn: (input: number) => Promise<number>
}

describe(`Utility exposure pattern`, () => {
  test(`exposes utilities at top level and under .utils namespace`, () => {
    // Create mock utility functions
    const testFn = (input: string) => `processed: ${input}`
    const asyncFn = (input: number) => input * 2

    // Create a mock sync config
    const mockSync: SyncConfig = {
      sync: () => {
        return {
          unsubscribe: () => {},
        }
      },
    }

    // Create collection options with utilities
    const options: CollectionConfig<{ id: string }> & { utils: TestUtils } = {
      getId: (item) => item.id,
      sync: mockSync,
      utils: {
        testFn,
        asyncFn,
      },
    }

    // Create collection with utilities
    const collection = createCollection(options)

    // Verify utilities are exposed at top level
    expect(collection.testFn).toBeDefined()
    expect(collection.testFn(`test`)).toBe(`processed: test`)
    expect(collection.asyncFn).toBeDefined()

    // Verify utilities are also exposed under .utils namespace
    expect(collection.utils).toBeDefined()
    expect(collection.utils.testFn).toBeDefined()
    expect(collection.utils.testFn(`test`)).toBe(`processed: test`)
    expect(collection.utils.asyncFn).toBeDefined()

    // Verify both references point to the same function
    expect(collection.testFn).toBe(collection.utils.testFn)
    expect(collection.asyncFn).toBe(collection.utils.asyncFn)
  })

  test(`supports collections without utilities`, () => {
    // Create a mock sync config
    const mockSync: SyncConfig = {
      sync: () => {
        return {
          unsubscribe: () => {},
        }
      },
    }

    // Create collection without utilities
    const collection = createCollection({
      getId: (item: { id: string }) => item.id,
      sync: mockSync,
    })

    // Verify .utils exists but is empty
    expect(collection.utils).toBeDefined()
    expect(Object.keys(collection.utils).length).toBe(0)
  })

  test(`preserves type information for collection data`, async () => {
    // Define a type for our collection items
    type TestItem = {
      id: string
      name: string
      value: number
    }

    // Create mock utility functions
    const testFn = (input: string) => `processed: ${input}`
    const asyncFn = (input: number) => input * 2

    // Create a mock sync config
    const mockSync: SyncConfig = {
      sync: () => {
        return {
          unsubscribe: () => {},
        }
      },
    }

    // Create collection options with utilities
    const options: CollectionConfig<TestItem> & { utils: TestUtils } = {
      getId: (item) => item.id,
      sync: mockSync,
      utils: {
        testFn,
        asyncFn,
      },
    }

    // Create collection with utilities
    const collection = createCollection<TestItem, TestUtils>(options)

    // Create an item for the collection
    const testItem: TestItem = { id: `1`, name: `Test`, value: 42 }

    // Let's verify utilities work with the collection
    expect(collection.testFn(`test`)).toBe(`processed: test`)
    const asyncResult = await collection.asyncFn(21)
    expect(asyncResult).toBe(42)

    // TypeScript knows the collection is for TestItem type
    // This is a compile-time check that we can't verify at runtime directly
    // But we've verified the utilities work
  })
})
