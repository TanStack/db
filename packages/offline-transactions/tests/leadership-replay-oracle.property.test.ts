import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { OfflineExecutor } from '../src/OfflineExecutor'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { declareOracle, oracleReplayTest } from '../../db/tests/oracle-config'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { gate, storedTransaction, turn } from './leadership-replay-support'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'
import { oracleLaneOptions, readOfflineOracleConfig } from './oracle-config'
import type { OfflineTransaction } from '../src/types'

/**
 * # May leadership replay an offline transaction more than once, or report
 * success for an action that never reached durable admission?
 *
 * Contract and source: OfflineExecutor leadership, TransactionExecutor serial
 * scheduling, and OutboxManager durability define this boundary. Only the
 * current leader may admit stored work. An action cannot fulfill when neither
 * its outbox record nor its provider mutation exists. Issued work may settle
 * after leadership loss, but loss or disposal fences startup, stale reads,
 * retry hooks, and new provider work. A failed outbox phase write or deletion
 * stops the current executor and leaves later rows queued. A durable row remains
 * owned until its acknowledgement or permanent rejection is durably removed.
 * An ID already pending, running, completed, permanently rejected, or durably
 * removed must not execute twice.
 *
 * Model: this file is a partial relational oracle, not a second executor. Each
 * history relates three independent projections: durable outbox IDs, scheduler
 * lifecycle, and caller settlement with optimistic rows. Expected relations
 * come from those contracts rather than production queues or classifiers.
 * `foldReplayLedger` models stored and durably removed IDs without copying
 * production revision counters, so stale captured reads cannot restore removed
 * work in the model.
 * Outbox replay means resuming unfinished durable transaction work. An offline
 * executor restart constructs a fresh executor over the retained outbox; neither
 * is a Collection sync restart or truncate replay. Seed/path replay below is
 * oracle replay of a recorded failure.
 *
 * History grammar: leadership may be acquired, lost, regained, or disposed at
 * construction, outbox read, retry hook, provider, acknowledgement, or retry
 * boundaries. Controlled storage may hold, reject, or finish individual reads,
 * writes, and deletes. Histories include concurrent scans, repeated leadership
 * reports, filtered replay snapshots, mixed deletion outcomes, and later work.
 * Action histories also hold leadership, lose it before invocation, or lose it
 * during or just after onMutate, after offline selection but before admission.
 *
 * Production driver and refinement check: the real OfflineExecutor,
 * TransactionExecutor, KeyScheduler, OutboxManager, and transaction path run
 * unchanged. Gates control causal events. Named checkpoints compare provider
 * calls and idempotency keys, outbox contents, scheduler counts, leadership,
 * retry records, caller promise settlement, optimistic rows, and cleanup.
 *
 * Reach and controls: pinned histories force each lifecycle boundary and both
 * mixed-deletion positions. Fixed and random campaigns cover legal adjacent
 * histories and support seed/path replay. Delayed-read, stale-admission, and
 * mixed-removal witnesses reject the recorded pre-fix behaviors. The action
 * admission witness exercises the selection-to-admission gap from issue #1939.
 * A wrong-result control that expected a captured stale read to return its
 * removed ID failed at `stale replay delivered`: seed 20260923, path 0:0,
 * `{ count: 2, removedPrefix: 1 }`. Direct replay reproduced the same row-ID
 * assertion; the restored comparison passed. This calibrates the stale-read
 * refinement check, not every leadership boundary.
 *
 * Limits: the fake storage adapter proves ordering and ownership, not a native
 * storage engine. Exactly-once network execution across independent leaders is
 * not promised. Provider side effects after an issued call remain provider-owned.
 */
type ReplayLedgerEvent =
  | { type: `stored`; id: string }
  | { type: `read-captured`; ids: Array<string> }
  | { type: `durably-removed`; id: string }
  | { type: `read-delivered` }

