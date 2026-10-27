// Leadership replay cases whose expectations are written by hand: a fixed
// outbox restart, pinned admission and retry-hook histories, stale reads,
// and failed deletions. The leadership and replay laws they illustrate are
// owned by leadership-replay-oracle.property.test.ts.
import { expect, it, vi } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { NonRetriableError } from '../src/types'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'
import { gate, storedTransaction, turn } from './leadership-replay-support'
import type { OfflineTransaction, OnlineDetector } from '../src/types'
import type { TestItem } from './harness'

it(`removes an earlier deletion-pending row before replaying an equal-time peer`, async () => {
  // The README promises creation-order FIFO and deletion before success. This
  // fixed offline executor restart history uses storage insertion order to
  // distinguish creation when both persisted timestamps are equal. The
  // independent expected trace first removes the earlier completed-provider row,
  // then executes and removes its later peer. It covers this storage boundary,
  // not ordering across independent storage writers or a native browser host.
  const earlier: OfflineTransaction = {
    ...storedTransaction(`earlier`),
    outboxPhase: `deletion-pending`,
  }
  const later = storedTransaction(`later`)
  const events: Array<string> = []
  const hookInputs: Array<Array<string>> = []
  class Storage extends FakeStorageAdapter {
    override async delete(key: string): Promise<void> {
      events.push(`delete:${key.slice(3)}`)
      await super.delete(key)
    }
  }
  const outbox = new OutboxManager(new Storage(), {})
  await outbox.add(earlier)
  await outbox.add(later)
  const executor = new TransactionExecutor(
    new KeyScheduler(),
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: async ({ transaction }) => {
          events.push(`provider:${transaction.id}`)
        },
      },
      beforeRetry: (transactions) => {
        hookInputs.push(transactions.map(({ id }) => id))
        return transactions
      },
    },
    {
      isOfflineEnabled: true,
      isOnline: () => true,
      resolveTransaction: () => {},
      rejectTransaction: () => {},
      registerRestorationTransaction: () => {},
    },
  )

  let hasPrimaryFailure = false
  try {
    expect((await outbox.getAll()).map(({ id }) => id)).toEqual([
      earlier.id,
      later.id,
    ])
    await atOracleCheckpoint(
      executor.loadPendingTransactions(),
      `equal-time outbox replay loaded`,
    )
    await atOracleCheckpoint(
      executor.executeAll(),
      `equal-time outbox replay drained`,
    )

    expect({ hookInputs, events, remaining: await outbox.count() }).toEqual({
      hookInputs: [[later.id]],
      events: [
        `delete:${earlier.id}`,
        `provider:${later.id}`,
        `delete:${later.id}`,
      ],
      remaining: 0,
    })
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupOfflineOracle([() => executor.clear()], hasPrimaryFailure)
  }
})

