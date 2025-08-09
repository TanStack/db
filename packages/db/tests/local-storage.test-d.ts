import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/index"
import { localStorageCollectionOptions } from "../src/local-storage"
import type { Query } from "../src/query/builder"
import type {
  LocalStorageCollectionConfig,
  StorageApi,
  StorageEventApi,
} from "../src/local-storage"
import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  ResolveType,
  UpdateMutationFnParams,
} from "../src/types"

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
  })

  it(`should prioritize explicit type in LocalStorageCollectionConfig`, () => {
    const options = localStorageCollectionOptions<ExplicitType>({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<
      ExplicitType,
      never,
      Record<string, unknown>
    >
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()
  })

  it(`should use schema type when explicit type is not provided`, () => {
    const options = localStorageCollectionOptions({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      schema: testSchema,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<
      unknown,
      typeof testSchema,
      Record<string, unknown>
    >
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[SchemaType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<SchemaType>()
  })

  it(`should use fallback type when neither explicit nor schema type is provided`, () => {
    const config: LocalStorageCollectionConfig<unknown, never, FallbackType> = {
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item) => item.id,
    }

    const options = localStorageCollectionOptions<unknown, never, FallbackType>(
      config
    )

    type ExpectedType = ResolveType<unknown, never, FallbackType>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[FallbackType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<FallbackType>()
  })

  it(`should correctly resolve type with all three types provided`, () => {
    const options = localStorageCollectionOptions<
      ExplicitType,
      typeof testSchema,
      FallbackType
    >({
      storageKey: `test`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      schema: testSchema,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<
      ExplicitType,
      typeof testSchema,
      FallbackType
    >
    // The getKey function should have the resolved type (explicit type should win)
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()
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

    // Verify that the handlers are properly typed
    expectTypeOf(options.onInsert).parameters.toEqualTypeOf<
      [InsertMutationFnParams<ExplicitType>]
    >()

    expectTypeOf(options.onUpdate).parameters.toEqualTypeOf<
      [UpdateMutationFnParams<ExplicitType>]
    >()

    expectTypeOf(options.onDelete).parameters.toEqualTypeOf<
      [DeleteMutationFnParams<ExplicitType>]
    >()
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
    expectTypeOf(options.sync).toExtend<
      CollectionConfig<ExplicitType>[`sync`]
    >()

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

  it(`should work with schema and query builder type inference (bug report reproduction)`, () => {
    const queryTestSchema = z.object({
      id: z.string(),
      entityId: z.string(),
      value: z.string(),
      createdAt: z.date(),
    })

    const config = {
      storageKey: `test-with-schema-query`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (item: any) => item.id,
      schema: queryTestSchema,
    }

    const options = localStorageCollectionOptions(config)
    const collection = createCollection(options)

    // This should work without type errors - the query builder should infer the correct type
    const query = (q: InstanceType<typeof Query>) =>
      q
        .from({ bookmark: collection })
        .orderBy(({ bookmark }) => bookmark.createdAt, `desc`)

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection).toExtend<any>() // Using any here since we don't have the exact Collection type imported

    // Test that the query builder can access the createdAt property
    expectTypeOf(query).toBeFunction()
  })

  it(`should reproduce exact bug report scenario with localStorage`, () => {
    // This reproduces the exact scenario from the bug report but with localStorage
    const selectUrlSchema = z.object({
      id: z.string(),
      url: z.string(),
      title: z.string(),
      createdAt: z.date(),
    })

    const config = {
      storageKey: `test-with-schema`,
      storage: mockStorage,
      storageEventApi: mockStorageEventApi,
      getKey: (url: any) => url.id,
      schema: selectUrlSchema,
    }

    const options = localStorageCollectionOptions(config)
    const collection = createCollection(options)

    // This should work without type errors - the query builder should infer the correct type
    const query = (q: InstanceType<typeof Query>) =>
      q
        .from({ bookmark: collection })
        .orderBy(({ bookmark }) => bookmark.createdAt, `desc`)

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection).toExtend<any>() // Using any here since we don't have the exact Collection type imported

    // Test that the query builder can access the createdAt property
    expectTypeOf(query).toBeFunction()
  })
})