// The model records durable facts instead of copying OutboxManager's version
// fences. A stale captured value cannot undo a later durable removal. These
// fixtures use FakeStorageAdapter and therefore establish executor/outbox
// behavior, not IndexedDB, LocalStorage, or native transaction completion.
function foldReplayLedger(events: ReadonlyArray<ReplayLedgerEvent>): {
  unfinished: Array<string>
  staleCapture: Array<string>
} {
  const stored = new Set<string>()
  const removed = new Set<string>()
  let staleCapture: Array<string> = []

  for (const event of events) {
    if (event.type === `stored`) stored.add(event.id)
    else if (event.type === `durably-removed`) removed.add(event.id)
    else if (event.type === `read-captured`) staleCapture = [...event.ids]
  }

  return {
    unfinished: Array.from(stored).filter((id) => !removed.has(id)),
    staleCapture,
  }
}

// Each campaign below is its own replay property, and a path belongs to one of
// them. To replay a shrink path, set TANSTACK_DB_ORACLE_SEED,
// TANSTACK_DB_ORACLE_PATH, and TANSTACK_DB_ORACLE_PROPERTY to that campaign's
// `offline.leadership.*` property. For example, from the repository root:
// TANSTACK_DB_ORACLE_SEED=20260923 TANSTACK_DB_ORACLE_PATH=0:0 \
// TANSTACK_DB_ORACLE_PROPERTY=offline.leadership.stale-read \
// pnpm --dir packages/offline-transactions exec vitest run \
// tests/leadership-replay-oracle.property.test.ts
//
// Grammar controls: each fixed lane enumerates the named causal boundary, and
// the seedless lane samples adjacent values with the same property/checkpoint.
// Startup count 1–4 distinguishes empty peer work from multiple retained IDs;
// the four disposal cuts distinguish construction, election, read, and hook.
// Serial count 2–5 supplies an issued call plus peers; loss/disposal and
// provider/acknowledgment/retry select different legal ownership cuts, while
// the payload checks that a surviving row is replayed unchanged. Repeated
// reports range 0–5 before and after settlement; separate turns and a false
// then true report distinguish coalescing from leadership reacquisition. The
// pinned one-report example reconstructs that overlap. Stale reads remove
// 1–5 of 2–6 stored IDs (clamped to leave a peer); the pinned 3/1 example
// reconstructs durable removal after capture. Delayed reads vary 1–4 peers,
// 1–3 scans, and removal before/after acknowledgment; both one-scan cuts are
// pinned. Storage failure varies keys/get and 1–3 retained records. Removing
// any of these axes loses the stated cut, multiplicity, or preservation check.
// Delivery before capture and acknowledgment before provider completion are
// causally invalid histories, so neither is generated. Zero stored work and
// all-removed stale reads lie outside these stored-work/retained-peer claims.
const SERIAL_WORK_PROPERTY = `offline.leadership.serial-work`
const REPORT_PROPERTY = `offline.leadership.report`
const DELAYED_READ_PROPERTY = `offline.leadership.delayed-read`
const STARTUP_PROPERTY = `offline.leadership.startup`
const STALE_READ_PROPERTY = `offline.leadership.stale-read`
const STORAGE_FAILURE_PROPERTY = `offline.leadership.storage-failure`
const serialWorkOracle = readOfflineOracleConfig({
  property: SERIAL_WORK_PROPERTY,
  defaultRuns: 20,
})
const leadershipReportOracle = readOfflineOracleConfig({
  property: REPORT_PROPERTY,
  defaultRuns: 40,
})
const delayedReadOracle = readOfflineOracleConfig({
  property: DELAYED_READ_PROPERTY,
  defaultRuns: 30,
})
const startupOracle = readOfflineOracleConfig({
  property: STARTUP_PROPERTY,
  defaultRuns: 10,
})
const staleReadOracle = readOfflineOracleConfig({
  property: STALE_READ_PROPERTY,
  defaultRuns: 20,
})
const storageFailureOracle = readOfflineOracleConfig({
  property: STORAGE_FAILURE_PROPERTY,
  defaultRuns: 10,
})

// The stale-read campaign compares each delivered read with the ledger fold,
// the model. The append-only judgment pins the fold's own result.
declareOracle({ check: [checkStaleRead], model: [foldReplayLedger] })

const startupCases = (seed: number | undefined) =>
  [`construction`, `leadership`, `outbox read`, `retry hook`].map(
    (boundary) => ({
      boundary,
      seed,
    }),
  )

// The fixed lane stands aside during any path replay. The random lane runs in
// ordinary and seed-only runs, and it is the replay of STARTUP_PROPERTY.
async function checkStartup({
  boundary,
  seed,
}: ReturnType<typeof startupCases>[number]): Promise<void> {
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
    oracleLaneOptions(startupOracle, seed),
  )
}

