import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { OfflineExecutor } from '../src/OfflineExecutor'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { NonRetriableError } from '../src/types'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'
import type { OfflineTransaction, OnlineDetector } from '../src/types'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const storedTransaction = (id: string): OfflineTransaction => ({
  id,
  mutationFnName: `syncData`,
  mutations: [],
  keys: [],
  idempotencyKey: `${id}/once`,
  createdAt: new Date(0),
  retryCount: 0,
  nextAttemptAt: 0,
  version: 1,
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

it(`keeps later work live when a permanent record removal fails`, async () => {
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
      pending: 1,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect({ calls, completed, pending: executor.getPendingCount() }).toEqual({
      calls: [permanent.id, later.id],
      completed: [later.id],
      pending: 0,
    })
    expect(await outbox.get(permanent.id)).toEqual(permanent)
    expect(await outbox.get(later.id)).toBeNull()
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

it.each([`construction`, `leadership`, `outbox read`, `retry hook`] as const)(
  `does not revive a disposed executor after %s`,
  async (boundary) => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (count) => {
        const pending = gate()
        const entered = gate()
        let reading = false
        class Storage extends FakeStorageAdapter {
          override async keys() {
            if (reading && boundary === `outbox read`) {
              entered.resolve()
              await pending.promise
            }
            return super.keys()
          }
        }
        const storage = new Storage()
        const outbox = new OutboxManager(storage, {})
        for (let index = 0; index < count; index++)
          await outbox.add({
            id: `startup-${index}`,
            mutationFnName: `syncData`,
            mutations: [],
            keys: [],
            idempotencyKey: `key-${index}`,
            createdAt: new Date(index),
            retryCount: 0,
            nextAttemptAt: 0,
            version: 1,
          })
        const snapshot = storage.snapshot()
        const callbacks = new Set<(leader: boolean) => void>()
        let leader = false
        let requests = 0
        const restore = vi.spyOn(
          OfflineExecutor.prototype,
          `registerRestorationTransaction`,
        )
        reading = true
        const env = createTestOfflineEnvironment({
          storage,
          config: {
            beforeRetry: (transactions) => {
              if (boundary === `retry hook`) env.executor.dispose()
              return transactions
            },
            leaderElection: {
              requestLeadership: async () => {
                requests++
                if (boundary === `leadership`) {
                  entered.resolve()
                  await pending.promise
                }
                leader = true
                return true
              },
              releaseLeadership: () => {
                leader = false
              },
              isLeader: () => leader,
              onLeadershipChange: (callback) => {
                callbacks.add(callback)
                return () => {
                  callbacks.delete(callback)
                }
              },
            },
          },
        })
        let hasPrimaryFailure = false
        try {
          if (boundary === `leadership` || boundary === `outbox read`)
            await atOracleCheckpoint(
              entered.promise,
              `startup reached ${boundary}`,
            )
          if (boundary !== `retry hook`) env.executor.dispose()
          pending.resolve()
          await atOracleCheckpoint(
            env.executor.waitForInit(),
            `disposed startup completed`,
          )
          await turn()
          expect(env.mutationCalls).toEqual([])
          expect(env.executor.isOfflineEnabled).toBe(false)
          expect(callbacks.size).toBe(0)
          expect(env.executor.getPendingCount()).toBe(0)
          expect(leader).toBe(false)
          expect(restore).not.toHaveBeenCalled()
          expect(storage.snapshot()).toEqual(snapshot)
          if (boundary === `construction`) expect(requests).toBe(0)
        } catch (error) {
          hasPrimaryFailure = true
          throw error
        } finally {
          pending.resolve()
          restore.mockRestore()
          await cleanupOfflineOracle(
            [
              () => env.executor.dispose(),
              () => env.executor.waitForInit(),
              () => env.collection.cleanup(),
            ],
            hasPrimaryFailure,
          )
        }
      }),
      { seed: 20260918, numRuns: 10 },
    )
  },
)

it.each(
  [`loss`, `dispose`].flatMap((stop) =>
    [`provider`, `acknowledgment`, `retry`].flatMap((boundary) =>
      [20260917, undefined].map((seed) => ({ stop, boundary, seed })),
    ),
  ),
)(
  `retains serial work after $stop at $boundary (seed $seed)`,
  async ({ stop, boundary, seed }) => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.string({ maxLength: 20 }),
        async (count, payload) => {
          vi.useFakeTimers()
          const executions = vi.spyOn(
            TransactionExecutor.prototype,
            `executeAll`,
          )
          const entered = gate()
          const provider = gate()
          const acknowledgment = gate()
          const acknowledging = gate()
          const transactions: Array<OfflineTransaction> = Array.from(
            { length: count },
            (_, index) => ({
              id: `stored-${index}`,
              mutationFnName: `syncData`,
              mutations: [],
              keys: [],
              idempotencyKey: `key-${index}`,
              createdAt: new Date(index),
              retryCount: 0,
              nextAttemptAt: 0,
              version: 1,
              metadata: { payload },
            }),
          )
          class Storage extends FakeStorageAdapter {
            override async delete(key: string) {
              if (boundary === `acknowledgment`) {
                acknowledging.resolve()
                await acknowledgment.promise
              }
              return super.delete(key)
            }
          }
          const storage = new Storage()
          const outbox = new OutboxManager(storage, {})
          for (const transaction of transactions) await outbox.add(transaction)
          const calls: Array<{ id: string; key: string; metadata: unknown }> =
            []
          const env = createTestOfflineEnvironment({
            storage,
            config: { jitter: false },
            mutationFn: async ({ transaction, idempotencyKey, attempt }) => {
              calls.push({
                id: transaction.id,
                key: idempotencyKey,
                metadata: transaction.metadata,
              })
              entered.resolve()
              await provider.promise
              if (
                boundary === `retry` &&
                attempt === 1 &&
                transaction.id === `stored-0`
              )
                throw new Error(`transient provider failure`)
            },
          })
          const completions = transactions.map(({ id }) => {
            const observed: { state: `pending` | `fulfilled` | `rejected` } = {
              state: `pending`,
            }
            void env.executor.waitForTransactionCompletion(id).then(
              () => {
                observed.state = `fulfilled`
              },
              () => {
                observed.state = `rejected`
              },
            )
            return observed
          })
          let replacement:
            | ReturnType<typeof createTestOfflineEnvironment>
            | undefined
          const expectedCall = ({
            id,
            idempotencyKey,
            metadata,
          }: OfflineTransaction) => ({ id, key: idempotencyKey, metadata })
          let hasPrimaryFailure = false
          try {
            await env.executor.waitForInit()
            await entered.promise
            expect(calls).toEqual(transactions.slice(0, 1).map(expectedCall))
            if (boundary !== `provider`) {
              provider.resolve()
              if (boundary === `acknowledgment`) await acknowledging.promise
              await vi.advanceTimersByTimeAsync(0)
            }
            if (stop === `loss`) env.leader.setLeader(false)
            else env.executor.dispose()
            provider.resolve()
            acknowledgment.resolve()
            const executionCount = executions.mock.calls.length
            await vi.advanceTimersByTimeAsync(2000)
            expect(executions).toHaveBeenCalledTimes(executionCount)
            env.executor.getOnlineDetector().notifyOnline()
            await vi.advanceTimersByTimeAsync(0)

            // Only the issued call may finish. Queue length, timers or final rows
            // alone cannot tell whether a former owner made extra remote requests.
            expect(calls).toEqual(transactions.slice(0, 1).map(expectedCall))
            expect(env.executor.isOfflineEnabled).toBe(false)
            expect(completions.map(({ state }) => state)).toEqual(
              transactions.map((_, index) =>
                boundary !== `retry` && index === 0 ? `fulfilled` : `pending`,
              ),
            )
            const retained =
              boundary === `retry` ? transactions : transactions.slice(1)
            expect(
              (await outbox.getAll()).map(
                ({ id, idempotencyKey, metadata }) => ({
                  id,
                  idempotencyKey,
                  metadata,
                }),
              ),
            ).toEqual(
              retained.map(({ id, idempotencyKey, metadata }) => ({
                id,
                idempotencyKey,
                metadata,
              })),
            )

            if (stop === `loss`) env.leader.setLeader(true)
            else {
              replacement = createTestOfflineEnvironment({
                storage,
                mutationFn: ({ transaction, idempotencyKey }) => {
                  calls.push({
                    id: transaction.id,
                    key: idempotencyKey,
                    metadata: transaction.metadata,
                  })
                  return Promise.resolve()
                },
              })
              await replacement.executor.waitForInit()
              // Disposed executors cannot be revived by a later elector report.
              env.leader.setLeader(true)
            }
            await vi.advanceTimersByTimeAsync(0)
            expect(calls).toEqual([
              ...transactions.slice(0, 1).map(expectedCall),
              ...retained.map(expectedCall),
            ])
            expect(await outbox.getAll()).toEqual([])
            if (stop === `loss`)
              expect(
                completions.every(({ state }) => state === `fulfilled`),
              ).toBe(true)
          } catch (error) {
            hasPrimaryFailure = true
            throw error
          } finally {
            provider.resolve()
            acknowledgment.resolve()
            executions.mockRestore()
            vi.useRealTimers()
            await cleanupOfflineOracle(
              [
                () => env.executor.dispose(),
                () => replacement?.executor.dispose(),
                () => env.collection.cleanup(),
                () => replacement?.collection.cleanup(),
              ],
              hasPrimaryFailure,
            )
          }
        },
      ),
      { seed, numRuns: 20 },
    )
  },
)

