import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'
import type { TestItem } from './harness'
import type { PendingMutation } from '@tanstack/db'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Repeated reports and reacquisition must not readmit work already in flight.
// Use the real serializer and executor: an invalid storage key would let a
// zero-execution trace falsely satisfy an at-most-once assertion.
it.each([20260912, undefined])(
  `preserves replay under repeated reports and leadership regain (seed %s)`,
  async (seed) => {
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
          const storage = new FakeStorageAdapter()
          const callbacks = new Set<(leader: boolean) => void>()
          const calls: Array<{ id: string; key: string; row: TestItem }> = []
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
              const mutations = params.transaction
                .mutations as unknown as Array<PendingMutation<TestItem>>
              calls.push({
                id: params.transaction.id,
                key: params.idempotencyKey,
                row: structuredClone(mutations[0]!.modified),
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
            await report(pendingReports)
            expect(calls).toEqual(expected)
            release.resolve()
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
