import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection/index.js"
import { createLiveQueryCollection } from "../src/query/live-query-collection.js"

interface Todo {
  id: string
  created_at: number
}

describe(`Live Query - Concurrent Insert Updates`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(`should emit change events for both optimistic inserts and sync completions`, async () => {
    let changeEventCount = 0

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

        syncBegin()
        transaction.mutations.forEach((mutation) => {
          syncWrite({ type: mutation.type, value: mutation.modified })
        })
        syncCommit()
      },
    })

    const liveQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: collection })
          .orderBy(({ todo }) => todo.created_at, `asc`),
      startSync: true,
    })

    await liveQuery.preload()

    liveQuery.subscribeChanges(() => {
      changeEventCount++
    })

    const tx1 = collection.insert({ id: `1`, created_at: Date.now() })
    const tx2 = collection.insert({ id: `2`, created_at: Date.now() + 1 })

    await vi.advanceTimersByTimeAsync(2000)

    await Promise.all([tx1.isPersisted.promise, tx2.isPersisted.promise])

    expect(collection.size).toBe(2)
    expect(liveQuery.size).toBe(2)
    expect(changeEventCount).toBeGreaterThanOrEqual(2)
    expect((collection as any)._changes.shouldBatchEvents).toBe(false)
  })

  it(`should keep live query in sync with many concurrent optimistic inserts`, async () => {
    let syncBegin: () => void
    let syncWrite: (change: any) => void
    let syncCommit: () => void

    const collection = createCollection<Todo, string>({
      id: `todos-many`,
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
          syncWrite({ type: mutation.type, value: mutation.modified })
        })
        syncCommit()
      },
    })

    const liveQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: collection })
          .orderBy(({ todo }) => todo.created_at, `asc`),
      startSync: true,
    })

    await liveQuery.preload()

    const transactions = Array.from({ length: 5 }, (_, index) =>
      collection.insert({
        id: `${index + 1}`,
        created_at: Date.now() + index,
      })
    )

    await vi.advanceTimersByTimeAsync(5000)

    await Promise.all(transactions.map((tx) => tx.isPersisted.promise))

    expect(collection.size).toBe(5)
    expect(liveQuery.size).toBe(5)
    expect((collection as any)._changes.shouldBatchEvents).toBe(false)
  })
})
