import { isDeepStrictEqual } from 'node:util'
import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { OfflineExecutor } from '../src/OfflineExecutor'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { oracleRoute } from '../../db/tests/oracle-config'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  FakeStorageAdapter,
  createTestOfflineEnvironment,
  gate,
  turn,
} from './harness'
import { storedTransaction } from './leadership-replay-support'
import {
  atOracleCheckpoint,
  cleanupOfflineOracle,
  useControlledClock,
} from './oracle-lifecycle'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
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
 * Each test runs on a controlled clock (timers and `Date` virtual, macrotask
 * turns real; `useControlledClock`), so a checkpoint that a retry backoff or
 * a stuck replay would end fails at its virtual bound at once, and timers
 * that never go quiet fail under law `bounded clock`.
 *
 * Reach and controls: fixed histories force each lifecycle boundary and both
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
let releaseClock: (() => void) | undefined
beforeEach(() => {
  releaseClock = useControlledClock()
})
afterEach(() => {
  releaseClock?.()
})

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
// Grammar controls: each fixed campaign enumerates the named causal boundary, and
// the random campaign samples adjacent values with the same property/checkpoint.
// Startup count 1–4 distinguishes empty peer work from multiple retained IDs;
// the four disposal cuts distinguish construction, election, read, and hook.
// Serial count 2–5 supplies an issued call plus peers; loss/disposal and
// provider/acknowledgment/retry select different legal ownership cuts, while
// the payload checks that a surviving row is replayed unchanged. Repeated
// reports range 0–5 before and after settlement; separate turns and a false
// then true report distinguish coalescing from leadership reacquisition. The
// fixed one-report example reconstructs that overlap. Stale reads remove
// 1–5 of 2–6 stored IDs (clamped to leave a peer); the fixed 3/1 example
// reconstructs durable removal after capture. Delayed reads vary 1–4 peers,
// 1–3 scans, and removal before/after acknowledgment; both one-scan cuts are
// fixed. Storage failure varies keys/get and 1–3 retained records. Removing
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

// These are the existing relational expectations: disposed executors have no
// admitted work, stopped executors retain unissued IDs, and repeated reports
// preserve one issued mutation. Native checks compare each original cut.
const leadershipLaw = {
  authority: `OfflineExecutor leadership and disposal; TransactionExecutor serial scheduling; OutboxManager durability`,
  limits: `Controlled in-memory storage and one executor owner at a time; no exactly-once network claim across independent leaders.`,
  owner: `Offline leadership replay`,
}
function replayData(value: unknown): unknown {
  if (value instanceof Date) return { date: value.getTime() }
  if (Array.isArray(value)) return value.map(replayData)
  if (value !== null && typeof value === `object`)
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, replayData(field)]),
    )
  return value
}
function sameReplaySnapshot(actual: unknown, before: unknown): boolean {
  // Storage snapshots are plain string dictionaries; this is the existing
  // unchanged-storage relation, not an independent wire-format prediction.
  return isDeepStrictEqual(actual, before)
}
function checkLeadershipTrace(
  trace: ReadonlyArray<Observation>,
  expected: Readonly<Record<string, unknown>>,
): Verdict {
  for (const observation of trace) {
    const verdict = differs(
      observation.checkpoint,
      `leadership replay`,
      observation.value,
      expected[observation.checkpoint],
    )
    if (verdict) return verdict
  }
  return (
    differs(
      `complete leadership history`,
      `leadership replay`,
      trace.length,
      Object.keys(expected).length,
    ) ?? pass
  )
}
function storedCalls(count: number, payload: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `stored-${index}`,
    key: `key-${index}`,
    metadata: { payload },
  }))
}
declareOracle({
  owns: [
    `src/OfflineExecutor.ts#startOfflineExecutor`,
    `src/OfflineExecutor.ts#OfflineExecutor.waitForInit`,
    `src/OfflineExecutor.ts#OfflineExecutor.dispose`,
  ],
  check: [checkLeadershipTrace],
  model: [foldReplayLedger],
})