oracleReplayTest(it).each(startupCases(20260918))(
  `does not revive a disposed executor after $boundary (seed $seed)`,
  checkStartup,
)
oracleReplayTest(it, STARTUP_PROPERTY).each(startupCases(undefined))(
  `does not revive a disposed executor after $boundary (seed $seed)`,
  checkStartup,
)

const serialWorkCases = (seed: number | undefined) =>
  [`loss`, `dispose`].flatMap((stop) =>
    [`provider`, `acknowledgment`, `retry`].map((boundary) => ({
      stop,
      boundary,
      seed,
    })),
  )

// The fixed lane stands aside during any path replay. The random lane runs in
// ordinary and seed-only runs, and it is the replay of SERIAL_WORK_PROPERTY.
async function checkSerialWork({
  stop,
  boundary,
  seed,
}: ReturnType<typeof serialWorkCases>[number]): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 5 }),
      fc.string({ maxLength: 20 }),
      async (count, payload) => {
        vi.useFakeTimers()
        const executions = vi.spyOn(TransactionExecutor.prototype, `executeAll`)
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
        const calls: Array<{ id: string; key: string; metadata: unknown }> = []
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
          ReturnType<typeof createTestOfflineEnvironment> | undefined
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
            (await outbox.getAll()).map(({ id, idempotencyKey, metadata }) => ({
              id,
              idempotencyKey,
              metadata,
            })),
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
    oracleLaneOptions(serialWorkOracle, seed),
  )
}

oracleReplayTest(it).each(serialWorkCases(20260917))(
  `retains serial work after $stop at $boundary (seed $seed)`,
  checkSerialWork,
)
oracleReplayTest(it, SERIAL_WORK_PROPERTY).each(serialWorkCases(undefined))(
  `retains serial work after $stop at $boundary (seed $seed)`,
  checkSerialWork,
)

// Repeated reports and reacquisition must not readmit work already in flight.
// Use the real serializer and executor: an invalid storage key would let a
// zero-execution trace falsely satisfy an at-most-once assertion.
const reportCases = (seed: number | undefined) =>
  [`provider`, `acknowledgment`].map((boundary) => ({ boundary, seed }))

// The fixed lane stands aside during any path replay. The random lane runs in
// ordinary and seed-only runs, and it is the replay of REPORT_PROPERTY.
async function checkReport({
  boundary,
  seed,
}: ReturnType<typeof reportCases>[number]): Promise<void> {
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
          expect(await atOracleCheckpoint(completion, `replay completed`)).toBe(
            `fulfilled`,
          )
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
      ...oracleLaneOptions(leadershipReportOracle, seed),
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
}

oracleReplayTest(it).each(reportCases(20260912))(
  `preserves replay under repeated reports and leadership regain at $boundary (seed $seed)`,
  checkReport,
)
oracleReplayTest(it, REPORT_PROPERTY).each(reportCases(undefined))(
  `preserves replay under repeated reports and leadership regain at $boundary (seed $seed)`,
  checkReport,
)

