/**
 * Oracle properties: one constructor for an oracle's law, histories, model,
 * production driver, and check.
 *
 * An oracle file used to assemble these parts by hand: `declareOracle`, a loop
 * of `it` calls, assertions spread through the driver, and its own cleanup and
 * failure text. `oracleProperty` takes the parts and does the mechanics that
 * every oracle shares, so an oracle file holds only the parts that state its
 * law.
 *
 * The parts keep their jobs separate (oracle rubric, ORC-003):
 *
 * - `law` states the promise, its authority, its limits, and its owner in the
 *   coverage map. A failure names it.
 * - `histories` is either an enumerated list, which runs in full (bounded
 *   exhaustiveness, glossary), or a generated source: a fast-check arbitrary
 *   with a run budget, fixed seeds, required segments, and pins (below).
 * - `model` gives the expected result of a history and its recorded trace,
 *   without production. A model that answers from the history alone ignores
 *   the trace; a model of an environment the driver observes reads it
 *   (oracle-framework design, R7).
 * - `driver` runs one history through production and records public
 *   observations with `observe(checkpoint, value)`. It returns nothing, so it
 *   cannot decide a verdict (oracle-framework design, decision D10). A
 *   production error that the law cares about is an observation the driver
 *   records. An error that escapes the driver is a setup error, unless the
 *   trace recorded before it already violates the law: then the violation is
 *   the failure, with the error as its cause, so a later crash cannot hide an
 *   earlier wrong observation. A check therefore judges the recorded
 *   checkpoints first and the trace's completeness last.
 * - `check` compares the observations with the model and returns a verdict.
 *   Only the check can report a violation of the law. A violation that gives
 *   the `actual` and `expected` values gets the test runner's usual diff.
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
 *   `reached(history, trace, expected)` instead. Each lane prints how many
 *   histories entered each declared state, including none (ORC-015).
 * - A **segment** builds a history that reaches states that the laws need,
 *   from a generated history, and names those states. Every lane runs every
 *   segment once as an example, and a segment run that does not enter a named
 *   state fails. Only segments make reach required: a state that random
 *   histories reach is measured, never gated (design, D21). So every state in
 *   `states` must be named by a segment, and a state the property only
 *   measures is declared in `measured` instead (ORC-015). Half of a lane's
 *   generated histories also go through a segment, so the histories after
 *   each required state are explored, not visited once.
 * - A **pin** is a fixed history, such as a regression. It may name the
 *   states it `enters`, which its run must reach. A pin and a segment's
 *   history must be histories the arbitrary could generate
 *   (`canShrinkWithoutContext`), so they shrink like generated ones and cannot
 *   cover a dimension that the grammar lacks (design, R8).
 * - **Resolution.** A history can name its actions indirectly, such as "settle
 *   the second active transaction". `resolve(history)` turns it into the plan
 *   of concrete actions that the driver runs and that the model and check read.
 *   The plan holds actions, never expected observations, so the driver still
 *   decides nothing. A history shrinks before resolution, so every shrunk
 *   history still resolves to a legal plan.
 * - **Calibration.** A `calibration` names a wrong answer and the law that
 *   must reject it: a `corrupt` function that alters a recorded trace, as an
 *   observation mutant does, or a hostile `driver`, such as production set up
 *   wrongly. The calibration test finds a history where the corruption
 *   applies, requires the clean trace to pass, and requires the check to report
 *   that law for the corrupted one (rubric, ORC-006).
 * - **Determinism.** A `determinism` test runs some histories twice and
 *   requires the same trace: every pin and segment history of a generated
 *   source, or up to eight evenly spaced enumerated histories. A trace that
 *   differs between runs of one history breaks replay, shrinking, and the gap
 *   report's comparison, so a driver records relations (before and after,
 *   same or different id) rather than clock readings or random ids.
 * - **Shrinking keeps the failure.** A violation can name the law it broke.
 *   Once a history fails one way, a setup error, a missed segment state, or
 *   one law, a smaller history that fails another way counts as passing, so
 *   the reported counterexample still shows the first failure (ORC-010).
 *
 * The `oracle/no-unit-test` lint rule treats an `oracleProperty` call as an
 * oracle test whose parts are its arguments, when its options are an object
 * literal with a `check`. The property is its own declaration.
 */
import { appendFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config.js'

/** A law and where it comes from. */
export interface OracleLaw {
  /** The promise, stated so that a reader could predict an observation. */
  statement: string
  /** The contract document and section, or the maintainer decision. */
  authority: string
  /** What this property does not establish. */
  limits: string
  /** The coverage-map owner. */
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
 * History checking against allowed cuts (oracle-framework design, form F-E).
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
 * Logical time for drivers (oracle-framework design, form F-F). A driver that
 * must not hang when production never settles a promise waits with
 * `withinTurns(promise, turns)`: it resolves `true` as soon as the promise
 * settles, at the same microtask an `await` would, or `false` after `turns`
 * event-loop turns. The bound counts turns, not milliseconds, so a loaded
 * machine cannot turn a slow but legal settlement into a timeout. It cannot
 * wait for work that production schedules on a delayed timer; a driver for
 * such work controls that timer.
 */
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
      await new Promise((resolve) => setTimeout(resolve, 0))
    return false
  })()
  return Promise.race([done, expiry])
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
export interface Segment<History> {
  name: string
  enters: ReadonlyArray<string>
  build: (generated: History) => History
}

export interface GeneratedHistories<History> {
  arbitrary: fc.Arbitrary<History>
  /**
   * The states the laws depend on (ORC-015). Each must be named by a segment,
   * so every lane reaches it. Each lane reports how many histories entered
   * each one, including none.
   */
  states?: ReadonlyArray<string>
  /**
   * States that are counted but not required. A reached state outside
   * `states` and `measured` fails, so a misspelled state cannot pass unseen.
   */
  measured?: ReadonlyArray<string>
  /** The base run budget of each lane, scaled by the run multiplier. */
  runs: number
  /** One fixed lane per seed, beside the random lane. */
  fixedSeeds: ReadonlyArray<number>
  segments?: ReadonlyArray<Segment<History>>
  pins?: ReadonlyArray<Pin<History>>
}

/** A fixed history, such as a regression, and the states it must enter. */
export interface Pin<History> {
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
      /** A hostile driver, such as production configured wrongly. */
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
  /** Each registered test's limit in milliseconds; 120 seconds by default. */
  timeout?: number
}

declare global {
  // Installed by the gap report's test setup, absent otherwise.
  var __oracleObserve:
    ((checkpoint: string, value: unknown) => void) | undefined
}

/** One test that a property registers. */
interface PropertyTest {
  name: string
  run: () => Promise<void>
  /** Path replays this test runs during; empty stands aside during every one. */
  replays: ReadonlyArray<string>
}