// The model is a safety relation over public settlement and external effects:
// fulfillment requires an admitted outbox record or a provider call. The
// before-call history selects the online-only path; the onMutate history has
// already selected the offline path. Loss before admission rejects and rolls
// back that selected offline transaction.
it.each([
  { history: `retains leadership`, loss: `never`, providerCalls: 1 },
  {
    history: `loses leadership before invocation`,
    loss: `before-call`,
    providerCalls: 1,
  },
  {
    history: `loses leadership during onMutate`,
    loss: `on-mutate`,
    providerCalls: 0,
  },
  {
    history: `loses leadership just after onMutate`,
    loss: `after-on-mutate`,
    providerCalls: 0,
  },
] as const)(
  `never fulfills an unadmitted action when it $history`,
  async ({ loss, providerCalls }) => {
    const stored = gate()
    const releaseWrite = gate()
    class Storage extends FakeStorageAdapter {
      override async set(key: string, value: string) {
        await super.set(key, value)
        if (key.startsWith(`tx:`)) {
          stored.resolve()
          // Keep the stored record visible before admission starts provider work.
          if (loss === `never`) await releaseWrite.promise
        }
      }
    }
    const env = createTestOfflineEnvironment({ storage: new Storage() })
    const row: TestItem = {
      id: `admission-row`,
      value: `Buy milk`,
      completed: false,
      updatedAt: new Date(1700000000000),
    }
    const outcome: {
      status: `pending` | `fulfilled` | `rejected`
      error?: unknown
    } = {
      status: `pending`,
    }
    let observed: Promise<void> | undefined
    let transactionId: string | undefined
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const action = env.executor.createOfflineAction({
        mutationFnName: env.mutationFnName,
        onMutate: (item: TestItem) => {
          env.collection.insert(item)
          if (loss === `on-mutate`) env.leader.setLeader(false)
          if (loss === `after-on-mutate`)
            queueMicrotask(() => env.leader.setLeader(false))
        },
      })
      if (loss === `before-call`) env.leader.setLeader(false)
      const transaction = action(row)
      transactionId = transaction.id
      const settled = transaction.isPersisted.promise.then(
        () => {
          outcome.status = `fulfilled`
        },
        (error: unknown) => {
          outcome.status = `rejected`
          outcome.error = error
        },
      )
      observed = settled

      // Public settlement or a stored record lets us inspect this attempt.
      // The provider call may follow the stored record.
      await atOracleCheckpoint(
        Promise.race([settled, stored.promise]),
        `action settled or stored`,
      )
      const durable = await env.executor.peekOutbox()
      // Fulfillment without either effect violates the admission law.
      expect([
        outcome.status,
        durable.length,
        env.mutationCalls.length,
      ]).not.toEqual([`fulfilled`, 0, 0])
      if (loss === `on-mutate` || loss === `after-on-mutate`) {
        expect(env.executor.isOfflineEnabled).toBe(false)
        expect(outcome.status).toBe(`rejected`)
        expect(outcome.error).toBeInstanceOf(NonRetriableError)
        expect(durable).toEqual([])
        expect(env.collection.get(row.id)).toBeUndefined()
      } else {
        if (loss === `never`) {
          expect(outcome.status).toBe(`pending`)
          expect(durable).toHaveLength(1)
          expect(env.mutationCalls).toHaveLength(0)
          releaseWrite.resolve()
        }
        await atOracleCheckpoint(observed, `admitted action settled`)
        expect(outcome.status).toBe(`fulfilled`)
        expect(env.collection.get(row.id)).toMatchObject(row)
      }
      expect(env.mutationCalls).toHaveLength(providerCalls)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseWrite.resolve()
      if (outcome.status === `pending` && transactionId) {
        env.executor.rejectTransaction(
          transactionId,
          new NonRetriableError(`oracle cleanup`),
        )
      }
      await cleanupOfflineOracle(
        [
          () => observed,
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

it(`rejects a selected manual offline transaction that loses leadership before admission`, async () => {
  const env = createTestOfflineEnvironment()
  const row: TestItem = {
    id: `manual-admission-row`,
    value: `Buy milk`,
    completed: false,
    updatedAt: new Date(1700000000000),
  }
  let transactionId: string | undefined
  let commitObserved: Promise<unknown> | undefined
  let persistedObserved: Promise<unknown> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const offline = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    const transaction = offline.mutate(() => env.collection.insert(row))
    transactionId = transaction.id
    persistedObserved = transaction.isPersisted.promise.then(
      () => `fulfilled`,
      (error: unknown) => error,
    )

    env.leader.setLeader(false)
    commitObserved = offline.commit().then(
      () => `fulfilled`,
      (error: unknown) => error,
    )
    const [commitResult, persistedResult] = await atOracleCheckpoint(
      Promise.all([commitObserved, persistedObserved]),
      `manual action rejected before admission`,
    )
    expect(commitResult).toBeInstanceOf(NonRetriableError)
    expect(persistedResult).toBe(commitResult)
    expect(env.collection.get(row.id)).toBeUndefined()
    expect(await env.executor.peekOutbox()).toEqual([])
    expect(env.mutationCalls).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    if (transactionId)
      env.executor.rejectTransaction(
        transactionId,
        new NonRetriableError(`oracle cleanup`),
      )
    await cleanupOfflineOracle(
      [
        () => commitObserved,
        () => persistedObserved,
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
})

it(`revokes only replay work excluded by the retry hook`, async () => {
  // The hook classifies one captured replay snapshot. Reconciliation may
  // revoke IDs from that snapshot, but must preserve work admitted later.
  const captured = gate()
  const delivery = gate()
  let hold = false
  let scans = 0
  class Storage extends FakeStorageAdapter {
    override async keys() {
      scans++
      return super.keys()
    }

    override async get(key: string) {
      const value = await super.get(key)
      if (hold && key === `tx:filtered`) {
        captured.resolve()
        await delivery.promise
      }
      return value
    }
  }

  const filtered = storedTransaction(`filtered`)
  const retained = {
    ...storedTransaction(`retained`),
    createdAt: new Date(1),
  }
  const admitted = {
    ...storedTransaction(`admitted`),
    createdAt: new Date(2),
  }
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  await outbox.add(filtered)
  await outbox.add(retained)

  const hookInputs: Array<Array<string>> = []
  const calls: Array<string> = []
  let filterReplay = false
  let online = false
  const scheduler = new KeyScheduler()
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: async ({ transaction }) => {
          calls.push(transaction.id)
        },
      },
      beforeRetry: (transactions) => {
        hookInputs.push(transactions.map(({ id }) => id))
        return filterReplay
          ? transactions.filter(({ id }) => id !== filtered.id)
          : transactions
      },
      jitter: false,
    },
    {
      isOfflineEnabled: true,
      isOnline: () => online,
      resolveTransaction: () => {},
      rejectTransaction: () => {},
      registerRestorationTransaction: () => {},
    },
  )

  try {
    await executor.loadPendingTransactions()
    expect(scheduler.getAllPendingTransactions().map(({ id }) => id)).toEqual([
      filtered.id,
      retained.id,
    ])

    filterReplay = true
    hold = true
    const loading = executor.loadPendingTransactions()
    await atOracleCheckpoint(captured.promise, `retry scan captured filtered`)
    await outbox.add(admitted)
    await executor.execute(admitted)
    hold = false
    delivery.resolve()
    await atOracleCheckpoint(loading, `filtered retry scan delivered`)

    const queued = scheduler.getAllPendingTransactions().map(({ id }) => id)
    const durable = (await outbox.getAll()).map(({ id }) => id)
    online = true
    await atOracleCheckpoint(executor.executeAll(), `retained work drained`)

    expect({ queued, durable, calls, hookInputs, scans }).toEqual({
      queued: [retained.id, admitted.id],
      durable: [retained.id, admitted.id],
      calls: [retained.id, admitted.id],
      hookInputs: [
        [filtered.id, retained.id],
        [filtered.id, retained.id],
      ],
      scans: 3,
    })
  } finally {
    hold = false
    delivery.resolve()
    executor.clear()
  }
})

it(`settles replay work discarded by the retry hook`, async () => {
  const persisted = gate()
  const removed = gate()
  class Storage extends FakeStorageAdapter {
    override async set(key: string, value: string) {
      await super.set(key, value)
      persisted.resolve()
    }

    override async delete(key: string) {
      await super.delete(key)
      removed.resolve()
    }
  }
  const onlineDetector: OnlineDetector = {
    subscribe: () => () => {},
    notifyOnline: () => {},
    isOnline: () => false,
    dispose: () => {},
  }
  let discardReplay = false
  const storage = new Storage()
  const env = createTestOfflineEnvironment({
    storage,
    config: {
      onlineDetector,
      beforeRetry: (transactions) => (discardReplay ? [] : transactions),
    },
  })
  let commitStatus: unknown = `pending`
  let waitStatus: unknown = `pending`
  let commitObserved: Promise<void> | undefined
  let waitObserved: Promise<void> | undefined
  let transactionId = ``
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const transaction = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = transaction.id
    waitObserved = env.executor
      .waitForTransactionCompletion(transaction.id)
      .then(
        () => {
          waitStatus = `fulfilled`
        },
        (error: unknown) => {
          waitStatus = error
        },
      )
    transaction.mutate(() => {
      env.collection.insert({
        id: `discarded`,
        value: `optimistic`,
        completed: false,
        updatedAt: new Date(0),
      })
    })
    commitObserved = transaction.commit().then(
      () => {
        commitStatus = `fulfilled`
      },
      (error: unknown) => {
        commitStatus = error
      },
    )
    await atOracleCheckpoint(persisted.promise, `discarded work persisted`)
    expect(env.collection.get(`discarded`)).toMatchObject({
      value: `optimistic`,
    })

    env.leader.setLeader(false)
    discardReplay = true
    env.leader.setLeader(true)
    await atOracleCheckpoint(removed.promise, `discarded work removed`)
    await turn()

    expect(commitStatus).toBeInstanceOf(NonRetriableError)
    expect(waitStatus).toBe(commitStatus)
    expect(env.collection.get(`discarded`)).toBeUndefined()
    expect(storage.snapshot()).not.toHaveProperty(`tx:${transaction.id}`)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    if (commitStatus === `pending` && transactionId)
      env.executor.rejectTransaction(
        transactionId,
        new NonRetriableError(`oracle cleanup`),
      )
    await cleanupOfflineOracle(
      [
        () => Promise.all([commitObserved, waitObserved]),
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
})

it.each([0, 1])(
  `settles each discarded replay after its durable removal succeeds when deletion %i fails`,
  async (failedIndex) => {
    const successfulIndex = 1 - failedIndex
    const persisted = gate()
    const removing = gate()
    const releaseRemoval = gate()
    const removed = gate()
    const failed = gate()
    const retried = gate()
    const storageError = new Error(`discard removal failed`)
    let writes = 0
    let failedKey = ``
    let failRemoval = false
    let failedOnce = false
    class Storage extends FakeStorageAdapter {
      override async set(key: string, value: string) {
        await super.set(key, value)
        if (++writes === 2) persisted.resolve()
      }

      override async delete(key: string) {
        if (failRemoval && key !== failedKey) {
          removing.resolve()
          await releaseRemoval.promise
        }
        if (failRemoval && key === failedKey && !failedOnce) {
          failedOnce = true
          failed.resolve()
          throw storageError
        }
        await super.delete(key)
        if (key === failedKey) retried.resolve()
        else removed.resolve()
      }
    }
    const onlineDetector: OnlineDetector = {
      subscribe: () => () => {},
      notifyOnline: () => {},
      isOnline: () => false,
      dispose: () => {},
    }
    let discardReplay = false
    const storage = new Storage()
    const env = createTestOfflineEnvironment({
      storage,
      config: {
        onlineDetector,
        beforeRetry: (transactions) => (discardReplay ? [] : transactions),
      },
    })
    const ids: Array<string> = []
    const commitStatuses: Array<unknown> = [`pending`, `pending`]
    const waitStatuses: Array<unknown> = [`pending`, `pending`]
    const commitObserved: Array<Promise<void>> = []
    const waitObserved: Array<Promise<void>> = []
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      for (let index = 0; index < 2; index++) {
        const transaction = env.executor.createOfflineTransaction({
          mutationFnName: env.mutationFnName,
          autoCommit: false,
        })
        ids.push(transaction.id)
        waitObserved.push(
          env.executor.waitForTransactionCompletion(transaction.id).then(
            () => {
              waitStatuses[index] = `fulfilled`
            },
            (error: unknown) => {
              waitStatuses[index] = error
            },
          ),
        )
        transaction.mutate(() => {
          env.collection.insert({
            id: `discarded-${index}`,
            value: `optimistic-${index}`,
            completed: false,
            updatedAt: new Date(index),
          })
        })
        commitObserved.push(
          transaction.commit().then(
            () => {
              commitStatuses[index] = `fulfilled`
            },
            (error: unknown) => {
              commitStatuses[index] = error
            },
          ),
        )
      }
      await atOracleCheckpoint(persisted.promise, `discarded work persisted`)

      env.leader.setLeader(false)
      discardReplay = true
      failedKey = `tx:${ids[failedIndex]}`
      failRemoval = true
      env.leader.setLeader(true)
      await atOracleCheckpoint(
        Promise.all([removing.promise, failed.promise]),
        `mixed discard removals started`,
      )
      await turn()

      expect(commitStatuses).toEqual([`pending`, `pending`])
      expect(waitStatuses).toEqual([`pending`, `pending`])
      expect(warning).toHaveBeenCalledWith(
        `Failed to remove transaction excluded by beforeRetry:`,
        ids[failedIndex],
        storageError,
      )
      expect(env.executor.getPendingCount()).toBe(0)
      expect(storage.snapshot()).toHaveProperty(`tx:${ids[0]}`)
      expect(storage.snapshot()).toHaveProperty(failedKey)
      expect(env.collection.get(`discarded-0`)?.value).toBe(`optimistic-0`)
      expect(env.collection.get(`discarded-1`)?.value).toBe(`optimistic-1`)
      expect(env.mutationCalls).toHaveLength(0)

      releaseRemoval.resolve()
      await atOracleCheckpoint(removed.promise, `successful discard removed`)
      await turn()

      expect(commitStatuses[successfulIndex]).toBeInstanceOf(NonRetriableError)
      expect(waitStatuses[successfulIndex]).toBe(
        commitStatuses[successfulIndex],
      )
      expect(commitStatuses[failedIndex]).toBe(`pending`)
      expect(waitStatuses[failedIndex]).toBe(`pending`)
      expect({
        queued: env.executor.getPendingCount(),
        durable: Object.keys(storage.snapshot()),
        optimistic: [
          env.collection.get(`discarded-${successfulIndex}`),
          env.collection.get(`discarded-${failedIndex}`)?.value,
        ],
        calls: env.mutationCalls.length,
      }).toEqual({
        queued: 0,
        durable: [failedKey],
        optimistic: [undefined, `optimistic-${failedIndex}`],
        calls: 0,
      })

      env.leader.setLeader(false)
      env.leader.setLeader(true)
      await atOracleCheckpoint(retried.promise, `failed discard retried`)
      await turn()

      expect(commitStatuses[failedIndex]).toBeInstanceOf(NonRetriableError)
      expect(waitStatuses[failedIndex]).toBe(commitStatuses[failedIndex])
      expect({
        queued: env.executor.getPendingCount(),
        durable: storage.snapshot(),
        optimistic: env.collection.get(`discarded-${failedIndex}`),
        calls: env.mutationCalls.length,
      }).toEqual({ queued: 0, durable: {}, optimistic: undefined, calls: 0 })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseRemoval.resolve()
      for (let index = 0; index < ids.length; index++)
        if (commitStatuses[index] === `pending`)
          env.executor.rejectTransaction(
            ids[index]!,
            new NonRetriableError(`oracle cleanup`),
          )
      await cleanupOfflineOracle(
        [
          () => Promise.all([...commitObserved, ...waitObserved]),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
      warning.mockRestore()
    }
  },
)

it(`keeps retry timers live when a retry record update fails`, async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const storageError = new Error(`retry update failed`)
  class Storage extends FakeStorageAdapter {
    private failed = false

    override async set(key: string, value: string) {
      if (!this.failed && JSON.parse(value).retryCount > 0) {
        this.failed = true
        throw storageError
      }
      await super.set(key, value)
    }
  }
  const transaction = storedTransaction(`retry-after-update-failure`)
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  await outbox.add(transaction)
  const scheduler = new KeyScheduler()
  const calls: Array<string> = []
  const completed: Array<string> = []
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: async ({ transaction: current }) => {
          calls.push(current.id)
          if (calls.length === 1) throw new Error(`provider unavailable`)
        },
      },
      jitter: false,
    },
    {
      isOfflineEnabled: true,
      isOnline: () => true,
      resolveTransaction: (id) => completed.push(id),
      rejectTransaction: () => {},
      registerRestorationTransaction: () => {},
    },
  )

  try {
    await expect(executor.execute(transaction)).rejects.toBe(storageError)
    expect({ calls, completed, pending: executor.getPendingCount() }).toEqual({
      calls: [transaction.id],
      completed: [],
      pending: 1,
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect({ calls, completed, pending: executor.getPendingCount() }).toEqual({
      calls: [transaction.id, transaction.id],
      completed: [transaction.id],
      pending: 0,
    })
    expect(await outbox.get(transaction.id)).toBeNull()
  } finally {
    executor.clear()
    vi.useRealTimers()
  }
})

it(`stops later work when terminal outbox removal fails`, async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const storageError = new Error(`permanent removal failed`)
  class Storage extends FakeStorageAdapter {
    private failed = false

    override async delete(key: string) {
      if (!this.failed && key === `tx:permanent`) {
        this.failed = true
        throw storageError
      }
      await super.delete(key)
    }
  }
  const permanent = storedTransaction(`permanent`)
  const later = { ...storedTransaction(`later`), createdAt: new Date(1) }
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  await outbox.add(permanent)
  await outbox.add(later)
  const scheduler = new KeyScheduler()
  scheduler.schedule(permanent)
  scheduler.schedule(later)
  const calls: Array<string> = []
  const completed: Array<string> = []
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: async ({ transaction }) => {
          calls.push(transaction.id)
          if (transaction.id === permanent.id)
            throw new NonRetriableError(`permanent`)
        },
      },
      jitter: false,
    },
    {
      isOfflineEnabled: true,
      isOnline: () => true,
      resolveTransaction: (id) => completed.push(id),
      rejectTransaction: () => {},
      registerRestorationTransaction: () => {},
    },
  )

  try {
    await expect(executor.executeAll()).rejects.toBe(storageError)
    expect({ calls, completed, pending: executor.getPendingCount() }).toEqual({
      calls: [permanent.id],
      completed: [],
      pending: 2,
    })

    await vi.advanceTimersByTimeAsync(60_000)
    expect({ calls, completed, pending: executor.getPendingCount() }).toEqual({
      calls: [permanent.id],
      completed: [],
      pending: 2,
    })
    expect((await outbox.get(permanent.id))?.outboxPhase).toBe(
      `rejection-pending`,
    )
    expect(await outbox.get(later.id)).toEqual(later)
  } finally {
    executor.clear()
    vi.useRealTimers()
  }
})

