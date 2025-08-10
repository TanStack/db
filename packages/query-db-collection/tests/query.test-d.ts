import { describe, expectTypeOf, it } from "vitest"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from "@tanstack/db"
import { QueryClient } from "@tanstack/query-core"
import { z } from "zod"
import { queryCollectionOptions } from "../src/query"
import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  UpdateMutationFnParams,
} from "@tanstack/db"

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
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve()
      },
      onUpdate: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve()
      },
      onDelete: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].original
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve()
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
    expectTypeOf(queryOptions.getKey).parameters.toEqualTypeOf<[UserType]>()
  })
})
