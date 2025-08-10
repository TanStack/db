import { describe, expectTypeOf, test } from "vitest"
import { z } from "zod"
import { type } from "arktype"
import { createLiveQueryCollection, eq, gt } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
}

// Sample data for tests
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 25, email: `alice@example.com`, active: true },
  { id: 2, name: `Bob`, age: 19, email: `bob@example.com`, active: true },
]

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
    })
  )
}

describe(`Query Basic Types`, () => {
  const usersCollection = createUsersCollection()

  test(`basic select query return type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
          age: user.age,
          email: user.email,
          active: user.active,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        id: number
        name: string
        age: number
        email: string
        active: boolean
      }>
    >()
  })

  test(`query function syntax return type`, () => {
    const liveCollection = createLiveQueryCollection((q) =>
      q.from({ user: usersCollection }).select(({ user }) => ({
        id: user.id,
        name: user.name,
        age: user.age,
        email: user.email,
        active: user.active,
      }))
    )

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        id: number
        name: string
        age: number
        email: string
        active: boolean
      }>
    >()
  })

  test(`WHERE with SELECT return type`, () => {
    const activeLiveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            active: user.active,
          })),
    })

    const results = activeLiveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        id: number
        name: string
        active: boolean
      }>
    >()
  })

  test(`SELECT projection return type`, () => {
    const projectedLiveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => gt(user.age, 20))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            isAdult: user.age,
          })),
    })

    const results = projectedLiveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        id: number
        name: string
        isAdult: number
      }>
    >()
  })

  test(`custom getKey return type`, () => {
    const customKeyCollection = createLiveQueryCollection({
      id: `custom-key-users`,
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          userId: user.id,
          userName: user.name,
        })),
      getKey: (item) => item.userId,
    })

    const results = customKeyCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        userId: number
        userName: string
      }>
    >()
  })

  test(`auto-generated IDs return type`, () => {
    const collection1 = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
        })),
    })

    const collection2 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
          })),
    })

    const results1 = collection1.toArray
    expectTypeOf(results1).toEqualTypeOf<
      Array<{
        id: number
        name: string
      }>
    >()

    const results2 = collection2.toArray
    expectTypeOf(results2).toEqualTypeOf<
      Array<{
        id: number
        name: string
      }>
    >()
  })

  test(`no select returns original collection type`, () => {
    const liveCollection = createLiveQueryCollection({
      query: (q) => q.from({ user: usersCollection }),
    })

    const results = liveCollection.toArray
    // Should return the original User type, not namespaced
    expectTypeOf(results).toEqualTypeOf<Array<User>>()
  })

  test(`no select with WHERE returns original collection type`, () => {
    const activeLiveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true)),
    })

    const results = activeLiveCollection.toArray
    // Should return the original User type, not namespaced
    expectTypeOf(results).toEqualTypeOf<Array<User>>()
  })

  test(`query function syntax with no select returns original type`, () => {
    const liveCollection = createLiveQueryCollection((q) =>
      q.from({ user: usersCollection }).where(({ user }) => gt(user.age, 20))
    )

    const results = liveCollection.toArray
    // Should return the original User type, not namespaced
    expectTypeOf(results).toEqualTypeOf<Array<User>>()
  })

  test(`selecting optional field should work`, () => {
    // Define a type with an optional field
    type UserWithOptional = {
      id: number
      name: string
      inserted_at?: Date
    }

    const usersWithOptionalCollection = createCollection(
      mockSyncCollectionOptions<UserWithOptional>({
        id: `test-users-optional`,
        getKey: (user) => user.id,
        initialData: [],
      })
    )

    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersWithOptionalCollection }).select(({ user }) => ({
          inserted_at: user.inserted_at,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        inserted_at: Date | undefined
      }>
    >()
  })

  test(`selecting optional field with Zod schema should work`, () => {
    // Define a Zod schema with optional field using .optional()
    const userWithOptionalSchema = z.object({
      id: z.number(),
      name: z.string(),
      inserted_at: z.date().optional(), // Optional using .optional()
    })

    const usersWithOptionalCollection = createCollection({
      id: `test-users-zod-optional`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userWithOptionalSchema,
    })

    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersWithOptionalCollection }).select(({ user }) => ({
          inserted_at: user.inserted_at,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        inserted_at: Date | undefined
      }>
    >()
  })

  test(`selecting union field with Zod schema should work`, () => {
    // Define a Zod schema with union type field
    const userWithUnionSchema = z.object({
      id: z.number(),
      name: z.string(),
      status: z.union([z.literal(`active`), z.literal(`inactive`)]).optional(),
    })

    const usersWithUnionCollection = createCollection({
      id: `test-users-zod-union`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userWithUnionSchema,
    })

    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersWithUnionCollection }).select(({ user }) => ({
          status: user.status,
          name: user.name,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        status: `active` | `inactive` | undefined
        name: string
      }>
    >()
  })
})

describe(`Query Basic Types with ArkType Schemas`, () => {
  test(`selecting optional field with ArkType schema should work`, () => {
    // Define an ArkType schema with optional field using "field?"
    const userWithOptionalSchema = type({
      id: `number`,
      name: `string`,
      "inserted_at?": `Date`, // Optional using "field?"
    })

    const usersWithOptionalCollection = createCollection({
      id: `test-users-arktype-optional`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userWithOptionalSchema,
    })

    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersWithOptionalCollection }).select(({ user }) => ({
          inserted_at: user.inserted_at,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        inserted_at: Date | undefined
      }>
    >()
  })

  test(`selecting union field with ArkType schema should work`, () => {
    // Define an ArkType schema with union type field
    const userWithUnionSchema = type({
      id: `number`,
      name: `string`,
      "status?": `"active" | "inactive"`, // Union type with optional
    })

    const usersWithUnionCollection = createCollection({
      id: `test-users-arktype-union`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userWithUnionSchema,
    })

    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersWithUnionCollection }).select(({ user }) => ({
          status: user.status,
          name: user.name,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        status: `active` | `inactive` | undefined
        name: string
      }>
    >()
  })

  test(`selecting array field with ArkType schema should work`, () => {
    // Define an ArkType schema with array field
    const userWithArraySchema = type({
      id: `number`,
      name: `string`,
      "tags?": `string[]`, // Array type with optional
    })

    const usersWithArrayCollection = createCollection({
      id: `test-users-arktype-array`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userWithArraySchema,
    })

    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersWithArrayCollection }).select(({ user }) => ({
          tags: user.tags,
          name: user.name,
        })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        tags: Array<string> | undefined
        name: string
      }>
    >()
  })

  test(`WHERE with ArkType schema should work`, () => {
    // Define an ArkType schema with validation
    const userSchema = type({
      id: `number`,
      name: `string > 0`,
      age: `number.integer > 0`,
      "email?": `string.email`,
    })

    const usersCollection = createCollection({
      id: `test-users-arktype-where`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })

    const liveCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => gt(user.age, 20))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            age: user.age,
            email: user.email,
          })),
    })

    const results = liveCollection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<{
        id: number
        name: string
        age: number
        email: string | undefined
      }>
    >()
  })
})
