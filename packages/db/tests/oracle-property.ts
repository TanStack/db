/**
 * Oracle properties: one constructor for an oracle's law, histories, model,
 * production driver, and check.
 *
 * An oracle file used to assemble these parts by hand: `declareOracle`, a loop
 * of `it` calls, assertions spread through the driver, and its own failure
 * text. `oracleProperty` takes the parts and does the mechanics that every
 * oracle shares, so an oracle file holds only the parts that state its law.
 * Cleanup stays with the driver: a driver releases what it created before it
 * returns or throws, so the framework never holds a production resource.
 *
 * The parts keep their jobs separate (oracle rubric, ORC-003):
 *
 * - `law` states the promise, its authority, its limits, and its owner in the
 *   coverage map. A failure names it.
 * - `histories` is either an enumerated list, which runs in full (bounded
 *   exhaustiveness, glossary), or a generated source: a fast-check arbitrary
 *   with a run budget, fixed seeds, constructed histories, and fixed histories
 *   (below).
 * - `model` gives the expected result of a history and its recorded trace,
 *   without production. A model that answers from the history alone ignores
 *   the trace; a model of an environment the driver observes reads it, and
 *   reads only the inputs the driver recorded, never what production showed.
 * - `driver` runs one history through production and records public
 *   observations with `observe(checkpoint, value)`. It returns nothing, so it
 *   cannot decide a verdict. A
 *   production error that the law cares about is an observation the driver
 *   records. An error that escapes the driver is a setup error, unless the
 *   trace recorded before it already violates the law: then the violation is
 *   the failure, with the error as its cause, so a later crash cannot hide an
 *   earlier wrong observation. A check therefore judges the recorded
 *   checkpoints first and the trace's completeness last.
 * - `check` compares the observations with the model and returns a verdict.
 *   Only the check can report a violation of the law. A violation that gives
 *   the `actual` and `expected` values gets the test runner's usual diff;
 *   `differs` builds one from an exact comparison.
 *
 * Each history is one test, named by `label`. A violation fails it with an
 * `OracleViolation` that names the property, the law, the checkpoint, the
 * difference, and the command that reruns that history (the name is escaped,
 * because Vitest reads `-t` as a regular expression). Every observation is
 * also offered to `globalThis.__oracleObserve` when a harness installs one,
 * so the gap report can tell an output the check does not compare from one
 * that never changed.
 *
 * A generated source runs one test per fixed seed and one random test, with
 * the same arbitrary, check, and budget (ORC-007). The random test reads the
 * replay variables through `oraclePropertyOptions`, and every test stands
 * aside during another property's path replay.
 *
 * - **Reach** names the states a history entered. By default the driver
 *   reports them with `observe("reach", state)`. A state that only the model
 *   can name, such as "a failure while the seed is active", comes from
 *   `reached(history, trace, expected)` instead. Each campaign prints how many
 *   histories entered each declared state, including none (ORC-015).
 * - A **state probe** binds a declared state, written `{ name, probe }` in
 *   `states` or `measured`, to a production probe. Production calls
 *   `process.env.NODE_ENV !== 'production' && globalThis.__oracleProbe?.("package#name", condition)`
 *   where it decides whether it enters that state; `condition` is truthy when
 *   production enters it. The framework collects the calls each history makes
 *   inside that history's async context, and never shows them to the model or
 *   the check. Two laws read them. A probe is **reached** in a history when
 *   it was called at all, whatever its condition. A probe-bound state is
 *   **entered** in a history when its probe was called with a truthy
 *   condition. `predict(plan)` says, from the plan alone, whether the history
 *   enters each probe-bound state. A history whose prediction disagrees with
 *   its entries, in either direction, violates law `reach agreement` at
 *   checkpoint `states`, after a driver error and the check's own violation,
 *   so it shrinks and replays like any violation. A predicted entry that does
 *   not happen says why: its probe was never reached, or it was reached with a
 *   false condition, which need different fixes. A probe-bound state counts as
 *   reached only where the prediction and the entry agree, whatever `reached`
 *   or the driver's `reach` records say. Two calibrations per probe force its
 *   entry to be true and to be false; the check must reject both. The
 *   determinism test compares the probe calls each run makes. A call that
 *   arrives after its history's driver settled throws where it happens: the
 *   driver must await the work it starts.
 * - A **constructed history** is built from a generated history so that it
 *   reaches states that the laws need, and it names those declared states.
 *   Every campaign runs every constructed history once as an example, and a
 *   constructed history that does not enter a named state fails. Only
 *   constructed histories make reach required: a state that random histories
 *   reach is measured, never gated. So every state in `states` must be named
 *   by a constructed history, and a state the property only measures is
 *   declared in `measured` instead (ORC-015). Half of a campaign's generated
 *   histories are also constructed, so the histories after each required
 *   state are explored, not visited once.
 * - A **fixed history** is a named history, such as a fixed regression. It may
 *   name the states it `enters`, which its run must reach. Fixed and
 *   constructed histories must be histories the arbitrary could generate
 *   (`canShrinkWithoutContext`), so they shrink like generated ones and cannot
 *   cover a dimension that the grammar lacks; such a dimension belongs in the
 *   grammar, or in the property's stated limits.
 * - **Resolution.** A history can name its actions indirectly, such as "settle
 *   the second active transaction". `resolve(history)` turns it into the plan
 *   of concrete actions that the driver runs and that the model and check read.
 *   The plan holds actions, never expected observations, so the driver still
 *   decides nothing. A history shrinks before resolution, so every shrunk
 *   history still resolves to a legal plan.
 * - **Calibration.** A `calibration` names a wrong answer and the law that
 *   must reject it: a `corrupt` function that alters a recorded trace, as an
 *   observation mutant does, or a mutant `driver`, such as production set up
 *   wrongly. The calibration test finds a history where the corruption
 *   applies and the clean trace passes (it skips a candidate whose clean trace
 *   fails), and requires the check to report that law for the corrupted one
 *   (rubric, ORC-006).
 * - **Determinism.** A `determinism` test runs some histories twice and
 *   requires the same trace: every fixed and constructed history of a generated
 *   source and three generated histories, or up to eight evenly spaced
 *   enumerated histories. A trace that
 *   differs between runs of one history breaks replay, shrinking, and the gap
 *   report's comparison, so a driver records relations (before and after,
 *   same or different id) rather than clock readings or random ids.
 * - **Shrinking keeps the failure.** A violation can name the law it broke.
 *   Once a history fails one way, a setup error, a constructed history that
 *   missed its state, or
 *   one law, a smaller history that fails another way counts as passing, so
 *   the reported counterexample still shows the first failure (ORC-010).
 *   Within one history a driver error decides first, then a law violation,
 *   then a constructed history that missed its state.
 * - **Bounded clock.** A driver that runs on `useOracleClock` has virtual
 *   timers and `Date`; macrotask turns stay real. The clock fires at most
 *   `maxTimers` timers (1,000 by default) in one history. Past that it stops
 *   firing them, and the history fails under law `bounded clock` at
 *   checkpoint `clock`: work that never goes quiet on a controlled clock is
 *   a defect (maintainer decision, 2026-11-06). The spin ranks as a driver
 *   error does, by where it happens: only a violation at a checkpoint
 *   recorded before it still decides, and a driver error after it does not.
 *
 * `oracle-property-self-oracle.test.ts` checks these promises the way an
 * oracle checks production: it runs synthetic properties under real Vitest
 * and compares what Vitest reports with an independent model.
 *
 * The `oracle/no-unit-test` lint rule treats an `oracleProperty` call as an
 * oracle test whose parts are its arguments, when its options are an object
 * literal with a `check`. The property is its own declaration.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  assertRegisteredOracleProperty,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
  withOracleExamples,
} from './oracle-config.js'

/** A law and where it comes from. */
export interface OracleLaw {
  /** The promise, stated so that a reader could predict an observation. */
  statement: string
  /** The contract document and section, or the maintainer decision. */
  authority: string
  /** What this property does not establish. */
  limits: string
  /** The oracle owner in the coverage map. */
  owner: string
}