it(`keeps issued work durable when a replay hook excludes it`, async () => {
  const entered = gate()
  const release = gate()
  const retryRead = gate()
  const retryWrite = gate()
  let holdRetryUpdate = false
  class Storage extends FakeStorageAdapter {
    override async get(key: string) {
      const value = await super.get(key)
      if (holdRetryUpdate && key === `tx:active`) {
        holdRetryUpdate = false
        retryRead.resolve()
        await retryWrite.promise
      }
      return value
    }
  }
  const active = storedTransaction(`active`)
  const filtered = {
    ...storedTransaction(`filtered`),
    createdAt: new Date(1),
  }
  const retained = {
    ...storedTransaction(`retained`),
    createdAt: new Date(2),
  }
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  await Promise.all(
    [active, filtered, retained].map((transaction) => outbox.add(transaction)),
  )
  const scheduler = new KeyScheduler()
  let online = true
  for (const transaction of [active, filtered, retained])
    scheduler.schedule(transaction)
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: async () => {
          entered.resolve()
          await release.promise
          holdRetryUpdate = true
          throw new Error(`retry`)
        },
      },
      beforeRetry: (transactions) =>
        transactions.filter(({ id }) => id === retained.id),
      jitter: false,
    },
    {
      isOfflineEnabled: true,
      isOnline: () => online,
      resolveTransaction: () => {},
      rejectTransaction: () => {},
      registerRestorationTransaction: () => {},
    },
  )

  let executing: Promise<void> | undefined
  try {
    executing = executor.executeAll()
    await atOracleCheckpoint(entered.promise, `issued work entered provider`)
    await executor.loadPendingTransactions()

    expect({
      queued: scheduler.getAllPendingTransactions().map(({ id }) => id),
      durable: (await outbox.getAll()).map(({ id }) => id),
      running: scheduler.getRunningCount(),
    }).toEqual({
      queued: [active.id, retained.id],
      durable: [active.id, retained.id],
      running: 1,
    })

    release.resolve()
    await atOracleCheckpoint(retryRead.promise, `retry persistence read issued`)
    await executor.loadPendingTransactions()
    expect({
      queued: scheduler.getAllPendingTransactions().map(({ id }) => id),
      durable: (await outbox.getAll()).map(({ id }) => id),
      running: scheduler.getRunningCount(),
    }).toEqual({
      queued: [active.id, retained.id],
      durable: [active.id, retained.id],
      running: 1,
    })

    online = false
    retryWrite.resolve()
    await atOracleCheckpoint(executing, `issued work scheduled its retry`)
    expect({
      active: await outbox.get(active.id),
      filtered: await outbox.get(filtered.id),
      queued: scheduler.getAllPendingTransactions().map(({ id }) => id),
      running: scheduler.getRunningCount(),
    }).toMatchObject({
      active: { id: active.id, retryCount: 1 },
      filtered: null,
      queued: [active.id, retained.id],
      running: 0,
    })
  } finally {
    online = false
    release.resolve()
    retryWrite.resolve()
    await executing?.catch(() => undefined)
    executor.clear()
  }
})

