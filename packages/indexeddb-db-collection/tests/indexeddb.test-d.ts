import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { z } from 'zod'
import {
  indexedDBCollectionOptions,
} from '../src'
import type {
  DatabaseInfo,
  IndexedDBCollectionConfig,
  IndexedDBCollectionUtils,
  IndexedDBInstance,
} from '../src'
import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  UpdateMutationFnParams,
} from '@tanstack/db'

// Mock IndexedDBInstance for type testing
const mockDbInstance: IndexedDBInstance = {
  db: {
    objectStoreNames: { contains: () => true },
  } as unknown as IDBDatabase,
  name: `test-db`,
  version: 1,
  stores: [`test-store`, `users`, `todos`, `numeric`, `items`],
  close: () => {},
}

describe(`IndexedDB collection type resolution tests`, () => {
  // Define test types
  type ExplicitType = { id: string; explicit: boolean }

  it(`should prioritize explicit type in IndexedDBCollectionConfig`, () => {
    const options = indexedDBCollectionOptions<ExplicitType>({
      db: mockDbInstance,
      name: `test-store`,
      getKey: (item) => item.id,
    })

    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
  })

  it(`should properly type the onInsert, onUpdate, and onDelete handlers`, () => {
    const options = indexedDBCollectionOptions<ExplicitType>({
      db: mockDbInstance,
      name: `test-store`,
      getKey: (item) => item.id,
      onInsert: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified,
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve()
      },
      onUpdate: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified,
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve()
      },
      onDelete: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].original,
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve()
      },
    })

    // Verify that the handlers are properly typed
    expectTypeOf(options.onInsert).parameters.toEqualTypeOf<
      [
        InsertMutationFnParams<
          ExplicitType,
          string | number,
          IndexedDBCollectionUtils<ExplicitType, string | number, ExplicitType>
        >,
      ]
    >()

    expectTypeOf(options.onUpdate).parameters.toEqualTypeOf<
      [
        UpdateMutationFnParams<
          ExplicitType,
          string | number,
          IndexedDBCollectionUtils<ExplicitType, string | number, ExplicitType>
        >,
      ]
    >()

    expectTypeOf(options.onDelete).parameters.toEqualTypeOf<
      [
        DeleteMutationFnParams<
          ExplicitType,
          string | number,
          IndexedDBCollectionUtils<ExplicitType, string | number, ExplicitType>
        >,
      ]
    >()
  })

  it(`should create collection with explicit types`, () => {
    // Define a user type
    type UserType = {
      id: string
      name: string
      age: number
      email: string
      active: boolean
    }

    // Create IndexedDB collection options with explicit type
    const idbOptions = indexedDBCollectionOptions<UserType>({
      db: mockDbInstance,
      name: `users`,
      getKey: (item) => item.id,
    })

    // Create a collection using the options
    const usersCollection = createCollection(idbOptions)

    // Test that the collection itself has the correct type
    expectTypeOf(usersCollection.toArray).toEqualTypeOf<Array<UserType>>()

    // Test that the getKey function has the correct parameter type
    expectTypeOf(idbOptions.getKey).parameters.toEqualTypeOf<[UserType]>()
  })

  it(`should infer types from Zod schema`, () => {
    // Define a Zod schema for a user with basic field types
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
      active: z.boolean(),
    })

    type UserType = z.infer<typeof userSchema>

    // Create IndexedDB collection options with the schema
    const idbOptions = indexedDBCollectionOptions({
      db: mockDbInstance,
      name: `users`,
      schema: userSchema,
      getKey: (item) => item.id,
    })

    // Create a collection using the options
    const usersCollection = createCollection(idbOptions)

    // Test that the collection itself has the correct type
    expectTypeOf(usersCollection.toArray).toEqualTypeOf<Array<UserType>>()

    // Test that the getKey function has the correct parameter type
    expectTypeOf(idbOptions.getKey).parameters.toEqualTypeOf<[UserType]>()
  })

  describe(`Key type inference`, () => {
    interface TodoType {
      id: string
      title: string
      completed: boolean
    }

    interface NumericKeyType {
      num: number
      value: string
    }

    it(`should infer string key type from getKey`, () => {
      const options = indexedDBCollectionOptions<TodoType, string>({
        db: mockDbInstance,
        name: `todos`,
        getKey: (item) => item.id,
      })

      // getKey should return string
      expectTypeOf(options.getKey).returns.toEqualTypeOf<string>()
    })

    it(`should infer number key type from getKey`, () => {
      const options = indexedDBCollectionOptions<NumericKeyType, number>({
        db: mockDbInstance,
        name: `numeric`,
        getKey: (item) => item.num,
      })

      // getKey should return number
      expectTypeOf(options.getKey).returns.toEqualTypeOf<number>()
    })

    it(`should use default key type (string | number) when not specified`, () => {
      const options = indexedDBCollectionOptions<TodoType>({
        db: mockDbInstance,
        name: `todos`,
        getKey: (item) => item.id,
      })

      // getKey should accept string | number return by default
      expectTypeOf(options.getKey).returns.toMatchTypeOf<string | number>()
    })
  })

  describe(`Config options type checking`, () => {
    interface TestItem {
      id: string
      name: string
    }

    it(`should require db option`, () => {
      const config: IndexedDBCollectionConfig<TestItem> = {
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      }

      expectTypeOf(config.db).toEqualTypeOf<IndexedDBInstance>()
    })

    it(`should require name option`, () => {
      const config: IndexedDBCollectionConfig<TestItem> = {
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      }

      expectTypeOf(config.name).toEqualTypeOf<string>()
    })

    it(`should require getKey option`, () => {
      const config: IndexedDBCollectionConfig<TestItem> = {
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      }

      expectTypeOf(config.getKey).toBeFunction()
      expectTypeOf(config.getKey).parameters.toEqualTypeOf<[TestItem]>()
    })

    it(`should accept optional id`, () => {
      const config: IndexedDBCollectionConfig<TestItem> = {
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
        id: `custom-id`,
      }

      expectTypeOf(config.id).toEqualTypeOf<string | undefined>()
    })
  })

  describe(`Utility function types`, () => {
    interface TestItem {
      id: string
      name: string
    }

    it(`should type clearObjectStore as returning Promise<void>`, () => {
      const options = indexedDBCollectionOptions<TestItem>({
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      })

      expectTypeOf(options.utils.clearObjectStore).returns.toEqualTypeOf<
        Promise<void>
      >()
    })

    it(`should type deleteDatabase as returning Promise<void>`, () => {
      const options = indexedDBCollectionOptions<TestItem>({
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      })

      expectTypeOf(options.utils.deleteDatabase).returns.toEqualTypeOf<
        Promise<void>
      >()
    })

    it(`should type getDatabaseInfo as returning Promise<DatabaseInfo>`, () => {
      const options = indexedDBCollectionOptions<TestItem>({
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      })

      expectTypeOf(options.utils.getDatabaseInfo).returns.toEqualTypeOf<
        Promise<DatabaseInfo>
      >()
    })

    it(`should type exportData as returning Promise<T[]>`, () => {
      const options = indexedDBCollectionOptions<TestItem>({
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      })

      expectTypeOf(options.utils.exportData).returns.toEqualTypeOf<
        Promise<Array<TestItem>>
      >()
    })

    it(`should type importData as accepting T[] and returning Promise<void>`, () => {
      const options = indexedDBCollectionOptions<TestItem>({
        db: mockDbInstance,
        name: `test-store`,
        getKey: (item) => item.id,
      })

      expectTypeOf(options.utils.importData).parameters.toEqualTypeOf<
        [Array<TestItem>]
      >()
      expectTypeOf(options.utils.importData).returns.toEqualTypeOf<
        Promise<void>
      >()
    })

    it(`should type DatabaseInfo correctly`, () => {
      const info: DatabaseInfo = {
        name: `test-db`,
        version: 1,
        objectStores: [`store1`, `store2`],
        estimatedSize: 1024,
      }

      expectTypeOf(info.name).toEqualTypeOf<string>()
      expectTypeOf(info.version).toEqualTypeOf<number>()
      expectTypeOf(info.objectStores).toEqualTypeOf<Array<string>>()
      expectTypeOf(info.estimatedSize).toEqualTypeOf<number | undefined>()
    })
  })

  describe(`Schema vs no schema usage`, () => {
    it(`should work without schema using explicit generic`, () => {
      interface Todo {
        id: number
        title: string
        done: boolean
      }

      const options = indexedDBCollectionOptions<Todo>({
        db: mockDbInstance,
        name: `todos`,
        getKey: (item) => item.id,
      })

      expectTypeOf(options.getKey).parameter(0).toMatchTypeOf<Todo>()
      expectTypeOf(options.schema).toEqualTypeOf<never | undefined>()
    })

    it(`should infer item type from schema when provided`, () => {
      const todoSchema = z.object({
        id: z.number(),
        title: z.string(),
        done: z.boolean(),
      })

      const options = indexedDBCollectionOptions({
        db: mockDbInstance,
        name: `todos`,
        schema: todoSchema,
        getKey: (item) => item.id,
      })

      type ExpectedType = z.infer<typeof todoSchema>
      expectTypeOf(options.getKey).parameter(0).toMatchTypeOf<ExpectedType>()
      expectTypeOf(options.schema).toEqualTypeOf<typeof todoSchema>()
    })
  })

  describe(`Mutation handler parameter types`, () => {
    interface Item {
      id: string
      value: number
    }

    it(`should type onInsert params correctly`, () => {
      indexedDBCollectionOptions<Item>({
        db: mockDbInstance,
        name: `items`,
        getKey: (item) => item.id,
        onInsert: (params) => {
          // transaction should have mutations array
          expectTypeOf(params.transaction.mutations).toBeArray()
          // Each mutation should have modified field with correct type
          expectTypeOf(
            params.transaction.mutations[0].modified,
          ).toEqualTypeOf<Item>()
          // collection should be accessible and have correct type
          expectTypeOf(params.collection.get).toBeFunction()
          return Promise.resolve()
        },
      })
    })

    it(`should type onUpdate params correctly`, () => {
      indexedDBCollectionOptions<Item>({
        db: mockDbInstance,
        name: `items`,
        getKey: (item) => item.id,
        onUpdate: (params) => {
          // transaction should have mutations array
          expectTypeOf(params.transaction.mutations).toBeArray()
          // Each mutation should have modified field with correct type
          expectTypeOf(
            params.transaction.mutations[0].modified,
          ).toEqualTypeOf<Item>()
          // Each mutation should have original field with correct type
          expectTypeOf(
            params.transaction.mutations[0].original,
          ).toEqualTypeOf<Item>()
          // collection should be accessible and have correct type
          expectTypeOf(params.collection.get).toBeFunction()
          return Promise.resolve()
        },
      })
    })

    it(`should type onDelete params correctly`, () => {
      indexedDBCollectionOptions<Item>({
        db: mockDbInstance,
        name: `items`,
        getKey: (item) => item.id,
        onDelete: (params) => {
          // transaction should have mutations array
          expectTypeOf(params.transaction.mutations).toBeArray()
          // Each mutation should have original field with correct type
          expectTypeOf(
            params.transaction.mutations[0].original,
          ).toEqualTypeOf<Item>()
          // Each mutation should have key
          expectTypeOf(
            params.transaction.mutations[0].key,
          ).toMatchTypeOf<string | number>()
          // collection should be accessible and have correct type
          expectTypeOf(params.collection.get).toBeFunction()
          return Promise.resolve()
        },
      })
    })
  })

  describe(`Utils type inference with schema`, () => {
    it(`should properly type utils with schema inference`, () => {
      const itemSchema = z.object({
        id: z.string(),
        name: z.string(),
        count: z.number(),
      })

      type ItemType = z.infer<typeof itemSchema>

      const options = indexedDBCollectionOptions({
        db: mockDbInstance,
        name: `items`,
        schema: itemSchema,
        getKey: (item) => item.id,
      })

      // exportData should return Promise<ItemType[]>
      expectTypeOf(options.utils.exportData).returns.toEqualTypeOf<
        Promise<Array<ItemType>>
      >()

      // importData should accept ItemType[]
      expectTypeOf(options.utils.importData).parameters.toMatchTypeOf<
        [Array<ItemType>]
      >()
    })
  })
})
