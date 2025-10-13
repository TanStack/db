import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Temporal } from "temporal-polyfill"
import { createCollection } from "../../src/collection/index.js"
import {
  createLiveQueryCollection,
  eq,
  liveQueryCollectionOptions,
} from "../../src/query/index.js"
import { Query } from "../../src/query/builder/index.js"
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from "../utils.js"
import { createDeferred } from "../../src/deferred"
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
    expect(liveQuery.status).toBe(`ready`)

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

    const subscription = liveQuery.subscribeChanges(() => {})
    await liveQuery.preload()
    expect(liveQuery.status).toBe(`ready`)

    // Unsubscribe and wait for GC to run and cleanup to complete
    subscription.unsubscribe()
    const deadline = Date.now() + 500
    while (liveQuery.status !== `cleaned-up` && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1))
    }
    expect(liveQuery.status).toBe(`cleaned-up`)

    // Resubscribe should not throw (would throw "Graph already finalized" without the fix)
    expect(() => liveQuery.subscribeChanges(() => {})).not.toThrow()
  })

  it(`nested live query should not go blank after GC and resubscribe`, async () => {
    type Thread = { id: string; last_email_id: string; last_sent_at: number }
    type LabelByEmail = { email_id: string; label: string }

    const threads = createCollection(
      mockSyncCollectionOptions<Thread>({
        id: `threads-for-nested-gc-repro-collection`,
        getKey: (t) => t.id,
        initialData: [
          { id: `t1`, last_email_id: `e1`, last_sent_at: 3 },
          { id: `t2`, last_email_id: `e2`, last_sent_at: 2 },
        ],
      })
    )

    const labelsByEmail = createCollection(
      mockSyncCollectionOptions<LabelByEmail>({
        id: `labels-for-nested-gc-repro-collection`,
        getKey: (l) => l.email_id,
        initialData: [
          { email_id: `e1`, label: `inbox` },
          { email_id: `e2`, label: `work` },
        ],
      })
    )

    // Source live query (pre-created)
    const sourceLQ = createCollection({
      ...liveQueryCollectionOptions({
        query: (q: any) =>
          q
            .from({ thread: threads })
            .orderBy(({ thread }: any) => thread.last_sent_at, {
              direction: `desc`,
            }),
        startSync: true,
        gcTime: 5,
      }),
      id: `source-lq`,
    })

    // Nested live query built from the source live query
    const nestedLQ = createCollection({
      ...liveQueryCollectionOptions({
        query: (q: any) =>
          q
            .from({ thread: sourceLQ })
            .join(
              { label: labelsByEmail },
              ({ thread, label }: any) =>
                eq(thread.last_email_id, label.email_id),
              `inner`
            )
            .orderBy(({ thread }: any) => thread.last_sent_at, {
              direction: `desc`,
            }),
        startSync: true,
        gcTime: 5,
      }),
      id: `nested-lq`,
    })

    // Wait for initial sync
    await nestedLQ.preload()
    expect(nestedLQ.size).toBe(2)
    expect(nestedLQ.status).toBe(`ready`)

    // First subscription cycle
    const subscription1 = nestedLQ.subscribeChanges(() => {})

    // Verify we still have data after subscribing
    expect(nestedLQ.size).toBe(2)
    expect(nestedLQ.status).toBe(`ready`)

    // Unsubscribe and wait for GC
    subscription1.unsubscribe()
    const deadline1 = Date.now() + 500
    while (nestedLQ.status !== `cleaned-up` && Date.now() < deadline1) {
      await new Promise((r) => setTimeout(r, 1))
    }
    expect(nestedLQ.status).toBe(`cleaned-up`)

    // Try multiple resubscribe cycles to increase chance of reproduction
    for (let i = 0; i < 3; i++) {
      // Resubscribe
      const subscription2 = nestedLQ.subscribeChanges(() => {})

      // Wait for the collection to potentially recover
      await new Promise((r) => setTimeout(r, 50))

      expect(nestedLQ.status).toBe(`ready`)
      expect(nestedLQ.size).toBe(2)

      // Unsubscribe and wait for GC again
      subscription2.unsubscribe()
      const deadline2 = Date.now() + 500
      while (nestedLQ.status !== `cleaned-up` && Date.now() < deadline2) {
        await new Promise((r) => setTimeout(r, 1))
      }
      expect(nestedLQ.status).toBe(`cleaned-up`)

      // Small delay between cycles
      await new Promise((r) => setTimeout(r, 20))
    }

    // Final verification - resubscribe one more time and ensure data is available
    const finalSubscription = nestedLQ.subscribeChanges(() => {})

    // Wait for the collection to become ready
    const finalDeadline = Date.now() + 1000
    while (nestedLQ.status !== `ready` && Date.now() < finalDeadline) {
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(nestedLQ.status).toBe(`ready`)
    expect(nestedLQ.size).toBe(2)

    finalSubscription.unsubscribe()
  })

  it(`should handle temporal values correctly in live queries`, async () => {
    // Define a type with temporal values
    type Task = {
      id: number
      name: string
      duration: Temporal.Duration
    }

    // Initial data with temporal duration
    const initialTask: Task = {
      id: 1,
      name: `Test Task`,
      duration: Temporal.Duration.from({ hours: 1 }),
    }

    // Create a collection with temporal values
    const taskCollection = createCollection(
      mockSyncCollectionOptions<Task>({
        id: `test-tasks`,
        getKey: (task) => task.id,
        initialData: [initialTask],
      })
    )

    // Create a live query collection that includes the temporal value
    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ task: taskCollection })
    )

    await liveQuery.preload()

    // After initial sync, the live query should see the row with the temporal value
    expect(liveQuery.size).toBe(1)
    const initialResult = liveQuery.get(1)
    expect(initialResult).toBeDefined()
    expect(initialResult!.duration).toBeInstanceOf(Temporal.Duration)
    expect(initialResult!.duration.hours).toBe(1)

    // Simulate backend change: update the temporal value to 10 hours
    const updatedTask: Task = {
      id: 1,
      name: `Test Task`,
      duration: Temporal.Duration.from({ hours: 10 }),
    }

    // Update the task in the collection (simulating backend sync)
    taskCollection.utils.begin()
    taskCollection.utils.write({
      type: `update`,
      value: updatedTask,
    })
    taskCollection.utils.commit()

    // The live query should now contain the new temporal value
    const updatedResult = liveQuery.get(1)
    expect(updatedResult).toBeDefined()
    expect(updatedResult!.duration).toBeInstanceOf(Temporal.Duration)
    expect(updatedResult!.duration.hours).toBe(10)
    expect(updatedResult!.duration.total({ unit: `hours` })).toBe(10)
  })

  for (const autoIndex of [`eager`, `off`] as const) {
    it(`should not send the initial state twice on joins with autoIndex: ${autoIndex}`, async () => {
      type Player = { id: number; name: string }
      type Challenge = { id: number; value: number }

      const playerCollection = createCollection(
        mockSyncCollectionOptionsNoInitialState<Player>({
          id: `player`,
          getKey: (post) => post.id,
          autoIndex,
        })
      )

      const challenge1Collection = createCollection(
        mockSyncCollectionOptionsNoInitialState<Challenge>({
          id: `challenge1`,
          getKey: (post) => post.id,
          autoIndex,
        })
      )

      const challenge2Collection = createCollection(
        mockSyncCollectionOptionsNoInitialState<Challenge>({
          id: `challenge2`,
          getKey: (post) => post.id,
          autoIndex,
        })
      )

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
      playerCollection.utils.begin()
      playerCollection.utils.write({
        type: `insert`,
        value: { id: 1, name: `Alice` },
      })
      playerCollection.utils.commit()
      playerCollection.utils.markReady()

      // Write challenge1
      challenge1Collection.utils.begin()
      challenge1Collection.utils.write({
        type: `insert`,
        value: { id: 1, value: 100 },
      })
      challenge1Collection.utils.commit()
      challenge1Collection.utils.markReady()

      // Write challenge2
      challenge2Collection.utils.begin()
      challenge2Collection.utils.write({
        type: `insert`,
        value: { id: 1, value: 200 },
      })
      challenge2Collection.utils.commit()
      challenge2Collection.utils.markReady()

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

  it(`should handle updates in live queries with custom getKey correctly`, async () => {
    type Task = {
      id: number
      name: string
    }

    const initialTask: Task = {
      id: 1,
      name: `Test Task`,
    }

    const taskCollection = createCollection(
      mockSyncCollectionOptions<Task>({
        id: `test-tasks`,
        getKey: (task) => `source:${task.id}`,
        initialData: [initialTask],
      })
    )

    const liveQuery = createLiveQueryCollection({
      query: (q) => q.from({ task: taskCollection }),
      getKey: (task) => `live:${task.id}`, // return a different key from the source
    })

    await liveQuery.preload()

    // After initial sync, the live query should see the row with the value
    expect(liveQuery.size).toBe(1)
    const initialResult = liveQuery.get(`live:1`)
    expect(initialResult).toBeDefined()
    expect(initialResult!.name).toBe(`Test Task`)

    // Simulate backend change
    const updatedTask: Task = {
      id: 1,
      name: `Updated Task`,
    }

    // Update the task in the collection (simulating backend sync)
    taskCollection.utils.begin()
    taskCollection.utils.write({
      type: `update`,
      value: updatedTask,
    })
    taskCollection.utils.commit()

    // The live query should now contain the new value
    expect(liveQuery.size).toBe(1)
    const updatedResult = liveQuery.get(`live:1`)
    expect(updatedResult).toBeDefined()
    expect(updatedResult!.name).toBe(`Updated Task`)
  })

  describe(`optimistic reconciliation`, () => {
    describe(`with delayed inserts`, () => {
      beforeEach(() => {
        vi.useFakeTimers()
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it(`keeps emitting changes while sync catches up`, async () => {
        let changeEventCount = 0

        let syncBegin!: () => void
        let syncWrite!: (change: ChangeMessage<any>) => void
        let syncCommit!: () => void

        const base = createCollection<{ id: string; created_at: number }>({
          id: `delayed-inserts`,
          getKey: (item) => item.id,
          startSync: true,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit

              begin()
              commit()
              markReady()
            },
          },
          onInsert: async ({ transaction }) => {
            await new Promise((resolve) => setTimeout(resolve, 1000))

            syncBegin()
            transaction.mutations.forEach((mutation) => {
              syncWrite({
                type: mutation.type,
                value: mutation.modified,
                key: mutation.key,
              })
            })
            syncCommit()
          },
        })

        const live = createLiveQueryCollection({
          query: (q) =>
            q
              .from({ todo: base })
              .orderBy(({ todo }) => todo.created_at, `asc`),
          startSync: true,
        })

        await live.preload()

        live.subscribeChanges(() => {
          changeEventCount++
        })

        const tx1 = base.insert({ id: `1`, created_at: Date.now() })
        const tx2 = base.insert({ id: `2`, created_at: Date.now() + 1 })

        await vi.advanceTimersByTimeAsync(2000)
        await Promise.all([tx1.isPersisted.promise, tx2.isPersisted.promise])

        expect(base.size).toBe(2)
        expect(live.size).toBe(2)
        expect(changeEventCount).toBeGreaterThanOrEqual(2)
        expect((base as any)._changes.shouldBatchEvents).toBe(false)
      })

      it(`stays in sync with many queued inserts`, async () => {
        let syncBegin!: () => void
        let syncWrite!: (change: ChangeMessage<any>) => void
        let syncCommit!: () => void

        const base = createCollection<{ id: string; created_at: number }>({
          id: `delayed-inserts-many`,
          getKey: (item) => item.id,
          startSync: true,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit

              begin()
              commit()
              markReady()
            },
          },
          onInsert: async ({ transaction }) => {
            await new Promise((resolve) => setTimeout(resolve, 1000))

            syncBegin()
            transaction.mutations.forEach((mutation) => {
              syncWrite({
                type: mutation.type,
                value: mutation.modified,
                key: mutation.key,
              })
            })
            syncCommit()
          },
        })

        const live = createLiveQueryCollection({
          query: (q) =>
            q
              .from({ todo: base })
              .orderBy(({ todo }) => todo.created_at, `asc`),
          startSync: true,
        })

        await live.preload()

        const transactions = Array.from({ length: 5 }, (_, index) =>
          base.insert({
            id: `${index + 1}`,
            created_at: Date.now() + index,
          })
        )

        await vi.advanceTimersByTimeAsync(5000)
        await Promise.all(transactions.map((tx) => tx.isPersisted.promise))

        expect(base.size).toBe(5)
        expect(live.size).toBe(5)
        expect((base as any)._changes.shouldBatchEvents).toBe(false)
      })
    })

    describe(`with queued optimistic updates`, () => {
      it(`keeps live query results aligned while persist is delayed`, async () => {
        const pendingPersists: Array<ReturnType<typeof createDeferred<void>>> =
          []

        let syncBegin: (() => void) | undefined
        let syncWrite: ((change: ChangeMessage<any>) => void) | undefined
        let syncCommit: (() => void) | undefined

        const todos = createCollection<{
          id: string
          createdAt: number
          completed: boolean
        }>({
          id: `queued-optimistic-updates`,
          getKey: (todo) => todo.id,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = (change) => write({ ...change })
              syncCommit = commit

              begin()
              ;[
                { id: `1`, createdAt: 1, completed: false },
                { id: `2`, createdAt: 2, completed: false },
                { id: `3`, createdAt: 3, completed: false },
                { id: `4`, createdAt: 4, completed: false },
                { id: `5`, createdAt: 5, completed: false },
              ].forEach((todo) =>
                write({
                  type: `insert`,
                  value: todo,
                })
              )
              commit()
              markReady()
            },
          },
          onUpdate: async ({ transaction }) => {
            const deferred = createDeferred<void>()
            pendingPersists.push(deferred)
            await deferred.promise

            syncBegin?.()
            transaction.mutations.forEach((mutation) => {
              syncWrite?.({
                type: mutation.type,
                key: mutation.key,
                value: mutation.modified as {
                  id: string
                  createdAt: number
                  completed: boolean
                },
              })
            })
            syncCommit?.()
          },
        })

        await todos.preload()

        const live = createLiveQueryCollection({
          query: (q) =>
            q
              .from({ todo: todos })
              .orderBy(({ todo }) => todo.createdAt, `desc`),
          startSync: true,
        })

        await live.preload()

        const ensureConsistency = (id: string) => {
          const baseTodo = todos.get(id)
          const liveTodo = Array.from(live.values())
            .map((row: any) => (`todo` in row ? row.todo : row))
            .find((todo: any) => todo?.id === id)
          expect(liveTodo?.completed).toBe(baseTodo?.completed)
        }

        const firstBatch = [`1`, `2`, `3`, `4`, `5`, `1`, `3`, `5`]
        const secondBatch = [`2`, `4`, `1`, `2`, `3`, `4`, `5`]

        for (const id of firstBatch) {
          todos.update(id, (draft) => {
            draft.completed = !draft.completed
          })

          await Promise.resolve()
          ensureConsistency(id)
        }

        const toResolveNow = pendingPersists.splice(0, 4)
        for (const deferred of toResolveNow) {
          deferred.resolve()
          await Promise.resolve()
        }

        for (const id of secondBatch) {
          todos.update(id, (draft) => {
            draft.completed = !draft.completed
          })

          await Promise.resolve()
          ensureConsistency(id)
        }

        pendingPersists.forEach((deferred) => deferred.resolve())
      })

      it(`still emits optimistic changes during long sync commit`, async () => {
        const todos = createCollection<{
          id: string
          createdAt: number
          completed: boolean
        }>({
          id: `commit-blocked`,
          getKey: (todo) => todo.id,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              begin()
              write({
                type: `insert`,
                value: { id: `1`, createdAt: 1, completed: false },
              })
              commit()
              markReady()
            },
          },
          onUpdate: async () => {},
        })

        await todos.preload()

        const live = createLiveQueryCollection({
          query: (q) =>
            q
              .from({ todo: todos })
              .orderBy(({ todo }) => todo.createdAt, `desc`),
          startSync: true,
        })

        await live.preload()

        const state = (todos as any)._state
        state.isCommittingSyncTransactions = true

        todos.update(`1`, (draft) => {
          draft.completed = true
        })

        const liveTodo = Array.from(live.values())
          .map((row: any) => (`todo` in row ? row.todo : row))
          .find((todo: any) => todo?.id === `1`)

        expect(liveTodo?.completed).toBe(true)
      })
    })
  })

  describe(`isLoadingMore integration`, () => {
    it(`live query result collection has isLoadingMore property`, async () => {
      const sourceCollection = createCollection<{ id: string; value: string }>({
        id: `source`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
      })

      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: sourceCollection })
      )

      await liveQuery.preload()

      expect(liveQuery.isLoadingMore).toBeDefined()
      expect(liveQuery.isLoadingMore).toBe(false)
    })

    it(`isLoadingMore property exists and starts as false`, async () => {
      const sourceCollection = createCollection<{ id: string; value: string }>({
        id: `source`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
      })

      const liveQuery = createLiveQueryCollection({
        query: (q) => q.from({ item: sourceCollection }),
        startSync: true,
      })

      await liveQuery.preload()

      expect(liveQuery.isLoadingMore).toBe(false)
    })

    it(`source collection isLoadingMore is independent`, async () => {
      let resolveLoadSubset: () => void
      const loadSubsetPromise = new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })

      const sourceCollection = createCollection<{ id: string; value: number }>({
        id: `source`,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady, begin, write, commit }) => {
            begin()
            write({ type: `insert`, value: { id: `1`, value: 1 } })
            commit()
            markReady()
            return {
              loadSubset: () => loadSubsetPromise,
            }
          },
        },
      })

      const liveQuery = createLiveQueryCollection({
        query: (q) => q.from({ item: sourceCollection }),
        startSync: true,
      })

      await liveQuery.preload()

      // Calling loadSubset directly on source collection sets its own isLoadingMore
      sourceCollection._sync.loadSubset({})
      expect(sourceCollection.isLoadingMore).toBe(true)

      // But live query isLoadingMore tracks subscription-driven loads, not direct loadSubset calls
      // so it remains false unless subscriptions trigger loads via predicate pushdown
      expect(liveQuery.isLoadingMore).toBe(false)

      resolveLoadSubset!()
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(sourceCollection.isLoadingMore).toBe(false)
      expect(liveQuery.isLoadingMore).toBe(false)
    })
  })
})