it(`keeps permanently failed work owned until durable deletion settles`, async () => {
  const deleting = gate()
  const deleteRelease = gate()
  class Storage extends FakeStorageAdapter {
    override async delete(key: string) {
      if (key === `tx:active`) {
        deleting.resolve()
        await deleteRelease.promise
      }
      return super.delete(key)
    }
  }
  const active = storedTransaction(`active`)
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  await outbox.add(active)
  const scheduler = new KeyScheduler()
  scheduler.schedule(active)
  const calls: Array<string> = []
  let online = true
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: async ({ transaction }) => {
          calls.push(transaction.id)
          throw new NonRetriableError(`permanent`)
        },
      },
      jitter: false,
    },
    {
      isOfflineEnabled: true,
      isOnline: () => online,
      resolveTransaction: () => {},
      rejectTransaction: () => {},
      registerRestorationTransaction: () => {},
    },
  )
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let executing: Promise<void> | undefined

  try {
    executing = executor.executeAll()
    await atOracleCheckpoint(deleting.promise, `durable rejection started`)
    await executor.loadPendingTransactions()
    expect({
      queued: scheduler.getAllPendingTransactions().map(({ id }) => id),
      durable: (await outbox.getAll()).map(({ id }) => id),
      running: scheduler.getRunningCount(),
    }).toEqual({ queued: [active.id], durable: [active.id], running: 1 })

    online = false
    deleteRelease.resolve()
    await atOracleCheckpoint(executing, `durable rejection settled`)
    expect({
      queued: scheduler.getAllPendingTransactions().map(({ id }) => id),
      durable: (await outbox.getAll()).map(({ id }) => id),
      calls,
    }).toEqual({ queued: [], durable: [], calls: [active.id] })
  } finally {
    online = false
    deleteRelease.resolve()
    await executing?.catch(() => undefined)
    executor.clear()
    warning.mockRestore()
  }
})