describe.each([`construction`, `leadership`, `outbox read`, `retry hook`])(
  `disposed startup at %s`,
  (boundary) => {
    oracleProperty({
      id: STARTUP_PROPERTY,
      law: {
        ...leadershipLaw,
        statement: `A disposed executor cannot revive during construction, election, replay read or retry hook; its durable rows remain unchanged.`,
      },
      histories: {
        arbitrary: fc.integer({ min: 1, max: 4 }),
        runs: 10,
        fixedSeeds: [20260918],
      },
      model: () => ({
        calls: [],
        enabled: false,
        callbacks: 0,
        pending: 0,
        leader: false,
        restorations: 0,
        'storage-preserved': true,
        ...(boundary === `construction` ? { 'leadership-requests': 0 } : {}),
      }),
      driver: async (count, observe) => {
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
          observe(
            `calls`,
            env.mutationCalls.map(({ transaction }) => transaction.id),
          )
          observe(`enabled`, env.executor.isOfflineEnabled)
          observe(`callbacks`, callbacks.size)
          observe(`pending`, env.executor.getPendingCount())
          observe(`leader`, leader)
          observe(`restorations`, restore.mock.calls.length)
          observe(
            `storage-preserved`,
            sameReplaySnapshot(storage.snapshot(), snapshot),
          )
          if (boundary === `construction`)
            observe(`leadership-requests`, requests)
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
      },
      check: (_count, trace, expected) => checkLeadershipTrace(trace, expected),
    })
  },
)

