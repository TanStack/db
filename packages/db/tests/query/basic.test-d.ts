import { describe, expectTypeOf, test } from "vitest"
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
})
