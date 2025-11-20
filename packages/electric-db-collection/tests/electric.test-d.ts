import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import {
  and,
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type {
  ElectricCollectionConfig,
  ElectricCollectionUtils,
} from "../src/electric"
import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  UpdateMutationFnParams,
} from "@tanstack/db"

describe(`Electric collection type resolution tests`, () => {
  // Define test types
  type ExplicitType = { id: string; explicit: boolean }
  type FallbackType = { id: string; fallback: boolean }

  // Define a schema
  const testSchema = z.object({
    id: z.string(),
    schema: z.boolean(),
  })

  type SchemaType = z.infer<typeof testSchema>

  it(`should prioritize explicit type in ElectricCollectionConfig`, () => {
    const options = electricCollectionOptions<ExplicitType>({
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      getKey: (item) => item.id,
    })

    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
  })

  it(`should use schema type when a schema is provided`, () => {
    const options = electricCollectionOptions({
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      schema: testSchema,
      getKey: (item) => item.id,
    })

    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[SchemaType]>()
  })

  it(`should throw a type error when both a schema and an explicit type (that is not the type of the schema) are provided`, () => {
    electricCollectionOptions<ExplicitType>({
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      // @ts-expect-error – schema should be `undefined` because we passed an explicit type
      schema: testSchema,
      getKey: (item) => item.id,
    })
  })

  it(`should use explicit type when no schema is provided`, () => {
    const config: ElectricCollectionConfig<FallbackType> = {
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      getKey: (item) => item.id,
    }

    const options = electricCollectionOptions(config)

    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[FallbackType]>()
  })

  it(`should use getKey type when no schema and no explicit type is provided`, () => {
    const config = {
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      getKey: (item: FallbackType) => item.id,
    }

    const options = electricCollectionOptions(config)

    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[FallbackType]>()
  })

  it(`should type collection.utils as ElectricCollectionUtils<T>`, () => {
    const todoSchema = z.object({
      id: z.string(),
      title: z.string(),
      completed: z.boolean(),
    })

    type TodoType = z.infer<typeof todoSchema>

    const options = electricCollectionOptions({
      id: `todos`,
      getKey: (item) => item.id,
      shapeOptions: {
        url: `/api/todos`,
        params: { table: `todos` },
      },
      schema: todoSchema,
      onInsert: async ({ collection }) => {
        const testCollectionUtils: ElectricCollectionUtils<TodoType> =
          collection.utils
        expectTypeOf(testCollectionUtils.awaitTxId).toBeFunction
        expectTypeOf(collection.utils.awaitTxId).toBeFunction
        return Promise.resolve({ txid: 1 })
      },
    })

    // ✅ Test that options.utils is typed as ElectricCollectionUtils<TodoType>
    // The options object should have the correct type from electricCollectionOptions
    const testOptionsUtils: ElectricCollectionUtils<TodoType> = options.utils

    expectTypeOf(testOptionsUtils.awaitTxId).toBeFunction

    const todosCollection = createCollection(options)

    // Test that todosCollection.utils is ElectricCollectionUtils<TodoType>
    // Note: We can't use expectTypeOf(...).toEqualTypeOf<ElectricCollectionUtils<T>> because
    // expectTypeOf's toEqualTypeOf has a constraint that requires { [x: string]: any; [x: number]: never; },
    // but ElectricCollectionUtils extends UtilsRecord which is Record<string, any> (no number index signature).
    // This causes a constraint error instead of a type mismatch error.
    // Instead, we test via type assignment which will show a proper type error if the types don't match.
    // Currently this shows that todosCollection.utils is typed as UtilsRecord, not ElectricCollectionUtils<TodoType>
    const testTodosUtils: ElectricCollectionUtils<TodoType> =
      todosCollection.utils

    expectTypeOf(testTodosUtils.awaitTxId).toBeFunction

    // Verify the specific properties that define ElectricCollectionUtils exist and are functions
    expectTypeOf(todosCollection.utils.awaitTxId).toBeFunction
    expectTypeOf(todosCollection.utils.awaitMatch).toBeFunction
  })

  it(`should properly type the onInsert, onUpdate, and onDelete handlers`, () => {
    const options = electricCollectionOptions<ExplicitType>({
      shapeOptions: {
        url: `test_shape`,
        params: { table: `test_table` },
      },
      getKey: (item) => item.id,
      onInsert: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ txid: 1 })
      },
      onUpdate: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ txid: 1 })
      },
      onDelete: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].original
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ txid: 1 })
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

  it(`should correctly type mutations in transaction handlers when mapping over mutations array`, () => {
    const schema = z.object({
      id: z.string(),
      title: z.string(),
      completed: z.boolean(),
    })

    type TodoType = z.infer<typeof schema>

    const options = electricCollectionOptions({
      id: `todos`,
      schema,
      getKey: (item) => item.id,
      shapeOptions: {
        url: `/api/todos`,
        params: { table: `todos` },
      },
      onDelete: (params) => {
        // Direct index access should be correctly typed
        expectTypeOf(
          params.transaction.mutations[0].original
        ).toEqualTypeOf<TodoType>()

        // Non-null assertion on second element should be correctly typed
        expectTypeOf(
          params.transaction.mutations[1]!.original
        ).toEqualTypeOf<TodoType>()

        // When mapping over mutations, each mutation.original should be correctly typed
        params.transaction.mutations.map((mutation) => {
          expectTypeOf(mutation.original).toEqualTypeOf<TodoType>()
          return mutation.original.id
        })

        return Promise.resolve({ txid: 1 })
      },
      onInsert: (params) => {
        // Direct index access should be correctly typed
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<TodoType>()

        // When mapping over mutations, each mutation.modified should be correctly typed
        params.transaction.mutations.map((mutation) => {
          expectTypeOf(mutation.modified).toEqualTypeOf<TodoType>()
          return mutation.modified.id
        })

        return Promise.resolve({ txid: 1 })
      },
      onUpdate: (params) => {
        // Direct index access should be correctly typed
        expectTypeOf(
          params.transaction.mutations[0].original
        ).toEqualTypeOf<TodoType>()
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<TodoType>()

        // When mapping over mutations, each mutation should be correctly typed
        params.transaction.mutations.map((mutation) => {
          expectTypeOf(mutation.original).toEqualTypeOf<TodoType>()
          expectTypeOf(mutation.modified).toEqualTypeOf<TodoType>()
          return mutation.modified.id
        })

        return Promise.resolve({ txid: 1 })
      },
    })

    // Verify that the handlers are properly typed
    expectTypeOf(options.onDelete).parameters.toEqualTypeOf<
      [DeleteMutationFnParams<TodoType>]
    >()
    expectTypeOf(options.onInsert).parameters.toEqualTypeOf<
      [InsertMutationFnParams<TodoType>]
    >()
    expectTypeOf(options.onUpdate).parameters.toEqualTypeOf<
      [UpdateMutationFnParams<TodoType>]
    >()
  })

  it(`should infer types from Zod schema through electric collection options to live query`, () => {
    // Define a Zod schema for a user with basic field types
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
      active: z.boolean(),
    })

    type UserType = z.infer<typeof userSchema>

    // Create electric collection options with the schema
    const electricOptions = electricCollectionOptions({
      shapeOptions: {
        url: `test_shape`,
        params: { table: `users` },
      },
      schema: userSchema,
      getKey: (item) => item.id,
    })

    // Create a collection using the electric options
    const usersCollection = createCollection(electricOptions)

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
    expectTypeOf(electricOptions.getKey).parameters.toEqualTypeOf<[UserType]>()
  })

  it(`should demonstrate the difference between electric options and direct createCollection with schema`, () => {
    // Define a Zod schema with basic fields
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
      active: z.boolean(),
    })

    type UserType = z.infer<typeof userSchema>

    // Method 1: Using electric collection options (WORKS)
    const electricOptions = electricCollectionOptions({
      shapeOptions: {
        url: `test_shape`,
        params: { table: `users` },
      },
      schema: userSchema,
      getKey: (item) => item.id,
    })

    const electricCollection = createCollection(electricOptions)

    // Method 2: Using direct createCollection with schema (FAILS with never types)
    const directCollection = createCollection({
      id: `test-direct`,
      schema: userSchema,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    // Test that electric collection works correctly
    const electricQuery = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: electricCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
          age: user.age,
        })),
    })

    const electricResults = electricQuery.toArray
    expectTypeOf(electricResults).toEqualTypeOf<
      Array<{
        id: string
        name: string
        age: number
      }>
    >()

    // Test that direct collection has the correct type
    expectTypeOf(directCollection.toArray).toEqualTypeOf<Array<UserType>>()

    // The key insight: electric collection options properly resolve schema types
    // while direct createCollection with schema doesn't work in query builder
    expectTypeOf(electricOptions.getKey).parameters.toEqualTypeOf<[UserType]>()
  })
})