// Repeated reports and reacquisition must not readmit work already in flight.
// Use the real serializer and executor: an invalid storage key would let a
// zero-execution trace falsely satisfy an at-most-once assertion.
it.each(
  [`provider`, `acknowledgment`].flatMap((boundary) =>
    [20260912, undefined].map((seed) => ({ boundary, seed })),
  ),
)(
  `preserves replay under repeated reports and leadership regain at $boundary (seed $seed)`,
  async ({ boundary, seed }) => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          pendingReports: fc.integer({ min: 0, max: 5 }),
          settledReports: fc.integer({ min: 0, max: 5 }),
          separateTurns: fc.boolean(),
          regainLeadership: fc.boolean(),
          value: fc.string({ maxLength: 20 }),
        }),
        async ({
          pendingReports,
          settledReports,
          separateTurns,
          regainLeadership,
          value,
        }) => {
          const request = gate()
          const entered = gate()
          const release = gate()
          const acknowledging = gate()
          const acknowledgment = gate()
          class Storage extends FakeStorageAdapter {
            override async delete(key: string) {
              acknowledging.resolve()
              await acknowledgment.promise
              return super.delete(key)
            }
          }
          const storage = new Storage()
          const callbacks = new Set<(leader: boolean) => void>()
          const calls: Array<{
            id: string
            key: string
            row: Record<string, unknown>
          }> = []
          const row = {
            id: `row`,
            value,
            completed: false,
            updatedAt: new Date(1700000000123),
          }
          const env = createTestOfflineEnvironment({
            storage,
            config: {
              leaderElection: {
                requestLeadership: async () => {
                  await request.promise
                  return true
                },
                releaseLeadership: () => {},
                isLeader: () => true,
                onLeadershipChange: (callback) => {
                  callbacks.add(callback)
                  return () => {
                    callbacks.delete(callback)
                  }
                },
              },
            },
            mutationFn: async (params) => {
              const mutations = params.transaction.mutations
              calls.push({
                id: params.transaction.id,
                key: params.idempotencyKey,
                row: structuredClone(mutations[0].modified),
              })
              entered.resolve()
              await release.promise
              env.applyMutations(mutations)
            },
          })
          const completion = env.executor
            .waitForTransactionCompletion(`valid`)
            .then(
              () => `fulfilled`,
              (error: unknown) => `rejected:${String(error)}`,
            )
          const transaction = createTransaction({
            autoCommit: false,
            mutationFn: async () => {},
          })
          const rolledBack = transaction.isPersisted.promise.catch(
            () => undefined,
          )
          const expected = [{ id: `valid`, key: `once`, row }]
          const report = async (count: number) => {
            expect(callbacks.size).toBe(1)
            for (let i = 0; i < count; i++) {
              if (regainLeadership)
                for (const callback of callbacks) callback(false)
              for (const callback of callbacks) callback(true)
              if (separateTurns) await turn()
            }
            await turn()
          }
          let hasPrimaryFailure = false
          try {
            transaction.mutate(() => env.collection.insert(row))
            await new OutboxManager(storage, {
              [env.collection.id]: env.collection,
            }).add({
              id: `valid`,
              mutationFnName: env.mutationFnName,
              mutations: transaction.mutations,
              keys: transaction.mutations.map((mutation) => mutation.globalKey),
              idempotencyKey: `once`,
              createdAt: new Date(1700000000000),
              retryCount: 0,
              nextAttemptAt: 0,
              metadata: {},
              version: 1,
            })
            transaction.rollback()
            await rolledBack
            request.resolve()
            await atOracleCheckpoint(entered.promise, `replay provider entered`)
            await atOracleCheckpoint(
              env.executor.waitForInit(),
              `replay initialized`,
            )
            expect(calls).toEqual(expected)
            if (boundary === `acknowledgment`) {
              release.resolve()
              await atOracleCheckpoint(
                acknowledging.promise,
                `provider completed; durable deletion held`,
              )
            }
            await report(pendingReports)
            expect(calls).toEqual(expected)
            release.resolve()
            acknowledgment.resolve()
            expect(
              await atOracleCheckpoint(completion, `replay completed`),
            ).toBe(`fulfilled`)
            await report(settledReports)
            expect(calls).toEqual(expected)
            expect(await env.executor.peekOutbox()).toEqual([])
            expect(env.serverState.get(`row`)).toEqual(row)
            // Collection reads also expose virtual row metadata.
            expect(env.collection.get(`row`)).toMatchObject(row)
          } catch (error) {
            hasPrimaryFailure = true
            throw error
          } finally {
            request.resolve()
            release.resolve()
            acknowledgment.resolve()
            await cleanupOfflineOracle(
              [
                () => {
                  transaction.rollback()
                },
                () => rolledBack,
                () => env.executor.waitForInit(),
                () => completion,
                () => turn(),
                () => env.executor.dispose(),
                () => env.collection.cleanup(),
              ],
              hasPrimaryFailure,
            )
          }
        },
      ),
      {
        seed,
        numRuns: 40,
        examples: [
          [
            {
              pendingReports: 1,
              settledReports: 1,
              separateTurns: true,
              regainLeadership: true,
              value: `payload`,
            },
          ],
        ],
      },
    )
  },
)

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