// The fixed lane stands aside during any path replay. The random lane runs in
// ordinary and seed-only runs, and it is the replay of STALE_READ_PROPERTY.
async function checkStaleRead(seed: number | undefined): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        count: fc.integer({ min: 2, max: 6 }),
        removedPrefix: fc.integer({ min: 1, max: 5 }),
      }),
      async ({ count, removedPrefix }) => {
        const captured = gate()
        const delivery = gate()
        let hold = true
        let capturedSnapshot: Array<string> = []
        class Storage extends FakeStorageAdapter {
          override async keys() {
            const keys = await super.keys()
            capturedSnapshot = [...keys]
            return keys
          }
          override async get(key: string) {
            const value = await super.get(key)
            if (hold && key === `tx:stored-0`) {
              captured.resolve()
              await delivery.promise
            }
            return value
          }
        }
        const storage = new Storage()
        const outbox = new OutboxManager(storage, {})
        const transactions = Array.from({ length: count }, (_, index) =>
          storedTransaction(`stored-${index}`),
        )
        const ledger: Array<ReplayLedgerEvent> = []
        for (const transaction of transactions) {
          await outbox.add(transaction)
          ledger.push({ type: `stored`, id: transaction.id })
        }
        const reading = outbox.getAll()
        let hasPrimaryFailure = false
        try {
          await atOracleCheckpoint(captured.promise, `stale replay captured`)
          ledger.push({
            type: `read-captured`,
            ids: capturedSnapshot.map((key) => key.slice(`tx:`.length)),
          })
          const removed = transactions.slice(
            0,
            Math.min(count - 1, removedPrefix),
          )
          await outbox.removeMany(removed.map(({ id }) => id))
          for (const transaction of removed) {
            ledger.push({ type: `durably-removed`, id: transaction.id })
          }
          hold = false
          delivery.resolve()
          ledger.push({ type: `read-delivered` })

          const expected = foldReplayLedger(ledger)
          const delivered = await atOracleCheckpoint(
            reading,
            `stale replay delivered`,
          )
          expect(delivered.map(({ id }) => id)).toEqual(expected.unfinished)
          expect(expected.staleCapture).not.toEqual(expected.unfinished)
        } catch (error) {
          hasPrimaryFailure = true
          throw error
        } finally {
          hold = false
          delivery.resolve()
          await cleanupOfflineOracle([() => reading], hasPrimaryFailure)
        }
      },
    ),
    {
      ...oracleLaneOptions(staleReadOracle, seed),
      examples: [[{ count: 3, removedPrefix: 1 }]],
    },
  )
}

oracleReplayTest(it).each([20260923])(
  `filters every durably removed transaction from a generated stale replay read (seed %s)`,
  checkStaleRead,
)
oracleReplayTest(it, STALE_READ_PROPERTY).each([undefined])(
  `filters every durably removed transaction from a generated stale replay read (seed %s)`,
  checkStaleRead,
)

it(`append-only replay judgment rejects stale admission after durable removal`, () => {
  const ledger: Array<ReplayLedgerEvent> = [
    { type: `stored`, id: `removed` },
    { type: `stored`, id: `peer` },
    { type: `read-captured`, ids: [`removed`, `peer`] },
    { type: `durably-removed`, id: `removed` },
    { type: `read-delivered` },
  ]
  const expected = foldReplayLedger(ledger)

  expect(expected.unfinished).toEqual([`peer`])
  expect(expected.staleCapture).not.toEqual(expected.unfinished)
})

