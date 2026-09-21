import fc from 'fast-check'
import { createCollection, createTransaction } from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'
import type { TestItem } from './harness'

/**
 * # Does each offline transaction settle only from its own durable history?
 *
 * Transactions enter a global FIFO, but commit and wait promises belong to one
 * transaction ID. Success applies its server rows and fulfills both promises.
 * Permanent failure rejects those promises with the same error and rolls back
 * only its local overlay. A peer's provider, retry-record, or durable-admission
 * failure cannot settle or erase independently admitted work.
 *
 * Generated histories vary shared keys, transaction width, and success/failure
 * sequences. Gates expose each provider boundary. The driver compares exact
 * calls, IDs, promise outcomes, durable outbox state, server state, local rows,
 * pending counts, and later progress after every settlement. The simple expected
 * Maps do not copy executor or scheduler internals.
 */

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const localRows = (rows: Iterable<TestItem>) =>
  [...rows]
    .map(({ id, value, completed, updatedAt }) => ({
      id,
      value,
      completed,
      updatedAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

function expectLocalRows(
  actual: Iterable<TestItem>,
  expected: Iterable<TestItem>,
) {
  expect(localRows(actual)).toEqual(localRows(expected))
}

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
          const succeeds = outcomes
          const failures = succeeds.map(
            (_value, index) => new NonRetriableError(`failed-${index}`),
          )
          const entered = succeeds.map(() => gate())
          const release = succeeds.map(() => gate())
          const statuses: Record<string, unknown> = {}
          const observed: Array<Promise<void>> = []
          const observe = (name: string, promise: Promise<unknown>) => {
            statuses[name] = `pending`
            observed.push(
              promise.then(
                () => {
                  statuses[name] = `fulfilled`
                },
                (error: unknown) => {
                  statuses[name] = error
                },
              ),
            )
          }
          const calls: Array<{
            id: string
            rows: Array<Record<string, unknown>>
          }> = []
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
              const mutations = params.transaction.mutations
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
              if (!succeeds[index]) throw failures[index]
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
            expect(
              Object.fromEntries(
                Object.entries(statuses).map(([name, status]) => [
                  name,
                  status instanceof Error ? status.message : status,
                ]),
              ),
            ).toEqual(
              Object.fromEntries(
                ids.flatMap((_id, index) => {
                  const status =
                    index < completed
                      ? succeeds[index]
                        ? `fulfilled`
                        : failures[index]!.message
                      : `pending`
                  return [
                    [`commit-${index}`, status],
                    [`wait-${index}`, status],
                  ]
                }),
              ),
            )
            for (let index = 0; index < completed; index++) {
              if (!succeeds[index]) {
                expect(statuses[`commit-${index}`]).toBe(failures[index])
                expect(statuses[`wait-${index}`]).toBe(failures[index])
              }
            }
            expect(env.serverState).toEqual(expectedServer)
            // Queued provider work is already independently submitted. Its
            // active whole-row snapshots survive a sibling's failed insert.
            const expectedLocal = new Map(expectedServer)
            for (const rows of expectedRows.slice(completed))
              for (const row of rows) expectedLocal.set(row.id, row)
            expectLocalRows(env.collection.toArray, expectedLocal.values())
            if (completed === 1) {
              const wrong = localRows(env.collection.toArray)
              if (wrong.length > 0) wrong[0]!.completed = !wrong[0]!.completed
              else wrong.push(expectedRows[0]![0]!)
              expect(() =>
                expectLocalRows(wrong, expectedLocal.values()),
              ).toThrowError(
                expect.objectContaining({ name: `AssertionError` }),
              )
            }
            expect(
              (await env.executor.peekOutbox()).map((tx) => tx.id),
            ).toEqual(ids.slice(completed))
          }
          let hasPrimaryFailure = false
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
              if (index === 0)
                await atOracleCheckpoint(
                  entered[0]!.promise,
                  `first provider entered`,
                )
            }
            // Drain enqueue continuations with the first real provider still held.
            await turn()
            await assertState(0)
            for (let index = 0; index < succeeds.length; index++) {
              release[index]!.resolve()
              if (index + 1 < succeeds.length)
                await atOracleCheckpoint(
                  entered[index + 1]!.promise,
                  `provider ${index + 1} entered`,
                )
              else
                await atOracleCheckpoint(
                  Promise.all(observed),
                  `all transactions settled`,
                )
              await turn()
              if (succeeds[index])
                for (const row of expectedRows[index]!)
                  expectedServer.set(row.id, row)
              await assertState(index + 1)
            }
          } catch (error) {
            hasPrimaryFailure = true
            throw error
          } finally {
            for (const item of release) item.resolve()
            await cleanupOfflineOracle(
              [
                () => Promise.all(observed),
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
          [{ sharedKeys: true, width: 1, outcomes: [true, true] }],
          [{ sharedKeys: false, width: 2, outcomes: [true, false, true] }],
          [{ sharedKeys: true, width: 2, outcomes: [false, false, false] }],
          [{ sharedKeys: true, width: 1, outcomes: [false, true, false] }],
        ],
      },
    )
  },
)