it(`does not readmit a permanently rejected row from a stale outbox read`, async () => {
  // Law: once durable removal and rejection complete, an older read cannot
  // schedule that ID or restore its optimistic state.
  const captured = gate()
  const delivery = gate()
  let hold = true
  let capturedOnce = false
  class Storage extends FakeStorageAdapter {
    override async get(key: string) {
      const value = await super.get(key)
      if (hold && !capturedOnce && key === `tx:rejected`) {
        capturedOnce = true
        captured.resolve()
        await delivery.promise
      }
      return value
    }
  }
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  const rejected = storedTransaction(`rejected`)
  await outbox.add(rejected)
  const scheduler = new KeyScheduler()
  let online = false
  let observedRejection: Error | undefined
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: () => Promise.reject(new NonRetriableError(`permanent`)),
      },
      jitter: false,
    },
    {
      isOfflineEnabled: true,
      isOnline: () => online,
      resolveTransaction: () => {},
      rejectTransaction: (_id, error) => {
        observedRejection = error
      },
      registerRestorationTransaction: () => {},
    },
  )
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  try {
    const loading = executor.loadPendingTransactions()
    await atOracleCheckpoint(captured.promise, `stale read captured row`)
    online = true
    await executor.execute(rejected)
    online = false
    expect(observedRejection).toBeInstanceOf(NonRetriableError)
    expect(await outbox.get(rejected.id)).toBeNull()
    hold = false
    delivery.resolve()
    await atOracleCheckpoint(loading, `stale read delivered`)

    expect(scheduler.getAllPendingTransactions()).toEqual([])
  } finally {
    hold = false
    delivery.resolve()
    executor.clear()
    warning.mockRestore()
  }
})

