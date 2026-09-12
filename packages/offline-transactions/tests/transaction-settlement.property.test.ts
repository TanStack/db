import fc from 'fast-check'
import { expect, it } from 'vitest'
import { NonRetriableError } from '../src/types'
import { createTestOfflineEnvironment } from './harness'
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

it.each([20260913, undefined])(
  `settles each transaction independently while preserving FIFO (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sharedKeys: fc.boolean(),
          width: fc.integer({ min: 1, max: 3 }),
          outcomes: fc.array(fc.boolean(), { minLength: 2, maxLength: 5 }),
        }),
        async ({ sharedKeys, width, outcomes }) => {
          // The first insert succeeds; later writes may fail independently.
          const succeeds = outcomes.map((value, index) => index === 0 || value)
          const entered = succeeds.map(() => gate())
          const release = succeeds.map(() => gate())
          const statuses: Record<string, string> = {}
          const observed: Array<Promise<void>> = []
          const observe = (name: string, promise: Promise<unknown>) => {
            statuses[name] = `pending`
            observed.push(
              promise.then(
                () => {
                  statuses[name] = `fulfilled`
                },
                (error: unknown) => {
                  statuses[name] =
                    error instanceof Error ? error.message : String(error)
                },
              ),
            )
          }
          const calls: Array<{ id: string; rows: Array<TestItem> }> = []
          const expectedRows = succeeds.map((_, index) =>
            Array.from({ length: width }, (_unused, column) => ({
              id: `${sharedKeys ? 0 : index}:${column}`,
              value: `value-${index}`,
              completed: false,
              updatedAt: new Date(1700000000000 + index),
            })),
          )
          const env = createTestOfflineEnvironment({
            mutationFn: async (params) => {
              const index = calls.length
              const mutations = params.transaction
                .mutations as unknown as Array<PendingMutation<TestItem>>
              calls.push({
                id: params.transaction.id,
                rows: mutations.map((mutation) =>
                  structuredClone(mutation.modified),
                ),
              })
              if (!entered[index])
                throw new NonRetriableError(`Unexpected extra execution`)
              entered[index].resolve()
              await release[index]!.promise
              if (!succeeds[index])
                throw new NonRetriableError(`failed-${index}`)
              env.applyMutations(mutations)
            },
          })
          const ids: Array<string> = []
          const expectedServer = new Map<string, TestItem>()
          const assertState = async (completed: number) => {
            expect(calls).toEqual(
              ids
                .slice(0, Math.min(completed + 1, ids.length))
                .map((id, index) => ({ id, rows: expectedRows[index] })),
            )
            expect(statuses).toEqual(
              Object.fromEntries(
                ids.flatMap((_id, index) => {
                  const status =
                    index < completed
                      ? succeeds[index]
                        ? `fulfilled`
                        : `failed-${index}`
                      : `pending`
                  return [
                    [`commit-${index}`, status],
                    [`wait-${index}`, status],
                  ]
                }),
              ),
            )
            expect(env.serverState).toEqual(expectedServer)
            expect(
              (await env.executor.peekOutbox()).map((tx) => tx.id),
            ).toEqual(ids.slice(completed))
          }
          try {
            await env.waitForLeader()
            for (let index = 0; index < succeeds.length; index++) {
              const tx = env.executor.createOfflineTransaction({
                mutationFnName: env.mutationFnName,
                autoCommit: false,
              })
              ids.push(tx.id)
              observe(
                `wait-${index}`,
                env.executor.waitForTransactionCompletion(tx.id),
              )
              tx.mutate(() => {
                for (const row of expectedRows[index]!) {
                  if (sharedKeys && index > 0) {
                    env.collection.update(row.id, (draft) => {
                      draft.value = row.value
                      draft.updatedAt = row.updatedAt
                    })
                  } else env.collection.insert(row)
                }
              })
              observe(`commit-${index}`, tx.commit())
              if (index === 0) await entered[0]!.promise
            }
            // Drain enqueue continuations with the first real provider still held.
            await turn()
            await assertState(0)
            for (let index = 0; index < succeeds.length; index++) {
              release[index]!.resolve()
              if (index + 1 < succeeds.length) await entered[index + 1]!.promise
              else await Promise.all(observed)
              await turn()
              if (succeeds[index])
                for (const row of expectedRows[index]!)
                  expectedServer.set(row.id, row)
              await assertState(index + 1)
            }
          } finally {
            for (const item of release) item.resolve()
            await Promise.all(observed)
            env.executor.dispose()
            await env.collection.cleanup()
          }
        },
      ),
      {
        seed,
        numRuns: 40,
        examples: [
          [{ sharedKeys: true, width: 1, outcomes: [true, true] }],
          [{ sharedKeys: false, width: 2, outcomes: [true, false, true] }],
        ],
      },
    )
  },
)
