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

  it(`types getKey param as schema OUTPUT and onInsert as schema INPUT`, () => {
    const schema = z.object({
      id: z.string(),
      created_at: z.string().transform((s) => new Date(s)),
      updated_at: z.string().transform((s) => new Date(s)),
    })

    type Output = z.output<typeof schema>
    type Input = z.input<typeof schema>

    const testQueryClient = new QueryClient()

    const options = queryCollectionOptions({
      queryClient: testQueryClient,
      queryKey: [`users`],
      queryFn: () => Promise.resolve([] as Array<any>),
      schema,
      getKey: (item) => item.id,
      onInsert: () => Promise.resolve(),
      onUpdate: () => Promise.resolve(),
    })

    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[Output]>()
    // utils.writeInsert should accept schema INPUT
    type WriteInsertParam0 = Parameters<
      (typeof options.utils)[`writeInsert`]
    >[0]
    expectTypeOf<WriteInsertParam0>().toEqualTypeOf<Input | Array<Input>>()
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
        queryFn: (): Promise<Array<TodoType>> => {
          return Promise.resolve([] as Array<TodoType>)
        },
        getKey: (item) => item.id,
      })

      // Should infer TodoType from queryFn
      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[TodoType]>()
    })

    it(`should prioritize explicit type over queryFn`, () => {
      interface UserType {
        id: string
        name: string
      }

      const options = queryCollectionOptions<UserType>({
        queryClient,
        queryKey: [`explicit-priority`],
        queryFn: (): Promise<Array<TodoType>> => {
          return Promise.resolve([] as Array<TodoType>)
        },
        getKey: (item) => item.id,
      })

      // Should use explicit UserType, not TodoType from queryFn
      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[UserType]>()
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
        queryFn: (): Promise<Array<z.infer<typeof userSchema>>> => {
          return Promise.resolve([] as Array<z.infer<typeof userSchema>>)
        },
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
        queryFn: () => Promise.resolve([] as Array<TodoType>),
        getKey: (item) => item.id,
      })

      expectTypeOf(options.getKey).parameters.toEqualTypeOf<[TodoType]>()
    })

    it(`should work with collection creation`, () => {
      const options = queryCollectionOptions({
        queryClient,
        queryKey: [`collection-test`],
        queryFn: (): Promise<Array<TodoType>> => {
          return Promise.resolve([] as Array<TodoType>)
        },
        getKey: (item) => item.id,
      })

      const collection = createCollection(options)
      expectTypeOf(collection.toArray).toEqualTypeOf<Array<TodoType>>()
    })
  })
})