it.each([`remove`, `removeMany`, `clear`] as const)(
  `filters %s from an outbox read already in flight`,
  async (operation) => {
    const captured = gate()
    const delivery = gate()
    let hold = true
    class Storage extends FakeStorageAdapter {
      override async get(key: string) {
        const value = await super.get(key)
        if (hold && key === `tx:removed`) {
          captured.resolve()
          await delivery.promise
        }
        return value
      }
    }
    const outbox = new OutboxManager(new Storage(), {})
    const removed = storedTransaction(`removed`)
    await outbox.add(removed)
    try {
      const reading = outbox.getAll()
      await atOracleCheckpoint(captured.promise, `outbox read captured row`)
      if (operation === `remove`) await outbox.remove(removed.id)
      else if (operation === `removeMany`) await outbox.removeMany([removed.id])
      else await outbox.clear()
      hold = false
      delivery.resolve()

      await expect(
        atOracleCheckpoint(reading, `outbox read delivered`),
      ).resolves.toEqual([])
    } finally {
      hold = false
      delivery.resolve()
    }
  },
)

it.each([1, 4])(
  `loads once while %s concurrent acknowledgments finish`,
  async (acknowledgments) => {
    // Work law: one replay request performs one outbox scan. Concurrent
    // removals filter that scan's result instead of restarting O(N) reads.
    const captured = gate()
    const delivery = gate()
    let hold = true
    let scans = 0
    class Storage extends FakeStorageAdapter {
      override async keys() {
        scans++
        return super.keys()
      }
      override async get(key: string) {
        const value = await super.get(key)
        if (hold && key === `tx:peer`) {
          captured.resolve()
          await delivery.promise
        }
        return value
      }
    }
    const storage = new Storage()
    const outbox = new OutboxManager(storage, {})
    const peer = storedTransaction(`peer`)
    await outbox.add(peer)
    const scheduler = new KeyScheduler()
    let online = false
    const completed: Array<string> = []
    const executor = new TransactionExecutor(
      scheduler,
      outbox,
      {
        collections: {},
        mutationFns: { syncData: async () => {} },
        jitter: false,
      },
      {
        isOfflineEnabled: true,
        isOnline: () => online,
        resolveTransaction: (id) => completed.push(id),
        rejectTransaction: () => {},
        registerRestorationTransaction: () => {},
      },
    )
    try {
      const loading = executor.loadPendingTransactions()
      await atOracleCheckpoint(captured.promise, `replay scan captured peer`)
      online = true
      for (let index = 0; index < acknowledgments; index++) {
        const active = storedTransaction(`active-${index}`)
        await outbox.add(active)
        await executor.execute(active)
      }
      online = false
      hold = false
      delivery.resolve()
      await atOracleCheckpoint(loading, `replay scan delivered`)

      expect(completed).toEqual(
        Array.from(
          { length: acknowledgments },
          (_, index) => `active-${index}`,
        ),
      )
      expect(scans).toBe(1)
      expect(scheduler.getAllPendingTransactions().map(({ id }) => id)).toEqual(
        [peer.id],
      )
    } finally {
      hold = false
      delivery.resolve()
      executor.clear()
    }
  },
)

