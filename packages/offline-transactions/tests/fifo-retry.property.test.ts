import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter } from './harness'
import { readOfflineOracleConfig } from './oracle-config'
import type { OfflineTransaction } from '../src/types'

/**
 * # Why does a ready transaction wait?
 *
 * The scheduler executes transactions in first-in, first-out order. A later
 * transaction must not pass the first transaction when the first transaction
 * has a retry delay.
 *
 * The scheduler must set one timer for the first transaction. It must execute
 * nothing before that timer expires. At the deadline, it must execute all
 * transactions in queue order and remove them from the outbox.
 *
 * fast-check varies the queue length and the retry delay. `expectedStateAt`
 * models time without using the scheduler, timers, or the outbox.
 */

type ExpectedState = {
  calls: Array<string>
  outboxCount: number
}

const {
  runs: replayRuns,
  seed: replaySeed,
  path: replayPath,
} = readOfflineOracleConfig({
  prefix: `OFFLINE_ORACLE`,
  defaultRuns: 30,
})

function expectedStateAt(
  elapsed: number,
  delay: number,
  transactionIds: ReadonlyArray<string>,
): ExpectedState {
  const deadlinePassed = elapsed >= delay
  return {
    calls: deadlinePassed ? [...transactionIds] : [],
    outboxCount: deadlinePassed ? 0 : transactionIds.length,
  }
}

it.each([20260916, undefined])(
  `wakes at the FIFO head deadline rather than polling ready tails (seed %s)`,
  async (fixedSeed) => {
    const seed = fixedSeed ?? replaySeed
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

          // Record each transaction when the production executor runs it.
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
              isOfflineEnabled: true,
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
          const transactionIds = transactions.map(
            (transaction) => transaction.id,
          )

          try {
            for (const transaction of transactions) {
              await outbox.add(transaction)
              scheduler.schedule(transaction)
            }
            await executor.executeAll()

            // The ready tail must wait for the delayed head. One timer must wake
            // the executor at the head deadline. The executor must not poll.
            const beforeDeadline = expectedStateAt(0, delay, transactionIds)
            expect(calls).toEqual(beforeDeadline.calls)
            expect(await outbox.count()).toBe(beforeDeadline.outboxCount)
            expect(timers).toHaveBeenCalledTimes(1)
            expect(timers.mock.calls[0]![1]).toBe(delay)

            await vi.advanceTimersByTimeAsync(delay - 1)
            const nearDeadline = expectedStateAt(
              delay - 1,
              delay,
              transactionIds,
            )
            expect(calls).toEqual(nearDeadline.calls)
            expect(await outbox.count()).toBe(nearDeadline.outboxCount)
            expect(timers).toHaveBeenCalledTimes(1)

            await vi.advanceTimersByTimeAsync(1)
            const atDeadline = expectedStateAt(delay, delay, transactionIds)
            expect(calls).toEqual(atDeadline.calls)
            expect(await outbox.count()).toBe(atDeadline.outboxCount)
          } finally {
            executor.clear()
            timers.mockRestore()
            vi.useRealTimers()
          }
        },
      ),
      {
        numRuns: replayRuns,
        ...(seed === undefined ? {} : { seed }),
        ...(fixedSeed === undefined && replayPath !== undefined
          ? { path: replayPath }
          : {}),
      },
    )
  },
)
