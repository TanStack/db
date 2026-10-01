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
 * The executor must execute nothing before the head is eligible. Under the
 * controlled virtual clock, advancing to that deadline must execute all
 * transactions in queue order and remove them from the outbox.
 *
 * The package README's FIFO sequential-processing and automatic-retry
 * contracts supply the order and eventual-retry laws. The established
 * `KeyScheduler.property.test.ts` supplies the `nextAttemptAt` eligibility
 * boundary.
 * Advancing fake timers to that boundary is a bounded executor liveness check,
 * not a user-facing wall-clock latency guarantee. Timer count and polling
 * strategy are implementation details outside this oracle's judgment.
 * This oracle covers an online executor with successful mutation functions,
 * one delayed head, and ready tails. It does not judge failed mutation
 * functions, leadership changes, or real browser timer scheduling.
 *
 * Input grammar: 2–5 distinct transactions have increasing `createdAt`; only
 * the head has a future `nextAttemptAt` (2–10,000 ms). A count of 2 is the
 * smallest head/tail witness; larger counts challenge complete tail draining.
 * The delay axis moves the boundary while preserving the order law. Every
 * generated pair reconstructs the delayed-head/ready-tail history. Removing
 * either the tail or delay loses that history. A tail before the head by
 * `createdAt`, duplicate IDs, or a ready head is outside this grammar; each
 * changes the premise. The checkpoints at delay−1 and delay distinguish early
 * and late wakeups, including the 2 ms marginal delay.
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

const campaignSeeds =
  replayPath === undefined ? [20260916, undefined] : [undefined]

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

function expectState(actual: ExpectedState, expected: ExpectedState): void {
  expect(actual.calls).toEqual(expected.calls)
  expect(actual.outboxCount).toBe(expected.outboxCount)
}

it.each(campaignSeeds)(
  `waits for the FIFO head and executes eligible work at its deadline (seed %s)`,
  async (fixedSeed) => {
    const seed = fixedSeed ?? replaySeed
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 2, max: 10000 }),
        async (count, delay) => {
          let clearExecutor: (() => void) | undefined
          let primaryFailure: unknown
          let failed = false
          try {
            vi.useFakeTimers()
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
            clearExecutor = () => executor.clear()
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

            for (const transaction of transactions) {
              await outbox.add(transaction)
              scheduler.schedule(transaction)
            }
            await executor.executeAll()

            // A ready tail waits for the delayed head. The virtual-clock cuts
            // distinguish early execution from failure to wake when eligible.
            const beforeDeadline = expectedStateAt(0, delay, transactionIds)
            const observedBeforeDeadline = {
              calls: [...calls],
              outboxCount: await outbox.count(),
            }
            expectState(observedBeforeDeadline, beforeDeadline)
            // A scheduler that lets a ready tail bypass the delayed head
            // reaches this checkpoint with an extra call. Calibrate the same
            // comparison against that plausible wrong observation.
            expect(() =>
              expectState(
                { ...observedBeforeDeadline, calls: [transactionIds[1]!] },
                beforeDeadline,
              ),
            ).toThrow()
            await vi.advanceTimersByTimeAsync(delay - 1)
            const nearDeadline = expectedStateAt(
              delay - 1,
              delay,
              transactionIds,
            )
            expectState(
              { calls: [...calls], outboxCount: await outbox.count() },
              nearDeadline,
            )
            await vi.advanceTimersByTimeAsync(1)
            const atDeadline = expectedStateAt(delay, delay, transactionIds)
            const observedAtDeadline = {
              calls: [...calls],
              outboxCount: await outbox.count(),
            }
            expectState(observedAtDeadline, atDeadline)
            // A scheduler that never wakes at eligibility leaves the whole
            // queue untouched at this controlled-clock checkpoint.
            expect(() =>
              expectState(
                { calls: [], outboxCount: transactionIds.length },
                atDeadline,
              ),
            ).toThrow()
          } catch (error) {
            primaryFailure = error
            failed = true
          }

          const cleanupFailures: Array<Error> = []
          const cleanups: Array<[string, (() => void) | undefined]> = [
            [`executor.clear`, clearExecutor],
            [`real timer restore`, () => vi.useRealTimers()],
          ]
          for (const [name, cleanup] of cleanups) {
            if (!cleanup) continue
            try {
              cleanup()
            } catch (error) {
              cleanupFailures.push(
                new Error(`${name} failed`, { cause: error }),
              )
            }
          }
          if (cleanupFailures.length > 0) {
            throw new AggregateError(
              cleanupFailures,
              `FIFO retry oracle cleanup failed`,
              { cause: failed ? primaryFailure : undefined },
            )
          }
          if (failed) throw primaryFailure
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
