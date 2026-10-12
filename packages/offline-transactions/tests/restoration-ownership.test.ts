import {
  TransactionNotPendingMutateError,
  createCollection,
  createTransaction,
} from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import type { Transaction } from '@tanstack/db'
import type { OfflineTransaction, TransactionSignaler } from '../src/types'

/**
 * Focused witnesses for offline transactions and the Collection's tracked
 * transactions. The ownership oracle in `@tanstack/db` models
 * `createTransaction` transactions only; offline restoration and the offline
 * API reach the same tracking through their own paths. Each case states the
 * law it checks:
 *
 * - One offline transaction is one transaction: repeated `mutate()` calls
 *   add to it, so every written row stays visible and no id is reused.
 * - A restoration transaction that completes also settles `isPersisted`, as
 *   every settled transaction does.
 * - A restoration that cannot track every Collection it wrote leaves no
 *   Collection tracking it, so no restored row outlives its owner.
 */

const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for condition`)
}

const item = (id: string, value: string) => ({
  id,
  value,
  completed: false,
  updatedAt: new Date(),
})

it(`adds every mutate() call to the same offline transaction`, async () => {
  const env = createTestOfflineEnvironment({
    mutationFn: () => new Promise<void>(() => {}),
  })
  await env.waitForLeader()
  const offlineTx = env.executor.createOfflineTransaction({
    mutationFnName: env.mutationFnName,
    autoCommit: false,
  })

  const first = offlineTx.mutate(() =>
    env.collection.insert(item(`a`, `first`)),
  )
  const second = offlineTx.mutate(() =>
    env.collection.insert(item(`b`, `second`)),
  )

  expect(second).toBe(first)
  expect(first.mutations.map((mutation) => mutation.key)).toEqual([`a`, `b`])
  expect(env.collection.get(`a`)?.value).toBe(`first`)
  expect(env.collection.get(`b`)?.value).toBe(`second`)
  env.executor.dispose()
})

// With autoCommit, the first mutate() commits the transaction. A later call
// cannot add to a committed transaction, as for any Transaction, and must not
// replace it with a second transaction that has the same id.
it(`rejects a mutate() call after an auto-committed one`, async () => {
  const env = createTestOfflineEnvironment()
  await env.waitForLeader()
  const offlineTx = env.executor.createOfflineTransaction({
    mutationFnName: env.mutationFnName,
  })

  const first = offlineTx.mutate(() =>
    env.collection.insert(item(`a`, `first`)),
  )
  expect(() =>
    offlineTx.mutate(() => env.collection.insert(item(`b`, `second`))),
  ).toThrow(TransactionNotPendingMutateError)

  expect(first.mutations.map((mutation) => mutation.key)).toEqual([`a`])
  expect(env.collection.get(`a`)?.value).toBe(`first`)
  expect(env.collection.get(`b`)).toBeUndefined()
  await first.isPersisted.promise
  env.executor.dispose()
})

it(`settles a restoration transaction when its offline transaction completes`, async () => {
  const storage = new FakeStorageAdapter()
  const firstEnv = createTestOfflineEnvironment({
    storage,
    mutationFn: () => new Promise<void>(() => {}),
  })
  await firstEnv.waitForLeader()
  const offlineTx = firstEnv.executor.createOfflineTransaction({
    mutationFnName: firstEnv.mutationFnName,
    autoCommit: false,
  })
  offlineTx.mutate(() =>
    firstEnv.collection.insert(item(`restored`, `pending`)),
  )
  void offlineTx.commit().catch(() => undefined)
  await waitUntil(
    async () => (await firstEnv.executor.peekOutbox()).length === 1,
  )
  firstEnv.executor.dispose()

  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const secondEnv = createTestOfflineEnvironment({
    storage,
    mutationFn: async (params) => {
      await released
      secondEnv.applyMutations(params.transaction.mutations)
      return { ok: true }
    },
  })
  await secondEnv.waitForLeader()
  const tracked = [...secondEnv.collection._state.transactions.values()]
  expect(tracked).toHaveLength(1)
  const restorationTx = tracked[0]!

  let settled = false
  void restorationTx.isPersisted.promise.then(() => {
    settled = true
  })
  release()
  await waitUntil(
    async () => (await secondEnv.executor.peekOutbox()).length === 0,
  )
  await waitUntil(() => settled, 2000)
  expect(restorationTx.state).toBe(`completed`)
  expect(secondEnv.collection._state.transactions.size).toBe(0)
  secondEnv.executor.dispose()
})

it(`leaves no Collection tracking a restoration that could not track all of them`, () => {
  type Row = { id: string; value: string }
  const make = (id: string) =>
    createCollection<Row, string>({
      id,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
    })
  const first = make(`restore-first`)
  const second = make(`restore-second`)

  // Build the restored mutations from a real transaction, then roll it back.
  const source = createTransaction({
    autoCommit: false,
    mutationFn: async () => {},
  })
  source.mutate(() => {
    first.insert({ id: `a`, value: `restored` })
    second.insert({ id: `b`, value: `restored` })
  })
  const mutations = [...source.mutations]
  source.rollback()

  // The second Collection already tracks a live transaction with the id the
  // restoration uses, so tracking the restoration there must fail. The live
  // transaction writes the restored key, so a rollback that cascades to
  // conflicting transactions would also remove the live row.
  const id = `offline-1`
  const live = createTransaction({
    id,
    autoCommit: false,
    mutationFn: async () => {},
  })
  live.mutate(() => second.insert({ id: `b`, value: `live` }))

  const registered: Array<Transaction> = []
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => false,
    resolveTransaction: () => {},
    rejectTransaction: () => {},
    registerRestorationTransaction: (_id, transaction) => {
      registered.push(transaction)
    },
  }
  const executor = new TransactionExecutor(
    new KeyScheduler(),
    new OutboxManager(new FakeStorageAdapter(), {}),
    { collections: {}, mutationFns: {}, jitter: false },
    signaler,
  )
  const offlineTx: OfflineTransaction = {
    id,
    mutationFnName: `syncData`,
    mutations,
    keys: mutations.map((mutation) => mutation.globalKey),
    idempotencyKey: id,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
  // The live transaction already shows a transaction with this id, so the
  // skipped restoration is not a failure to report.
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  ;(
    executor as unknown as {
      restoreOptimisticState: (transactions: Array<OfflineTransaction>) => void
    }
  ).restoreOptimisticState([offlineTx])
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()

  expect([...first._state.transactions.values()]).toEqual([])
  expect(first.get(`a`)).toBeUndefined()
  expect([...second._state.transactions.values()]).toEqual([live])
  expect(live.state).toBe(`pending`)
  expect(second.get(`b`)?.value).toBe(`live`)
  live.rollback()
})
