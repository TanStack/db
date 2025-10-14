import { afterEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createTransaction } from "../../src/transactions.js"
import { transactionScopedScheduler } from "../../src/scheduler.js"
import { CollectionConfigBuilder } from "../../src/query/live/collection-config-builder.js"
import type { FullSyncState } from "../../src/query/live/types.js"
import type { SyncConfig } from "../../src/types.js"

interface ChangeMessageLike {
  type: string
  value: any
}

interface User {
  id: number
  name: string
}

interface Task {
  id: number
  userId: number
  title: string
}

function setupLiveQueryCollections(id: string) {
  const users = createCollection<User>({
    id: `${id}-users`,
    getKey: (user) => user.id,
    startSync: true,
    sync: {
      sync: ({ begin, commit, markReady }) => {
        begin()
        commit()
        markReady()
      },
    },
  })

  const tasks = createCollection<Task>({
    id: `${id}-tasks`,
    getKey: (task) => task.id,
    startSync: true,
    sync: {
      sync: ({ begin, commit, markReady }) => {
        begin()
        commit()
        markReady()
      },
    },
  })

  const assignments = createLiveQueryCollection({
    id: `${id}-assignments`,
    startSync: true,
    query: (q) =>
      q
        .from({ user: users })
        .join({ task: tasks }, ({ user, task }) => eq(user.id, task.userId))
        .select(({ user, task }) => ({
          userId: user.id,
          taskId: task?.id,
          title: task?.title,
        })),
  })

  return { users, tasks, assignments }
}

function recordBatches(collection: any) {
  const batches: Array<Array<ChangeMessageLike>> = []
  const subscription = collection.subscribeChanges((changes: any) => {
    batches.push(changes as Array<ChangeMessageLike>)
  })
  return {
    batches,
    unsubscribe: () => subscription.unsubscribe(),
  }
}

afterEach(() => {
  transactionScopedScheduler.flushAll()
})