describe.each(
  [`loss`, `dispose`].flatMap((stop) =>
    [`provider`, `acknowledgment`, `retry`].map((boundary) => ({
      stop,
      boundary,
    })),
  ),
)(`serial work after $stop at $boundary`, ({ stop, boundary }) => {
  oracleProperty({
    id: SERIAL_WORK_PROPERTY,
    law: {
      ...leadershipLaw,
      statement: `Leadership loss or disposal permits only the issued call to settle; retained serial work resumes once under its next owner.`,
    },
    histories: {
      arbitrary: fc.tuple(
        fc.integer({ min: 2, max: 5 }),
        fc.string({ maxLength: 20 }),
      ),
      runs: 20,
      fixedSeeds: [20260917],
    },
    model: ([count, payload]) => {
      const calls = storedCalls(count, payload)
      const issued = calls.slice(0, 1)
      const retained = boundary === `retry` ? calls : calls.slice(1)
      return {
        'issued-0': issued,
        'execution-growth': 0,
        'issued-1': issued,
        enabled: false,
        'completion-states': calls.map((_, index) =>
          boundary !== `retry` && index === 0 ? `fulfilled` : `pending`,
        ),
        retained: retained.map(({ id, key, metadata }) => ({
          id,
          idempotencyKey: key,
          metadata,
        })),
        'resumed-calls': [...issued, ...retained],
        remaining: [],
        ...(stop === `loss` ? { 'all-completed': true } : {}),
      }
    },
    driver: async ([count, payload], observe) => {
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
      let issuedCut = 0
      let hasPrimaryFailure = false
      try {
        await env.executor.waitForInit()
        await entered.promise
        observe(
          `issued-${issuedCut++}`,
          calls.map((call) => ({
            ...call,
            metadata: structuredClone(call.metadata),
          })),
        )
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
        observe(
          `execution-growth`,
          executions.mock.calls.length - executionCount,
        )
        env.executor.getOnlineDetector().notifyOnline()
        await vi.advanceTimersByTimeAsync(0)

        // Only the issued call may finish. Queue length, timers or final rows
        // alone cannot tell whether a former owner made extra remote requests.
        observe(
          `issued-${issuedCut++}`,
          calls.map((call) => ({
            ...call,
            metadata: structuredClone(call.metadata),
          })),
        )
        observe(`enabled`, env.executor.isOfflineEnabled)
        observe(
          `completion-states`,
          completions.map(({ state }) => state),
        )
        observe(
          `retained`,
          (await outbox.getAll()).map(({ id, idempotencyKey, metadata }) => ({
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
        observe(
          `resumed-calls`,
          calls.map((call) => ({
            ...call,
            metadata: structuredClone(call.metadata),
          })),
        )
        observe(
          `remaining`,
          (await outbox.getAll()).map(({ id }) => id),
        )
        if (stop === `loss`)
          observe(
            `all-completed`,
            completions.every(({ state }) => state === `fulfilled`),
          )
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        provider.resolve()
        acknowledgment.resolve()
        executions.mockRestore()
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
    check: (_history, trace, expected) => checkLeadershipTrace(trace, expected),
  })
})

const reportArbitrary = fc.record({
  pendingReports: fc.integer({ min: 0, max: 5 }),
  settledReports: fc.integer({ min: 0, max: 5 }),
  separateTurns: fc.boolean(),
  regainLeadership: fc.boolean(),
  value: fc.string({ maxLength: 20 }),
})
describe.each([`provider`, `acknowledgment`])(
  `repeated reports at %s`,
  (boundary) => {
    oracleProperty({
      id: REPORT_PROPERTY,
      law: {
        ...leadershipLaw,
        statement: `Repeated leadership reports and reacquisition cannot replay an issued or durably removed ID twice.`,
      },
      histories: {
        arbitrary: reportArbitrary,
        runs: 40,
        fixedSeeds: [20260912],
        fixed: [
          {
            name: `one repeated report through a leadership regain`,
            history: {
              pendingReports: 1,
              settledReports: 1,
              separateTurns: true,
              regainLeadership: true,
              value: `payload`,
            },
          },
        ],
      },
      model: ({ value }) => {
        const row = {
          id: `row`,
          value,
          completed: false,
          updatedAt: { date: 1700000000123 },
        }
        const calls = [{ id: `valid`, key: `once`, row }]
        return {
          'calls-0': calls,
          'callbacks-0': 1,
          'calls-1': calls,
          completion: `fulfilled`,
          'callbacks-1': 1,
          'calls-2': calls,
          remaining: [],
          'server-row': row,
          'collection-row': row,
        }
      },
      driver: async (
        {
          pendingReports,
          settledReports,
          separateTurns,
          regainLeadership,
          value,
        },
        observe,
      ) => {
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
        const rolledBack = transaction.when('settled').catch(() => undefined)
        let reportCut = 0
        const report = async (count: number) => {
          observe(`callbacks-${reportCut++}`, callbacks.size)
          for (let i = 0; i < count; i++) {
            if (regainLeadership)
              for (const callback of callbacks) callback(false)
            for (const callback of callbacks) callback(true)
            if (separateTurns) await turn()
          }
          await turn()
        }
        let callsCut = 0
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
          observe(`calls-${callsCut++}`, replayData(calls))
          if (boundary === `acknowledgment`) {
            release.resolve()
            await atOracleCheckpoint(
              acknowledging.promise,
              `provider completed; durable deletion held`,
            )
          }
          await report(pendingReports)
          observe(`calls-${callsCut++}`, replayData(calls))
          release.resolve()
          acknowledgment.resolve()
          observe(
            `completion`,
            await atOracleCheckpoint(completion, `replay completed`),
          )
          await report(settledReports)
          observe(`calls-${callsCut++}`, replayData(calls))
          observe(
            `remaining`,
            (await env.executor.peekOutbox()).map(({ id }) => id),
          )
          observe(`server-row`, replayData(env.serverState.get(`row`)))
          // Collection reads also expose virtual row metadata.
          observe(
            `collection-row`,
            replayData(
              Object.fromEntries(
                (Object.keys(row) as Array<keyof typeof row>).map((key) => [
                  key,
                  env.collection.get(`row`)?.[key],
                ]),
              ),
            ),
          )
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
      check: (_history, trace, expected) =>
        checkLeadershipTrace(trace, expected),
    })
  },
)

oracleProperty({
  id: STALE_READ_PROPERTY,
  law: {
    ...leadershipLaw,
    statement: `A stale captured outbox read cannot re-admit IDs that were durably removed before delivery.`,
  },
  histories: {
    arbitrary: fc.record({
      count: fc.integer({ min: 2, max: 6 }),
      removedPrefix: fc.integer({ min: 1, max: 5 }),
    }),
    runs: 20,
    fixedSeeds: [20260923],
    fixed: [
      {
        name: `remove the captured first ID`,
        history: { count: 3, removedPrefix: 1 },
      },
    ],
  },
  model: ({ count, removedPrefix }) => {
    const ids = Array.from({ length: count }, (_, index) => `stored-${index}`)
    return foldReplayLedger([
      ...ids.map((id) => ({ type: `stored` as const, id })),
      { type: `read-captured` as const, ids },
      ...ids
        .slice(0, Math.min(count - 1, removedPrefix))
        .map((id) => ({ type: `durably-removed` as const, id })),
      { type: `read-delivered` as const },
    ])
  },
  driver: async ({ count, removedPrefix }, observe) => {
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
      const removed = transactions.slice(0, Math.min(count - 1, removedPrefix))
      await outbox.removeMany(removed.map(({ id }) => id))
      for (const transaction of removed) {
        ledger.push({ type: `durably-removed`, id: transaction.id })
      }
      hold = false
      delivery.resolve()
      ledger.push({ type: `read-delivered` })

      const delivered = await atOracleCheckpoint(
        reading,
        `stale replay delivered`,
      )
      observe(
        `delivered`,
        delivered.map(({ id }) => id),
      )
      observe(`captured`, foldReplayLedger(ledger).staleCapture)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hold = false
      delivery.resolve()
      await cleanupOfflineOracle([() => reading], hasPrimaryFailure)
    }
  },
  check: (_history, trace, expected) => {
    let checked = 0
    for (const observation of trace) {
      if (observation.checkpoint === `delivered`) {
        const verdict = differs(
          `delivered`,
          `durable replay ledger`,
          observation.value,
          expected.unfinished,
        )
        if (verdict) return verdict
      } else {
        try {
          expect(observation.value).not.toEqual(expected.unfinished)
        } catch (error) {
          if (!(error instanceof Error) || error.name !== `AssertionError`)
            throw error
          return {
            kind: `violation`,
            checkpoint: `captured`,
            law: `durable replay ledger`,
            difference: error.message,
            cause: error,
          }
        }
      }
      checked++
    }
    return (
      differs(`complete stale read`, `durable replay ledger`, checked, 2) ??
      pass
    )
  },
})

it(`append-only replay judgment rejects stale admission after durable removal`, () => {
  oracleRoute(`case`)
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

const delayedReadArbitrary = fc.record({
  peers: fc.integer({ min: 1, max: 4 }),
  scans: fc.integer({ min: 1, max: 3 }),
  afterAcknowledgment: fc.boolean(),
  payload: fc.string({ maxLength: 12 }),
})
oracleProperty({
  id: DELAYED_READ_PROPERTY,
  law: {
    ...leadershipLaw,
    statement: `Delayed replay scans admit every unfinished peer exactly once and never restore already acknowledged work.`,
  },
  histories: {
    arbitrary: delayedReadArbitrary,
    runs: 30,
    fixedSeeds: [20260919],
    fixed: [
      {
        name: `deliver a scan after acknowledgment`,
        history: {
          peers: 1,
          scans: 1,
          afterAcknowledgment: true,
          payload: `witness`,
        },
      },
      {
        name: `deliver a scan before acknowledgment`,
        history: {
          peers: 1,
          scans: 1,
          afterAcknowledgment: false,
          payload: `control`,
        },
      },
    ],
  },
  model: ({ peers, scans, afterAcknowledgment, payload }) => ({
    captures: scans,
    ...(afterAcknowledgment
      ? { 'active-removed': true, 'active-calls': [`active`] }
      : {}),
    calls: [
      `active`,
      ...Array.from({ length: peers }, (_, index) => `peer-${index}`),
    ].map((id) => ({ id, key: `${id}/once`, metadata: { payload } })),
    storage: {},
    pending: 0,
  }),
  driver: async ({ peers, scans, afterAcknowledgment, payload }, observe) => {
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
      observe(`captures`, captures)
      if (afterAcknowledgment) {
        provider.resolve()
        await atOracleCheckpoint(outcomes[0]!, `active row acknowledged`)
        observe(`active-removed`, (await outbox.get(`active`)) === null)
        observe(
          `active-calls`,
          env.mutationCalls.map((call) => call.transaction.id),
        )
      }
      hold = false
      delivery.resolve()
      await atOracleCheckpoint(Promise.all(reads), `replay reads delivered`)
      provider.resolve()
      await atOracleCheckpoint(Promise.all(outcomes), `all callers completed`)
      await atOracleCheckpoint(
        executions.mock.results.at(-1)!.value,
        `replay drained`,
      )
      observe(
        `calls`,
        env.mutationCalls.map(({ transaction, idempotencyKey }) => ({
          id: transaction.id,
          key: idempotencyKey,
          metadata: transaction.metadata,
        })),
      )
      observe(`storage`, storage.snapshot())
      observe(`pending`, env.executor.getPendingCount())
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
  check: (_history, trace, expected) => checkLeadershipTrace(trace, expected),
})

describe.each([`keys`, `get`])(
  `storage initialization failure in %s`,
  (operation) => {
    oracleProperty({
      id: STORAGE_FAILURE_PROPERTY,
      law: {
        ...leadershipLaw,
        statement: `An outbox read failure rejects initialization with the same error without running or losing stored work.`,
      },
      histories: {
        arbitrary: fc.integer({ min: 1, max: 3 }),
        runs: 10,
        fixedSeeds: [20260916],
      },
      model: () => ({
        'initialization-error-identity': true,
        calls: [],
        'storage-preserved': true,
      }),
      driver: async (count, observe) => {
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
          let initializationError: unknown
          try {
            await atOracleCheckpoint(
              env.executor.waitForInit(),
              `failed storage initialization`,
            )
          } catch (failure) {
            initializationError = failure
          }
          observe(
            `initialization-error-identity`,
            initializationError === error,
          )
          observe(
            `calls`,
            env.mutationCalls.map(({ transaction }) => transaction.id),
          )
          observe(
            `storage-preserved`,
            sameReplaySnapshot(storage.snapshot(), before),
          )
        } catch (failure) {
          hasPrimaryFailure = true
          throw failure
        } finally {
          await cleanupOfflineOracle(
            [() => env.executor.dispose(), () => env.collection.cleanup()],
            hasPrimaryFailure,
          )
        }
      },
      check: (_count, trace, expected) => checkLeadershipTrace(trace, expected),
    })
  },
)