export function oracleProperty<History, Expected, Plan = History>(
  options: OraclePropertyOptions<History, Expected, Plan>,
): void {
  const { id, histories } = options
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
        test.run,
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

/** Runs only the driver, for a history's recorded trace. */
async function recordTrace<Plan>(
  driver: (
    plan: Plan,
    observe: (checkpoint: string, value: unknown) => void,
  ) => Promise<void> | void,
  plan: Plan,
): Promise<Array<Observation>> {
  const observations: Array<Observation> = []
  await driver(plan, (checkpoint, value) => {
    observations.push({ checkpoint, value })
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
  options: OraclePropertyOptions<History, Expected, Plan>,
  histories: () => ReadonlyArray<{ name: string; history: History }>,
): PropertyTest {
  return {
    name: `determinism`,
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
  options: OraclePropertyOptions<History, Expected, Plan>,
  history: History,
  driver: OraclePropertyOptions<
    History,
    Expected,
    Plan
  >[`driver`] = options.driver,
): Promise<{ verdict: Verdict; reached: Set<string> }> {
  const plan = planOf(options, history)
  const { observations, driverError } = await recordGuarded(driver, plan)
  return judge(options, plan, observations, driverError)
}

/** Runs the driver and keeps an error that escapes it beside the trace. */
async function recordGuarded<Plan>(
  driver: (
    plan: Plan,
    observe: (checkpoint: string, value: unknown) => void,
  ) => Promise<void> | void,
  plan: Plan,
): Promise<{
  observations: Array<Observation>
  driverError?: { error: unknown }
}> {
  const observations: Array<Observation> = []
  try {
    await driver(plan, (checkpoint, value) => {
      observations.push({ checkpoint, value })
      globalThis.__oracleObserve?.(checkpoint, value)
    })
  } catch (error) {
    return { observations, driverError: { error } }
  }
  return { observations }
}

/** The model predicts and the check judges a recorded trace. */
function judge<History, Expected, Plan>(
  options: OraclePropertyOptions<History, Expected, Plan>,
  plan: Plan,
  observations: ReadonlyArray<Observation>,
  driverError?: { error: unknown },
): { verdict: Verdict; reached: Set<string> } {
  let expected: Expected
  let verdict: Verdict
  try {
    expected = options.model(plan, observations)
    verdict = options.check(plan, observations, expected)
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
  return { verdict, reached }
}

const lawOf = (verdict: Extract<Verdict, { kind: `violation` }>) =>
  verdict.law ?? verdict.checkpoint

/**
 * One test per calibration. It tries candidate histories in order until the
 * wrong answer applies, and requires the check to report the named law.
 */
function calibrationTests<History, Expected, Plan>(
  options: OraclePropertyOptions<History, Expected, Plan>,
  candidates: () => ReadonlyArray<{ name: string; history: History }>,
): Array<PropertyTest> {
  const { id } = options
  return (options.calibrations ?? []).map((calibration) => ({
    name: `calibration: ${calibration.name}`,
    replays: [],
    run: async () => {
      const seen: Array<string> = []
      for (const { name, history } of candidates()) {
        const plan = planOf(options, history)
        if (`corrupt` in calibration) {
          const { observations, driverError } = await recordGuarded(
            options.driver,
            plan,
          )
          const corrupted = calibration.corrupt(observations, plan)
          if (corrupted === undefined) continue
          // A calibration is meaningful only where the true trace passes.
          const clean = judge(options, plan, observations, driverError).verdict
          if (clean.kind === `violation`)
            throw failure(
              options,
              clean,
              history,
              `the calibration's history "${name}"`,
            )
          const wrong = judge(options, plan, corrupted).verdict
          if (wrong.kind === `violation` && lawOf(wrong) === calibration.law)
            return
          throw new Error(
            `${id}: calibration "${calibration.name}" corrupted the trace of "${name}", but the check ${wrong.kind === `pass` ? `passed it` : `reported law "${lawOf(wrong)}"`}. It must report law "${calibration.law}".`,
          )
        }
        const { verdict } = await runOne(options, history, calibration.driver)
        if (verdict.kind === `pass`) continue
        if (lawOf(verdict) === calibration.law) return
        seen.push(`"${name}" reported law "${lawOf(verdict)}"`)
      }
      throw new Error(
        `${id}: calibration "${calibration.name}" found no history where the check reports law "${calibration.law}"${seen.length ? `; ${seen.slice(0, 3).join(`, `)}` : ``}. Add a pin or segment that reaches the state its wrong answer changes.`,
      )
    },
  }))
}

function failure<History>(
  options: { id: string; law: OracleLaw },
  verdict: Extract<Verdict, { kind: `violation` }>,
  history: History,
  rerun: string,
): OracleViolation {
  const { id, law } = options
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
  options: OraclePropertyOptions<History, Expected, Plan>,
  source: GeneratedHistories<History>,
): Array<PropertyTest> {
  const { id } = options
  const segments = source.segments ?? []
  const declared =
    source.states || source.measured
      ? new Set([...(source.states ?? []), ...(source.measured ?? [])])
      : undefined
  const named = new Set(segments.flatMap((segment) => segment.enters))
  const unsegmented = (source.states ?? []).filter((state) => !named.has(state))
  if (unsegmented.length > 0)
    throw new Error(
      `${id}: no segment enters ${unsegmented.join(`, `)}. A required state needs a segment; a state that is only counted belongs in \`measured\`.`,
    )
  // Generated histories, half of them built by a segment. A built history
  // shrinks through its generated input, as a mapped arbitrary does.
  const arbitrary =
    segments.length === 0
      ? source.arbitrary
      : fc.oneof(
          { arbitrary: source.arbitrary, weight: segments.length },
          ...segments.map((segment) => ({
            arbitrary: source.arbitrary.map(segment.build),
            weight: 1,
          })),
        )
  for (const segment of segments) {
    const undeclared = segment.enters.filter(
      (state) =>
        declared !== undefined && !(source.states ?? []).includes(state),
    )
    if (undeclared.length > 0)
      throw new Error(
        `${id}: segment "${segment.name}" names undeclared states ${undeclared.join(`, `)}.`,
      )
  }

  // Each lane gets a fresh predicate: its first failure fixes the kind that
  // shrinking must keep, a setup error, a missed segment state, or one law. A
  // smaller history that fails some other way counts as passing. It counts
  // the histories that entered each state.
  const predicateFor = (
    segmentOf: Map<History, Segment<History>>,
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
      const segment = segmentOf.get(history)
      if (segment !== undefined) {
        const missing = segment.enters.filter((state) => !reached.has(state))
        if (missing.length > 0) {
          if (!keeps(`segment-reach`)) return
          throw new Error(
            `${id}: segment "${segment.name}" did not enter ${missing.join(`, `)}. A segment must reach every state it names.`,
          )
        }
      }
      if (verdict.kind === `pass`) return
      if (!keeps(`law:${lawOf(verdict)}`)) return
      throw failure(
        options,
        verdict,
        history,
        `TANSTACK_DB_ORACLE_PROPERTY=${id} with the seed and path that fast-check reports`,
      )
    }
  }
  // Each lane runs every segment, built from histories its own seed draws.
  // fast-check passes example inputs by reference, which identifies them.
  const examplesFor = (seed: number) => {
    const segmentOf = new Map<History, Segment<History>>()
    const examples = segments.map((segment, index) => {
      const [generated] = fc.sample(source.arbitrary, {
        seed: seed + index,
        numRuns: 1,
      })
      const history = segment.build(generated!)
      if (!source.arbitrary.canShrinkWithoutContext(history))
        throw new Error(
          `${id}: segment "${segment.name}" built a history the arbitrary cannot generate. A segment must stay inside the generated language so that its failures shrink.`,
        )
      segmentOf.set(history, segment)
      return [history] as [History]
    })
    return { examples, segmentOf }
  }

  // A lane reports its reach counts after it passes; a failing lane reports
  // its counterexample instead.
  const runLane = async (
    name: string,
    seed: number,
    parameters: (examples: Array<[History]>) => Parameters<typeof fc.assert>[1],
  ) => {
    const { examples, segmentOf } = examplesFor(seed)
    const counts = new Map<string, number>(
      [...(declared ?? [])].map((state) => [state, 0]),
    )
    await fc.assert(
      fc.asyncProperty(arbitrary, predicateFor(segmentOf, counts)),
      parameters(examples),
    )
    // Vitest hides console output from a passing test; stdout reaches the log.
    process.stdout.write(
      `${id} ${name} reach ${JSON.stringify(Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1))))}\n`,
    )
  }
  // Examples come on top of a lane's budget, as in `oraclePropertyOptions`.
  const fixedLanes = source.fixedSeeds.map((seed): PropertyTest => ({
    name: `fixed seed ${seed}`,
    replays: [],
    run: () =>
      runLane(`fixed seed ${seed}`, seed, (examples) => ({
        numRuns: oracleRuns(source.runs) + examples.length,
        seed,
        examples,
      })),
  }))
  // The random lane picks its seed itself, so a replay of that seed rebuilds
  // the same segment histories, which the replay path counts.
  const randomLane: PropertyTest = {
    name: `random seed`,
    replays: [id],
    run: () => {
      const seed =
        oraclePropertyOptions(source.runs, id).seed ?? Date.now() % 2 ** 31
      return runLane(`random seed`, seed, (examples) => ({
        ...oraclePropertyOptions(source.runs, id, { examples }),
        seed,
      }))
    },
  }
  const pins = (source.pins ?? []).map((pin): PropertyTest => ({
    name: `pin: ${pin.name}`,
    replays: [],
    run: async () => {
      if (!source.arbitrary.canShrinkWithoutContext(pin.history))
        throw new Error(
          `${id}: pin "${pin.name}" is not a history the arbitrary can generate. A pin must stay inside the generated language, or the property must declare the missing dimension as a limit.`,
        )
      const { verdict, reached } = await runOne(options, pin.history)
      if (verdict.kind === `violation`)
        throw failure(
          options,
          verdict,
          pin.history,
          rerunByName(`${id} pin: ${pin.name}`),
        )
      const missing = (pin.enters ?? []).filter((state) => !reached.has(state))
      if (missing.length > 0)
        throw new Error(
          `${id}: pin "${pin.name}" did not enter ${missing.join(`, `)}. A pin must reach every state it names.`,
        )
    },
  }))
  // Pins and the segment histories of the first fixed seed, so these checks
  // are reproducible; they are built when a test runs, like a lane's.
  const fixedHistories = () => {
    const { examples, segmentOf } = examplesFor(source.fixedSeeds[0] ?? 0)
    return [
      ...(source.pins ?? []).map(({ name, history }) => ({
        name: `pin: ${name}`,
        history,
      })),
      ...examples.map(([history]) => ({
        name: `segment: ${segmentOf.get(history)!.name}`,
        history,
      })),
    ]
  }
  const determinism = determinismTest(options, fixedHistories)
  // A calibration also tries a fixed sample of generated histories.
  const calibrations = calibrationTests(options, () => [
    ...fixedHistories(),
    ...fc
      .sample(source.arbitrary, {
        seed: source.fixedSeeds[0] ?? 0,
        numRuns: 100,
      })
      .map((history, index) => ({ name: `sample ${index}`, history })),
  ])
  return [...fixedLanes, randomLane, ...pins, ...calibrations, determinism]
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