/** One recorded public fact, at the checkpoint where the contract owes it. */
export interface Observation {
  checkpoint: string
  value: unknown
}

/** The check's judgment of one history. */
export type Verdict =
  | { kind: `pass` }
  | {
      kind: `violation`
      checkpoint: string
      difference: string
      /** The law broken, which shrinking preserves. Defaults to the checkpoint. */
      law?: string
      /** The observed and owed values, which the failure shows as a diff. */
      values?: { actual: unknown; expected: unknown }
      /** A driver error that came after the violated checkpoint. */
      cause?: unknown
    }

export const pass: Verdict = { kind: `pass` }

export function violation(
  checkpoint: string,
  difference: string,
  law?: string,
  values?: { actual: unknown; expected: unknown },
): Verdict {
  return { kind: `violation`, checkpoint, difference, law, values }
}

/**
 * One exact comparison: a violation of `law` at `checkpoint` when `actual` is
 * not strictly deep-equal to `expected`, with both values attached so the
 * failure shows a diff; otherwise undefined, so comparisons chain as
 * `return differs(...) ?? differs(...) ?? pass`. Equality is Node's
 * `isDeepStrictEqual`: symbol keys, undefined-versus-absent fields, `-0`,
 * and prototypes count, where JSON text would erase them.
 */
export function differs(
  checkpoint: string,
  law: string,
  actual: unknown,
  expected: unknown,
  difference = `the observed value differs from the owed value`,
): Verdict | undefined {
  return isDeepStrictEqual(actual, expected)
    ? undefined
    : violation(checkpoint, difference, law, { actual, expected })
}

/**
 * History checking against allowed cuts.
 * A model can often name, in order, the states an observer may see after a
 * step without fixing which of them it sees: a publication may skip a state
 * but never go back to an earlier one. `forwardCut` returns the index of the
 * first cut at or after `from` that equals `observed`, or -1 when the
 * observation is no allowed state ahead of `from`. The caller keeps the
 * returned index as the next `from`.
 */
export function forwardCut<State>(
  cuts: ReadonlyArray<State>,
  observed: State,
  from: number,
  same: (allowed: State, observed: State) => boolean,
): number {
  for (let index = from; index < cuts.length; index += 1)
    if (same(cuts[index]!, observed)) return index
  return -1
}

/**
 * Logical time for drivers. A driver that
 * must not hang when production never settles a promise waits with
 * `withinTurns(promise, turns)`: it resolves `true` as soon as the promise
 * settles, at the same microtask an `await` would, or `false` after `turns`
 * event-loop turns. The bound counts turns, not milliseconds, so a loaded
 * machine cannot turn a slow but legal settlement into a timeout. It cannot
 * wait for work that production schedules on a delayed timer; a driver for
 * such work controls that timer.
 */
/**
 * One event-loop turn. `setTimeout(0)` waits at least a millisecond in Node,
 * which made schedule-heavy histories mostly idle; `setImmediate` yields the
 * same turn without that clamp. A browser has no `setImmediate`.
 */
const nextTurn = () =>
  new Promise<void>((resolve) =>
    typeof setImmediate === `function`
      ? setImmediate(resolve)
      : setTimeout(resolve, 0),
  )

export function withinTurns(
  promise: Promise<unknown>,
  turns: number,
): Promise<boolean> {
  // An object, so the loop reads the flag that the callbacks set.
  const state = { settled: false }
  const done = promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  )
  const expiry = (async () => {
    for (let turn = 0; turn < turns && !state.settled; turn += 1)
      await nextTurn()
    return false
  })()
  return Promise.race([done, expiry])
}

