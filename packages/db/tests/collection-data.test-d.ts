import { describe, expectTypeOf, test } from 'vitest'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import {
  createCollection,
  getCollectionData,
  getCollectionDataWhenReady,
} from '../src/collection/index.js'
import { mockSyncCollectionOptions } from './utils.js'

type User = {
  id: string
  name: string
  email: string
}

const usersCollection = createCollection(
  mockSyncCollectionOptions<User>({
    id: `test-users-collection-data`,
    getKey: (user) => user.id,
    initialData: [],
  }),
)

describe(`getCollectionData()`, () => {
  test(`returns T | undefined for findOne() queries`, () => {
    const userQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.id, `test-id`))
          .findOne(),
    })

    const data = getCollectionData(userQuery)

    expectTypeOf(data).toEqualTypeOf<User | undefined>()
  })

  test(`returns T[] for regular queries`, () => {
    const usersQuery = createLiveQueryCollection({
      query: (q) => q.from({ user: usersCollection }),
    })

    const data = getCollectionData(usersQuery)

    expectTypeOf(data).toEqualTypeOf<Array<User>>()
  })

  test(`returns T | undefined for findOne() with select()`, () => {
    const userQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.id, `test-id`))
          .select(({ user }) => ({ name: user.name, email: user.email }))
          .findOne(),
    })

    const data = getCollectionData(userQuery)

    expectTypeOf(data).toEqualTypeOf<
      { name: string; email: string } | undefined
    >()
  })

  test(`returns T[] for queries with select()`, () => {
    const usersQuery = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          name: user.name,
          email: user.email,
        })),
    })

    const data = getCollectionData(usersQuery)

    expectTypeOf(data).toEqualTypeOf<Array<{ name: string; email: string }>>()
  })

  test(`returns T[] for limit(1) queries (limit is not findOne)`, () => {
    const usersQuery = createLiveQueryCollection({
      query: (q) => q.from({ user: usersCollection }).limit(1),
    })

    const data = getCollectionData(usersQuery)

    expectTypeOf(data).toEqualTypeOf<Array<User>>()
  })
})

describe(`getCollectionDataWhenReady()`, () => {
  test(`returns Promise<T | undefined> for findOne() queries`, () => {
    const userQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.id, `test-id`))
          .findOne(),
    })

    const dataPromise = getCollectionDataWhenReady(userQuery)

    expectTypeOf(dataPromise).toEqualTypeOf<Promise<User | undefined>>()
  })

  test(`returns Promise<T[]> for regular queries`, () => {
    const usersQuery = createLiveQueryCollection({
      query: (q) => q.from({ user: usersCollection }),
    })

    const dataPromise = getCollectionDataWhenReady(usersQuery)

    expectTypeOf(dataPromise).toEqualTypeOf<Promise<Array<User>>>()
  })

  test(`returns Promise<T | undefined> for findOne() with select()`, () => {
    const userQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.id, `test-id`))
          .select(({ user }) => ({ name: user.name, email: user.email }))
          .findOne(),
    })

    const dataPromise = getCollectionDataWhenReady(userQuery)

    expectTypeOf(dataPromise).toEqualTypeOf<
      Promise<{ name: string; email: string } | undefined>
    >()
  })

  test(`returns Promise<T[]> for queries with select()`, () => {
    const usersQuery = createLiveQueryCollection({
      query: (q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          name: user.name,
          email: user.email,
        })),
    })

    const dataPromise = getCollectionDataWhenReady(usersQuery)

    expectTypeOf(dataPromise).toEqualTypeOf<
      Promise<Array<{ name: string; email: string }>>
    >()
  })
})
