import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { OfflineExecutor } from '../src/OfflineExecutor'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'
import type { OfflineTransaction } from '../src/types'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