/**
 * A schedule as plain data. `scheduleFrom(choices)` orders promises the way
 * fast-check's `fc.scheduler()` does, with the same method names, but its
 * decisions are a list of numbers in the history. A task belongs to a queue
 * (its label's text before the first space, unless `queue` names one), and a
 * queue releases its tasks in the order they were scheduled, as a storage
 * engine completes one store's operations in order. At each step the schedule
 * releases the oldest task of queue `choices[step] % queues`, counting the
 * queues that have a pending task in the order they first did, and the oldest
 * task overall once the choices run out. A history that holds the choices replays exactly, shrinks
 * like any array, can be a fixed or constructed history, and prints as JSON; a
 * `fc.scheduler()` value does none of these (it is consumed as it runs, its
 * clones do not reproduce, and it is never a member of its own language).
 */
export interface DataScheduler {
  /** A promise that settles like `promise`, once the schedule releases it. */
  schedule: <T>(
    promise: Promise<T> | T,
    label?: string,
    queue?: string,
  ) => Promise<T>
  /** Releases one pending task and waits for its continuations. */
  waitOne: () => Promise<void>
  /** Releases tasks until none is pending, including ones they schedule. */
  waitIdle: () => Promise<void>
  /** The labels of released tasks, in release order. */
  released: () => ReadonlyArray<string>
}

export function scheduleFrom(choices: ReadonlyArray<number>): DataScheduler {
  const pending: Array<{ label: string; queue: string; release: () => void }> =
    []
  const released: Array<string> = []
  let step = 0
  // Continuations of a released task run on microtasks; one macrotask turn
  // lets them finish, and lets them schedule further tasks.
  const settle = nextTurn
  const waitOne = async () => {
    if (pending.length === 0) return
    const queues = [...new Set(pending.map((task) => task.queue))]
    const choice = choices[step++]
    const at =
      choice === undefined
        ? 0
        : pending.findIndex(
            (task) => task.queue === queues[choice % queues.length],
          )
    const [task] = pending.splice(at, 1)
    released.push(task!.label)
    task!.release()
    await settle()
  }
  return {
    schedule: <T>(
      promise: Promise<T> | T,
      label = `task ${pending.length}`,
      queue = label.split(` `)[0]!,
    ) =>
      new Promise<T>((resolve, reject) => {
        // The schedule owns the promise from here: a rejection waits for its
        // release without counting as unhandled, then reaches the caller.
        const held = Promise.resolve(promise)
        held.catch(() => {})
        pending.push({
          label,
          queue,
          release: () => void held.then(resolve, reject),
        })
      }),
    waitOne,
    waitIdle: async () => {
      await settle()
      while (pending.length > 0) await waitOne()
    },
    released: () => [...released],
  }
}

/**
 * The check found a history whose observations the law does not allow.
 * `actual` and `expected` are the fields Vitest reads to print a diff.
 */
export class OracleViolation extends Error {
  override name = `OracleViolation`
  actual?: unknown
  expected?: unknown
  showDiff?: boolean
}

/**
 * A history built from a generated one so that it reaches the states the
 * laws need. The driver reports reached states with `observe("reach", state)`.
 */
export interface ConstructedHistory<History> {
  name: string
  enters: ReadonlyArray<string>
  build: (generated: History) => History
}

/**
 * A declared state: its name, or its name and the production probe that marks
 * it (`package#name`). A probe-bound state's reach is the agreement between
 * the property's `predict` and the probe's entries.
 */
export type DeclaredState = string | { name: string; probe: string }

export interface GeneratedHistories<History> {
  arbitrary: fc.Arbitrary<History>
  /**
   * The declared states the laws depend on (ORC-015). Each must be named by a
   * constructed history, so every campaign reaches it. Each campaign reports
   * how many histories entered each one, including none.
   */
  states?: ReadonlyArray<DeclaredState>
  /**
   * States that are counted but not required. A reached state outside
   * `states` and `measured` fails, so a misspelled state cannot pass unseen.
   */
  measured?: ReadonlyArray<DeclaredState>
  /** The base run budget of each campaign, scaled by the run multiplier. */
  runs: number
  /** One fixed-seed campaign per seed, beside the random campaign. */
  fixedSeeds: ReadonlyArray<number>
  constructed?: ReadonlyArray<ConstructedHistory<History>>
  fixed?: ReadonlyArray<FixedHistory<History>>
}

/** A named fixed history, such as a fixed regression, and the states it must enter. */
export interface FixedHistory<History> {
  name: string
  history: History
  enters?: ReadonlyArray<string>
}

/** A wrong answer and the law that must reject it (ORC-006). */
export type Calibration<History, Plan> = {
  name: string
  /** The law the check must report. */
  law: string
} & (
  | {
      /** A corrupted copy of the trace, or undefined when nothing applies. */
      corrupt: (
        trace: ReadonlyArray<Observation>,
        plan: Plan,
      ) => ReadonlyArray<Observation> | undefined
    }
  | {
      /** A mutant driver, such as production configured wrongly. */
      driver: OraclePropertyOptions<History, unknown, Plan>[`driver`]
    }
)

export interface OraclePropertyOptions<History, Expected, Plan = History> {
  /** A stable identifier, used in failures, the manifest, and replay. */
  id: string
  law: OracleLaw
  /** Every legal history in a fixed order, or a generated source. */
  histories: ReadonlyArray<History> | GeneratedHistories<History>
  /** A short, unique test name for an enumerated history. */
  label?: (history: History) => string
  /** The plan of concrete actions; required when Plan is not History. */
  resolve?: (history: History) => Plan
  model: (plan: Plan, trace: ReadonlyArray<Observation>) => Expected
  /** The states the history entered. Defaults to the trace's `reach` values. */
  reached?: (
    plan: Plan,
    trace: ReadonlyArray<Observation>,
    expected: Expected,
  ) => Iterable<string>
  driver: (
    plan: Plan,
    observe: (checkpoint: string, value: unknown) => void,
  ) => Promise<void> | void
  check: (
    plan: Plan,
    observations: ReadonlyArray<Observation>,
    expected: Expected,
  ) => Verdict
  calibrations?: ReadonlyArray<Calibration<History, Plan>>
  /**
   * Whether the history enters each probe-bound state, from the plan alone:
   * a prediction never sees the trace, so it cannot follow production.
   */
  predict?: (plan: Plan) => Readonly<Record<string, boolean>>
  /** Each registered test's limit in milliseconds; 120 seconds by default. */
  timeout?: number
}

