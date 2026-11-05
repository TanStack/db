import fc from 'fast-check'
import { vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import {
  differs,
  oracleProperty,
  pass,
  scheduleFrom,
  violation,
  withinTurns,
} from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import {
  captureUnhandledRejections,
  cleanupOfflineOracle,
} from './oracle-lifecycle'
import type { Observation } from '../../db/tests/oracle-property'
import type { OnlineDetector } from '../src/types'
import type { TestItem } from './harness'

// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.
declareOracle({
  owns: [
    `src/OfflineExecutor.ts#startOfflineExecutor`,
    `src/OfflineExecutor.ts#OfflineExecutor.createOfflineTransaction`,
    `src/OfflineExecutor.ts#OfflineExecutor.dispose`,
  ],
})

/**
 * # Does an interruption at any point keep each offline transaction's
 * settlement and durable ownership?
 *
 * Contract and source: the README and the settlement and leadership oracles.
 * Leadership loss, disposal, and going offline fence new provider work; issued
 * work may still settle. A transaction that was not durably admitted rejects
 * its commit with `NonRetriableError` and never reaches the provider. A durable
 * row stays owned until its acknowledgement or permanent rejection is durably
 * removed, and no ID reaches the provider twice. A commit fulfils only after
 * the provider fulfilled and the outbox row was durably removed.
 *
 * The other offline oracles step between named gates or full flushes. This one
 * moves a single interruption across the commit pipeline (`persistTransaction`,
 * outbox admission, scheduling, the provider call, the phase write and the
 * deletion), where a removed `await` or a reordered step would change what the
 * interruption sees. Two timings:
 *
 * - **Immediate:** the fake storage answers each operation in one turn and the
 *   provider answers within its call; the interruption lands after `turn`
 *   microtask turns (0-40, favoring the first few, where admission happens).
 * - **Scheduled:** storage operations and provider responses wait for a data
 *   schedule. Storage completes its operations in order, as one store does;
 *   the provider may answer before or after any pending storage operation.
 *   The interruption lands after `steps` releases and then `turn` microtask
 *   turns, so it can fall while a write or an answer is still outstanding.
 *
 * History grammar: one to three manual transactions on disjoint keys, each
 * with a provider outcome (fulfil, or reject with `NonRetriableError`), commit
 * back to back. One interruption occurs: leadership loss, going offline, or
 * disposal. Recovery then restores the condition: leadership returns to the
 * same executor, the detector goes back online, or, after disposal and once
 * issued work has settled, a fresh executor starts over the same storage.
 *
 * The laws, judged from recorded public observations:
 * - `admission`: a commit that rejects with `NonRetriableError` before its
 *   provider call was not admitted, and never reaches the provider. Only the
 *   current leader admits work, so after leadership loss or disposal no
 *   outbox write for a new row may start. The admission check and the write
 *   run in one synchronous step, so a write that starts after the
 *   interruption means admission passed after it. Going offline does not
 *   refuse admission.
 * - `fencing`: no provider call starts between the interruption and recovery.
 * - `once`: every admitted ID reaches the provider exactly once across both
 *   executors, and calls follow commit order.
 * - `settlement`: after leadership returns or the detector goes online, every
 *   admitted commit settles with its provider outcome. After disposal, the
 *   old executor's waiter may stay pending (disposal ends it), but a settled
 *   commit must still match its outcome.
 * - `durability`: when a commit fulfils, its row is already gone from
 *   storage, and after recovery the outbox is empty.
 * - `unhandled`: no rejection escapes as an unhandled process rejection.
 *
 * Reach: where the interruption landed for each transaction: before
 * admission (`refused`), after admission but before its provider call started
 * (`queued`), or after the call started (`issued`), whether or not the
 * provider has answered, per interruption. Fixed histories enter every
 * reachable landing; going offline cannot refuse admission.
 *
 * Limits: disjoint keys only, so sibling rollback is the settlement oracle's;
 * fake storage over one store, so this proves ordering against this adapter,
 * not a native storage engine. Overlapping old and new executors are not
 * generated: exactly-once execution across independent leaders is not
 * promised.
 */

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

type Outcome = `fulfil` | `reject`
type Interruption = `leadership` | `offline` | `dispose`
type Landing = `refused` | `queued` | `issued`
type History = {
  outcomes: Array<Outcome>
  interruption: Interruption
  turn: number
  /** Null for immediate storage and provider; otherwise a data schedule. */
  schedule: { choices: Array<number>; steps: number } | null
}

const history: fc.Arbitrary<History> = fc.record({
  outcomes: fc.array(fc.constantFrom<Outcome>(`fulfil`, `reject`), {
    minLength: 1,
    maxLength: 3,
  }),
  interruption: fc.constantFrom<Interruption>(
    `leadership`,
    `offline`,
    `dispose`,
  ),
  // Admission takes only the first few turns, so small turns are favored.
  turn: fc.oneof(
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 40 }),
  ),
  schedule: fc.option(
    fc.record({
      choices: fc.array(fc.nat(3), { maxLength: 12 }),
      steps: fc.nat(8),
    }),
    { freq: 2 },
  ),
})

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------
//
// The driver commits the transactions back to back, lets the pipeline run
// for the history's timing, interrupts, lets issued work settle, recovers,
// and lets the outbox drain. It records the phase each outbox admission
// write and each provider call started in, each commit's result, the stored
// keys when each commit fulfilled, the outbox after recovery, and unhandled
// rejections.

