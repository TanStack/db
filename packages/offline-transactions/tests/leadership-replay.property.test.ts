import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
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

// Repeated reports of the same leadership state must be observationally inert.
// Use the real serializer and executor: an invalid storage key would let a
// zero-execution trace falsely satisfy an at-most-once assertion.
it.each([20260912, undefined])(
  `preserves replay under redundant leadership reports (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          pendingReports: fc.integer({ min: 0, max: 5 }),
          settledReports: fc.integer({ min: 0, max: 5 }),
          separateTurns: fc.boolean(),
          value: fc.string({ maxLength: 20 }),
        }),
        async ({ pendingReports, settledReports, separateTurns, value }) => {
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
              for (const callback of callbacks) callback(true)
              if (separateTurns) await turn()
            }
            await turn()
          }
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
            await entered.promise
            await env.executor.waitForInit()
            expect(calls).toEqual(expected)
            await report(pendingReports)
            expect(calls).toEqual(expected)
            release.resolve()
            expect(await completion).toBe(`fulfilled`)
            await report(settledReports)
            expect(calls).toEqual(expected)
            expect(await env.executor.peekOutbox()).toEqual([])
            expect(env.serverState.get(`row`)).toEqual(row)
            // Collection reads also expose virtual row metadata.
            expect(env.collection.get(`row`)).toMatchObject(row)
          } finally {
            request.resolve()
            release.resolve()
            transaction.rollback()
            await rolledBack
            await env.executor.waitForInit()
            await completion
            await turn()
            env.executor.dispose()
            await env.collection.cleanup()
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
              value: `payload`,
            },
          ],
        ],
      },
    )
  },
)