declare global {
  // Installed by the gap report's test setup, absent otherwise.
  var __oracleObserve:
    ((checkpoint: string, value: unknown) => void) | undefined
  // Production probes call this in development builds; see `probes`.
  var __oracleProbe:
    | ((name: string, condition: unknown) => void)
    | undefined
  // Installed by the gap report's test setup, absent otherwise. It receives
  // every law violation the framework raises, so a mutant's kill is
  // classified by the law that rejected it rather than by its message.
  // Installed by the gap report's test setup, absent otherwise. Each
  // registered test reports its route before it runs.
  var __oracleRoute: ((route: string) => void) | undefined
  var __oracleVerdict:
    | ((verdict: { property: string; law: string; checkpoint: string }) => void)
    | undefined
}

/** The probe calls one history made: which probes it reached and which it entered. */
interface ProbeRecord {
  reached: ReadonlySet<string>
  entered: ReadonlySet<string>
}
/** A history's probe record, open until its driver settles. */
interface ProbeWindow {
  reached: Set<string>
  entered: Set<string>
  open: boolean
}
const probeWindows = new AsyncLocalStorage<ProbeWindow>()
// Outside any history, such as in an ordinary test, a probe does nothing. A
// call that arrives after its history's driver settled throws where it
// arrives: the driver did not await work that production started.
globalThis.__oracleProbe = (name, condition) => {
  const window = probeWindows.getStore()
  if (!window) return
  if (!window.open)
    throw new Error(
      `probe ${name} was called after its history ended. The driver must await the work it starts, so every probe call belongs to one history.`,
    )
  window.reached.add(name)
  if (condition) window.entered.add(name)
}

/** A calibration's forced entry: the probe is reached, and its entry is forced to the stated value. */
interface ForcedProbe {
  probe: string
  entered: boolean
}
const agreementLaw = `reach agreement`

/** A property's options with the probes its declared states bind, by state. */
type BoundOptions<History, Expected, Plan> = OraclePropertyOptions<
  History,
  Expected,
  Plan
> & { probes?: ReadonlyMap<string, string> }

const stateName = (state: DeclaredState) =>
  typeof state === `string` ? state : state.name

/** One test that a property registers. */
interface PropertyTest {
  name: string
  /**
   * The test's route, which the gap report reads to tell a reproducible kill
   * from a random-only one or a framework check (`__oracleRoute`).
   */
  route: string
  run: () => Promise<void>
  /** Path replays this test runs during; empty stands aside during every one. */
  replays: ReadonlyArray<string>
}

export function oracleProperty<History, Expected, Plan = History>(
  options: OraclePropertyOptions<History, Expected, Plan>,
): void {
  // Every source names a registered property, so its replay and manifest
  // entries exist; an enumerated source has no random campaign to check it.
  assertRegisteredOracleProperty(options.id)
  const { id, histories } = options
  if (Array.isArray(histories) && options.predict)
    throw new Error(
      `${id}: \`predict\` needs probe-bound states, which only a generated source declares.`,
    )
  recordRegistration(id, options.law, histories)
  // The tests are built as data first, so every one registers unconditionally
  // (oracle/no-disabled).
  const tests = Array.isArray(histories)
    ? enumeratedTests(options, histories as ReadonlyArray<History>)
    : generatedTests(options, histories as GeneratedHistories<History>)
  describe(id, () => {
    for (const test of tests)
      oracleReplayTest(it, ...test.replays)(
        test.name,
        () => {
          globalThis.__oracleRoute?.(test.route)
          return test.run()
        },
        options.timeout ?? 120_000,
      )
  })
}

function enumeratedTests<History, Expected, Plan>(
  options: OraclePropertyOptions<History, Expected, Plan>,
  histories: ReadonlyArray<History>,
): Array<PropertyTest> {
  const spacing = Math.max(1, Math.ceil(histories.length / 8))
  const sampled = histories.filter((_, index) => index % spacing === 0)
  return [
    ...histories.map((history) => enumeratedTest(options, history)),
    ...calibrationTests(options, () =>
      histories.map((history) => ({
        name: options.label?.(history) ?? JSON.stringify(history),
        history,
      })),
    ),
    determinismTest(options, () =>
      sampled.map((history) => ({
        name: options.label?.(history) ?? JSON.stringify(history),
        history,
      })),
    ),
  ]
}

function enumeratedTest<History, Expected, Plan>(
  options: OraclePropertyOptions<History, Expected, Plan>,
  history: History,
): PropertyTest {
  {
    const name = options.label?.(history) ?? JSON.stringify(history)
    return {
      name,
      route: `enumerated`,
      replays: [],
      run: async () => {
        const { verdict } = await runOne(options, history)
        if (verdict.kind === `violation`)
          throw failure(
            options,
            verdict,
            history,
            rerunByName(`${options.id} ${name}`),
          )
      },
    }
  }
}

// The running history's trace, and where in it a controlled clock passed its
// bound (see `useOracleClock`).
let historyTrace: Array<Observation> | undefined
let clockSpin: { at: number; maxTimers: number } | undefined
/** The running history's spin, if its clock passed its bound; clears it. */
const takeClockSpin = () => {
  const spin = clockSpin
  clockSpin = undefined
  return spin
}

