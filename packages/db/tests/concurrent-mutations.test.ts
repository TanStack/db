import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection/index.js"
import { createLiveQueryCollection } from "../src/query/live-query-collection.js"

interface Todo {
  id: string
  created_at: number
}

/**
 * Live Query Change Events with Concurrent Inserts
 *
 * Tests that live queries correctly emit change events throughout the
 * lifecycle of concurrent insert operations.
 */
describe(`Live Query - Concurrent Insert Updates`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(`should emit change events for both optimistic inserts and sync completions`, async () => {
    let changeEventCount = 0

    // Save sync functions to call directly
    let syncBegin: () => void
    let syncWrite: (change: any) => void
    let syncCommit: () => void

    // Base collection with latency
    const collection = createCollection<Todo, string>({
      id: `todos`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Save references to sync functions
          syncBegin = begin
          syncWrite = write
          syncCommit = commit

          // Initial empty sync
          begin()
          commit()
          markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        // Artificial latency
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Directly call sync functions to write changes
        syncBegin()
        transaction.mutations.forEach((mutation) => {
          syncWrite({ type: mutation.type, value: mutation.modified })
        })
        syncCommit()
      },
    })

    // Live query with orderBy
    const liveQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: collection })
          .orderBy(({ todo }) => todo.created_at, `asc`),
      startSync: true,
    })

    await liveQuery.preload()

    // Count change events
    liveQuery.subscribeChanges(() => {
      changeEventCount++
    })

    // Insert two items concurrently
    const tx1 = collection.insert({ id: `1`, created_at: Date.now() })
    const tx2 = collection.insert({ id: `2`, created_at: Date.now() + 1 })

    // Advance timers to complete onInsert callbacks
    await vi.advanceTimersByTimeAsync(2000)

    // Wait for transactions
    await Promise.all([tx1.isPersisted.promise, tx2.isPersisted.promise])

    // Verify final state
    expect(collection.size).toBe(2)
    expect(liveQuery.size).toBe(2)

    // Expect at least the optimistic inserts to arrive immediately
    expect(changeEventCount).toBeGreaterThanOrEqual(2)
    // ensure batching has been flushed after sync commits
    expect((collection as any)._changes.shouldBatchEvents).toBe(false)
  })

  it(`should handle concurrent inserts without orderBy clause`, async () => {
    // Save sync functions to call directly
    let syncBegin: () => void
    let syncWrite: (change: any) => void
    let syncCommit: () => void

    const collection = createCollection<Todo, string>({
      id: `todos`,
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

        // Directly call sync functions
        syncBegin()
        transaction.mutations.forEach((mutation) => {
          syncWrite({ type: mutation.type, value: mutation.modified })
        })
        syncCommit()
      },
    })

    // Live query without orderBy clause
    const liveQuery = createLiveQueryCollection({
      query: (q) => q.from({ todo: collection }),
      startSync: true,
    })

    await liveQuery.preload()

    const tx1 = collection.insert({ id: `1`, created_at: Date.now() })
    const tx2 = collection.insert({ id: `2`, created_at: Date.now() + 1 })

    await vi.advanceTimersByTimeAsync(2000)

    // Transactions should complete successfully without errors
    await Promise.all([tx1.isPersisted.promise, tx2.isPersisted.promise])

    // Verify final state
    expect(collection.size).toBe(2)
    expect(liveQuery.size).toBe(2)
    expect(tx1.state).toBe(`completed`)
    expect(tx2.state).toBe(`completed`)
  })
})
