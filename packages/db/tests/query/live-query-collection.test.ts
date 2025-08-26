import { beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection.js"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { Query } from "../../src/query/builder/index.js"
import { mockSyncCollectionOptions } from "../utls.js"
import type { ChangeMessage } from "../../src/types.js"

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

  it(`should update after source collection is loaded even when not preloaded before rendering`, async () => {
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

  it(`should not reuse finalized graph after GC cleanup (resubscribe is safe)`, async () => {
    const liveQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.active, true)),
      gcTime: 1,
    })

    const unsubscribe = liveQuery.subscribeChanges(() => {})
    await liveQuery.preload()
    expect(liveQuery.status).toBe(`ready`)

    // Unsubscribe and wait for GC to run and cleanup to complete
    unsubscribe()
    const deadline = Date.now() + 500
    while (liveQuery.status !== `cleaned-up` && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1))
    }
    expect(liveQuery.status).toBe(`cleaned-up`)

    // Resubscribe should not throw (would throw "Graph already finalized" without the fix)
    expect(() => liveQuery.subscribeChanges(() => {})).not.toThrow()
  })

  for (const autoIndex of [`eager`, `off`] as const) {
    it(`should not send the initial state twice on joins with autoIndex: ${autoIndex}`, async () => {
      type Player = { id: number; name: string }
      type Challenge = { id: number; value: number }

      let playerBeginCallback: (() => void) | undefined
      let playerWriteCallback:
        | ((
            message: Omit<ChangeMessage<Player, string | number>, `key`>
          ) => void)
        | undefined
      let playerCommitCallback: (() => void) | undefined
      let playerMarkReadyCallback: (() => void) | undefined
      const playerCollection = createCollection<Player>({
        id: `player`,
        getKey: (post) => post.id,
        startSync: false,
        autoIndex,
        sync: {
          sync: ({ begin, commit, write, markReady }) => {
            playerBeginCallback = begin
            playerCommitCallback = commit
            playerMarkReadyCallback = markReady
            playerWriteCallback = write
            return () => {}
          },
        },
        onInsert: async () => {}, // Add empty handler to allow direct inserts
      })

      let challenge1BeginCallback: (() => void) | undefined
      let challenge1WriteCallback:
        | ((
            message: Omit<ChangeMessage<Challenge, string | number>, `key`>
          ) => void)
        | undefined
      let challenge1CommitCallback: (() => void) | undefined
      let challenge1MarkReadyCallback: (() => void) | undefined
      const challenge1Collection = createCollection<Challenge>({
        id: `challenge1`,
        getKey: (post) => post.id,
        startSync: false,
        autoIndex,
        sync: {
          sync: ({ begin, commit, write, markReady }) => {
            challenge1BeginCallback = begin
            challenge1CommitCallback = commit
            challenge1MarkReadyCallback = markReady
            challenge1WriteCallback = write
            return () => {}
          },
        },
        onInsert: async () => {}, // Add empty handler to allow direct inserts
      })

      let challenge2BeginCallback: (() => void) | undefined
      let challenge2WriteCallback:
        | ((
            message: Omit<ChangeMessage<Challenge, string | number>, `key`>
          ) => void)
        | undefined
      let challenge2CommitCallback: (() => void) | undefined
      let challenge2MarkReadyCallback: (() => void) | undefined
      const challenge2Collection = createCollection<Challenge>({
        id: `challenge2`,
        getKey: (post) => post.id,
        startSync: false,
        autoIndex,
        sync: {
          sync: ({ begin, commit, write, markReady }) => {
            challenge2BeginCallback = begin
            challenge2CommitCallback = commit
            challenge2MarkReadyCallback = markReady
            challenge2WriteCallback = write
            return () => {}
          },
        },
        onInsert: async () => {}, // Add empty handler to allow direct inserts
      })

      const liveQuery = createLiveQueryCollection((q) =>
        q
          .from({ player: playerCollection })
          .leftJoin(
            { challenge1: challenge1Collection },
            ({ player, challenge1 }) => eq(player.id, challenge1.id)
          )
          .leftJoin(
            { challenge2: challenge2Collection },
            ({ player, challenge2 }) => eq(player.id, challenge2.id)
          )
      )

      // Start the query, but don't wait it, we are doing to write the data to the
      // source collections while the query is loading the initial state
      const preloadPromise = liveQuery.preload()

      // Write player
      playerBeginCallback!()
      playerWriteCallback!({
        type: `insert`,
        value: { id: 1, name: `Alice` },
      })
      playerCommitCallback!()
      playerMarkReadyCallback!()

      // Write challenge1
      challenge1BeginCallback!()
      challenge1WriteCallback!({
        type: `insert`,
        value: { id: 1, value: 100 },
      })
      challenge1CommitCallback!()
      challenge1MarkReadyCallback!()

      // Write challenge2
      challenge2BeginCallback!()
      challenge2WriteCallback!({
        type: `insert`,
        value: { id: 1, value: 200 },
      })
      challenge2CommitCallback!()
      challenge2MarkReadyCallback!()

      await preloadPromise

      // With a failed test the results show more than 1 item
      // It returns both an unjoined player with no joined challenges, and a joined
      // player with the challenges
      const results = liveQuery.toArray
      expect(results.length).toBe(1)

      const result = results[0]!
      expect(result.player.name).toBe(`Alice`)
      expect(result.challenge1?.value).toBe(100)
      expect(result.challenge2?.value).toBe(200)
    })
  }
})
