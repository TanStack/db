import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter } from './harness'
import type { OfflineTransaction } from '../src/types'

it(`wakes at the FIFO head deadline rather than polling ready tails`, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 5 }),
      fc.integer({ min: 2, max: 10000 }),
      async (count, delay) => {
        vi.useFakeTimers()
        const timers = vi.spyOn(globalThis, `setTimeout`)
        const scheduler = new KeyScheduler()
        const outbox = new OutboxManager(new FakeStorageAdapter(), {})
        const calls: Array<string> = []
        const executor = new TransactionExecutor(
          scheduler,
          outbox,
          {
            collections: {},
            mutationFns: {
              persist: ({ transaction }) => {
                calls.push(transaction.id)
                return Promise.resolve()
              },
            },
          },
          {
            resolveTransaction: () => {},
            rejectTransaction: () => {},
            registerRestorationTransaction: () => {},
            isOnline: () => true,
          },
        )
        const transactions: Array<OfflineTransaction> = Array.from(
          { length: count },
          (_unused, index) => ({
            id: `tx-${index}`,
            mutationFnName: `persist`,
            mutations: [],
            keys: [],
            idempotencyKey: `key-${index}`,
            createdAt: new Date(index),
            nextAttemptAt: Date.now() + (index === 0 ? delay : 0),
            retryCount: 0,
            version: 1,
          }),
        )
        try {
          for (const transaction of transactions) {
            await outbox.add(transaction)
            scheduler.schedule(transaction)
          }
          await executor.executeAll()
          expect(calls).toEqual([])
          expect(timers).toHaveBeenCalledTimes(1)
          expect(timers.mock.calls[0]![1]).toBe(delay)
          await vi.advanceTimersByTimeAsync(delay - 1)
          expect(calls).toEqual([])
          expect(timers).toHaveBeenCalledTimes(1)
          await vi.advanceTimersByTimeAsync(1)
          expect(calls).toEqual(
            transactions.map((transaction) => transaction.id),
          )
          expect(await outbox.count()).toBe(0)
        } finally {
          executor.clear()
          timers.mockRestore()
          vi.useRealTimers()
        }
      },
    ),
    { seed: 20260916, numRuns: 30 },
  )
})
