import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq, isNull } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import {
  getActivePublicationContext,
  transactionScopedScheduler,
  withPublicationContext,
} from '../../src/scheduler.js'
import { CollectionConfigBuilder } from '../../src/query/live/collection-config-builder.js'
import { CollectionSubscriber } from '../../src/query/live/collection-subscriber.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import type { OutputWithVirtual } from '../utils.js'
import type { FullSyncState } from '../../src/query/live/types.js'
import type { SyncConfig } from '../../src/types.js'

interface ChangeMessageLike {
  type: string
  value: any
}

interface User {
  id: number
  name: string
}

type UserWithVirtual = OutputWithVirtual<User, string | number>

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
          taskId: task.id,
          title: task.title,
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

describe(`Collection publication scheduler context`, () => {
  it(`shares one context and flushes after the outer publication`, () => {
    const calls: Array<string> = []
    let contextId: ReturnType<typeof getActivePublicationContext>

    withPublicationContext(() => {
      contextId = getActivePublicationContext()
      expect(contextId).toBeDefined()

      transactionScopedScheduler.schedule({
        contextId,
        jobId: `outer`,
        run: () => calls.push(`outer`),
      })
      withPublicationContext(() => {
        expect(getActivePublicationContext()).toBe(contextId)
        transactionScopedScheduler.schedule({
          contextId,
          jobId: `inner`,
          run: () => calls.push(`inner`),
        })
      })

      expect(calls).toEqual([])
    })

    expect(calls).toEqual([`outer`, `inner`])
    expect(getActivePublicationContext()).toBeUndefined()
  })

  it(`clears queued work when publication throws`, () => {
    const run = vi.fn()
    let contextId: ReturnType<typeof getActivePublicationContext>

    expect(() =>
      withPublicationContext(() => {
        contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: `discarded`,
          run,
        })
        throw new Error(`publication failed`)
      }),
    ).toThrow(`publication failed`)

    expect(run).not.toHaveBeenCalled()
    expect(getActivePublicationContext()).toBeUndefined()
    expect(transactionScopedScheduler.hasPendingJobs(contextId!)).toBe(false)
  })

  it(`preserves a falsy graph failure through a publication boundary`, () => {
    let didThrow = false
    let thrown: unknown

    try {
      withPublicationContext(() => {
        const contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: `failing`,
          run: () => {
            throw undefined
          },
        })
      })
    } catch (error) {
      didThrow = true
      thrown = error
    }

    expect(didThrow).toBe(true)
    expect(thrown).toBeUndefined()
  })
})

