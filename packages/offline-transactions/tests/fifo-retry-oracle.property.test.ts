import fc from 'fast-check'
import { vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { NonRetriableError } from '../src/types'
import {
  differs,
  oracleProperty,
  pass,
  useOracleClock,
  violation,
} from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { FakeStorageAdapter } from './harness'
import type { Observation } from '../../db/tests/oracle-property'
import type { OfflineTransaction } from '../src/types'

// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.
declareOracle({
  owns: [
    `src/executor/TransactionExecutor.ts#TransactionExecutor.executeAll`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.clear`,
  ],
})

/**
 * # Why does a ready transaction wait, and what stops the queue?
 *
 * Contract (the package README: "FIFO Sequential Processing", "Retry
 * decisions", and the offline-execution settlement section):
 * - The executor runs one transaction at a time, in creation order. A later
 *   transaction does not pass an earlier one that has a retry delay, and a
 *   retried transaction keeps its FIFO position.
 * - Eligible work runs when it becomes eligible: at the head's deadline the
 *   executor runs the head and every ready transaction behind it, in order,
 *   until a retriable failure or a storage fault. This is a bounded liveness
 *   check on a controlled clock, not a wall-clock latency promise; while work
 *   is pending, timer count and polling strategy are outside the judgment.
 *   The `nextAttemptAt`
 *   eligibility boundary itself is the KeyScheduler oracle's
 *   (`KeyScheduler-oracle.property.test.ts`).
 * - A retriable provider failure retries the same transaction after its
 *   backoff; nothing behind it runs first.
 * - A `NonRetriableError` removes its row and rejects its caller with that
 *   error; queued rows then continue in creation order.
 * - An idle executor goes quiet: once every plan has played out, so that no
 *   transaction is due or waiting to retry, it holds no timer. An executor
 *   that keeps waking with nothing to do spins the CPU for as long as the app
 *   runs (maintainer decision, 2026-11-06: an idle spin is a bad bug).
 * - Success means the provider returned and the storage adapter acknowledged
 *   the outbox deletion. If recording the `deletion-pending` phase or
 *   removing the row fails, the caller rejects with the storage error and
 *   the executor stops: it processes no queued peer.
 *
 * Fault injection: each transaction's attempt plan is part of the history.
 * The provider fails a planned number of times with a retriable error, then
 * succeeds or fails permanently; a successful transaction may also have a
 * planned storage fault on its phase write or its deletion. The faults are
 * data, so a history replays exactly.
 *
 * History grammar: two to five transactions with increasing `createdAt`; only
 * the head has a future `nextAttemptAt` (2 to 10,000 ms), and the tail is
 * ready. Two is the smallest head-and-tail witness; larger counts test that
 * the whole tail drains, and removing either the tail or the delay loses the
 * delayed-head history. The delay axis moves the head's eligibility boundary;
 * the checkpoints at delay-1 and delay distinguish early and late wakeups,
 * including the 2 ms marginal delay. A tail created before the head,
 * duplicate IDs, and a ready head are outside the grammar: each changes the
 * premise.
 *
 * Model: the attempt order and outcomes follow from the plans alone, without
 * the scheduler, timers, or the outbox. At the deadline, attempts run until
 * the first retriable failure (whose backoff is at least a second) or a
 * storage fault; after every timer has run, every plan has played out up to
 * the first storage fault, and the executor holds no timer.
 *
 * Driver: a real `TransactionExecutor`, `KeyScheduler`, and `OutboxManager`
 * over fake storage that fails as planned, with a controlled virtual clock
 * and jitter off. It records provider calls, the outbox, and each caller's
 * settlement at each checkpoint, and after the last one the number of timers
 * the executor still holds. It runs the retry timers one at a time, at most
 * `TIMER_STEPS` of them, so an executor that never goes quiet cannot keep
 * the driver busy forever; the idle law then judges the timers it left.
 *
 * Reach comes from what production did, never from the grammar's labels. The
 * four states that the model can predict from the plans are state probes
 * (glossary: state probe): production marks each one where its branch runs,
 * `predict` says from the plans alone whether a history enters it, and reach
 * agreement checks the two in every history. They are `retry before a queued
 * peer` (a retriable failure while a transaction waits behind it),
 * `permanent failure before a peer` (a non-retriable failure with a row
 * behind it), `phase write fault` (the deletion-pending marker write fails),
 * and `fault before a queued peer` (a storage fault stops the executor with a
 * row behind it). `deletion fault` is reported by the storage fake when it
 * rejects the removal that the executor issued: production reached the
 * removal and the storage refused it. `retried head` and `retried tail` are
 * measured only: the driver reports each provider call that fails retriably,
 * and `queue drained` when the outbox ends empty, the history where an idle
 * executor has nothing left at all.
 *
 * Limits: an online executor with one mutation function; no leadership
 * changes, no `shouldRetry` or `beforeRetry` hooks, no storage fault on a
 * permanent failure's removal, and no real browser timers. Backoff lengths
 * are not judged, only that a retry waits past the deadline cut.
 */

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

type Plan = {
  /** Retriable provider failures before the final attempt. */
  failures: number
  final: `success` | `permanent`
  /** A storage fault after a successful provider call. */
  storageFault: `none` | `phase` | `delete`
}
type History = { delay: number; plans: Array<Plan> }

const plan: fc.Arbitrary<Plan> = fc.oneof(
  // Most transactions succeed at once, so a queue often drains past a fault.
  {
    weight: 3,
    arbitrary: fc.record({
      failures: fc.constant(0),
      final: fc.constant(`success` as const),
      storageFault: fc.constant(`none` as const),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      failures: fc.integer({ min: 0, max: 2 }),
      final: fc.constantFrom(`success` as const, `permanent` as const),
      storageFault: fc.constant(`none` as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      failures: fc.integer({ min: 0, max: 1 }),
      final: fc.constant(`success` as const),
      storageFault: fc.constantFrom(`phase` as const, `delete` as const),
    }),
  },
)
const fifoHistory: fc.Arbitrary<History> = fc.record({
  delay: fc.integer({ min: 2, max: 10000 }),
  plans: fc.array(plan, { minLength: 2, maxLength: 5 }),
})

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Settlement = {
  id: string
  outcome: `fulfilled` | `rejected`
  message?: string
}
type State = {
  calls: Array<string>
  outbox: Array<string>
  settled: Array<Settlement>
}
const idOf = (index: number) => `tx-${index}`
const retriable = (index: number, attempt: number) =>
  `retriable failure ${idOf(index)} attempt ${attempt}`
const permanent = (index: number) => `permanent failure ${idOf(index)}`
const storageFailure = (index: number) => `storage failed for ${idOf(index)}`

/**
 * What the public observations show after the plans have run, either only
 * up to the first retriable failure (`untilRetry`, the deadline cut) or to
 * the end.
 */
function playOut({ plans }: History, untilRetry: boolean): State {
  const calls: Array<string> = []
  const settled: Array<Settlement> = []
  const remaining = new Set(plans.map((_, index) => idOf(index)))
  for (const [index, { failures, final, storageFault }] of plans.entries()) {
    const id = idOf(index)
    if (untilRetry && failures > 0) {
      calls.push(id)
      break
    }
    for (let attempt = 0; attempt <= failures; attempt++) calls.push(id)
    if (final === `permanent`) {
      remaining.delete(id)
      settled.push({ id, outcome: `rejected`, message: permanent(index) })
      continue
    }
    if (storageFault !== `none`) {
      // The row stays, and the executor stops before any queued peer.
      settled.push({ id, outcome: `rejected`, message: storageFailure(index) })
      break
    }
    remaining.delete(id)
    settled.push({ id, outcome: `fulfilled` })
  }
  return { calls, outbox: [...remaining], settled }
}

/** Timers an executor with nothing left to run may hold: none (idle law). */
const idleTimers = 0

function fifoModel(history: History) {
  const queued: State = {
    calls: [],
    outbox: history.plans.map((_, index) => idOf(index)),
    settled: [],
  }
  return new Map<string, State>([
    [`before deadline`, queued],
    [`just before deadline`, queued],
    [`at deadline`, playOut(history, true)],
    [`after every retry`, playOut(history, false)],
  ])
}

// States. A probe-bound state is predicted by `predictedStates` and marked by
// a production probe; the other two are reported by the driver.
const retryBeforePeer = `retry before a queued peer`
const permanentBeforePeer = `permanent failure before a peer`
const phaseWriteFault = `phase write fault`
const faultBeforePeer = `fault before a queued peer`
const deletionFault = `deletion fault`
const measuredStates = [`retried head`, `retried tail`, `queue drained`] as const

/**
 * Which probe-bound states a history enters, from its plans alone. The
 * executor plays the plans in order and stops at the first storage fault
 * (`stop`), so only the plans up to it run. A plan at `index` has a queued
 * peer when `index < last`: the rows behind it are still waiting.
 */
function predictedStates({ plans }: History): Record<string, boolean> {
  const last = plans.length - 1
  const stop = plans.findIndex(
    (entry) => entry.final === `success` && entry.storageFault !== `none`,
  )
  const played = stop < 0 ? plans : plans.slice(0, stop + 1)
  return {
    [retryBeforePeer]: played.some(
      (entry, index) => entry.failures > 0 && index < last,
    ),
    [permanentBeforePeer]: played.some(
      (entry, index) => entry.final === `permanent` && index < last,
    ),
    [phaseWriteFault]: stop >= 0 && plans[stop]!.storageFault === `phase`,
    [faultBeforePeer]: stop >= 0 && stop < last,
  }
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

// Timers the driver runs after the deadline. A history's retries need a few
// dozen; an executor that keeps arming timers is cut off here (in a few
// milliseconds of virtual time) and judged by the idle law. Raise it if a
// legal history needs more.
const TIMER_STEPS = 1000

async function driveFifo(
  { delay, plans }: History,
  observe: (checkpoint: string, value: unknown) => void,
) {
  let executor: TransactionExecutor | undefined
  let warn: { mockRestore: () => void } | undefined
  let primary: unknown
  let failed = false
  let clock: { release: () => void } | undefined
  try {
    // The framework's controlled clock: a history whose timers never go
    // quiet fails under law `bounded clock`.
    clock = useOracleClock()
    // A storage fault stops the executor, which logs the failed retry batch.
    warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    // Fails the planned phase write or deletion for one transaction.
    const storage = new (class extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        const index = plans.findIndex((_, i) => key.endsWith(idOf(i)))
        if (
          index >= 0 &&
          plans[index]!.storageFault === `phase` &&
          value.includes(`"deletion-pending"`)
        )
          throw new Error(storageFailure(index))
        return super.set(key, value)
      }
      override async delete(key: string): Promise<void> {
        const index = plans.findIndex((_, i) => key.endsWith(idOf(i)))
        if (index >= 0 && plans[index]!.storageFault === `delete`) {
          observe(`reach`, deletionFault)
          throw new Error(storageFailure(index))
        }
        return super.delete(key)
      }
    })()
    const outbox = new OutboxManager(storage, {})
    const scheduler = new KeyScheduler()
    const calls: Array<string> = []
    const attempts = new Map<string, number>()
    const settled: Array<Settlement> = []
    executor = new TransactionExecutor(
      scheduler,
      outbox,
      {
        collections: {},
        jitter: false,
        mutationFns: {
          persist: ({ transaction }) => {
            const id = transaction.id
            calls.push(id)
            const attempt = attempts.get(id) ?? 0
            attempts.set(id, attempt + 1)
            const index = Number(id.slice(3))
            const { failures, final } = plans[index]!
            // An attempt the plan does not have never settles, so a runaway
            // executor stops at its first extra call, which the trace shows.
            if (attempt > failures) return new Promise<void>(() => {})
            if (attempt < failures) {
              observe(`reach`, index === 0 ? `retried head` : `retried tail`)
              return Promise.reject(new Error(retriable(index, attempt)))
            }
            if (final === `permanent`)
              return Promise.reject(new NonRetriableError(permanent(index)))
            return Promise.resolve()
          },
        },
      },
      {
        isOfflineEnabled: true,
        resolveTransaction: (id) => settled.push({ id, outcome: `fulfilled` }),
        rejectTransaction: (id, error) =>
          settled.push({ id, outcome: `rejected`, message: error.message }),
        registerRestorationTransaction: () => {},
        isOnline: () => true,
      },
    )
    const record = async (checkpoint: string) =>
      observe(checkpoint, {
        calls: [...calls],
        outbox: (await outbox.getAll()).map((entry) => entry.id),
        settled: [...settled],
      } satisfies State)

    for (const [index] of plans.entries()) {
      const transaction: OfflineTransaction = {
        id: idOf(index),
        mutationFnName: `persist`,
        mutations: [],
        keys: [],
        idempotencyKey: `key-${index}`,
        createdAt: new Date(index),
        nextAttemptAt: Date.now() + (index === 0 ? delay : 0),
        retryCount: 0,
        version: 1,
      }
      await outbox.add(transaction)
      scheduler.schedule(transaction)
    }
    await executor.executeAll()
    await record(`before deadline`)
    await vi.advanceTimersByTimeAsync(delay - 1)
    await record(`just before deadline`)
    await vi.advanceTimersByTimeAsync(1)
    await record(`at deadline`)
    // Backoff doubles from a second to a minute; run every retry timer, one
    // at a time, up to the step budget.
    for (let step = 0; step < TIMER_STEPS && vi.getTimerCount() > 0; step++)
      await vi.advanceTimersToNextTimerAsync()
    await record(`after every retry`)
    if ((await outbox.getAll()).length === 0) observe(`reach`, `queue drained`)
    observe(`idle`, vi.getTimerCount())
  } catch (error) {
    primary = error
    failed = true
  }
  // Each release runs even when another fails; a cleanup failure keeps the
  // driver's own error as its cause.
  const failures: Array<unknown> = []
  for (const release of [
    () => executor?.clear(),
    () => warn?.mockRestore(),
    () => clock?.release(),
  ])
    try {
      release()
    } catch (error) {
      failures.push(error)
    }
  if (failures.length > 0)
    throw new AggregateError(failures, `FIFO retry driver cleanup failed`, {
      cause: failed ? primary : undefined,
    })
  if (failed) throw primary
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
//
// At each checkpoint the provider calls, the outbox, and the settlements
// equal the model's. Calls that are not a prefix of the full attempt order
// break the FIFO law; a correct prefix of the wrong length at a cut breaks
// the progress law (a late wakeup, or a queue that stalls); settlements and the outbox after a fault are the stop law.
// After every retry, a timer the executor still holds breaks the idle law.

function checkFifo(
  _history: History,
  trace: ReadonlyArray<Observation>,
  owed: ReturnType<typeof fifoModel>,
) {
  const order = owed.get(`after every retry`)!.calls
  for (const [checkpoint, expected] of owed) {
    const seen = trace.find((entry) => entry.checkpoint === checkpoint)
      ?.value as State | undefined
    if (!seen)
      return violation(
        checkpoint,
        `the driver recorded no "${checkpoint}"`,
        `trace`,
      )
    // Calls in the full attempt order, but too few or too many for this cut,
    // break progress; any other difference breaks FIFO order.
    const callLaw = seen.calls.every((id, index) => id === order[index])
      ? `progress`
      : `fifo`
    const wrong =
      differs(
        checkpoint,
        callLaw,
        seen.calls,
        expected.calls,
        `provider calls differ from creation order and the attempt plans`,
      ) ??
      differs(
        checkpoint,
        `settlement`,
        seen.settled,
        expected.settled,
        `caller settlements differ from the plans`,
      ) ??
      differs(
        checkpoint,
        `stop`,
        seen.outbox,
        expected.outbox,
        `the outbox differs from the plans`,
      )
    if (wrong) return wrong
  }
  return (
    differs(
      `idle`,
      `idle`,
      trace.find((entry) => entry.checkpoint === `idle`)?.value,
      idleTimers,
      `the executor still holds timers with nothing left to run`,
    ) ?? pass
  )
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

const ok: Plan = { failures: 0, final: `success`, storageFault: `none` }

oracleProperty({
  id: `offline.fifo-retry`,
  law: {
    statement: `The executor runs transactions one at a time in creation order: a ready tail waits for a delayed or retrying head, eligible work runs when its deadline passes, a permanent failure lets queued rows continue, a failed phase write or deletion rejects its caller with the storage error and stops the queue, and an executor with nothing left to run holds no timer.`,
    authority: `packages/offline-transactions/README.md: FIFO Sequential Processing, Retry decisions, and offline-execution settlement; the eligibility boundary from KeyScheduler-oracle.property.test.ts; the idle law is the maintainer's decision of 2026-11-06 (an idle spin is a bad bug)`,
    limits: `An online executor with one mutation function, no retry hooks, and jitter off; no leadership changes; no storage fault on a permanent failure's removal; backoff lengths are not judged, and timer counts and polling strategy only once nothing is left to run; at most 1000 retry timers after the deadline; liveness on a controlled clock, not wall-clock latency.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: fifoHistory,
    states: [
      {
        name: retryBeforePeer,
        probe: `offline-transactions#retry-before-peer`,
      },
      {
        name: permanentBeforePeer,
        probe: `offline-transactions#permanent-failure-before-peer`,
      },
      {
        name: phaseWriteFault,
        probe: `offline-transactions#phase-write-fault`,
      },
      {
        name: faultBeforePeer,
        probe: `offline-transactions#fault-before-peer`,
      },
      deletionFault,
    ],
    measured: measuredStates,
    runs: 60,
    fixedSeeds: [20260916],
    // Each required state gets a history with a queued peer behind the event:
    // the laws need a peer that waits, runs, or stays in the outbox.
    constructed: [
      {
        name: `a phase write fault before a queued peer`,
        enters: [phaseWriteFault, faultBeforePeer],
        build: (generated: History): History => ({
          delay: generated.delay,
          plans: [
            { ...ok },
            { failures: 0, final: `success`, storageFault: `phase` },
            ...generated.plans.slice(0, 3),
          ],
        }),
      },
      {
        name: `a deletion fault before a queued peer`,
        enters: [deletionFault, faultBeforePeer],
        build: (generated: History): History => ({
          delay: generated.delay,
          plans: [
            { ...ok },
            { failures: 0, final: `success`, storageFault: `delete` },
            ...generated.plans.slice(0, 3),
          ],
        }),
      },
      {
        name: `a retry before a queued peer`,
        enters: [retryBeforePeer],
        build: (generated: History): History => ({
          delay: generated.delay,
          plans: [
            { failures: 1, final: `success`, storageFault: `none` },
            { ...ok },
            ...generated.plans.slice(0, 3),
          ],
        }),
      },
      {
        name: `a permanent failure before a queued peer`,
        enters: [permanentBeforePeer],
        build: (generated: History): History => ({
          delay: generated.delay,
          plans: [
            { ...ok },
            { failures: 0, final: `permanent`, storageFault: `none` },
            ...generated.plans.slice(0, 2),
          ],
        }),
      },
    ],
    fixed: [
      {
        name: `a ready tail waits for a delayed head with the smallest delay`,
        history: { delay: 2, plans: [{ ...ok }, { ...ok }] },
      },
      {
        name: `a retried head keeps its place`,
        enters: [retryBeforePeer, `retried head`],
        history: {
          delay: 500,
          plans: [
            { failures: 2, final: `success`, storageFault: `none` },
            { ...ok },
            { ...ok },
          ],
        },
      },
      {
        name: `a permanent failure lets the queue continue`,
        enters: [permanentBeforePeer],
        history: {
          delay: 10,
          plans: [
            { ...ok },
            { failures: 1, final: `permanent`, storageFault: `none` },
            { ...ok },
          ],
        },
      },
      {
        name: `a failed deletion stops the queue`,
        enters: [deletionFault, faultBeforePeer],
        history: {
          delay: 10,
          plans: [
            { failures: 0, final: `success`, storageFault: `delete` },
            { ...ok },
          ],
        },
      },
    ],
  },
  model: fifoModel,
  // Probe-bound states are predicted from the plans, never from the trace.
  predict: predictedStates,
  driver: driveFifo,
  check: checkFifo,
  // Wrong answers the check must reject: a ready tail that passes the
  // delayed head, a scheduler that never wakes at eligibility, a queue
  // that keeps running after a storage fault, and an idle executor that
  // keeps a timer armed.
  calibrations: [
    {
      name: `an idle executor keeps a timer armed`,
      law: `idle`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `idle` ? { ...entry, value: 1 } : entry,
        ),
    },
    {
      name: `a ready tail passes the delayed head`,
      law: `fifo`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `before deadline`
            ? {
                ...entry,
                value: { ...(entry.value as State), calls: [idOf(1)] },
              }
            : entry,
        ),
    },
    {
      name: `the head never wakes at its deadline`,
      law: `progress`,
      // The whole queue is untouched: no calls, every row still stored.
      corrupt: (trace) => {
        const queued = trace.find(
          ({ checkpoint }) => checkpoint === `before deadline`,
        )?.value as State | undefined
        return trace.map((entry) =>
          entry.checkpoint === `at deadline` && queued
            ? { ...entry, value: queued }
            : entry,
        )
      },
    },
    {
      name: `the queue continues past a storage fault`,
      law: `stop`,
      corrupt: (trace) => {
        const last = trace.find(
          ({ checkpoint }) => checkpoint === `after every retry`,
        )?.value as State | undefined
        if (!last || last.outbox.length < 2) return undefined
        return trace.map((entry) =>
          entry.checkpoint === `after every retry`
            ? { ...entry, value: { ...last, outbox: last.outbox.slice(0, 1) } }
            : entry,
        )
      },
    },
  ],
})
