import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq, isNull } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import { transactionScopedScheduler } from '../../src/scheduler.js'
import { CollectionConfigBuilder } from '../../src/query/live/collection-config-builder.js'
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
            `full`,
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
            profile: user?.profile,
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
            team: team?.team,
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
            bValue: b?.value ?? null,
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