it.each([
  { sharedKey: false, failedIndex: 0 },
  { sharedKey: false, failedIndex: 1 },
  { sharedKey: true, failedIndex: 0 },
  { sharedKey: true, failedIndex: 1 },
])(
  `restores whole snapshots across sibling rollback (shared=$sharedKey, failure=$failedIndex)`,
  async ({ sharedKey, failedIndex }) => {
    const rows: Array<TestItem> = [0, 1, 2].map((index) => ({
      id: sharedKey ? `same` : `row-${index}`,
      value: index === 0 ? `initial` : `edited`,
      completed: index === 2,
      updatedAt: new Date(1700000000000),
    }))
    // Seed real serialized mutations, not a second executor with ambiguous
    // in-flight-disposal semantics. No encoder output defines expected rows.
    const storage = new FakeStorageAdapter()
    const seed = createCollection<TestItem, string>({
      id: `test-items`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (ops) => {
          ops.markReady()
        },
      },
    })
    const outbox = new OutboxManager(storage, { [seed.id]: seed })
    const rollbackSeeds: Array<() => void> = []
    try {
      for (const [index, row] of rows.entries()) {
        const tx = createTransaction({
          autoCommit: false,
          mutationFn: () => Promise.resolve(),
        })
        rollbackSeeds.push(() => {
          tx.rollback({ isSecondaryRollback: true })
        })
        void tx.isPersisted.promise.catch(() => {})
        tx.mutate(() => {
          if (sharedKey && index > 0)
            seed.update(row.id, (draft) => {
              if (index === 1) draft.value = row.value
              else draft.completed = row.completed
            })
          else seed.insert(row)
        })
        await outbox.add({
          id: `restored-${index}`,
          mutationFnName: `syncData`,
          mutations: tx.mutations,
          keys: tx.mutations.map(({ globalKey }) => globalKey),
          idempotencyKey: `restore-${index}`,
          createdAt: new Date(1700000000000 + index),
          retryCount: 0,
          nextAttemptAt: 0,
          version: 1,
        })
      }
    } finally {
      for (const rollback of rollbackSeeds) rollback()
      await seed.cleanup()
    }

    const entered = rows.map(() => gate())
    const released = rows.map(() => gate())
    const failure = new NonRetriableError(`restored permanent failure`)
    const outcomes: Array<unknown> = rows.map(() => `pending`)
    const waits: Array<Promise<void>> = []
    const calls: Array<{ id: string; rows: Array<Record<string, unknown>> }> =
      []
    const env = createTestOfflineEnvironment({
      storage,
      mutationFn: async (params) => {
        const index = calls.length
        const mutations = params.transaction.mutations
        calls.push({
          id: params.transaction.id,
          rows: mutations.map((mutation) => structuredClone(mutation.modified)),
        })
        if (!entered[index]) throw new NonRetriableError(`unexpected replay`)
        entered[index].resolve()
        await released[index]!.promise
        if (index === failedIndex) throw failure
        env.applyMutations(mutations)
      },
    })
    const expectedServer = new Map<string, TestItem>()
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      for (const index of rows.keys())
        waits.push(
          env.executor.waitForTransactionCompletion(`restored-${index}`).then(
            () => {
              outcomes[index] = `fulfilled`
            },
            (error: unknown) => {
              outcomes[index] = error
            },
          ),
        )
      await atOracleCheckpoint(entered[0]!.promise, `restored provider entered`)
      expectLocalRows(env.collection.toArray, sharedKey ? [rows[2]!] : rows)
      for (const index of rows.keys()) {
        released[index]!.resolve()
        await atOracleCheckpoint(waits[index]!, `restored ${index} settled`)
        if (index < 2)
          await atOracleCheckpoint(
            entered[index + 1]!.promise,
            `restored sibling still held`,
          )
        await turn()
        if (index !== failedIndex)
          expectedServer.set(rows[index]!.id, rows[index]!)
        // Restoration holds pending snapshots. Core rollback cancels conflicting
        // pending peers, but not disjoint peers or their independently queued work.
        const pending =
          sharedKey && index >= failedIndex ? [] : rows.slice(index + 1)
        const expected = new Map(expectedServer)
        for (const row of pending) expected.set(row.id, row)
        expectLocalRows(env.collection.toArray, expected.values())
        if (index === failedIndex) {
          const wrong = localRows(env.collection.toArray)
          if (wrong.length > 0) wrong.pop()
          else wrong.push(rows[0]!)
          expect(() => expectLocalRows(wrong, expected.values())).toThrowError(
            expect.objectContaining({ name: `AssertionError` }),
          )
        }
        expect(env.serverState).toEqual(expectedServer)
        expect(calls).toEqual(
          rows
            .slice(0, Math.min(index + 2, 3))
            .map((row, call) => ({ id: `restored-${call}`, rows: [row] })),
        )
        expect(outcomes).toEqual(
          rows.map((_row, position) =>
            position > index
              ? `pending`
              : position === failedIndex
                ? failure
                : `fulfilled`,
          ),
        )
        if (index >= failedIndex) expect(outcomes[failedIndex]).toBe(failure)
        expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual(
          rows
            .slice(index + 1)
            .map((_row, offset) => `restored-${index + 1 + offset}`),
        )
      }
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      released.forEach((item) => item.resolve())
      await cleanupOfflineOracle(
        [
          () => Promise.all(waits),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

it(`keeps admitted transactions pending when a peer's retry record cannot be updated`, async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (count) => {
      const storageError = new Error(`retry record unavailable`)
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      class RetryStorage extends FakeStorageAdapter {
        failUpdate = true
        override async set(key: string, value: string): Promise<void> {
          if (this.failUpdate && JSON.parse(value).retryCount > 0) {
            this.failUpdate = false
            throw storageError
          }
          await super.set(key, value)
        }
      }
      const entered = gate()
      const release = gate()
      const calls: Array<string> = []
      const statuses: Array<unknown> = []
      const observed: Array<Promise<void>> = []
      const ids: Array<string> = []
      const env = createTestOfflineEnvironment({
        storage: new RetryStorage(),
        config: { jitter: false },
        mutationFn: async (params) => {
          calls.push(params.transaction.id)
          if (calls.length === 1) {
            entered.resolve()
            await release.promise
            throw new Error(`temporary provider failure`)
          }
          env.applyMutations(params.transaction.mutations)
        },
      })
      let hasPrimaryFailure = false
      try {
        await env.waitForLeader()
        for (let index = 0; index < count; index++) {
          const tx = env.executor.createOfflineTransaction({
            mutationFnName: env.mutationFnName,
            autoCommit: false,
          })
          ids.push(tx.id)
          tx.mutate(() =>
            env.collection.insert({
              id: `row-${index}`,
              value: `value-${index}`,
              completed: false,
              updatedAt: new Date(0),
            }),
          )
          statuses[index] = `pending`
          observed.push(
            tx.commit().then(
              () => {
                statuses[index] = `fulfilled`
              },
              (error: unknown) => {
                statuses[index] = error
              },
            ),
          )
          if (index === 0)
            await atOracleCheckpoint(
              entered.promise,
              `first retry provider entered`,
            )
        }
        await turn()
        release.resolve()
        await turn()
        expect(calls).toEqual([ids[0]])
        expect(statuses).toEqual(ids.map(() => `pending`))
        expect(warning).toHaveBeenCalledWith(
          `Failed to execute transactions:`,
          storageError,
        )
        expect((await env.executor.peekOutbox()).map((tx) => tx.id)).toEqual(
          ids,
        )
        env.executor.getOnlineDetector().notifyOnline()
        await atOracleCheckpoint(
          Promise.all(observed),
          `retry recovery settled`,
        )
        expect(calls).toEqual([ids[0], ...ids])
        expect(statuses).toEqual(ids.map(() => `fulfilled`))
        expect(await env.executor.peekOutbox()).toEqual([])
        expect([...env.serverState.keys()]).toEqual(
          ids.map((_id, index) => `row-${index}`),
        )
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        release.resolve()
        await cleanupOfflineOracle(
          [
            () => env.executor.getOnlineDetector().notifyOnline(),
            () => turn(),
            () => env.executor.dispose(),
            () => env.collection.cleanup(),
            () => {
              warning.mockRestore()
            },
          ],
          hasPrimaryFailure,
        )
      }
    }),
    { seed: 20260916, numRuns: 20 },
  )
})