describe(`live query scheduler`, () => {
  it(`runs the live query graph once per transaction that touches multiple collections`, async () => {
    const { users, tasks, assignments } =
      setupLiveQueryCollections(`single-batch`)
    await assignments.preload()

    const recorder = recordBatches(assignments)

    const transaction = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    transaction.mutate(() => {
      users.insert({ id: 1, name: `Alice` })
      tasks.insert({ id: 1, userId: 1, title: `Write tests` })
    })

    expect(recorder.batches).toHaveLength(1)
    expect(recorder.batches[0]).toHaveLength(1)
    expect(recorder.batches[0]![0]).toMatchObject({
      type: `insert`,
      value: {
        userId: 1,
        taskId: 1,
        title: `Write tests`,
      },
    })

    recorder.unsubscribe()
    transaction.rollback()
  })

  it(`handles nested transactions without emitting duplicate batches`, async () => {
    const { users, tasks, assignments } = setupLiveQueryCollections(`nested`)
    await assignments.preload()

    const recorder = recordBatches(assignments)

    const outerTx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })
    const innerTx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    outerTx.mutate(() => {
      users.insert({ id: 11, name: `Nested User` })
      innerTx.mutate(() => {
        tasks.insert({ id: 21, userId: 11, title: `Nested Task` })
      })
    })

    expect(recorder.batches).toHaveLength(1)
    expect(recorder.batches[0]![0]).toMatchObject({
      value: {
        userId: 11,
        taskId: 21,
        title: `Nested Task`,
      },
    })

    recorder.unsubscribe()
    innerTx.rollback()
    outerTx.rollback()
  })

  it(`clears pending jobs when a transaction rolls back due to an error`, async () => {
    const { users, tasks, assignments } = setupLiveQueryCollections(`rollback`)
    await assignments.preload()

    const recorder = recordBatches(assignments)
    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    expect(() => {
      tx.mutate(() => {
        users.insert({ id: 31, name: `Temp` })
        tasks.insert({ id: 41, userId: 31, title: `Temp Task` })
        throw new Error(`boom`)
      })
    }).toThrowError(`boom`)

    tx.rollback()

    const batchesBeforeFlush = recorder.batches.length
    transactionScopedScheduler.flush(tx.id)
    expect(recorder.batches.length).toBeGreaterThanOrEqual(batchesBeforeFlush)
    if (recorder.batches.length > batchesBeforeFlush) {
      const latestBatch = recorder.batches.at(-1)!
      expect(latestBatch[0]?.type).toBe(`delete`)
    }
    expect(transactionScopedScheduler.hasPendingJobs(tx.id)).toBe(false)
    // We emit the optimistic insert and, after the explicit rollback, possibly a
    // compensating delete – but no duplicate inserts.
    expect(recorder.batches[0]![0]).toMatchObject({ type: `insert` })

    recorder.unsubscribe()
  })

  it(`dedupes batches across multiple subscribers`, async () => {
    const { users, tasks, assignments } =
      setupLiveQueryCollections(`multi-subscriber`)
    await assignments.preload()

    const first = recordBatches(assignments)
    const second = recordBatches(assignments)

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })
    tx.mutate(() => {
      users.insert({ id: 51, name: `Multi` })
      tasks.insert({ id: 61, userId: 51, title: `Subscriber Task` })
    })

    expect(first.batches).toHaveLength(1)
    expect(second.batches).toHaveLength(1)
    expect(first.batches[0]![0]).toMatchObject({
      value: {
        userId: 51,
        taskId: 61,
        title: `Subscriber Task`,
      },
    })

    first.unsubscribe()
    second.unsubscribe()
    tx.rollback()
  })

  it(`runs join live queries once after their parent queries settle`, async () => {
    const collectionA = createCollection<{ id: number; value: string }>({
      id: `diamond-A`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const collectionB = createCollection<{ id: number; value: string }>({
      id: `diamond-B`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const liveQueryA = createLiveQueryCollection({
      id: `diamond-lqA`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: collectionA })
          .select(({ a }) => ({ id: a.id, value: a.value })),
    })

    const liveQueryB = createLiveQueryCollection({
      id: `diamond-lqB`,
      startSync: true,
      query: (q) =>
        q
          .from({ b: collectionB })
          .select(({ b }) => ({ id: b.id, value: b.value })),
    })

    const liveQueryJoin = createLiveQueryCollection({
      id: `diamond-join`,
      startSync: true,
      query: (q) =>
        q
          .from({ left: liveQueryA })
          .join(
            { right: liveQueryB },
            ({ left, right }) => eq(left.id, right.id),
            `full`
          )
          .select(({ left, right }) => ({
            left: left?.value,
            right: right?.value,
          })),
    })

    await Promise.all([
      liveQueryA.preload(),
      liveQueryB.preload(),
      liveQueryJoin.preload(),
    ])
    const baseRunCount = liveQueryJoin.utils.getRunCount()

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    tx.mutate(() => {
      collectionA.insert({ id: 1, value: `A1` })
      collectionB.insert({ id: 1, value: `B1` })
    })

    expect(liveQueryJoin.toArray).toEqual([{ left: `A1`, right: `B1` }])
    expect(liveQueryJoin.utils.getRunCount()).toBe(baseRunCount + 1)

    tx.mutate(() => {
      collectionA.update(1, (draft) => {
        draft.value = `A1b`
      })
      collectionB.update(1, (draft) => {
        draft.value = `B1b`
      })
    })

    expect(liveQueryJoin.toArray).toEqual([{ left: `A1b`, right: `B1b` }])
    expect(liveQueryJoin.utils.getRunCount()).toBe(baseRunCount + 2)
    tx.rollback()
  })

  it(`runs hybrid joins once when they observe both a live query and a collection`, async () => {
    const collectionA = createCollection<{ id: number; value: string }>({
      id: `hybrid-A`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const collectionB = createCollection<{ id: number; value: string }>({
      id: `hybrid-B`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const liveQueryA = createLiveQueryCollection({
      id: `hybrid-lqA`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: collectionA })
          .select(({ a }) => ({ id: a.id, value: a.value })),
    })

    const hybridJoin = createLiveQueryCollection({
      id: `hybrid-join`,
      startSync: true,
      query: (q) =>
        q
          .from({ left: liveQueryA })
          .join(
            { right: collectionB },
            ({ left, right }) => eq(left.id, right.id),
            `full`
          )
          .select(({ left, right }) => ({
            left: left?.value,
            right: right?.value,
          })),
    })

    await Promise.all([liveQueryA.preload(), hybridJoin.preload()])
    const baseRunCount = hybridJoin.utils.getRunCount()

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    tx.mutate(() => {
      collectionA.insert({ id: 7, value: `A7` })
      collectionB.insert({ id: 7, value: `B7` })
    })

    expect(hybridJoin.toArray).toEqual([{ left: `A7`, right: `B7` }])
    expect(hybridJoin.utils.getRunCount()).toBe(baseRunCount + 1)

    tx.mutate(() => {
      collectionA.update(7, (draft) => {
        draft.value = `A7b`
      })
      collectionB.update(7, (draft) => {
        draft.value = `B7b`
      })
    })

    expect(hybridJoin.toArray).toEqual([{ left: `A7b`, right: `B7b` }])
    expect(hybridJoin.utils.getRunCount()).toBe(baseRunCount + 2)
    tx.rollback()
  })

  it(`currently single batch when the join sees right-side data before the left`, async () => {
    const collectionA = createCollection<{ id: number; value: string }>({
      id: `ordering-A`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const collectionB = createCollection<{ id: number; value: string }>({
      id: `ordering-B`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const liveQueryA = createLiveQueryCollection({
      id: `ordering-lqA`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: collectionA })
          .select(({ a }) => ({ id: a.id, value: a.value })),
    })

    const join = createLiveQueryCollection({
      id: `ordering-join`,
      startSync: true,
      query: (q) =>
        q
          .from({ left: liveQueryA })
          .join(
            { right: collectionB },
            ({ left, right }) => eq(left.id, right.id),
            `full`
          )
          .select(({ left, right }) => ({
            left: left?.value,
            right: right?.value,
          })),
    })

    await Promise.all([liveQueryA.preload(), join.preload()])
    const baseRunCount = join.utils.getRunCount()

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    tx.mutate(() => {
      collectionB.insert({ id: 42, value: `right-first` })
      collectionA.insert({ id: 42, value: `left-later` })
    })

    expect(join.toArray).toEqual([{ left: `left-later`, right: `right-first` }])
    expect(join.utils.getRunCount()).toBe(baseRunCount + 1)
    tx.rollback()
  })

  it(`coalesces load-more callbacks scheduled within the same context`, () => {
    const baseCollection = createCollection<User>({
      id: `loader-users`,
      getKey: (user) => user.id,
      sync: {
        sync: () => () => {},
      },
    })

    const builder = new CollectionConfigBuilder({
      id: `loader-builder`,
      query: (q) => q.from({ user: baseCollection }),
    })

    const contextId = Symbol(`loader-context`)
    const loader = vi.fn(() => true)
    const config = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
      truncate: vi.fn(),
    } as unknown as Parameters<SyncConfig<User>[`sync`]>[0]

    const syncState = {
      messagesCount: 0,
      subscribedToAllCollections: true,
      unsubscribeCallbacks: new Set<() => void>(),
      graph: {
        pendingWork: () => false,
        run: vi.fn(),
      },
      inputs: {},
      pipeline: {},
    } as unknown as FullSyncState

    const maybeRunGraphSpy = vi
      .spyOn(builder, `maybeRunGraph`)
      .mockImplementation((combinedLoader) => {
        combinedLoader?.()
      })

    // Set instance properties since this test calls scheduleGraphRun directly
    builder.currentSyncConfig = config
    builder.currentSyncState = syncState

    builder.scheduleGraphRun(loader, { contextId })
    builder.scheduleGraphRun(loader, { contextId })

    transactionScopedScheduler.flush(contextId)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(maybeRunGraphSpy).toHaveBeenCalledTimes(1)

    maybeRunGraphSpy.mockRestore()
  })
})