it(`keeps startup replay available when discarded-work cleanup fails`, async () => {
  const discarded = storedTransaction(`discarded-at-startup`)
  const retained = {
    ...storedTransaction(`retained-at-startup`),
    createdAt: new Date(1),
  }
  const cleanupError = new Error(`discarded cleanup unavailable`)
  class Storage extends FakeStorageAdapter {
    override async delete(key: string): Promise<void> {
      if (key === `tx:${discarded.id}`) throw cleanupError
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  await outbox.add(discarded)
  await outbox.add(retained)
  const replayed = gate()
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const env = createTestOfflineEnvironment({
    storage,
    mutationFn: ({ transaction }) => {
      if (transaction.id === retained.id) replayed.resolve()
    },
    config: {
      beforeRetry: (transactions) =>
        transactions.filter(({ id }) => id !== discarded.id),
    },
  })
  let hasPrimaryFailure = false
  try {
    await expect(
      atOracleCheckpoint(
        env.executor.waitForInit(),
        `startup replay admitted despite discarded cleanup failure`,
      ),
    ).resolves.toBeUndefined()
    await atOracleCheckpoint(replayed.promise, `retained startup work replayed`)
    await turn()

    expect(env.mutationCalls.map(({ transaction }) => transaction.id)).toEqual([
      retained.id,
    ])
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      discarded.id,
    ])
    expect(warning).toHaveBeenCalledWith(
      `Failed to remove transaction excluded by beforeRetry:`,
      discarded.id,
      cleanupError,
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupOfflineOracle(
      [
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
})

it.each([false, true])(
  `fences each successful clear deletion while a peer is pending or fails, failure=%s`,
  async (failure) => {
    const captured = gate(),
      delivery = gate(),
      removed = gate(),
      release = gate()
    let hold = true
    class Storage extends FakeStorageAdapter {
      override async get(key: string) {
        const value = await super.get(key)
        if (hold && key === `tx:removed`) {
          captured.resolve()
          await delivery.promise
        }
        return value
      }
      override async delete(key: string) {
        if (key === `tx:peer`) {
          await release.promise
          if (failure) throw new Error(`storage deletion failed`)
        }
        await super.delete(key)
        if (key === `tx:removed`) removed.resolve()
      }
    }
    const outbox = new OutboxManager(new Storage(), {})
    await outbox.add(storedTransaction(`removed`))
    await outbox.add(storedTransaction(`peer`))
    const reading = outbox.getAll()
    await atOracleCheckpoint(captured.promise, `read captured removed row`)
    const clearing = outbox.clear().then(
      () => undefined,
      (error: unknown) => error,
    )
    try {
      await atOracleCheckpoint(removed.promise, `first deletion finished`)
      if (failure) {
        release.resolve()
        expect(await clearing).toBeInstanceOf(Error)
      }
      hold = false
      delivery.resolve()
      expect((await reading).map(({ id }) => id)).toEqual([`peer`])
    } finally {
      hold = false
      delivery.resolve()
      release.resolve()
      await clearing
    }
  },
)