it(`rejects only the transaction whose durable admission fails`, async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 2 }), async (failedIndex) => {
      const storageError = new Error(`admission unavailable`)
      class Storage extends FakeStorageAdapter {
        writes = 0
        override async set(key: string, value: string): Promise<void> {
          if (this.writes++ === failedIndex) throw storageError
          await super.set(key, value)
        }
      }
      const release = gate()
      const env = createTestOfflineEnvironment({
        storage: new Storage(),
        mutationFn: async (params) => {
          await release.promise
          env.applyMutations(params.transaction.mutations)
        },
      })
      const ids: Array<string> = []
      const statuses: Array<unknown> = []
      const observed: Array<Promise<void>> = []
      let hasPrimaryFailure = false
      try {
        await env.waitForLeader()
        for (let index = 0; index < 3; index++) {
          const tx = env.executor.createOfflineTransaction({
            mutationFnName: env.mutationFnName,
            autoCommit: false,
          })
          ids.push(tx.id)
          tx.mutate(() =>
            env.collection.insert({
              id: `row-${index}`,
              value: `value-${index}`,
              completed: false,
              updatedAt: new Date(0),
            }),
          )
          statuses[index] = `pending`
          observed.push(
            tx.commit().then(
              () => {
                statuses[index] = `fulfilled`
              },
              (error: unknown) => {
                statuses[index] = error
              },
            ),
          )
          await turn()
        }
        expect(statuses[failedIndex]).toBe(storageError)
        expect((await env.executor.peekOutbox()).map((tx) => tx.id)).toEqual(
          ids.filter((_id, index) => index !== failedIndex),
        )
        release.resolve()
        await atOracleCheckpoint(
          Promise.all(observed),
          `admitted peers settled`,
        )
        expect(env.mutationCalls.map((call) => call.transaction.id)).toEqual(
          ids.filter((_id, index) => index !== failedIndex),
        )
        for (let index = 0; index < 3; index++) {
          expect(statuses[index]).toBe(
            index === failedIndex ? storageError : `fulfilled`,
          )
          expect(env.collection.has(`row-${index}`)).toBe(index !== failedIndex)
        }
        expect(await env.executor.peekOutbox()).toEqual([])
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        release.resolve()
        await cleanupOfflineOracle(
          [
            () => turn(),
            () => env.executor.dispose(),
            () => env.collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    }),
    { seed: 20260916, numRuns: 10 },
  )
})
