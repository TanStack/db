import { expect, it, vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter } from './harness'
import type { OfflineTransaction } from '../src/types'

it(`retains replay records with membership work proportional to the snapshot`, async () => {
  const n = 100
  const outbox = new OutboxManager(new FakeStorageAdapter(), {})
  for (let index = 0; index < n; index++) {
    const id = `tx-${index}`
    const transaction: OfflineTransaction = {
      id,
      mutationFnName: 'syncData',
      mutations: [],
      keys: [],
      idempotencyKey: id,
      createdAt: new Date(index),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    }
    await outbox.add(transaction)
  }
  let filteredIdReads = 0
  let sourceIdReads = 0
  let arrayScanWork = 0
  const scheduler = new KeyScheduler()
  // Isolate replay membership work from the scheduler's separate admission
  // search. Replay still runs through the real outbox and executor path.
  vi.spyOn(scheduler, 'schedule').mockReturnValue(false)
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {},
      jitter: false,
      beforeRetry: (transactions) => {
        for (const transaction of transactions) {
          const { id } = transaction
          Object.defineProperty(transaction, `id`, {
            get: () => {
              sourceIdReads++
              return id
            },
          })
        }
        return transactions
          .filter((_, index) => index % 2 === 0)
          .map((transaction) => {
            const copy = { ...transaction }
            Object.defineProperty(copy, 'id', {
              get: () => {
                filteredIdReads++
                return transaction.id
              },
            })
            return copy
          })
      },
    },
    {
      isOfflineEnabled: true,
      isOnline: () => false,
      resolveTransaction: () => {},
      rejectTransaction: () => {},
      registerRestorationTransaction: () => {},
    },
  )
  const isRetainedIdArray = (values: Array<unknown>) =>
    values.length === n / 2 && values[0] === `tx-0`
  const nativeIncludes = Array.prototype.includes
  const includes = vi
    .spyOn(Array.prototype, `includes`)
    .mockImplementation(function (this: Array<unknown>, value, fromIndex) {
      // Repeated scans of copied IDs are work even when equality reads no getter.
      if (isRetainedIdArray(this)) arrayScanWork += this.length
      return nativeIncludes.call(this, value, fromIndex)
    })
  const nativeSome = Array.prototype.some
  const some = vi.spyOn(Array.prototype, `some`).mockImplementation(function (
    this: Array<unknown>,
    predicate,
    thisArg,
  ) {
    if (isRetainedIdArray(this)) arrayScanWork += this.length
    return nativeSome.call(this, predicate, thisArg)
  })
  try {
    await executor.loadPendingTransactions()
  } finally {
    some.mockRestore()
    includes.mockRestore()
  }
  const ids = (await outbox.getAll()).map(({ id }) => id)
  expect(sourceIdReads + filteredIdReads + arrayScanWork).toBeLessThanOrEqual(
    n * 4,
  )
  expect(ids).toEqual(
    Array.from({ length: n / 2 }, (_, index) => `tx-${index * 2}`),
  )
})