// A replay scan can capture A, then block on another storage read until A's
// successful deletion. Pending-only dedupe no longer remembers A at admission.
// Peers admitted only through this scan must still execute exactly once.
// The fixed lane stands aside during any path replay. The random lane runs in
// ordinary and seed-only runs, and it is the replay of DELAYED_READ_PROPERTY.
async function checkDelayedRead(seed: number | undefined): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        peers: fc.integer({ min: 1, max: 4 }),
        scans: fc.integer({ min: 1, max: 3 }),
        afterAcknowledgment: fc.boolean(),
        payload: fc.string({ maxLength: 12 }),
      }),
      async ({ peers, scans, afterAcknowledgment, payload }) => {
        const entered = gate()
        const provider = gate()
        const captured = gate()
        const delivery = gate()
        let hold = false
        let captures = 0
        class Storage extends FakeStorageAdapter {
          override async get(key: string) {
            const value = await super.get(key)
            if (hold && key === `tx:peer-0`) {
              if (++captures === scans) captured.resolve()
              await delivery.promise
            }
            return value
          }
        }
        const storage = new Storage()
        const outbox = new OutboxManager(storage, {})
        const transactions: Array<OfflineTransaction> = [
          `active`,
          ...Array.from({ length: peers }, (_, index) => `peer-${index}`),
        ].map((id, index) => ({
          id,
          mutationFnName: `syncData`,
          mutations: [],
          keys: [],
          idempotencyKey: `${id}/once`,
          createdAt: new Date(index),
          retryCount: 0,
          nextAttemptAt: 0,
          version: 1,
          metadata: { payload },
        }))
        await outbox.add(transactions[0]!)
        const loads = vi.spyOn(
          TransactionExecutor.prototype,
          `loadPendingTransactions`,
        )
        const executions = vi.spyOn(TransactionExecutor.prototype, `executeAll`)
        const env = createTestOfflineEnvironment({
          storage,
          mutationFn: async ({ transaction }) => {
            if (transaction.id === `active`) {
              entered.resolve()
              await provider.promise
            }
          },
        })
        const outcomes = transactions.map(({ id }) =>
          env.executor.waitForTransactionCompletion(id),
        )
        // Observe rejection now, even if a preceding reach assertion fails.
        for (const outcome of outcomes) void outcome.catch(() => {})
        let hasPrimaryFailure = false
        try {
          await atOracleCheckpoint(env.executor.waitForInit(), `initial replay`)
          await atOracleCheckpoint(entered.promise, `provider entered`)
          for (const transaction of transactions.slice(1))
            await outbox.add(transaction)
          hold = true
          const reads: Array<Promise<void>> = []
          for (let index = 0; index < scans; index++) {
            env.leader.setLeader(false)
            env.leader.setLeader(true)
            reads.push(loads.mock.results.at(-1)!.value)
          }
          await atOracleCheckpoint(
            captured.promise,
            `all reads captured active row`,
          )
          expect(captures).toBe(scans)
          if (afterAcknowledgment) {
            provider.resolve()
            await atOracleCheckpoint(outcomes[0]!, `active row acknowledged`)
            expect(await outbox.get(`active`)).toBeNull()
            expect(
              env.mutationCalls.map((call) => call.transaction.id),
            ).toEqual([`active`])
          }
          hold = false
          delivery.resolve()
          await atOracleCheckpoint(Promise.all(reads), `replay reads delivered`)
          provider.resolve()
          await atOracleCheckpoint(
            Promise.all(outcomes),
            `all callers completed`,
          )
          await atOracleCheckpoint(
            executions.mock.results.at(-1)!.value,
            `replay drained`,
          )
          expect(
            env.mutationCalls.map(({ transaction, idempotencyKey }) => ({
              id: transaction.id,
              key: idempotencyKey,
              metadata: transaction.metadata,
            })),
          ).toEqual(
            transactions.map(({ id, idempotencyKey, metadata }) => ({
              id,
              key: idempotencyKey,
              metadata,
            })),
          )
          expect(storage.snapshot()).toEqual({})
          expect(env.executor.getPendingCount()).toBe(0)
        } catch (error) {
          hasPrimaryFailure = true
          throw error
        } finally {
          hold = false
          provider.resolve()
          delivery.resolve()
          await cleanupOfflineOracle(
            [
              () => env.executor.dispose(),
              () => env.collection.cleanup(),
              () => {
                loads.mockRestore()
                executions.mockRestore()
              },
            ],
            hasPrimaryFailure,
          )
        }
      },
    ),
    {
      ...oracleLaneOptions(delayedReadOracle, seed),
      examples: [
        [
          {
            peers: 1,
            scans: 1,
            afterAcknowledgment: true,
            payload: `witness`,
          },
        ],
        [
          {
            peers: 1,
            scans: 1,
            afterAcknowledgment: false,
            payload: `control`,
          },
        ],
      ],
    },
  )
}

oracleReplayTest(it).each([20260919])(
  `admits only unfinished work from delayed replay reads (seed %s)`,
  checkDelayedRead,
)
oracleReplayTest(it, DELAYED_READ_PROPERTY).each([undefined])(
  `admits only unfinished work from delayed replay reads (seed %s)`,
  checkDelayedRead,
)

const storageFailureCases = (seed: number | undefined) =>
  [`keys`, `get`].map((operation) => ({ operation, seed }))

// The fixed lane stands aside during any path replay. The random lane runs in
// ordinary and seed-only runs, and it is the replay of STORAGE_FAILURE_PROPERTY.
async function checkStorageFailure({
  operation,
  seed,
}: ReturnType<typeof storageFailureCases>[number]): Promise<void> {
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
    oracleLaneOptions(storageFailureOracle, seed),
  )
}

oracleReplayTest(it).each(storageFailureCases(20260916))(
  `rejects initialization when storage $operation fails without losing records (seed $seed)`,
  checkStorageFailure,
)
oracleReplayTest(it, STORAGE_FAILURE_PROPERTY).each(
  storageFailureCases(undefined),
)(
  `rejects initialization when storage $operation fails without losing records (seed $seed)`,
  checkStorageFailure,
)
