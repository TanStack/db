import { beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection.js"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { Query } from "../../src/query/builder/index.js"
import { mockSyncCollectionOptions } from "../utls.js"
import type { ChangeMessage } from "../../src/types.js"

// This test file includes tests that reproduce a bug where live query collections
// don't properly transition to 'ready' status when source collections are preloaded
// after the live query collection is created.
//
// The issue: When a live query collection is created before its source collections
// are preloaded, the live query gets stuck in 'initialCommit' status instead of
// transitioning to 'ready' status, even though it has the correct data.
//
// This matches the original error report: "if I don't preload the collection before
// rendering, It won't update after being loaded. It'll only update, when some
// mutation/remote update happens"

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

  it(`shouldn't call markReady when source collection sync doesn't call markReady`, () => {
    const collection = createCollection<{ id: string }>({
      sync: {
        sync({ begin, commit }) {
          begin()
          commit()
        },
      },
      getKey: (item) => item.id,
      startSync: true,
    })

    const liveQuery = createLiveQueryCollection({
      query: (q) => q.from({ collection }),
      startSync: true,
    })
    expect(liveQuery.isReady()).toBe(false)
  })

  it(`should update after source collection is loaded even when not preloaded before rendering - REPRODUCES BUG`, async () => {
    // Create a source collection that doesn't start sync immediately
    let beginCallback: (() => void) | undefined
    let writeCallback:
      | ((message: Omit<ChangeMessage<User, string | number>, `key`>) => void)
      | undefined
    let markReadyCallback: (() => void) | undefined
    let commitCallback: (() => void) | undefined

    const sourceCollection = createCollection<User>({
      id: `delayed-source-collection`,
      getKey: (user) => user.id,
      startSync: false, // Don't start sync immediately
      sync: {
        sync: ({ begin, commit, write, markReady }) => {
          beginCallback = begin
          commitCallback = commit
          markReadyCallback = markReady
          writeCallback = write
          return () => {} // cleanup function
        },
      },
      onInsert: ({ transaction }) => {
        const newItem = transaction.mutations[0].modified
        // We need to call begin, write, and commit to properly sync the data
        beginCallback!()
        writeCallback!({
          type: `insert`,
          value: newItem,
        })
        commitCallback!()
        return Promise.resolve()
      },
      onUpdate: () => Promise.resolve(),
      onDelete: () => Promise.resolve(),
    })

    // Create a live query collection BEFORE the source collection is preloaded
    // This simulates the scenario where the live query is created during rendering
    // but the source collection hasn't been preloaded yet
    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ user: sourceCollection })
        .where(({ user }) => eq(user.active, true))
    )

    // Initially, the live query should be in idle state (default startSync: false)
    expect(liveQuery.status).toBe(`idle`)
    expect(liveQuery.size).toBe(0)

    // Now preload the source collection (simulating what happens after rendering)
    sourceCollection.preload()

    // Store the promise so we can wait for it later
    const preloadPromise = liveQuery.preload()

    // Trigger the initial data load first
    if (beginCallback && writeCallback && commitCallback && markReadyCallback) {
      beginCallback()
      // Write initial data
      writeCallback({
        type: `insert`,
        value: { id: 1, name: `Alice`, active: true },
      })
      writeCallback({
        type: `insert`,
        value: { id: 2, name: `Bob`, active: false },
      })
      writeCallback({
        type: `insert`,
        value: { id: 3, name: `Charlie`, active: true },
      })
      commitCallback()
      markReadyCallback()
    }

    // Wait for the preload to complete
    await preloadPromise

    // The live query should be ready and have the initial data
    expect(liveQuery.size).toBe(2) // Alice and Charlie are active
    expect(liveQuery.get(1)).toEqual({ id: 1, name: `Alice`, active: true })
    expect(liveQuery.get(3)).toEqual({ id: 3, name: `Charlie`, active: true })
    expect(liveQuery.get(2)).toBeUndefined() // Bob is not active
    // This test should fail because the live query is stuck in 'initialCommit' status
    expect(liveQuery.status).toBe(`ready`) // This should be 'ready' but is currently 'initialCommit'

    // Now add some new data to the source collection (this should work as per the original report)
    sourceCollection.insert({ id: 4, name: `David`, active: true })

    // Wait for the mutation to propagate
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The live query should update to include the new data
    expect(liveQuery.size).toBe(3) // Alice, Charlie, and David are active
    expect(liveQuery.get(4)).toEqual({ id: 4, name: `David`, active: true })
  })
})