class ControlledDetector implements OnlineDetector {
  online = true
  private listeners = new Set<() => void>()
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  notifyOnline(): void {
    for (const listener of this.listeners) listener()
  }
  isOnline(): boolean {
    return this.online
  }
  setOnline(online: boolean): void {
    this.online = online
    if (online) this.notifyOnline()
  }
  dispose(): void {
    this.listeners.clear()
  }
}

type Phase = `before` | `fenced` | `after`
type CommitResult =
  | { kind: `fulfilled`; storedAtFulfil: Array<string> }
  | { kind: `non-retriable`; message: string }
  | { kind: `error`; message: string }
  | { kind: `pending` }
type Run = {
  admissions: Array<Phase>
  calls: Array<{ id: string; phase: Phase }>
  commits: Array<{ id: string; result: CommitResult }>
  outbox: Array<string>
  unhandled: Array<string>
}

async function driveInterruption(
  { outcomes, interruption, turn, schedule: timing }: History,
  observe: (checkpoint: string, value: unknown) => void,
) {
  // A permanent provider failure logs once by design; this law ignores logs.
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const schedule = timing ? scheduleFrom(timing.choices) : undefined
  const settle = async () => {
    for (let index = 0; index < 10; index++) {
      await schedule?.waitIdle()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  let phase: Phase = `before`
  const admissions: Array<Phase> = []
  // Under a schedule, an operation's effect waits for its release; storage
  // completes its operations in the order they were made.
  const later = <T>(label: string, effect: () => Promise<T>) =>
    schedule
      ? schedule.schedule(undefined, label, `storage`).then(effect)
      : effect()
  const storage = new (class extends FakeStorageAdapter {
    override async set(key: string, value: string): Promise<void> {
      if (!(key in this.snapshot())) admissions.push(phase)
      return later(`storage set ${key}`, () => super.set(key, value))
    }
    override async delete(key: string): Promise<void> {
      return later(`storage delete ${key}`, () => super.delete(key))
    }
  })()
  const unhandled = captureUnhandledRejections()
  const calls: Array<{ id: string; phase: Phase }> = []
  // Transaction IDs are random, so the trace names each transaction by its
  // commit position, here and in storage keys.
  const names = new Map<string, string>()
  const named = (text: string) =>
    [...names].reduce(
      (renamed, [id, name]) => renamed.replaceAll(id, name),
      text,
    )
  const mutationFn = (params: { transaction: { id: string } }) => {
    const id = names.get(params.transaction.id)!
    calls.push({ id, phase })
    const answer = () => {
      if (outcomes[Number(id.slice(3))] === `reject`)
        throw new NonRetriableError(`provider rejected ${id}`)
      return { ok: true }
    }
    // Under a schedule, the answer waits for its release.
    return schedule
      ? schedule.schedule(undefined, `provider ${id}`, `provider`).then(answer)
      : answer()
  }
  const detector = new ControlledDetector()
  const first = createTestOfflineEnvironment({
    storage,
    mutationFn,
    config: { onlineDetector: detector },
  })
  let second: ReturnType<typeof createTestOfflineEnvironment> | undefined
  const commits: Array<{
    id: string
    result: CommitResult
    settled: Promise<unknown>
  }> = []
  let hasPrimaryFailure = false
  try {
    await first.waitForLeader()
    for (const index of outcomes.keys()) {
      const offline = first.executor.createOfflineTransaction({
        mutationFnName: first.mutationFnName,
        autoCommit: false,
      })
      const row: TestItem = {
        id: `row-${index}`,
        value: `value ${index}`,
        completed: false,
        updatedAt: new Date(1700000000000),
      }
      const transaction = offline.mutate(() => first.collection.insert(row))
      names.set(transaction.id, `tx ${index}`)
      const entry: (typeof commits)[number] = {
        id: `tx ${index}`,
        result: { kind: `pending` },
        settled: Promise.resolve(),
      }
      entry.settled = offline.commit().then(
        () => {
          entry.result = {
            kind: `fulfilled`,
            storedAtFulfil: Object.keys(storage.snapshot()).map(named),
          }
        },
        (error: unknown) => {
          entry.result =
            error instanceof NonRetriableError
              ? { kind: `non-retriable`, message: named(error.message) }
              : { kind: `error`, message: named(String(error)) }
        },
      )
      commits.push(entry)
    }
    // Inline, so turn 0 interrupts in the same task as the commits and each
    // later turn is exactly one microtask.
    for (let index = 0; index < (timing?.steps ?? 0); index++)
      await schedule!.waitOne()
    for (let index = 0; index < turn; index++) await Promise.resolve()
    phase = `fenced`
    if (interruption === `leadership`) first.leader.setLeader(false)
    else if (interruption === `offline`) detector.setOnline(false)
    else first.executor.dispose()
    await settle()

    phase = `after`
    if (interruption === `leadership`) first.leader.setLeader(true)
    else if (interruption === `offline`) detector.setOnline(true)
    else {
      second = createTestOfflineEnvironment({ storage, mutationFn })
      await second.waitForLeader()
    }
    await settle()
    // A waiter that never settles stays pending; the check decides whether
    // that is allowed.
    for (const entry of commits) await withinTurns(entry.settled, 20)
    observe(`run`, {
      admissions,
      calls,
      commits: commits.map(({ id, result }) => ({ id, result })),
      outbox: Object.keys(storage.snapshot()).map(named),
      unhandled: unhandled.rejections.map(String),
    } satisfies Run)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    warn.mockRestore()
    unhandled.cleanup()
    await cleanupOfflineOracle(
      [
        () => first.executor.dispose(),
        () => second?.executor.dispose(),
        () => first.collection.cleanup(),
        () => second?.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

// ---------------------------------------------------------------------------
// Model and reach
// ---------------------------------------------------------------------------
//
// Each transaction owes its provider outcome; the interruption decides which
// laws apply. Where a transaction's interruption landed is read from the
// trace: whether it reached the provider, and in which phase.

function landings(run: Run): Array<Landing> {
  return run.commits.map(({ id, result }) => {
    const call = run.calls.find((entry) => entry.id === id)
    if (!call && result.kind === `non-retriable`) return `refused`
    return call?.phase === `before` ? `issued` : `queued`
  })
}

const landingStates = ([`leadership`, `offline`, `dispose`] as const).flatMap(
  (interruption) =>
    (interruption === `offline`
      ? ([`issued`, `queued`] as const)
      : ([`refused`, `issued`, `queued`] as const)
    ).map((landing) => `${interruption} ${landing}`),
)

function interruptionModel({ outcomes }: History) {
  return { outcomes }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

function checkInterruption(
  { interruption }: History,
  trace: ReadonlyArray<Observation>,
  { outcomes }: ReturnType<typeof interruptionModel>,
) {
  const run = trace.find(({ checkpoint }) => checkpoint === `run`)?.value as
    Run | undefined
  if (!run) return violation(`run`, `the driver recorded no run`, `trace`)
  if (run.calls.some((call) => call.phase === `fenced`))
    return violation(
      `run`,
      `a provider call started between the interruption and recovery: ${JSON.stringify(run.calls)}`,
      `fencing`,
    )
  if (interruption !== `offline` && run.admissions.includes(`fenced`))
    return violation(
      `run`,
      `an outbox admission started after the interruption: ${JSON.stringify(run.admissions)}`,
      `admission`,
    )
  const calledIds = run.calls.map((call) => call.id)
  if (new Set(calledIds).size !== calledIds.length)
    return violation(
      `run`,
      `an ID reached the provider twice: ${JSON.stringify(calledIds)}`,
      `once`,
    )
  for (const [index, { id, result }] of run.commits.entries()) {
    const called = calledIds.includes(id)
    if (!called && result.kind === `non-retriable`) continue
    if (!called)
      return violation(
        `run`,
        `admitted ${id} never reached the provider; its commit is ${JSON.stringify(result)}`,
        `settlement`,
      )
    if (result.kind === `pending`) {
      if (interruption !== `dispose`)
        return violation(
          `run`,
          `${id} is still pending after recovery from ${interruption}`,
          `settlement`,
        )
      continue
    }
    if (outcomes[index] === `fulfil`) {
      if (result.kind !== `fulfilled`)
        return violation(
          `run`,
          `${id} owed fulfilment, got ${JSON.stringify(result)}`,
          `settlement`,
        )
      if (result.storedAtFulfil.some((key) => key.includes(id)))
        return violation(
          `run`,
          `${id} fulfilled while its row was still stored`,
          `durability`,
        )
    } else if (
      result.kind !== `non-retriable` ||
      result.message !== `provider rejected ${id}`
    )
      return violation(
        `run`,
        `${id} owed its provider rejection, got ${JSON.stringify(result)}`,
        `settlement`,
      )
  }
  const order = run.commits
    .map(({ id }) => id)
    .filter((id) => calledIds.includes(id))
  return (
    differs(
      `run`,
      `once`,
      calledIds,
      order,
      `provider calls do not follow commit order`,
    ) ??
    differs(
      `run`,
      `durability`,
      run.outbox,
      [],
      `the outbox still holds rows after recovery`,
    ) ??
    differs(
      `run`,
      `unhandled`,
      run.unhandled,
      [],
      `a rejection escaped as an unhandled rejection`,
    ) ??
    pass
  )
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

// Fixed histories that reach each landing: a late interruption lands after
// the provider call (`issued`), an early one before it (`queued`), and with
// two transactions an immediate one stops the second admission (`refused`).
const fixedLanding = (
  name: string,
  interruption: Interruption,
  outcomes: Array<Outcome>,
  turn: number,
) => ({
  name,
  enters: [name],
  history: { outcomes, interruption, turn, schedule: null } satisfies History,
})

oracleProperty({
  id: `offline.interruption-settlement`,
  law: {
    statement: `Leadership loss, going offline, or disposal at any point of the commit pipeline keeps each offline transaction's admission, fencing, exactly-once provider call in commit order, settlement with its provider outcome, and durable ownership, with no unhandled rejection.`,
    authority: `the offline-transactions README, and the settlement and leadership oracles`,
    limits: `Disjoint keys (sibling rollback is the settlement oracle's); one to three transactions; fake storage over one store; no overlapping old and new executors, since exactly-once execution across independent leaders is not promised.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: history,
    measured: landingStates,
    // Half of the generated histories are immediate and half scheduled, so
    // each timing keeps the 60 runs the immediate-only oracle had.
    runs: 120,
    fixedSeeds: [20251103],
    fixed: [
      fixedLanding(`leadership issued`, `leadership`, [`fulfil`], 40),
      fixedLanding(`leadership queued`, `leadership`, [`fulfil`], 1),
      fixedLanding(`leadership refused`, `leadership`, [`fulfil`, `reject`], 0),
      fixedLanding(`offline issued`, `offline`, [`fulfil`], 40),
      fixedLanding(`offline queued`, `offline`, [`fulfil`], 1),
      fixedLanding(`dispose issued`, `dispose`, [`fulfil`], 40),
      fixedLanding(`dispose queued`, `dispose`, [`fulfil`], 1),
      fixedLanding(`dispose refused`, `dispose`, [`fulfil`, `reject`], 0),
    ],
  },
  model: interruptionModel,
  reached: ({ interruption }, trace) => {
    const run = trace.find(({ checkpoint }) => checkpoint === `run`)?.value as
      Run | undefined
    return run
      ? [
          ...new Set(
            landings(run).map((landing) => `${interruption} ${landing}`),
          ),
        ]
      : []
  },
  driver: driveInterruption,
  check: checkInterruption,
  calibrations: [
    {
      name: `a provider call during the interruption`,
      law: `fencing`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `run` && (entry.value as Run).calls.length
            ? {
                ...entry,
                value: {
                  ...(entry.value as Run),
                  calls: (entry.value as Run).calls.map((call, index) =>
                    index === 0 ? { ...call, phase: `fenced` } : call,
                  ),
                },
              }
            : entry,
        ),
    },
    {
      name: `a repeated provider call`,
      law: `once`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `run` && (entry.value as Run).calls.length
            ? {
                ...entry,
                value: {
                  ...(entry.value as Run),
                  calls: [
                    ...(entry.value as Run).calls,
                    (entry.value as Run).calls[0]!,
                  ],
                },
              }
            : entry,
        ),
    },
  ],
})
