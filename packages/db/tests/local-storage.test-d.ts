import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/index"
import { localStorageCollectionOptions } from "../src/local-storage"
import type {
  LocalStorageCollectionConfig,
  StorageApi,
  StorageEventApi,
} from "../src/local-storage"
import type { ResolveType } from "../src/types"

type ItemOf<T> = T extends Array<infer U> ? U : T

describe(`LocalStorage collection type resolution tests`, () => {
  // Define test types
  type ExplicitType = { id: string; explicit: boolean }
  type FallbackType = { id: string; fallback: boolean }

  // Define a schema
  const testSchema = z.object({
    id: z.string(),
    schema: z.boolean(),
  })

  type SchemaType = z.infer<typeof testSchema>

  // Mock storage and event API for type tests
  const mockStorage: StorageApi = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }

  const mockStorageEventApi: StorageEventApi = {
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  it(`should return a type compatible with createCollection`, () => {
    const options = localStorageCollectionOptions<ExplicitType>({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    })

    // Should be able to create a collection with the returned options
    const collection = createCollection(options)

    // Verify the collection has the expected methods and properties
    expectTypeOf(collection.get).toBeFunction()
    expectTypeOf(collection.insert).toBeFunction()
    expectTypeOf(collection.update).toBeFunction()
    expectTypeOf(collection.delete).toBeFunction()
    expectTypeOf(collection.size).toBeNumber()
    expectTypeOf(collection.utils.clearStorage).toBeFunction()
    expectTypeOf(collection.utils.getStorageSize).toBeFunction()

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExplicitType>()

    // Test update draft type
    collection.update(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExplicitType>()
    })
  })

  it(`should prioritize explicit type in LocalStorageCollectionConfig`, () => {
    const options = localStorageCollectionOptions<ExplicitType>({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<ExplicitType, never>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()

    // Test that the collection works with the options
    const collection = createCollection(options)

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExplicitType>()

    // Test update draft type
    collection.update(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExplicitType>()
    })
  })

  it(`should use schema type when explicit type is not provided`, () => {
    const options = localStorageCollectionOptions({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      schema: testSchema,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<unknown, typeof testSchema>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[SchemaType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<SchemaType>()

    // Test that the collection works with the options
    const collection = createCollection(options)

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<SchemaType>()

    // Test update draft type
    collection.update(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<SchemaType>()
    })
  })

  it(`should use explicit type when provided`, () => {
    const config: LocalStorageCollectionConfig<FallbackType> = {
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    }

    const options = localStorageCollectionOptions<FallbackType>(config)

    type ExpectedType = ResolveType<FallbackType, never>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[FallbackType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<FallbackType>()

    // Test that the collection works with the options
    const collection = createCollection(options)

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<FallbackType>()

    // Test update draft type
    collection.update(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<FallbackType>()
    })
  })

  it(`should correctly resolve type with explicit type provided`, () => {
    const options = localStorageCollectionOptions<ExplicitType>({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<ExplicitType, never>
    // The getKey function should have the resolved type (explicit type should win)
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()

    // Test that the collection works with the options
    const collection = createCollection(options)

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExplicitType>()

    // Test update draft type
    collection.update(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExplicitType>()
    })
  })

  it(`should properly type the onInsert, onUpdate, and onDelete handlers`, () => {
    const options = localStorageCollectionOptions<ExplicitType>({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
      onInsert: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ success: true })
      },
      onUpdate: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ success: true })
      },
      onDelete: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].original
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ success: true })
      },
    })

    // Test that the collection works with the options
    const collection = createCollection(options)

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExplicitType>()

    // Test update draft type
    collection.update(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExplicitType>()
    })
  })

  it(`should properly type localStorage-specific configuration options`, () => {
    const config: LocalStorageCollectionConfig<ExplicitType> = {
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
      id: `custom-id`,
    }

    // Verify config types
    expectTypeOf(config.storageKey).toEqualTypeOf<string>()
    expectTypeOf(config.storage).toEqualTypeOf<StorageApi | undefined>()
    expectTypeOf(config.storageEventApi).toEqualTypeOf<
      StorageEventApi | undefined
    >()
    expectTypeOf(config.id).toEqualTypeOf<string | undefined>()

    const options = localStorageCollectionOptions(config)

    // Verify the id defaults correctly
    expectTypeOf(options.id).toEqualTypeOf<string>()
  })

  it(`should properly type utility functions`, () => {
    const options = localStorageCollectionOptions<ExplicitType>({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    })

    // Verify utility function types
    expectTypeOf(options.utils.clearStorage).toEqualTypeOf<() => void>()
    expectTypeOf(options.utils.getStorageSize).toEqualTypeOf<() => number>()
  })

  it(`should properly type sync configuration`, () => {
    const options = localStorageCollectionOptions<ExplicitType>({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    })

    // Verify sync has the correct type and optional getSyncMetadata
    expectTypeOf(options.sync).toBeObject()

    if (options.sync.getSyncMetadata) {
      expectTypeOf(options.sync.getSyncMetadata).toBeFunction()
      // Verify that getSyncMetadata returns an object with expected properties
      const metadata = options.sync.getSyncMetadata()
      expectTypeOf(metadata).toHaveProperty(`storageKey`)
      expectTypeOf(metadata).toHaveProperty(`storageType`)
    }
  })

  it(`should allow optional storage and storageEventApi (defaults to window)`, () => {
    // This should compile without providing storage or storageEventApi
    const config: LocalStorageCollectionConfig<ExplicitType> = {
      storageKey: `test`,
      getKey: (item) => item.id,
    }

    expectTypeOf(config.storage).toEqualTypeOf<StorageApi | undefined>()
    expectTypeOf(config.storageEventApi).toEqualTypeOf<
      StorageEventApi | undefined
    >()
  })

  it(`should properly constrain StorageApi and StorageEventApi interfaces`, () => {
    // Test that our interfaces match the expected DOM APIs
    const localStorage: Pick<Storage, `getItem` | `setItem` | `removeItem`> = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }

    const windowEventApi: {
      addEventListener: (
        type: `storage`,
        listener: (event: StorageEvent) => void
      ) => void
      removeEventListener: (
        type: `storage`,
        listener: (event: StorageEvent) => void
      ) => void
    } = {
      addEventListener: () => {},
      removeEventListener: () => {},
    }

    // These should be assignable to our interfaces
    expectTypeOf(localStorage).toExtend<StorageApi>()
    expectTypeOf(windowEventApi).toExtend<StorageEventApi>()
  })

  it(`should work with schema and infer correct types`, () => {
    const testSchemaWithSchema = z.object({
      id: z.string(),
      entityId: z.string(),
      value: z.string(),
      createdAt: z.date().optional().default(new Date()),
    })

    // We can trust that zod infers the correct types for the schema
    type ExpectedType = z.infer<typeof testSchemaWithSchema>
    type ExpectedInput = z.input<typeof testSchemaWithSchema>

    const collection = createCollection(
      localStorageCollectionOptions({
        storageKey: `test-with-schema`,
        storage: mockStorage,
        storageEventApi: mockStorageEventApi,
        getKey: (item: any) => item.id,
        schema: testSchemaWithSchema,
        onInsert: (params) => {
          expectTypeOf(
            params.transaction.mutations[0].modified
          ).toEqualTypeOf<ExpectedType>()
          return Promise.resolve()
        },
        onUpdate: (params) => {
          expectTypeOf(
            params.transaction.mutations[0].modified
          ).toEqualTypeOf<ExpectedType>()
          return Promise.resolve()
        },
        onDelete: (params) => {
          expectTypeOf(
            params.transaction.mutations[0].modified
          ).toEqualTypeOf<ExpectedType>()
          return Promise.resolve()
        },
      })
    )

    collection.insert({
      id: `1`,
      entityId: `1`,
      value: `1`,
    })

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExpectedInput>()

    // Check that the update method accepts the expected input type
    collection.update(`1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInput>()
    })

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<ExpectedType>>()
  })

  it(`should work with explicit type for URL scenario`, () => {
    type SelectUrlType = {
      id: string
      url: string
      title: string
      createdAt: Date
    }

    const options = localStorageCollectionOptions<SelectUrlType>({
      storageKey: `test-with-url-type`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (url) => url.id,
    })

    const collection = createCollection(options)

    // Test that the collection has the expected methods
    expectTypeOf(collection.insert).toBeFunction()
    expectTypeOf(collection.get).returns.toEqualTypeOf<
      SelectUrlType | undefined
    >()
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<SelectUrlType>>()

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<SelectUrlType>()

    // Test update draft type
    collection.update(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<SelectUrlType>()
    })
  })
})
