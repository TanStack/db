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
  const nativeIncludes = Array.prototype.includes
  const includes = vi
    .spyOn(Array.prototype, `includes`)
    .mockImplementation(function (this: Array<unknown>, value, fromIndex) {
      // A copied array of filtered IDs plus repeated includes() must count as
      // repeated membership work even though string equality is not observable.
      if (this.length === n / 2 && this[0] === `tx-0`) {
        arrayScanWork += this.length
      }
      return nativeIncludes.call(this, value, fromIndex)
    })
  try {
    await executor.loadPendingTransactions()
  } finally {
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
