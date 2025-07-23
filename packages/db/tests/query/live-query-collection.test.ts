import { beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection.js"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { Query } from "../../src/query/builder/index.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  active: boolean
}

// Sample data for tests
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, active: true },
  { id: 2, name: `Bob`, active: true },
  { id: 3, name: `Charlie`, active: false },
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

describe(`createLiveQueryCollection`, () => {
  let usersCollection: ReturnType<typeof createUsersCollection>

  beforeEach(() => {
    usersCollection = createUsersCollection()
  })

  it(`should accept a callback function`, async () => {
    const activeUsers = createLiveQueryCollection((q) =>
      q
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.active, true))
    )

    await activeUsers.preload()

    expect(activeUsers).toBeDefined()
    expect(activeUsers.size).toBe(2) // Only Alice and Bob are active
  })

  it(`should accept a QueryBuilder instance via config object`, async () => {
    const queryBuilder = new Query()
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))

    const activeUsers = createLiveQueryCollection({
      query: queryBuilder,
    })

    await activeUsers.preload()

    expect(activeUsers).toBeDefined()
    expect(activeUsers.size).toBe(2) // Only Alice and Bob are active
  })

  it(`should work with both callback and QueryBuilder instance via config`, async () => {
    // Test with callback
    const activeUsers1 = createLiveQueryCollection((q) =>
      q
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.active, true))
    )

    // Test with QueryBuilder instance via config
    const queryBuilder = new Query()
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.active, true))

    const activeUsers2 = createLiveQueryCollection({
      query: queryBuilder,
    })

    await activeUsers1.preload()
    await activeUsers2.preload()

    expect(activeUsers1).toBeDefined()
    expect(activeUsers2).toBeDefined()
    expect(activeUsers1.size).toBe(2)
    expect(activeUsers2.size).toBe(2)
  })

  it(`should call markReady when source collection returns empty array`, async () => {
    // Create an empty source collection using the mock sync options
    const emptyUsersCollection = createCollection(
      mockSyncCollectionOptions<User>({
        id: `empty-test-users`,
        getKey: (user) => user.id,
        initialData: [], // Empty initial data
      })
    )

    // Create a live query collection that depends on the empty source collection
    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ user: emptyUsersCollection })
        .where(({ user }) => eq(user.active, true))
    )

    // This should resolve and not hang, even though the source collection is empty
    await liveQuery.preload()

    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(0)
  })

  it(`should call markReady when source collection sync doesn't call begin/commit (without WHERE clause)`, async () => {
    // Create a collection with sync that only calls markReady (like the reproduction case)
    const problemCollection = createCollection<User>({
      id: `problem-collection`,
      sync: {
        sync: ({ markReady }) => {
          // Simulate async operation without begin/commit (like empty queryFn case)
          setTimeout(() => {
            markReady()
          }, 50)
          return () => {} // cleanup function
        },
      },
      getKey: (user) => user.id,
    })

    // Create a live query collection that depends on the problematic source collection
    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ user: problemCollection })
    )

    // This should resolve and not hang, even though the source collection doesn't commit data
    await liveQuery.preload()

    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(0)
  })

  it(`should call markReady when source collection sync doesn't call begin/commit (with WHERE clause)`, async () => {
    // Create a collection with sync that only calls markReady (like the reproduction case)
    const problemCollection = createCollection<User>({
      id: `problem-collection-where`,
      sync: {
        sync: ({ markReady }) => {
          // Simulate async operation without begin/commit (like empty queryFn case)
          setTimeout(() => {
            markReady()
          }, 50)
          return () => {} // cleanup function
        },
      },
      getKey: (user) => user.id,
    })

    // Create a live query collection that depends on the problematic source collection
    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ user: problemCollection })
        .where(({ user }) => eq(user.active, true))
    )

    // This should resolve and not hang, even though the source collection doesn't commit data
    await liveQuery.preload()

    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(0)
  })
})