/**
 * Runs the rest of a driver's history on a controlled clock: timers and
 * `Date` are virtual, and macrotask turns (`setImmediate`) and microtasks
 * stay real, so in-memory work finishes between clock steps. The clock fires
 * at most `maxTimers` timers in the history; past that it stops firing them,
 * which ends a storm of timers that never goes quiet, and the history fails
 * under law `bounded clock`. Raise `maxTimers` for a legal history that needs
 * more. Call `release` in the driver's `finally`.
 */
export function useOracleClock({ maxTimers = 1000 }: { maxTimers?: number } = {}): {
  release: () => void
} {
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Date`],
  })
  let fired = 0
  const counted =
    <Args extends Array<unknown>>(callback: (...args: Args) => void) =>
    (...args: Args) => {
      fired += 1
      if (fired > maxTimers) {
        clockSpin ??= { at: historyTrace?.length ?? 0, maxTimers }
        return
      }
      callback(...args)
    }
  const fakeTimeout = globalThis.setTimeout
  const fakeInterval = globalThis.setInterval
  globalThis.setTimeout = ((callback: unknown, ms?: number, ...args: Array<unknown>) =>
    fakeTimeout(
      typeof callback === `function` ? counted(callback as (...a: Array<unknown>) => void) : (callback as () => void),
      ms,
      ...args,
    )) as typeof setTimeout
  globalThis.setInterval = ((callback: unknown, ms?: number, ...args: Array<unknown>) =>
    fakeInterval(
      typeof callback === `function` ? counted(callback as (...a: Array<unknown>) => void) : (callback as () => void),
      ms,
      ...args,
    )) as typeof setInterval
  return { release: () => vi.useRealTimers() }
}

/** Runs only the driver, for a history's recorded trace. */
async function recordTrace<Plan>(
  driver: (
    plan: Plan,
    observe: (checkpoint: string, value: unknown) => void,
  ) => Promise<void> | void,
  plan: Plan,
): Promise<Array<Observation>> {
  const observations: Array<Observation> = []
  const window: ProbeWindow = {
    reached: new Set(),
    entered: new Set(),
    open: true,
  }
  historyTrace = observations
  clockSpin = undefined
  try {
    await probeWindows.run(window, () =>
      driver(plan, (checkpoint, value) => {
        observations.push({ checkpoint, value })
      }),
    )
  } finally {
    historyTrace = undefined
  }
  window.open = false
  // Where a controlled clock passed its bound is part of the trace.
  const spin = takeClockSpin()
  if (spin) observations.push({ checkpoint: `clock`, value: spin.at })
  // The probe calls a history makes are part of what a deterministic driver repeats.
  observations.push({
    checkpoint: `probes`,
    value: {
      reached: [...window.reached].sort(),
      entered: [...window.entered].sort(),
    },
  })
  return observations
}

/** The plan a history resolves to; a history is its own plan by default. */
function planOf<History, Expected, Plan>(
  options: OraclePropertyOptions<History, Expected, Plan>,
  history: History,
): Plan {
  return options.resolve
    ? options.resolve(history)
    : (history as unknown as Plan)
}

// A stable text for an observation: Maps, Sets, undefined, bigints, and
// errors keep their distinctions, which JSON alone drops.
function traceText(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined) return `$undefined`
    if (typeof item === `bigint`) return `$bigint:${item}`
    if (item instanceof Map) return { $map: [...item] }
    if (item instanceof Set) return { $set: [...item] }
    if (item instanceof Error)
      return { $error: item.name, message: item.message }
    return item
  })
}

function determinismTest<History, Expected, Plan>(
  options: BoundOptions<History, Expected, Plan>,
  histories: () => ReadonlyArray<{ name: string; history: History }>,
): PropertyTest {
  return {
    name: `determinism`,
    route: `determinism`,
    replays: [],
    run: async () => {
      for (const { name, history } of histories()) {
        const plan = planOf(options, history)
        const [first, second] = [
          await recordTrace(options.driver, plan),
          await recordTrace(options.driver, plan),
        ]
        const length = Math.max(first.length, second.length)
        for (let index = 0; index < length; index += 1) {
          const [a, b] = [first[index], second[index]]
          const [textA, textB] = [traceText(a), traceText(b)]
          if (textA === textB) continue
          const error = new Error(
            [
              `${options.id}: two runs of "${name}" recorded different traces at observation ${index}${a ? ` ("${a.checkpoint}")` : ``}.`,
              `First run:  ${textA.slice(0, 2000)}`,
              `Second run: ${textB.slice(0, 2000)}`,
              `History: ${traceText(history)}`,
              `A driver records relations, such as before and after or same and different, instead of clock readings or random ids.`,
            ].join(`\n`),
          ) as Error & {
            actual?: unknown
            expected?: unknown
            showDiff?: boolean
          }
          error.actual = b
          error.expected = a
          error.showDiff = true
          throw error
        }
      }
    },
  }
}

/** Runs one history: the driver records, the model predicts, the check judges. */
async function runOne<History, Expected, Plan>(
  options: BoundOptions<History, Expected, Plan>,
  history: History,
  driver: OraclePropertyOptions<
    History,
    Expected,
    Plan
  >[`driver`] = options.driver,
  forced?: ForcedProbe,
): Promise<{ verdict: Verdict; reached: Set<string> }> {
  const plan = planOf(options, history)
  const { observations, driverError, probes, spin } = await recordGuarded(
    driver,
    plan,
    forced,
  )
  // A spin ranks as a driver error does, by where it happens: the trace is
  // judged up to it, and a driver error after it does not decide.
  if (spin) {
    const { verdict, reached } = judge(
      options,
      plan,
      observations.slice(0, spin.at),
      undefined,
      probes,
    )
    const recorded =
      verdict.kind === `violation` &&
      observations
        .slice(0, spin.at)
        .some(({ checkpoint }) => checkpoint === verdict.checkpoint)
    return recorded
      ? { verdict, reached }
      : {
          verdict: violation(
            `clock`,
            `the controlled clock fired more than ${spin.maxTimers} timers in one history: work that never goes quiet (raise maxTimers if a legal history needs more)`,
            `bounded clock`,
          ),
          reached,
        }
  }
  return judge(options, plan, observations, driverError, probes)
}

/** Runs the driver and keeps an error that escapes it beside the trace. */
async function recordGuarded<Plan>(
  driver: (
    plan: Plan,
    observe: (checkpoint: string, value: unknown) => void,
  ) => Promise<void> | void,
  plan: Plan,
  forced?: ForcedProbe,
): Promise<{
  observations: Array<Observation>
  driverError?: { error: unknown }
  probes: ProbeRecord
  spin?: { at: number; maxTimers: number }
}> {
  const observations: Array<Observation> = []
  const window: ProbeWindow = {
    reached: new Set(),
    entered: new Set(),
    open: true,
  }
  const close = (): ProbeRecord => {
    window.open = false
    // A forced entry is a call with that condition, so the probe is reached.
    if (forced) {
      window.reached.add(forced.probe)
      if (forced.entered) window.entered.add(forced.probe)
      else window.entered.delete(forced.probe)
    }
    return window
  }
  historyTrace = observations
  clockSpin = undefined
  const settle = () => {
    historyTrace = undefined
    const spin = takeClockSpin()
    return spin ? { spin } : {}
  }
  try {
    await probeWindows.run(window, () =>
      driver(plan, (checkpoint, value) => {
        observations.push({ checkpoint, value })
        globalThis.__oracleObserve?.(checkpoint, value)
      }),
    )
  } catch (error) {
    return { observations, driverError: { error }, probes: close(), ...settle() }
  }
  return { observations, probes: close(), ...settle() }
}

/** The model predicts and the check judges a recorded trace. */
function judge<History, Expected, Plan>(
  options: BoundOptions<History, Expected, Plan>,
  plan: Plan,
  observations: ReadonlyArray<Observation>,
  driverError?: { error: unknown },
  probes: ProbeRecord = { reached: new Set(), entered: new Set() },
): { verdict: Verdict; reached: Set<string> } {
  let expected: Expected
  let verdict: Verdict
  let predicted: Readonly<Record<string, boolean>> = {}
  try {
    expected = options.model(plan, observations)
    verdict = options.check(plan, observations, expected)
    predicted = options.predict?.(plan) ?? {}
  } catch (error) {
    // A partial trace the model or check cannot read is still a setup error.
    throw driverError ? driverError.error : error
  }
  if (driverError) {
    // Only a violation at a checkpoint the driver recorded before it threw
    // outranks the error; one about the missing rest of the trace does not.
    const recorded = observations.some(
      ({ checkpoint }) =>
        verdict.kind === `violation` && checkpoint === verdict.checkpoint,
    )
    if (verdict.kind === `pass` || !recorded) throw driverError.error
    verdict = { ...verdict, cause: driverError.error }
  }
  const reached = new Set(
    options.reached?.(plan, observations, expected) ??
      observations
        .filter((entry) => entry.checkpoint === `reach`)
        .map((entry) => String(entry.value)),
  )
  // Agreement: the model's prediction and the probes' entries name the same
  // probe-bound states. Only an agreed entry counts as reach.
  for (const [state, probe] of options.probes ?? []) {
    const predicts = predicted[state] === true
    const entered = probes.entered.has(probe)
    reached.delete(state)
    if (predicts && entered) reached.add(state)
    if (predicts === entered || verdict.kind === `violation`) continue
    verdict = violation(
      `states`,
      predicts
        ? `the model predicts that this history enters "${state}", but probe ${probe} ${probes.reached.has(probe) ? `was reached with a false condition` : `was never reached`}`
        : `probe ${probe} was entered, but the model predicts that this history does not enter "${state}"`,
      agreementLaw,
    )
  }
  return { verdict, reached }
}

const lawOf = (verdict: Extract<Verdict, { kind: `violation` }>) =>
  verdict.law ?? verdict.checkpoint

/**
 * One test per calibration. It tries candidate histories in order until the
 * wrong answer applies, and requires the check to report the named law.
 */
function calibrationTests<History, Expected, Plan>(
  options: BoundOptions<History, Expected, Plan>,
  candidates: () => ReadonlyArray<{ name: string; history: History }>,
): Array<PropertyTest> {
  const { id } = options
  // Each probe-bound state also gets two forced-entry calibrations.
  const forcedCalibrations = [...(options.probes ?? [])].flatMap(
    ([state, probe]) =>
      [true, false].map((entered) => ({
        name: `probe ${probe} forced ${entered ? `entered` : `not entered`} (state "${state}")`,
        law: agreementLaw,
        forced: { probe, entered },
      })),
  )
  return [...(options.calibrations ?? []), ...forcedCalibrations].map(
    (calibration) => ({
      name: `calibration: ${calibration.name}`,
      route: `forced` in calibration ? `probe calibration` : `calibration`,
      replays: [],
      run: async () => {
        const seen: Array<string> = []
        for (const { name, history } of candidates()) {
          const plan = planOf(options, history)
          if (`corrupt` in calibration) {
            const { observations, driverError, probes } = await recordGuarded(
              options.driver,
              plan,
            )
            const corrupted = calibration.corrupt(observations, plan)
            if (corrupted === undefined) continue
            // A calibration is meaningful only where the true trace passes, so
            // a candidate whose clean trace fails, or whose driver throws, is
            // skipped; that history fails in its own test.
            if (
              driverError ||
              judge(options, plan, observations, undefined, probes).verdict
                .kind !== `pass`
            )
              continue
            const wrong = judge(
              options,
              plan,
              corrupted,
              undefined,
              probes,
            ).verdict
            if (wrong.kind === `violation` && lawOf(wrong) === calibration.law)
              return
            throw new Error(
              `${id}: calibration "${calibration.name}" corrupted the trace of "${name}", but the check ${wrong.kind === `pass` ? `passed it` : `reported law "${lawOf(wrong)}"`}. It must report law "${calibration.law}".`,
            )
          }
          // The real driver's trace of the candidate must pass first.
          const clean = await recordGuarded(options.driver, plan)
          if (
            clean.driverError ||
            judge(options, plan, clean.observations, undefined, clean.probes)
              .verdict.kind !== `pass`
          )
            continue
          const { verdict } =
            `forced` in calibration
              ? await runOne(
                  options,
                  history,
                  options.driver,
                  calibration.forced,
                )
              : await runOne(options, history, calibration.driver)
          if (verdict.kind === `pass`) continue
          if (lawOf(verdict) === calibration.law) return
          seen.push(`"${name}" reported law "${lawOf(verdict)}"`)
        }
        throw new Error(
          `${id}: calibration "${calibration.name}" found no history whose clean trace passes and where the check reports law "${calibration.law}"${seen.length ? `; ${seen.slice(0, 3).join(`, `)}` : ``}. Add a passing fixed or constructed history that reaches the state its wrong answer changes.`,
        )
      },
    }),
  )
}

function failure<History>(
  options: { id: string; law: OracleLaw },
  verdict: Extract<Verdict, { kind: `violation` }>,
  history: History,
  rerun: string,
): OracleViolation {
  const { id, law } = options
  globalThis.__oracleVerdict?.({
    property: id,
    law: lawOf(verdict),
    checkpoint: verdict.checkpoint,
  })
  const error = new OracleViolation(
    [
      `${id} violated at checkpoint "${verdict.checkpoint}"${verdict.law ? ` (law: ${verdict.law})` : ``}.`,
      `Law: ${law.statement}`,
      `Difference: ${verdict.difference}`,
      `History: ${JSON.stringify(history)}`,
      `Authority: ${law.authority}`,
      `Known limits: ${law.limits}`,
      `Rerun: ${rerun}`,
    ].join(`\n`),
    verdict.cause === undefined ? undefined : { cause: verdict.cause },
  )
  if (verdict.values) {
    error.actual = verdict.values.actual
    error.expected = verdict.values.expected
    error.showDiff = true
  }
  return error
}

/** A Vitest `-t` argument that matches exactly this test name. */
function rerunByName(name: string): string {
  const pattern = name.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
  return `-t ${JSON.stringify(`^${pattern}$`)}`
}

function generatedTests<History, Expected, Plan>(
  unbound: OraclePropertyOptions<History, Expected, Plan>,
  source: GeneratedHistories<History>,
): Array<PropertyTest> {
  const { id } = unbound
  const declaredStates = [...(source.states ?? []), ...(source.measured ?? [])]
  const probes = new Map(
    declaredStates.flatMap((state) =>
      typeof state === `string` ? [] : [[state.name, state.probe] as const],
    ),
  )
  if (probes.size > 0 !== (unbound.predict !== undefined))
    throw new Error(
      `${id}: a probe-bound state needs \`predict\`, and \`predict\` needs a probe-bound state. Declare the state as { name, probe }.`,
    )
  const options: BoundOptions<History, Expected, Plan> =
    probes.size > 0 ? { ...unbound, probes } : unbound
  const required = (source.states ?? []).map(stateName)
  const constructions = source.constructed ?? []
  const declared =
    source.states || source.measured
      ? new Set(declaredStates.map(stateName))
      : undefined
  const named = new Set(
    constructions.flatMap((construction) => construction.enters),
  )
  const unconstructed = required.filter((state) => !named.has(state))
  if (unconstructed.length > 0)
    throw new Error(
      `${id}: no constructed history enters ${unconstructed.join(`, `)}. A required state needs a constructed history; a state that is only counted belongs in \`measured\`.`,
    )
  // Generated histories, half of them constructed. A constructed history
  // shrinks through its generated input, as a mapped arbitrary does.
  const arbitrary =
    constructions.length === 0
      ? source.arbitrary
      : fc.oneof(
          { arbitrary: source.arbitrary, weight: constructions.length },
          ...constructions.map((construction) => ({
            arbitrary: source.arbitrary.map(construction.build),
            weight: 1,
          })),
        )
  for (const construction of constructions) {
    const undeclared = construction.enters.filter(
      (state) => declared !== undefined && !required.includes(state),
    )
    if (undeclared.length > 0)
      throw new Error(
        `${id}: constructed history "${construction.name}" names undeclared states ${undeclared.join(`, `)}.`,
      )
  }

  // Each campaign gets a fresh predicate: its first failure fixes the kind
  // that shrinking must keep, a setup error, a constructed history that missed
  // its state, or one law. A
  // smaller history that fails some other way counts as passing. It counts
  // the histories that entered each state.
  const predicateFor = (
    constructionOf: Map<History, ConstructedHistory<History>>,
    counts: Map<string, number>,
  ) => {
    let firstKind: string | undefined
    const keeps = (kind: string) => (firstKind ??= kind) === kind
    return async (history: History) => {
      let outcome: Awaited<ReturnType<typeof runOne>>
      try {
        outcome = await runOne(options, history)
      } catch (error) {
        if (keeps(`setup`)) throw error
        return
      }
      const { verdict, reached } = outcome
      for (const state of reached) {
        if (declared !== undefined && !declared.has(state))
          throw new Error(
            `${id}: a history entered "${state}", which the property does not declare.`,
          )
        counts.set(state, (counts.get(state) ?? 0) + 1)
      }
      // A law violation outranks a constructed history that missed its state.
      if (verdict.kind === `pass`) {
        const construction = constructionOf.get(history)
        const missing =
          construction?.enters.filter((state) => !reached.has(state)) ?? []
        if (missing.length === 0 || !keeps(`constructed-reach`)) return
        throw new Error(
          `${id}: constructed history "${construction!.name}" did not enter ${missing.join(`, `)}. A constructed history must reach every state it names.`,
        )
      }
      if (!keeps(`law:${lawOf(verdict)}`)) return
      throw failure(
        options,
        verdict,
        history,
        `TANSTACK_DB_ORACLE_PROPERTY=${id} with the seed and path that fast-check reports`,
      )
    }
  }
  // Each campaign runs every constructed history, built from histories its own
  // seed draws.
  // fast-check passes example inputs by reference, which identifies them.
  const examplesFor = (seed: number) => {
    const constructionOf = new Map<History, ConstructedHistory<History>>()
    const examples = constructions.map((construction, index) => {
      const [generated] = fc.sample(source.arbitrary, {
        seed: seed + index,
        numRuns: 1,
      })
      const history = construction.build(generated!)
      if (!source.arbitrary.canShrinkWithoutContext(history))
        throw new Error(
          `${id}: constructed history "${construction.name}" built a history the arbitrary cannot generate. A constructed history must stay inside the generated language so that its failures shrink.`,
        )
      constructionOf.set(history, construction)
      return [history] as [History]
    })
    return { examples, constructionOf }
  }

  // A campaign reports its reach counts after it passes; a failing campaign
  // reports its counterexample instead.
  const runCampaign = async (
    name: string,
    seed: number,
    parameters: (examples: Array<[History]>) => Parameters<typeof fc.assert>[1],
  ) => {
    const { examples, constructionOf } = examplesFor(seed)
    const counts = new Map<string, number>(
      [...(declared ?? [])].map((state) => [state, 0]),
    )
    await fc.assert(
      fc.asyncProperty(arbitrary, predicateFor(constructionOf, counts)),
      parameters(examples),
    )
    // Vitest hides console output from a passing test; stdout reaches the log.
    process.stdout.write(
      `${id} ${name} reach ${JSON.stringify(Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1))))}\n`,
    )
  }
  const fixedCampaigns = source.fixedSeeds.map((seed): PropertyTest => ({
    name: `fixed seed ${seed}`,
    route: `fixed seed`,
    replays: [],
    run: () =>
      runCampaign(`fixed seed ${seed}`, seed, (examples) =>
        withOracleExamples(
          { numRuns: oracleRuns(source.runs), seed },
          examples,
        ),
      ),
  }))
  // The random campaign picks its seed itself, so a replay of that seed
  // rebuilds the same constructed histories, which the replay path counts.
  const randomCampaign: PropertyTest = {
    name: `random seed`,
    route: `random seed`,
    replays: [id],
    run: () => {
      // One call selects and logs the seed; a replay reads that log line.
      const parameters = oraclePropertyOptions(source.runs, id)
      return runCampaign(`random seed`, parameters.seed!, (examples) =>
        withOracleExamples(parameters, examples),
      )
    },
  }
  const fixedTests = (source.fixed ?? []).map((fixed): PropertyTest => ({
    name: `fixed history: ${fixed.name}`,
    route: `fixed history`,
    replays: [],
    run: async () => {
      if (!source.arbitrary.canShrinkWithoutContext(fixed.history))
        throw new Error(
          `${id}: fixed history "${fixed.name}" is not a history the arbitrary can generate. A fixed history must stay inside the generated language, or the property must declare the missing dimension as a limit.`,
        )
      const { verdict, reached } = await runOne(options, fixed.history)
      if (verdict.kind === `violation`)
        throw failure(
          options,
          verdict,
          fixed.history,
          rerunByName(`${id} fixed history: ${fixed.name}`),
        )
      const missing = (fixed.enters ?? []).filter(
        (state) => !reached.has(state),
      )
      if (missing.length > 0)
        throw new Error(
          `${id}: fixed history "${fixed.name}" did not enter ${missing.join(`, `)}; it entered ${[...reached].sort().join(`, `) || `no declared state`}. A fixed history must reach every state it names.`,
        )
    },
  }))
  // Fixed histories and the constructed histories of the first fixed seed, so
  // these checks are reproducible; they are built when a test runs, like a
  // campaign's.
  const namedHistories = () => {
    const { examples, constructionOf } = examplesFor(source.fixedSeeds[0] ?? 0)
    return [
      ...(source.fixed ?? []).map(({ name, history }) => ({
        name: `fixed history: ${name}`,
        history,
      })),
      ...examples.map(([history]) => ({
        name: `constructed history: ${constructionOf.get(history)!.name}`,
        history,
      })),
    ]
  }
  // Determinism also covers three generated histories, so a property whose
  // driver varies is caught even without fixed or constructed histories.
  const determinism = determinismTest(options, () => [
    ...namedHistories(),
    ...fc
      .sample(source.arbitrary, { seed: source.fixedSeeds[0] ?? 0, numRuns: 3 })
      .map((history, index) => ({ name: `generated ${index}`, history })),
  ])
  // A calibration also tries a fixed sample of generated histories.
  const calibrations = calibrationTests(options, () => [
    ...namedHistories(),
    ...fc
      .sample(source.arbitrary, {
        seed: source.fixedSeeds[0] ?? 0,
        numRuns: 100,
      })
      .map((history, index) => ({ name: `sample ${index}`, history })),
  ])
  return [
    ...fixedCampaigns,
    randomCampaign,
    ...fixedTests,
    ...calibrations,
    determinism,
  ]
}

// A collect-only run (ORACLE_MANIFEST set) records each registration, so the
// committed manifest can be generated without running any history.
function recordRegistration(
  id: string,
  law: OracleLaw,
  histories: ReadonlyArray<unknown> | { runs: number },
): void {
  const manifest = process.env.ORACLE_MANIFEST
  if (manifest === undefined) return
  appendFileSync(
    manifest,
    `${JSON.stringify({
      id,
      file: relativeTestFile(),
      owner: law.owner,
      authority: law.authority,
      histories: Array.isArray(histories)
        ? histories.length
        : { runs: (histories as { runs: number }).runs },
    })}\n`,
  )
}

// `expect.getState()` names the test file while it is collected and run.
function relativeTestFile(): string {
  return expect.getState().testPath ?? `<test file>`
}
