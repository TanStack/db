import { describe, expectTypeOf, it } from 'vitest'
import {
  and,
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
  parseLoadSubsetOptions,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'
import { queryCollectionOptions } from '../src/query'
import type { QueryCollectionConfig, QueryCollectionUtils } from '../src/query'
import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  LoadSubsetOptions,
  UpdateMutationFnParams,
} from '@tanstack/db'

describe(`Query collection type resolution tests`, () => {
  // Define test types
  type ExplicitType = { id: string; explicit: boolean }

  // Create a mock QueryClient for tests
  const queryClient = new QueryClient()

  it(`should prioritize explicit type in QueryCollectionConfig`, () => {
    const options = queryCollectionOptions<ExplicitType>({
      id: `test`,
      queryClient,
      queryKey: [`test`],
      queryFn: () => Promise.resolve([]),
      getKey: (item) => item.id,
    })

    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
  })

  it(`should properly type the onInsert, onUpdate, and onDelete handlers`, () => {
    const options = queryCollectionOptions<ExplicitType>({
      id: `test`,
      queryClient,
      queryKey: [`test`],
      queryFn: () => Promise.resolve([]),
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
          QueryCollectionUtils<ExplicitType>
        >,
      ]
    >()

    expectTypeOf(options.onUpdate).parameters.toEqualTypeOf<
      [
        UpdateMutationFnParams<
          ExplicitType,
          string | number,
          QueryCollectionUtils<ExplicitType>
        >,
      ]
    >()

    expectTypeOf(options.onDelete).parameters.toEqualTypeOf<
      [
        DeleteMutationFnParams<
          ExplicitType,
          string | number,
          QueryCollectionUtils<ExplicitType>
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

    // Create query collection options with explicit type
    const queryOptions = queryCollectionOptions<UserType>({
      id: `test`,
      queryClient,
      queryKey: [`users`],
      queryFn: () => Promise.resolve([]),
      getKey: (item) => item.id,
    })

    // Create a collection using the query options
    const usersCollection = createCollection(queryOptions)

    // Test that the collection itself has the correct type
    expectTypeOf(usersCollection.toArray).toEqualTypeOf<Array<UserType>>()

    // Test that the getKey function has the correct parameter type
    expectTypeOf(queryOptions.getKey).parameters.toEqualTypeOf<[UserType]>()
  })

  it(`should infer types from Zod schema through query collection options to live query`, () => {
    // Define a Zod schema for a user with basic field types
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
      active: z.boolean(),
    })

    type UserType = z.infer<typeof userSchema>

    // Create query collection options with the schema
    const queryOptions = queryCollectionOptions({
      queryClient,
      queryKey: [`users`],
      queryFn: () => Promise.resolve([] as Array<UserType>),
      schema: userSchema,
      getKey: (item) => item.id,
    })

    // Create a collection using the query options
    const usersCollection = createCollection(queryOptions)

    // Create a live query collection that uses the users collection
    const activeUsersQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            age: user.age,
            email: user.email,
            isActive: user.active,
          })),
    })

    // Test that the query results have the correct inferred types
    const results = activeUsersQuery.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        id: string
        name: string
        age: number
        email: string
        isActive: boolean
      }>
    >()

    // Test that the collection itself has the correct type
    expectTypeOf(usersCollection.toArray).toEqualTypeOf<Array<UserType>>()

    // Test that we can access schema-inferred fields in the query with WHERE conditions
    const ageFilterQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => and(eq(user.active, true), gt(user.age, 18)))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            age: user.age,
          })),
    })

    const ageFilterResults = ageFilterQuery.toArray
    expectTypeOf(ageFilterResults).toEqualTypeOf<
      Array<{
        id: string
        name: string
        age: number
      }>
    >()

    // Test that the getKey function has the correct parameter type
    expectTypeOf(queryOptions.getKey).parameters.toEqualTypeOf<[UserType]>()
  })

  describe(`QueryFn type inference`, () => {
    interface TodoType {
      id: string
      title: string
      completed: boolean
    }

    it(`should infer types from queryFn return type`, () => {
      const options = queryCollectionOptions({
        queryClient,
        queryKey: [`queryfn-inference`],
        queryFn: async (): Promise<Array<TodoType>> => {
          return [] as Array<TodoType>
        },
        getKey: (item) => item.id,
      })

      // Should infer TodoType from queryFn
      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[TodoType]>()
    })

    it(`should throw a type error if explicit type does not match the inferred type from the queryFn`, () => {
      interface UserType {
        id: string
        name: string
      }

      queryCollectionOptions<UserType>({
        queryClient,
        queryKey: [`explicit-priority`],
        // @ts-expect-error – queryFn doesn't match the explicit type
        queryFn: async (): Promise<Array<TodoType>> => {
          return [] as Array<TodoType>
        },
        getKey: (item) => item.id,
      })
    })

    it(`should prioritize schema over queryFn`, () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })

      const options = queryCollectionOptions({
        queryClient,
        queryKey: [`schema-priority`],
        queryFn: async (): Promise<Array<z.infer<typeof userSchema>>> => {
          return [] as Array<z.infer<typeof userSchema>>
        },
        schema: userSchema,
        getKey: (item) => item.id,
      })

      // Should use schema type, not TodoType from queryFn
      type ExpectedType = z.infer<typeof userSchema>
      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExpectedType]>()
    })

    it(`should throw an error if schema type doesn't match the queryFn type`, () => {
      interface UserType {
        id: string
        name: string
      }

      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })

      const options = queryCollectionOptions({
        queryClient,
        queryKey: [`schema-priority`],
        queryFn: async () => {
          return [] as Array<UserType>
        },
        // @ts-expect-error – queryFn doesn't match the schema type
        schema: userSchema,
        getKey: (item) => item.id,
      })

      // Should use schema type, not TodoType from queryFn
      type ExpectedType = z.infer<typeof userSchema>
      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExpectedType]>()
    })

    it(`should maintain backward compatibility with explicit types`, () => {
      const options = queryCollectionOptions<TodoType>({
        queryClient,
        queryKey: [`backward-compat`],
        queryFn: async () => [] as Array<TodoType>,
        getKey: (item) => item.id,
      })

      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[TodoType]>()
    })

    it(`should work with collection creation`, () => {
      const options = queryCollectionOptions({
        queryClient,
        queryKey: [`collection-test`],
        queryFn: async (): Promise<Array<TodoType>> => {
          return [] as Array<TodoType>
        },
        getKey: (item) => item.id,
      })

      const collection = createCollection(options)
      expectTypeOf(collection.toArray).toEqualTypeOf<Array<TodoType>>()
    })
  })

  describe(`select type inference`, () => {
    it(`queryFn type inference`, () => {
      const dataSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })

      const options = queryCollectionOptions({
        queryClient,
        queryKey: [`x-queryFn-infer`],
        queryFn: async (): Promise<Array<z.infer<typeof dataSchema>>> => {
          return [] as Array<z.infer<typeof dataSchema>>
        },
        schema: dataSchema,
        getKey: (item) => item.id,
      })

      type ExpectedType = z.infer<typeof dataSchema>
      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExpectedType]>()
    })

    it(`should error when queryFn returns wrapped data without select`, () => {
      const userData = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })

      type UserDataType = z.infer<typeof userData>

      type WrappedResponse = {
        metadata: string
        data: Array<UserDataType>
      }

      queryCollectionOptions({
        queryClient,
        queryKey: [`wrapped-no-select`],
        // @ts-expect-error - queryFn returns wrapped data but no select provided
        queryFn: (): Promise<WrappedResponse> => {
          return Promise.resolve({
            metadata: `example`,
            data: [],
          })
        },
        // @ts-expect-error - schema type conflicts with queryFn return type
        schema: userData,
        // @ts-expect-error - item type is inferred as object due to type mismatch
        getKey: (item) => item.id,
      })
    })

    it(`select properly extracts array from wrapped response`, () => {
      const userData = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })

      type UserDataType = z.infer<typeof userData>

      type MetaDataType<T> = {
        metaDataOne: string
        metaDataTwo: string
        data: T
      }

      const metaDataObject: ResponseType = {
        metaDataOne: `example meta data`,
        metaDataTwo: `example meta data`,
        data: [
          {
            id: `1`,
            name: `carter`,
            email: `c@email.com`,
          },
        ],
      }

      type ResponseType = MetaDataType<Array<UserDataType>>

      const selectUserData = (data: ResponseType) => {
        return data.data
      }

      queryCollectionOptions({
        queryClient,
        queryKey: [`x-queryFn-infer`],
        queryFn: async (): Promise<ResponseType> => {
          return metaDataObject
        },
        select: selectUserData,
        schema: userData,
        getKey: (item) => item.id,
      })

      // Should infer ResponseType as select parameter type
      expectTypeOf(selectUserData).parameters.toEqualTypeOf<[ResponseType]>()
    })
  })

  describe(`loadSubsetOptions type inference`, () => {
    interface TestItem {
      id: string
      name: string
    }

    it(`should type loadSubsetOptions as LoadSubsetOptions in queryFn`, () => {
      const config: QueryCollectionConfig<TestItem> = {
        id: `loadSubsetTest`,
        queryClient,
        queryKey: [`loadSubsetTest`],
        queryFn: (ctx) => {
          // Verify that loadSubsetOptions is assignable to LoadSubsetOptions
          // This ensures it can be used where LoadSubsetOptions is expected
          expectTypeOf(
            ctx.meta!.loadSubsetOptions!,
          ).toExtend<LoadSubsetOptions>()
          // so that parseLoadSubsetOptions can be called without type errors
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
          // The fact that this call compiles without errors verifies that
          // ctx.meta.loadSubsetOptions is typed correctly as LoadSubsetOptions
          return Promise.resolve([])
        },
        getKey: (item) => item.id,
        syncMode: `on-demand`,
      }

      const options = queryCollectionOptions(config)
      createCollection(options)
    })

    it(`should allow meta to contain additional properties beyond loadSubsetOptions`, () => {
      const config: QueryCollectionConfig<TestItem> = {
        id: `loadSubsetTest`,
        queryClient,
        queryKey: [`loadSubsetTest`],
        queryFn: (ctx) => {
          // Verify that an object with loadSubsetOptions plus other properties
          // can be assigned to ctx.meta's type. This ensures the type is not too restrictive.
          const metaWithExtra = {
            loadSubsetOptions: ctx.meta!.loadSubsetOptions!,
            customProperty: `test`,
            anotherProperty: 123,
          }

          // Test that this object can be assigned to ctx.meta's type
          // This verifies that ctx.meta allows additional properties beyond loadSubsetOptions
          const typedMeta: typeof ctx.meta = metaWithExtra

          // Verify the assignment worked (this will fail at compile time if types don't match)
          expectTypeOf(
            typedMeta.loadSubsetOptions!,
          ).toExtend<LoadSubsetOptions>()

          return Promise.resolve([])
        },
        getKey: (item) => item.id,
        syncMode: `on-demand`,
      }

      const options = queryCollectionOptions(config)
      createCollection(options)
    })

    it(`should have loadSubsetOptions typed automatically without explicit QueryCollectionMeta import`, () => {
      // This test validates that the module augmentation works automatically
      // Note: We are NOT importing QueryCollectionMeta, yet ctx.meta.loadSubsetOptions
      // should still be properly typed as LoadSubsetOptions
      const config: QueryCollectionConfig<TestItem> = {
        id: `autoTypeTest`,
        queryClient,
        queryKey: [`autoTypeTest`],
        queryFn: (ctx) => {
          // This should compile without errors because the module augmentation
          // in global.d.ts is automatically loaded via the triple-slash reference
          // in index.ts
          const options = ctx.meta?.loadSubsetOptions

          // Verify the type is correct
          expectTypeOf(options).toMatchTypeOf<LoadSubsetOptions | undefined>()

          // Verify it can be passed to parseLoadSubsetOptions without type errors
          const parsed = parseLoadSubsetOptions(options)
          expectTypeOf(parsed).toMatchTypeOf<{
            filters: Array<any>
            sorts: Array<any>
            limit?: number
          }>()

          return Promise.resolve([])
        },
        getKey: (item) => item.id,
        syncMode: `on-demand`,
      }

      const options = queryCollectionOptions(config)
      createCollection(options)
    })

    it(`should allow users to extend QueryCollectionMeta via module augmentation`, () => {
      // This test validates that users can extend QueryCollectionMeta to add custom properties
      // by augmenting the @tanstack/query-db-collection module

      // In reality, users would do:
      // declare module "@tanstack/query-db-collection" {
      //   interface QueryCollectionMeta {
      //     customUserId: number
      //     customContext?: string
      //   }
      // }

      const config: QueryCollectionConfig<TestItem> = {
        id: `extendMetaTest`,
        queryClient,
        queryKey: [`extendMetaTest`],
        queryFn: (ctx) => {
          // ctx.meta still has loadSubsetOptions
          expectTypeOf(ctx.meta?.loadSubsetOptions).toMatchTypeOf<
            LoadSubsetOptions | undefined
          >()

          // This test documents the extension pattern even though we can't
          // actually augment QueryCollectionMeta in a test file (it would
          // affect all other tests in the same compilation unit)

          return Promise.resolve([])
        },
        getKey: (item) => item.id,
        syncMode: `on-demand`,
      }

      const options = queryCollectionOptions(config)
      createCollection(options)
    })
  })

  it(`should type collection.utils as QueryCollectionUtils after createCollection`, () => {
    const collection = createCollection(
      queryCollectionOptions<ExplicitType>({
        id: `test-utils-typing`,
        queryClient,
        queryKey: [`test-utils`],
        queryFn: () => Promise.resolve([]),
        getKey: (item) => item.id,
      }),
    )

    // Verify that collection.utils is typed as QueryCollectionUtils, not UtilsRecord
    const utils: QueryCollectionUtils<ExplicitType> = collection.utils
    expectTypeOf(utils.refetch).toBeFunction()
    expectTypeOf(collection.utils.refetch).toBeFunction()
    expectTypeOf(collection.utils.writeInsert).toBeFunction()
    expectTypeOf(collection.utils.writeUpdate).toBeFunction()
    expectTypeOf(collection.utils.writeDelete).toBeFunction()
    expectTypeOf(collection.utils.isFetching).toBeBoolean()
    expectTypeOf(collection.utils.isLoading).toBeBoolean()
  })
})