describe(`live query scheduler`, () => {
  it(`delivers an ordinary source batch to its frozen listener snapshot`, async () => {
    let begin!: () => void
    let write!: (message: { type: `insert`; value: User }) => void
    let commit!: () => void
    const calls: Array<string> = []
    const source = createCollection<User>({
      id: `ordinary-listener-membership-source`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          begin = actions.begin
          write = actions.write
          commit = () => {
            actions.commit()
          }
          actions.markReady()
        },
      },
    })
    let added: { unsubscribe: () => void } | undefined
    const first = source.subscribeChanges(() => {
      calls.push(`first`)
      second.unsubscribe()
      added ??= source.subscribeChanges(() => calls.push(`added`), {
        includeInitialState: false,
      })
    })
    const second = source.subscribeChanges(() => calls.push(`second`))

    try {
      begin()
      write({ type: `insert`, value: { id: 1, name: `Ada` } })
      commit()
      expect(calls).toEqual([`first`, `second`])

      begin()
      write({ type: `insert`, value: { id: 2, name: `Grace` } })
      commit()
      expect(calls).toEqual([`first`, `second`, `first`, `added`])
    } finally {
      first.unsubscribe()
      second.unsubscribe()
      added?.unsubscribe()
      await source.cleanup()
    }
  })

  it(`settles a dependent live query when an earlier source listener throws`, async () => {
    let begin!: () => void
    let write!: (message: { type: `insert`; value: User }) => void
    let commit!: () => void
    const listenerFailure = new Error(`source listener failed`)
    const source = createCollection<User>({
      id: `throwing-listener-live-source`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          begin = actions.begin
          write = actions.write
          commit = () => {
            actions.commit()
          }
          actions.markReady()
        },
      },
    })
    const throwingSubscription = source.subscribeChanges(
      () => {
        throw listenerFailure
      },
      { includeInitialState: false },
    )
    const live = createLiveQueryCollection({
      id: `throwing-listener-live-dependent`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: source })
          .select(({ user }) => ({ id: user.id, name: user.name })),
    })

    try {
      await live.preload()
      begin()
      write({ type: `insert`, value: { id: 1, name: `Ada` } })
      expect(() => commit()).toThrow(listenerFailure)
      expect(live.get(1)).toEqual(expect.objectContaining({ name: `Ada` }))
    } finally {
      throwingSubscription.unsubscribe()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it(`keeps a nested ready failure when a later outer listener throws`, async () => {
    let markInnerReady!: () => void
    const readyFailure = new Error(`nested ready listener failed`)
    const laterFailure = new Error(`later outer listener failed`)
    const scheduledJob = vi.fn()
    const inner = createCollection<User>({
      id: `nested-ready-collision-inner`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ markReady }) => {
          markInnerReady = markReady
        },
      },
    })
    const innerFirst = inner.subscribeChanges(() => {
      const contextId = getActivePublicationContext()
      transactionScopedScheduler.schedule({
        contextId,
        jobId: scheduledJob,
        run: scheduledJob,
      })
    })
    const innerSecond = inner.subscribeChanges(() => {
      throw readyFailure
    })

    let beginOuter!: () => void
    let writeOuter!: (message: { type: `insert`; value: User }) => void
    let commitOuter!: () => void
    const outer = createCollection<User>({
      id: `nested-ready-collision-outer`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          beginOuter = actions.begin
          writeOuter = actions.write
          commitOuter = () => {
            actions.commit()
          }
          actions.markReady()
        },
      },
    })
    const outerFirst = outer.subscribeChanges(() => markInnerReady())
    const outerSecond = outer.subscribeChanges(() => {
      throw laterFailure
    })

    try {
      beginOuter()
      writeOuter({ type: `insert`, value: { id: 1, name: `Ada` } })
      expect(() => commitOuter()).toThrow(readyFailure)
      expect(scheduledJob).toHaveBeenCalledOnce()
    } finally {
      outerFirst.unsubscribe()
      outerSecond.unsubscribe()
      innerFirst.unsubscribe()
      innerSecond.unsubscribe()
      await outer.cleanup()
      await inner.cleanup()
    }
  })

  it(`settles a dependent live query before a nested ready failure escapes`, async () => {
    let markSourceReady: (() => void) | undefined
    const listenerFailure = new Error(`source ready listener failed`)
    const source = createCollection<User>({
      id: `nested-ready-live-source`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markSourceReady = markReady
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `nested-ready-live-dependent`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: source })
          .select(({ user }) => ({ id: user.id, name: user.name })),
    })
    const preload = live.preload()
    const throwingSubscription = source.subscribeChanges(() => {
      throw listenerFailure
    })

    try {
      expect(live.status).toBe(`loading`)
      expect(() => withPublicationContext(() => markSourceReady!())).toThrow(
        listenerFailure,
      )
      await expect(preload).resolves.toBeUndefined()
      expect(source.status).toBe(`ready`)
      expect(live.status).toBe(`ready`)
    } finally {
      throwingSubscription.unsubscribe()
      await live.cleanup()
      await source.cleanup()
    }
  })

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
            `full`,
          )
          .select(({ left, right }) => ({
            left: left.value,
            right: right.value,
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

    expect(liveQueryJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A1`, right: `B1` },
    ])
    expect(liveQueryJoin.utils.getRunCount()).toBe(baseRunCount + 1)

    tx.mutate(() => {
      collectionA.update(1, (draft) => {
        draft.value = `A1b`
      })
      collectionB.update(1, (draft) => {
        draft.value = `B1b`
      })
    })

    expect(liveQueryJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A1b`, right: `B1b` },
    ])
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
            `full`,
          )
          .select(({ left, right }) => ({
            left: left.value,
            right: right.value,
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

    expect(hybridJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A7`, right: `B7` },
    ])
    expect(hybridJoin.utils.getRunCount()).toBe(baseRunCount + 1)

    tx.mutate(() => {
      collectionA.update(7, (draft) => {
        draft.value = `A7b`
      })
      collectionB.update(7, (draft) => {
        draft.value = `B7b`
      })
    })

    expect(hybridJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A7b`, right: `B7b` },
    ])
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
            `full`,
          )
          .select(({ left, right }) => ({
            left: left.value,
            right: right.value,
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

    expect(join.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `left-later`, right: `right-first` },
    ])
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
    } as unknown as Parameters<SyncConfig<UserWithVirtual>[`sync`]>[0]

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

  it.each([
    { name: `undefined`, failure: undefined },
    { name: `null`, failure: null },
    { name: `false`, failure: false },
    { name: `zero`, failure: 0 },
    { name: `empty string`, failure: `` },
    { name: `NaN`, failure: Number.NaN },
  ])(`preserves the first falsy graph-loader failure: $name`, ({ failure }) => {
    const baseCollection = createCollection<User>({
      id: `falsy-loader-users-${String(failure)}`,
      getKey: (user) => user.id,
      sync: {
        sync: () => () => {},
      },
    })
    const builder = new CollectionConfigBuilder({
      id: `falsy-loader-builder-${String(failure)}`,
      query: (q) => q.from({ user: baseCollection }),
    })
    const contextId = Symbol(`falsy-loader-context`)
    const laterLoader = vi.fn(() => true)
    const config = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
      truncate: vi.fn(),
    } as unknown as Parameters<SyncConfig<UserWithVirtual>[`sync`]>[0]
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

    builder.currentSyncConfig = config
    builder.currentSyncState = syncState
    builder.scheduleGraphRun(
      () => {
        throw failure
      },
      { contextId },
    )
    builder.scheduleGraphRun(laterLoader, { contextId })

    let didThrow = false
    let thrown: unknown
    try {
      transactionScopedScheduler.flush(contextId)
    } catch (error) {
      didThrow = true
      thrown = error
    } finally {
      maybeRunGraphSpy.mockRestore()
    }

    expect(didThrow).toBe(true)
    expect(Object.is(thrown, failure)).toBe(true)
    expect(laterLoader).toHaveBeenCalledOnce()
  })

  it(`attempts every repeated-alias source loader and preserves the first failure`, async () => {
    const createSource = (name: string) =>
      createCollection<User>({
        id: `source-loader-${name}`,
        getKey: (user) => user.id,
        startSync: true,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return () => {}
          },
        },
      })
    const firstSource = createSource(`first`)
    const secondSource = createSource(`second`)
    const thirdSource = createSource(`third`)
    const builder = new CollectionConfigBuilder({
      id: `source-loader-builder`,
      query: (q) =>
        q.from({ root: firstSource }).select(({ root }) => ({
          id: root.id,
          second: q
            .from({ item: secondSource })
            .where(({ item }) => eq(item.id, root.id)),
          third: q
            .from({ item: thirdSource })
            .where(({ item }) => eq(item.id, root.id)),
        })),
    })
    type BuilderSyncConfig = Parameters<
      ReturnType<typeof builder.getConfig>[`sync`][`sync`]
    >[0]
    const config = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
      truncate: vi.fn(),
    } as unknown as BuilderSyncConfig
    const builderInternals = builder as unknown as {
      graphCache: FullSyncState[`graph`]
      inputsCache: FullSyncState[`inputs`]
      pipelineCache: FullSyncState[`pipeline`]
      collectionSources: Array<{
        sourceId: string
        alias: string
        collection: object
      }>
      subscribeToAllCollections: (
        syncConfig: typeof config,
        state: FullSyncState,
      ) => () => boolean
    }
    const syncState = {
      messagesCount: 0,
      unsubscribeCallbacks: new Set<() => void>(),
      subscribedToAllCollections: false,
      graph: builderInternals.graphCache,
      inputs: builderInternals.inputsCache,
      pipeline: builderInternals.pipelineCache,
    } as unknown as FullSyncState
    const sourceIdFor = (collection: object): string => {
      const source = builderInternals.collectionSources.find(
        (candidate) => candidate.collection === collection,
      )
      if (!source) throw new Error(`Expected a lexical source`)
      return source.sourceId
    }
    const firstSourceId = sourceIdFor(firstSource)
    const secondSourceId = sourceIdFor(secondSource)
    const thirdSourceId = sourceIdFor(thirdSource)
    expect(
      builderInternals.collectionSources.map(({ alias }) => alias),
    ).toEqual([`root`, `item`, `item`])
    expect(new Set([firstSourceId, secondSourceId, thirdSourceId]).size).toBe(3)
    const laterFailure = new Error(`later source failed`)
    const loaderCalls: Array<string> = []
    const loaderCallCounts = new Map<string, number>()
    const loadMoreSpy = vi
      .spyOn(CollectionSubscriber.prototype, `loadMoreIfNeeded`)
      .mockImplementation(function (this: unknown) {
        const { sourceId } = this as { sourceId: string }
        loaderCalls.push(sourceId)
        loaderCallCounts.set(
          sourceId,
          (loaderCallCounts.get(sourceId) ?? 0) + 1,
        )
        if (sourceId === firstSourceId) throw undefined
        if (sourceId === secondSourceId) throw laterFailure
        if (sourceId === thirdSourceId) return true
        throw new Error(`Unexpected source: ${sourceId}`)
      })

    try {
      builder.currentSyncConfig = config
      builder.currentSyncState = syncState
      const loadAllSources = builderInternals.subscribeToAllCollections(
        config,
        syncState,
      )

      let didThrow = false
      let thrown: unknown
      try {
        loadAllSources()
      } catch (error) {
        didThrow = true
        thrown = error
      }

      expect(didThrow).toBe(true)
      expect(Object.is(thrown, undefined)).toBe(true)
      expect(loaderCalls).toEqual([
        firstSourceId,
        secondSourceId,
        thirdSourceId,
      ])
      expect(loaderCallCounts).toEqual(
        new Map([
          [firstSourceId, 1],
          [secondSourceId, 1],
          [thirdSourceId, 1],
        ]),
      )
      expect(loadMoreSpy).toHaveBeenCalledTimes(3)
    } finally {
      for (const unsubscribe of syncState.unsubscribeCallbacks) unsubscribe()
      loadMoreSpy.mockRestore()
      await Promise.all([
        firstSource.cleanup(),
        secondSource.cleanup(),
        thirdSource.cleanup(),
      ])
    }
  })

  it(`should handle optimistic mutations with nested left joins without scheduler errors`, async () => {
    // This test verifies that optimistic mutations on collections with nested live query
    // collections using left joins complete successfully without scheduler errors.
    //
    // Expected behavior:
    // 1. Collections are pre-populated with initialData (via mockSyncCollectionOptions)
    // 2. Nested live query collections use left joins
    // 3. An optimistic action updates an existing item using draft mutations
    // 4. The scheduler should flush the transaction successfully without detecting unresolved dependencies

    interface Account {
      id: string
      user_id: string
      name: string
    }

    interface UserProfile {
      id: string
      profile: string
    }

    interface Team {
      id: string
      account_id: string
      deleted_ts: string | null
    }

    // Use mockSyncCollectionOptions with initialData to match the failing test
    // Note: mockSyncCollectionOptions already sets startSync: true internally
    const accounts = createCollection<Account>(
      mockSyncCollectionOptions({
        id: `left-join-bug-accounts`,
        getKey: (account) => account.id,
        initialData: [
          { id: `account-1`, user_id: `user-1`, name: `Account 1` },
        ],
      }),
    )

    const users = createCollection<UserProfile>(
      mockSyncCollectionOptions({
        id: `left-join-bug-users`,
        getKey: (user) => user.id,
        initialData: [{ id: `user-1`, profile: `Profile 1` }],
      }),
    )

    const teams = createCollection<Team>(
      mockSyncCollectionOptions({
        id: `left-join-bug-teams`,
        getKey: (team) => team.id,
        initialData: [
          {
            id: `team-1`,
            account_id: `account-1`,
            deleted_ts: null as string | null,
          },
        ],
      }),
    )

    // Create nested live query collections similar to the bug report
    const accountsWithUsers = createLiveQueryCollection({
      id: `left-join-bug-accounts-with-users`,
      startSync: true,
      query: (q) =>
        q
          .from({ account: accounts })
          .join({ user: users }, ({ user, account }) =>
            eq(user.id, account.user_id),
          )
          .select(({ account, user }) => ({
            account: account,
            profile: user.profile,
          })),
    })

    const activeTeams = createLiveQueryCollection({
      id: `left-join-bug-active-teams`,
      startSync: true,
      query: (q) =>
        q
          .from({ team: teams })
          .where(({ team }) => isNull(team.deleted_ts))
          .select(({ team }) => ({ team })),
    })

    const accountsWithTeams = createLiveQueryCollection({
      id: `left-join-bug-accounts-with-teams`,
      startSync: true,
      query: (q) =>
        q
          .from({ accountWithUser: accountsWithUsers })
          .leftJoin({ team: activeTeams }, ({ accountWithUser, team }) =>
            eq(team.team.account_id, accountWithUser.account.id),
          )
          .select(({ accountWithUser, team }) => ({
            account: accountWithUser.account,
            profile: accountWithUser.profile,
            team: team.team,
          })),
    })

    // Wait for all queries to be ready
    await Promise.all([
      accountsWithUsers.preload(),
      activeTeams.preload(),
      accountsWithTeams.preload(),
    ])

    // Create an optimistic action that mutates using draft
    const testAction = createOptimisticAction<string>({
      onMutate: (id) => {
        // Update existing data using draft mutation
        accounts.update(id, (draft) => {
          draft.name = `new name here`
        })
      },
      mutationFn: (_id, _params) => {
        return Promise.resolve({ txid: 0 })
      },
    })

    // Execute the optimistic action and flush - this should complete without scheduler errors
    let error: Error | undefined
    let transaction: any

    try {
      transaction = testAction(`account-1`)

      // Wait for the transaction to process
      await new Promise((resolve) => setTimeout(resolve, 10))

      // The scheduler should flush successfully without detecting unresolved dependencies
      transactionScopedScheduler.flushAll()
    } catch (e) {
      error = e as Error
    }

    // The scheduler should not throw unresolved dependency errors
    expect(error).toBeUndefined()

    // Verify the transaction was created successfully
    expect(transaction).toBeDefined()
  })

  it(`should prevent stale data when lazy source also depends on modified collection`, async () => {
    interface BaseItem {
      id: string
      value: number
    }

    // Base collection
    const baseCollection = createCollection<BaseItem>(
      mockSyncCollectionOptions({
        id: `race-base`,
        getKey: (item) => item.id,
        initialData: [{ id: `1`, value: 10 }],
      }),
    )

    // QueryA: depends on base
    const queryA = createLiveQueryCollection({
      id: `race-queryA`,
      startSync: true,
      query: (q) =>
        q.from({ item: baseCollection }).select(({ item }) => ({
          id: item.id,
          value: item.value,
        })),
    })

    // QueryB: also depends on base (independent from queryA)
    const queryB = createLiveQueryCollection({
      id: `race-queryB`,
      startSync: true,
      query: (q) =>
        q.from({ item: baseCollection }).select(({ item }) => ({
          id: item.id,
          value: item.value,
        })),
    })

    // QueryC: depends on queryA, left joins queryB (lazy)
    const queryC = createLiveQueryCollection({
      id: `race-queryC`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: queryA })
          .leftJoin({ b: queryB }, ({ a, b }) => eq(a.id, b.id))
          .select(({ a, b }) => ({
            id: a.id,
            aValue: a.value,
            bValue: b.value,
          })),
    })

    // Wait for initial sync
    await Promise.all([queryA.preload(), queryB.preload(), queryC.preload()])

    // Verify initial state
    const initialC = [...queryC.values()][0]
    expect(initialC?.aValue).toBe(10)
    expect(initialC?.bValue).toBe(10)

    // Mutate the base collection
    const action = createOptimisticAction<string>({
      autoCommit: false,
      onMutate: (id) => {
        baseCollection.update(id, (draft) => {
          draft.value = 100
        })
      },
      mutationFn: (_id) => Promise.resolve({ txid: 0 }),
    })

    let error: Error | undefined
    try {
      action(`1`)
      await new Promise((resolve) => setTimeout(resolve, 10))
      transactionScopedScheduler.flushAll()
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeUndefined()

    const finalC = [...queryC.values()][0]
    expect(finalC?.aValue).toBe(100)
    expect(finalC?.bValue).toBe(100)
  })
})
