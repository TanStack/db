import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type { ElectricCollectionConfig } from "../src/electric"
import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  ResolveType,
  UpdateMutationFnParams,
} from "@tanstack/db"
import type { Row } from "@electric-sql/client"

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

    type ExpectedType = ResolveType<ExplicitType, never, Row<unknown>>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()
  })

  it(`should use schema type when explicit type is not provided`, () => {
    const options = electricCollectionOptions({
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      schema: testSchema,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<unknown, typeof testSchema, Row<unknown>>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[SchemaType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<SchemaType>()
  })

  it(`should use fallback type when neither explicit nor schema type is provided`, () => {
    const config: ElectricCollectionConfig<
      Row<unknown>,
      never,
      FallbackType
    > = {
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      getKey: (item) => item.id,
    }

    const options = electricCollectionOptions<
      Row<unknown>,
      never,
      FallbackType
    >(config)

    type ExpectedType = ResolveType<unknown, never, FallbackType>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[FallbackType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<FallbackType>()
  })

  it(`should correctly resolve type with all three types provided`, () => {
    const options = electricCollectionOptions<
      ExplicitType,
      typeof testSchema,
      FallbackType
    >({
      shapeOptions: {
        url: `test_shape`,
        params: { table: `test_table` },
      },
      schema: testSchema,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<
      ExplicitType,
      typeof testSchema,
      FallbackType
    >
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()
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
          .where(({ user }) => eq(user.active, true) && gt(user.age, 18)) // eslint-disable-line @typescript-eslint/no-unnecessary-condition
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