// A replay scan can capture A, then block on another storage read until A's
// successful deletion. Pending-only dedupe no longer remembers A at admission.
// Peers admitted only through this scan must still execute exactly once.
it.each([20260919, undefined])(
  `admits only unfinished work from delayed replay reads (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          peers: fc.integer({ min: 1, max: 4 }),
          scans: fc.integer({ min: 1, max: 3 }),
          afterAcknowledgment: fc.boolean(),
          payload: fc.string({ maxLength: 12 }),
        }),
        async ({ peers, scans, afterAcknowledgment, payload }) => {
          const entered = gate()
          const provider = gate()
          const captured = gate()
          const delivery = gate()
          let hold = false
          let captures = 0
          class Storage extends FakeStorageAdapter {
            override async get(key: string) {
              const value = await super.get(key)
              if (hold && key === `tx:peer-0`) {
                if (++captures === scans) captured.resolve()
                await delivery.promise
              }
              return value
            }
          }
          const storage = new Storage()
          const outbox = new OutboxManager(storage, {})
          const transactions: Array<OfflineTransaction> = [
            `active`,
            ...Array.from({ length: peers }, (_, index) => `peer-${index}`),
          ].map((id, index) => ({
            id,
            mutationFnName: `syncData`,
            mutations: [],
            keys: [],
            idempotencyKey: `${id}/once`,
            createdAt: new Date(index),
            retryCount: 0,
            nextAttemptAt: 0,
            version: 1,
            metadata: { payload },
          }))
          await outbox.add(transactions[0]!)
          const loads = vi.spyOn(
            TransactionExecutor.prototype,
            `loadPendingTransactions`,
          )
          const executions = vi.spyOn(
            TransactionExecutor.prototype,
            `executeAll`,
          )
          const env = createTestOfflineEnvironment({
            storage,
            mutationFn: async ({ transaction }) => {
              if (transaction.id === `active`) {
                entered.resolve()
                await provider.promise
              }
            },
          })
          const outcomes = transactions.map(({ id }) =>
            env.executor.waitForTransactionCompletion(id),
          )
          // Observe rejection now, even if a preceding reach assertion fails.
          for (const outcome of outcomes) void outcome.catch(() => {})
          let hasPrimaryFailure = false
          try {
            await atOracleCheckpoint(
              env.executor.waitForInit(),
              `initial replay`,
            )
            await atOracleCheckpoint(entered.promise, `provider entered`)
            for (const transaction of transactions.slice(1))
              await outbox.add(transaction)
            hold = true
            const reads: Array<Promise<void>> = []
            for (let index = 0; index < scans; index++) {
              env.leader.setLeader(false)
              env.leader.setLeader(true)
              reads.push(loads.mock.results.at(-1)!.value)
            }
            await atOracleCheckpoint(
              captured.promise,
              `all reads captured active row`,
            )
            expect(captures).toBe(scans)
            if (afterAcknowledgment) {
              provider.resolve()
              await atOracleCheckpoint(outcomes[0]!, `active row acknowledged`)
              expect(await outbox.get(`active`)).toBeNull()
              expect(
                env.mutationCalls.map((call) => call.transaction.id),
              ).toEqual([`active`])
            }
            hold = false
            delivery.resolve()
            await atOracleCheckpoint(
              Promise.all(reads),
              `replay reads delivered`,
            )
            provider.resolve()
            await atOracleCheckpoint(
              Promise.all(outcomes),
              `all callers completed`,
            )
            await atOracleCheckpoint(
              executions.mock.results.at(-1)!.value,
              `replay drained`,
            )
            expect(
              env.mutationCalls.map(({ transaction, idempotencyKey }) => ({
                id: transaction.id,
                key: idempotencyKey,
                metadata: transaction.metadata,
              })),
            ).toEqual(
              transactions.map(({ id, idempotencyKey, metadata }) => ({
                id,
                key: idempotencyKey,
                metadata,
              })),
            )
            expect(storage.snapshot()).toEqual({})
            expect(env.executor.getPendingCount()).toBe(0)
          } catch (error) {
            hasPrimaryFailure = true
            throw error
          } finally {
            hold = false
            provider.resolve()
            delivery.resolve()
            await cleanupOfflineOracle(
              [
                () => env.executor.dispose(),
                () => env.collection.cleanup(),
                () => {
                  loads.mockRestore()
                  executions.mockRestore()
                },
              ],
              hasPrimaryFailure,
            )
          }
        },
      ),
      {
        seed,
        numRuns: 30,
        examples: [
          [
            {
              peers: 1,
              scans: 1,
              afterAcknowledgment: true,
              payload: `witness`,
            },
          ],
          [
            {
              peers: 1,
              scans: 1,
              afterAcknowledgment: false,
              payload: `control`,
            },
          ],
        ],
      },
    )
  },
)

it.each([`keys`, `get`] as const)(
  `rejects initialization when storage %s fails without losing records`,
  async (operation) => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (count) => {
        const error = new Error(`stored work unavailable`)
        class Storage extends FakeStorageAdapter {
          override async keys() {
            if (operation === `keys`) throw error
            return super.keys()
          }
          override async get(key: string) {
            if (operation === `get`) throw error
            return super.get(key)
          }
        }
        const storage = new Storage()
        const outbox = new OutboxManager(storage, {})
        for (let index = 0; index < count; index++)
          await outbox.add({
            id: `stored-${index}`,
            mutationFnName: `syncData`,
            mutations: [],
            keys: [],
            idempotencyKey: `key-${index}`,
            createdAt: new Date(index),
            retryCount: 0,
            nextAttemptAt: 0,
            version: 1,
          })
        const before = storage.snapshot()
        const env = createTestOfflineEnvironment({ storage })
        let hasPrimaryFailure = false
        try {
          await expect(
            atOracleCheckpoint(
              env.executor.waitForInit(),
              `failed storage initialization`,
            ),
          ).rejects.toBe(error)
          expect(env.mutationCalls).toEqual([])
          expect(storage.snapshot()).toEqual(before)
        } catch (failure) {
          hasPrimaryFailure = true
          throw failure
        } finally {
          await cleanupOfflineOracle(
            [() => env.executor.dispose(), () => env.collection.cleanup()],
            hasPrimaryFailure,
          )
        }
      }),
      { seed: 20260916, numRuns: 10 },
    )
  },
)

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
