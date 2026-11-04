/**
 * # The oracleProperty self-oracle
 *
 * `oracleProperty` makes promises to the people who write oracles with it.
 * This oracle checks them the way every other oracle checks production: it
 * writes synthetic properties, runs them under real Vitest in a child
 * process, and compares what Vitest reports with what an independent model
 * predicts. The laws, each judged per test or per probe:
 *
 * - `registration`: a property registers its campaigns, fixed histories, calibrations, and
 *   determinism test, or fails to load when its id is not a registered
 *   oracle property, a required state has no constructed history, or a constructed history names an
 *   undeclared state.
 * - `verdict`: a test fails with a violation of law L exactly when its first
 *   failing history violates L. Within one history a driver error decides
 *   first, then a law violation, then a constructed history that misses its state; a driver error
 *   after a recorded violation becomes that violation's cause.
 * - `shrink`: a campaign's reported failure keeps the kind and law of its first
 *   failure, and its counterexample still has them.
 * - `membership`: a fixed history, or the history a constructed history builds, outside the language fails.
 * - `reach`: a fixed or constructed history that does not enter a state it names fails, and
 *   a passing campaign reports how many of its histories entered each declared
 *   state, whether the property names reach itself or the driver records it.
 * - `calibration`: a calibration uses the first candidate whose clean trace
 *   passes, and passes only when its wrong answer (a corrupted trace or a
 *   mutant driver) fails with the named law.
 * - `determinism`: the determinism test runs every fixed and constructed history
 *   and three generated ones, and fails for a driver whose trace changes.
 * - `timeout`: a property's `timeout` limits every test it registers.
 * - `replay`: replaying a failing campaign's seed and path runs only that
 *   property's random campaign, starts from the counterexample itself, and
 *   reproduces it.
 * - `rerun`: a violation's printed rerun command runs exactly that test.
 * - `seed-log`: a random campaign logs exactly one `ORACLE_SEED` line for its
 *   property, the seed it runs, and no other test logs one; a replay tool
 *   reads that line.
 *
 * Authority: the contract in the header of `oracle-property.ts`; the
 * maintainer decisions of 2026-11-03 on calibration candidates, failure
 * precedence, and determinism scope; and the oracle rubric's replay
 * (ORC-007), calibration (ORC-006), and declared-reach (ORC-015) rules.
 *
 * Limits: synthetic properties with histories of one to three integers, one
 * or two per run. The model learns which histories a test ran from the
 * synthetic driver's log, and relies on fast-check running a campaign's examples
 * (its constructed histories) first, in order. A replay or rerun probe covers
 * every failing campaign but only the first violating fixed or enumerated history of each
 * property. The gap report's observation hook, `forwardCut`, `withinTurns`,
 * and `differs` have no law here.
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { oracleProperty, pass, violation } from './oracle-property.js'
import {
  syntheticArbitrary,
  syntheticIds,
} from './oracle-property-self-oracle-fixture.js'
import type {
  SyntheticHistory,
  SyntheticSpec,
} from './oracle-property-self-oracle-fixture.js'

// ---------------------------------------------------------------------------
// History: a suite of one or two synthetic property drafts
// ---------------------------------------------------------------------------
//
// A draft chooses a generated or enumerated source, how its declared states
// relate to its constructed histories and fixed histories (inside or outside the language),
// whether its driver varies between runs, how it reports reach, whether it is
// slow under a small timeout, and its calibrations.

const allStates = [`saw-0`, `saw-1`, `saw-2`]
const calibrationKinds = [`right`, `wrong-law`, `no-op`, `driver`] as const
type Draft = {
  source:
    | { kind: `generated`; runs: number; seed: number }
    | { kind: `enumerated`; histories: ReadonlyArray<SyntheticHistory> }
  /** `exact` declares the constructed histories' states; the others break registration. */
  statesMode: `exact` | `extra` | `missing`
  constructed: Array<{ prefix: SyntheticHistory; enters: Array<string> }>
  fixed: Array<{ history: SyntheticHistory; enters: Array<string> | null }>
  nondeterministic: boolean
  reachVia: `reached` | `observe`
  /** `slow`: 300 ms per history under a 100 ms timeout. */
  timing: `normal` | `slow`
  calibrations: Array<(typeof calibrationKinds)[number]>
  /** An id no oracle configuration registers. */
  unregistered: boolean
}
type Suite = { drafts: Array<Draft> }

// Outside the synthetic language: an item 5, or four items.
const outside = fc.oneof(
  fc.constantFrom(5).map(
    (item) => [item],
    (value) => {
      if (Array.isArray(value) && value.length === 1 && value[0] === 5) return 5
      throw new Error(`not [5]`)
    },
  ),
  fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 4, maxLength: 4 }),
)
const insideOrOutside = (insideWeight: number) =>
  fc.oneof(
    { arbitrary: syntheticArbitrary, weight: insideWeight },
    { arbitrary: outside, weight: 1 },
  )
const draft: fc.Arbitrary<Draft> = fc.record({
  source: fc.oneof(
    fc.record({
      kind: fc.constant(`generated` as const),
      runs: fc.integer({ min: 2, max: 3 }),
      seed: fc.integer({ min: 1, max: 999 }),
    }),
    fc.record({
      kind: fc.constant(`enumerated` as const),
      histories: fc.uniqueArray(syntheticArbitrary, {
        minLength: 1,
        maxLength: 4,
        selector: (history) => history.join(`,`),
      }),
    }),
  ),
  statesMode: fc.oneof(
    { arbitrary: fc.constant(`exact` as const), weight: 6 },
    {
      arbitrary: fc.constantFrom(`extra` as const, `missing` as const),
      weight: 1,
    },
  ),
  constructed: fc.array(
    fc.record({ prefix: insideOrOutside(6), enters: fc.subarray(allStates) }),
    { maxLength: 2 },
  ),
  fixed: fc.array(
    fc.record({
      history: insideOrOutside(4),
      enters: fc.option(fc.subarray(allStates), { freq: 2 }),
    }),
    { maxLength: 2 },
  ),
  nondeterministic: fc.oneof(
    { arbitrary: fc.constant(false), weight: 4 },
    { arbitrary: fc.constant(true), weight: 1 },
  ),
  reachVia: fc.oneof(
    { arbitrary: fc.constant(`reached` as const), weight: 3 },
    { arbitrary: fc.constant(`observe` as const), weight: 1 },
  ),
  timing: fc.oneof(
    { arbitrary: fc.constant(`normal` as const), weight: 12 },
    { arbitrary: fc.constant(`slow` as const), weight: 1 },
  ),
  calibrations: fc.array(fc.constantFrom(...calibrationKinds), {
    maxLength: 3,
  }),
  // Rare: a property under an id no oracle configuration registers.
  unregistered: fc.oneof(
    { weight: 9, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
})
const suite: fc.Arbitrary<Suite> = fc.record({
  drafts: fc.array(draft, { minLength: 1, maxLength: 2 }),
})

// ---------------------------------------------------------------------------
// Resolution: ids, names, and declared states
// ---------------------------------------------------------------------------
//
// Each draft gets a pooled id, and its constructed histories, fixed histories, and calibrations get
// names. `statesMode` decides the declared states: exactly the states the
// constructed histories enter, one more (a state without a constructed history), or one fewer (a
// constructed history that names an undeclared state). An enumerated draft has no
// constructed or fixed histories.

type Plan = { specs: Array<SyntheticSpec> }

function resolveSuite({ drafts }: Suite): Plan {
  return {
    specs: drafts.map((d, index) => {
      const generated = d.source.kind === `generated`
      const constructed = generated
        ? d.constructed.map((construction, at) => ({
            name: `constructed-${at}`,
            ...construction,
          }))
        : []
      const entered = [
        ...new Set(constructed.flatMap((construction) => construction.enters)),
      ].sort()
      const unused = allStates.filter((state) => !entered.includes(state))
      const states =
        d.statesMode === `extra` && unused.length
          ? [...entered, unused[0]!]
          : d.statesMode === `missing` && entered.length
            ? entered.slice(1)
            : entered
      return {
        id: syntheticIds[index]!,
        source: d.source,
        states,
        constructed,
        fixed: generated
          ? d.fixed.map((fixedHistory, at) => ({
              name: `fixed-${at}`,
              history: fixedHistory.history,
              ...(fixedHistory.enters ? { enters: fixedHistory.enters } : {}),
            }))
          : [],
        nondeterministic: d.nondeterministic,
        reachVia: d.reachVia,
        ...(d.unregistered ? { unregistered: true } : {}),
        ...(d.timing === `slow` ? { slow: true, timeout: 100 } : {}),
        calibrations: d.calibrations.map((kind, at) => ({
          name: `cal-${at}`,
          kind,
        })),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Model: what Vitest should report for each synthetic property
// ---------------------------------------------------------------------------
//
// The synthetic laws are simple enough to state directly: the first 3, 4, or
// 6 in a history decides it (law `three`, law `four`, or a driver error), and
// a history reaches `saw-k` when it holds k. The model reads the synthetic
// driver's log only to learn which histories a test ran; it never reads what
// Vitest reported. From the predicted failures it also owes the probes: a
// replay of every campaign it predicts to fail, and a rerun of each property's
// first predicted violation among its fixed or enumerated histories.

type Kind =
  | `pass`
  | `violation`
  | `setup`
  | `fixed-membership`
  | `constructed-membership`
  | `fixed-reach`
  | `constructed-reach`
  | `determinism`
  | `calibration-passed`
  | `calibration-wrong-law`
  | `calibration-none`
  | `timeout`
type Outcome = {
  kind: Kind
  law?: `three` | `four`
  /** A violation whose driver threw afterwards carries that error. */
  cause?: `driver`
}
type LogEntry = { id: string; test: string; history: SyntheticHistory }

const allowed = (item: number) => [0, 1, 2, 3, 4, 6].includes(item)
const member = (history: SyntheticHistory) =>
  history.length >= 1 && history.length <= 3 && history.every(allowed)
// A constructed history builds its history from its prefix followed by a generated history, cut to
// three items; generated items are always allowed.
const constructedMember = (prefix: SyntheticHistory) =>
  prefix.length >= 1 && prefix.slice(0, 3).every(allowed)
function verdictOf(history: SyntheticHistory): Outcome {
  for (const [at, item] of history.entries()) {
    if (item === 3 || item === 4)
      return {
        kind: `violation`,
        law: item === 3 ? `three` : `four`,
        ...(history.slice(at + 1).includes(6) ? { cause: `driver` } : {}),
      }
    if (item === 6) return { kind: `setup` }
  }
  return { kind: `pass` }
}
const statesOf = (history: SyntheticHistory) =>
  allStates.filter((state) => history.includes(Number(state.slice(4))))
const reaches = (history: SyntheticHistory, states: ReadonlyArray<string>) =>
  states.every((state) => statesOf(history).includes(state))
const label = (history: SyntheticHistory) => `items ${history.join(` | `)}`
const isCampaign = (name: string) =>
  name.startsWith(`fixed seed`) || name === `random seed`

type SpecExpectation =
  | { loads: false }
  | {
      loads: true
      tests: Map<string, Outcome>
      /** Histories a passing determinism test must run, each twice. */
      determinismRuns?: number
      /** For each passing campaign, the histories entering each state. */
      reach: Map<string, Record<string, number>>
      /** Campaigns owed a replay probe, and the test owed a rerun probe. */
      replays: Array<string>
      rerun?: string
    }

function predictSpec(
  spec: SyntheticSpec,
  logged: ReadonlyArray<LogEntry>,
): SpecExpectation {
  const ran = (test: string) =>
    logged
      .filter(
        (entry) =>
          entry.id === spec.id && entry.test === `${spec.id} > ${test}`,
      )
      .map((entry) => entry.history)
  const tests = new Map<string, Outcome>()
  const generated = spec.source.kind === `generated`
  // Every source, enumerated or generated, must name a registered property.
  if (spec.unregistered) return { loads: false }
  if (generated) {
    const declared = new Set(spec.states)
    const entered = new Set(
      spec.constructed.flatMap((construction) => construction.enters),
    )
    if (
      spec.states.some((state) => !entered.has(state)) ||
      [...entered].some((state) => !declared.has(state))
    )
      return { loads: false }
  }
  const names =
    spec.source.kind === `enumerated`
      ? spec.source.histories.map(label)
      : [
          `fixed seed ${spec.source.seed}`,
          `random seed`,
          ...spec.fixed.map(
            (fixedHistory) => `fixed history: ${fixedHistory.name}`,
          ),
        ]
  const all = [
    ...names,
    ...spec.calibrations.map(({ name }) => `calibration: ${name}`),
    `determinism`,
  ]
  // A slow driver outlives the 100 ms limit in every test that runs a
  // history, and every test runs at least one.
  if (spec.slow) {
    for (const name of all) tests.set(name, { kind: `timeout` })
    return { loads: true, tests, reach: new Map(), replays: [] }
  }
  // A calibration needs a candidate whose clean trace passes; it skips the
  // others (maintainer decision, 2026-11-03). Every history has an item, so
  // the corruption applies to every candidate.
  const calibrate = (name: string, kind: (typeof calibrationKinds)[number]) => {
    const used = ran(`calibration: ${name}`).find(
      (history) => verdictOf(history).kind === `pass`,
    )
    if (!used) return { kind: `calibration-none` } as Outcome
    if (kind === `right` || kind === `driver`)
      return { kind: `pass` } as Outcome
    return {
      kind: kind === `no-op` ? `calibration-passed` : `calibration-wrong-law`,
    } as Outcome
  }
  // A generated property's determinism test also runs three generated
  // histories (maintainer decision, 2026-11-03), so a nondeterministic driver
  // fails it even without fixed or constructed histories.
  const determinism = (): Outcome => {
    const histories = ran(`determinism`).filter((_, at) => at % 2 === 0)
    for (const history of histories) {
      if (history.includes(6)) return { kind: `setup` }
      if (spec.nondeterministic) return { kind: `determinism` }
    }
    if (spec.nondeterministic && generated) return { kind: `determinism` }
    return { kind: `pass` }
  }
  // A driver error decides a history first, then a law violation, then a
  // constructed history that misses a state it names (maintainer decision,
  // 2026-11-03). A campaign runs its constructed histories first, in order.
  const campaign = (test: string): Outcome => {
    if (
      spec.constructed.some(
        (construction) => !constructedMember(construction.prefix),
      )
    )
      return { kind: `constructed-membership` }
    for (const [at, history] of ran(test).entries()) {
      const { cause: _shrinkable, ...verdict } = verdictOf(history)
      if (verdict.kind !== `pass`) return verdict
      const construction = spec.constructed[at]
      if (construction && !reaches(history, construction.enters))
        return { kind: `constructed-reach` }
    }
    return { kind: `pass` }
  }
  if (spec.source.kind === `enumerated`)
    for (const history of spec.source.histories)
      tests.set(label(history), verdictOf(history))
  else {
    tests.set(names[0]!, campaign(names[0]!))
    tests.set(`random seed`, campaign(`random seed`))
    for (const fixedHistory of spec.fixed) {
      const verdict = verdictOf(fixedHistory.history)
      tests.set(
        `fixed history: ${fixedHistory.name}`,
        !member(fixedHistory.history)
          ? { kind: `fixed-membership` }
          : verdict.kind !== `pass`
            ? verdict
            : !reaches(fixedHistory.history, fixedHistory.enters ?? [])
              ? { kind: `fixed-reach` }
              : { kind: `pass` },
      )
    }
  }
  for (const { name, kind } of spec.calibrations)
    tests.set(`calibration: ${name}`, calibrate(name, kind))
  tests.set(`determinism`, determinism())
  // The determinism and calibration tests build constructed histories too, so a
  // constructed history outside the language fails them the same way it fails a campaign.
  if (
    spec.constructed.some(
      (construction) => !constructedMember(construction.prefix),
    )
  )
    for (const name of all.filter(
      (name) => name === `determinism` || name.startsWith(`calibration:`),
    ))
      tests.set(name, { kind: `constructed-membership` })
  // A passing campaign counts, for every declared and measured state, the
  // histories it ran that entered it.
  const reach = new Map<string, Record<string, number>>()
  for (const name of names.filter(isCampaign))
    if (tests.get(name)!.kind === `pass`)
      reach.set(
        name,
        Object.fromEntries(
          allStates.map((state) => [
            state,
            ran(name).filter((history) => statesOf(history).includes(state))
              .length,
          ]),
        ),
      )
  // A campaign that fails inside fast-check reports a seed and path to replay; a
  // constructed history outside the language fails before fast-check runs.
  const replays = names.filter(
    (name) =>
      isCampaign(name) &&
      [`violation`, `setup`, `constructed-reach`].includes(
        tests.get(name)!.kind,
      ),
  )
  const rerun = names.find(
    (name) => !isCampaign(name) && tests.get(name)!.kind === `violation`,
  )
  return {
    loads: true,
    tests,
    reach,
    replays,
    ...(rerun ? { rerun } : {}),
    ...(generated
      ? { determinismRuns: spec.fixed.length + spec.constructed.length + 3 }
      : {}),
  }
}

function suiteModel(
  plan: Plan,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
) {
  const run = trace.find(({ checkpoint }) => checkpoint === `run`)?.value as
    SuiteRun | undefined
  const logged = run?.log ?? []
  return new Map(plan.specs.map((spec) => [spec.id, predictSpec(spec, logged)]))
}

// The self-oracle's own reach: states of the framework that its laws are
// about. Each fixed history names the state it witnesses, so every one is reached on
// every run; campaigns count them.
const frameworkStates = [
  `registration-error`,
  `campaign-violation`,
  `campaign-setup-failure`,
  `replay-probe`,
  `rerun-probe`,
  `cause-attached`,
  `constructed-reach-failure`,
  `fixed-reach-failure`,
  `fixed-membership-failure`,
  `constructed-membership-failure`,
  `calibration-applied`,
  `calibration-rejected`,
  `calibration-skipped-candidate`,
  `determinism-caught`,
  `observed-reach`,
  `timeout`,
  `random-campaign`,
] as const

function frameworkReach(
  plan: Plan,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
  expected: ReturnType<typeof suiteModel>,
): Iterable<string> {
  const reached = new Set<string>()
  const run = trace.find(({ checkpoint }) => checkpoint === `run`)?.value as
    SuiteRun | undefined
  for (const spec of plan.specs) {
    const owed = expected.get(spec.id)!
    if (!owed.loads) {
      reached.add(`registration-error`)
      continue
    }
    for (const [name, outcome] of owed.tests) {
      if (isCampaign(name) && outcome.kind === `violation`)
        reached.add(`campaign-violation`)
      if (isCampaign(name) && outcome.kind === `setup`)
        reached.add(`campaign-setup-failure`)
      if (outcome.cause) reached.add(`cause-attached`)
      if (outcome.kind === `timeout`) reached.add(`timeout`)
      if (name === `random seed`) reached.add(`random-campaign`)
      if (outcome.kind === `determinism`) reached.add(`determinism-caught`)
      const failure = {
        'constructed-reach': `constructed-reach-failure`,
        'fixed-reach': `fixed-reach-failure`,
        'fixed-membership': `fixed-membership-failure`,
        'constructed-membership': `constructed-membership-failure`,
        'calibration-passed': `calibration-rejected`,
        'calibration-wrong-law': `calibration-rejected`,
      }[outcome.kind as string]
      if (failure) reached.add(failure)
      if (name.startsWith(`calibration:`) && outcome.kind === `pass`)
        reached.add(`calibration-applied`)
      if (name.startsWith(`calibration:`)) {
        const tried = (run?.log ?? []).filter(
          (entry) =>
            entry.id === spec.id && entry.test === `${spec.id} > ${name}`,
        )
        if (tried.length > 1) reached.add(`calibration-skipped-candidate`)
      }
    }
    if (spec.reachVia === `observe` && owed.reach.size > 0)
      reached.add(`observed-reach`)
  }
  if (trace.some(({ checkpoint }) => checkpoint === `replay`))
    reached.add(`replay-probe`)
  if (trace.some(({ checkpoint }) => checkpoint === `rerun`))
    reached.add(`rerun-probe`)
  return reached
}

// ---------------------------------------------------------------------------
// Production driver: real Vitest in a child process
// ---------------------------------------------------------------------------
//
// The driver writes each spec to its own test file in a fresh directory
// under tests/, runs Vitest once over them with the self-oracle reporter, and
// records each file's load errors, each test's state and failure (with the
// cause fast-check attaches), each passing campaign's printed reach counts, and
// the synthetic driver's log. Then it probes:
// - replay: for every failing campaign with a reported seed and path, Vitest runs
//   all the files again with that replay selected and its own log, which
//   shows the history the replay started from;
// - rerun: for each property's first failure that printed a rerun command,
//   Vitest runs that file with the command's `-t` pattern.
// Child runs fix the random campaign's seed (a seed without a path reseeds the
// campaign and selects no replay), so a child run records the same facts every time.

type ReportedError = { name?: string; message?: string; cause?: ReportedError }
type ReportedTest = {
  name: string
  state: string
  errors: Array<ReportedError>
  console: string
}
type ReportedFile = {
  file: string
  errors: Array<ReportedError>
  tests: Array<ReportedTest>
}
type Report = { files: Array<ReportedFile>; stdout: string }
type Failure = {
  kind: Kind | `other`
  law?: string
  cause?: `driver`
  counterexample?: string
  seed?: number
  path?: string
  rerun?: string
}
type SuiteRun = {
  files: Record<
    string,
    {
      loaded: boolean
      tests: Array<{
        name: string
        state: string
        failure?: Failure
        /** Seeds of the `ORACLE_SEED` lines the test logged for its property. */
        seedLogs: Array<number>
      }>
      reach: Record<string, Record<string, number>>
    }
  >
  log: Array<LogEntry>
}
type ProbeRun = {
  id: string
  /** The probed test: a campaign for replay, a fixed or enumerated history for rerun. */
  target: string
  original: Failure
  /** Each test's state in the probe run, by property id and name. */
  states: Array<[string, string, string]>
  /** The probed test's failure in the probe run. */
  failure?: Failure
  /** Histories the replayed random campaign ran, in order. */
  ran?: Array<SyntheticHistory>
}

const here = dirname(fileURLToPath(import.meta.url))
const packageDirectory = dirname(here)
const vitest = join(
  dirname(createRequire(import.meta.url).resolve(`vitest/package.json`)),
  `vitest.mjs`,
)
let runCount = 0

function classify(error: ReportedError | undefined): Failure {
  if (!error) return { kind: `other` }
  const outer = error.message ?? ``
  // Only fast-check's wrapper carries the framework's failure as its cause;
  // the framework's own errors may carry a driver error as theirs.
  const inner =
    outer.startsWith(`Property failed`) && error.cause ? error.cause : error
  const text = inner.message ?? ``
  const seed = /seed: (-?\d+)/.exec(outer)?.[1]
  const path = /path: "([\d:]+)"/.exec(outer)?.[1]
  const counterexample = /Counterexample: (.*)/.exec(outer)?.[1]
  const rerun = /Rerun: -t ("(?:[^"\\]|\\.)*")/.exec(text)?.[1]
  const law = /\(law: ([^)]+)\)/.exec(text)?.[1]
  const cause =
    inner.name === `OracleViolation` &&
    (inner.cause?.message ?? ``).includes(`synthetic driver failed`)
      ? (`driver` as const)
      : undefined
  const kind: Kind | `other` =
    inner.name === `OracleViolation`
      ? `violation`
      : /timed out in \d+ms/.test(text) || /timed out in \d+ms/.test(outer)
        ? `timeout`
        : text.includes(`is not a history the arbitrary can generate`)
          ? `fixed-membership`
          : text.includes(`built a history the arbitrary cannot generate`)
            ? `constructed-membership`
            : text.includes(`did not enter`) &&
                text.includes(`: fixed history "`)
              ? `fixed-reach`
              : text.includes(`did not enter`) &&
                  text.includes(`: constructed history "`)
                ? `constructed-reach`
                : text.includes(`two runs of`)
                  ? `determinism`
                  : text.includes(`but the check passed it`)
                    ? `calibration-passed`
                    : text.includes(`but the check reported law`)
                      ? `calibration-wrong-law`
                      : text.includes(`found no history`)
                        ? `calibration-none`
                        : text.includes(`synthetic driver failed`)
                          ? `setup`
                          : `other`
  return {
    kind,
    ...(law ? { law } : {}),
    ...(cause ? { cause } : {}),
    ...(seed !== undefined ? { seed: Number(seed) } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(counterexample !== undefined ? { counterexample } : {}),
    ...(rerun !== undefined ? { rerun: JSON.parse(rerun) as string } : {}),
  }
}

function runVitest(
  directory: string,
  files: Array<string>,
  env: Record<string, string>,
  args: Array<string> = [],
): Report {
  const report = join(directory, `report-${runCount++}.json`)
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith(`TANSTACK_DB_ORACLE_`) &&
        !key.startsWith(`ORACLE_GAPS`),
    ),
  )
  const run = spawnSync(
    process.execPath,
    [
      vitest,
      `run`,
      `--coverage.enabled=false`,
      `--typecheck.enabled=false`,
      `--reporter=${join(here, `oracle-property-self-oracle-reporter.mjs`)}`,
      ...args,
      ...files,
    ],
    {
      cwd: packageDirectory,
      env: {
        ...childEnv,
        TANSTACK_DB_ORACLE_SEED: `20251103`,
        ...env,
        SELF_ORACLE_REPORT: report,
      },
      encoding: `utf8`,
      timeout: 240_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (run.error) throw run.error
  if (!existsSync(report))
    throw new Error(
      `the child Vitest run wrote no report:\n${run.stdout}\n${run.stderr}`,
    )
  // The framework prints reach counts straight to stdout, past Vitest's
  // console capture, so they arrive in the child's own output.
  const { files: reported } = JSON.parse(readFileSync(report, `utf8`)) as {
    files: Array<ReportedFile>
  }
  return { files: reported, stdout: run.stdout }
}

const short = (id: string, name: string) => name.replace(`${id} > `, ``)
const readLog = (log: string): Array<LogEntry> =>
  existsSync(log)
    ? readFileSync(log, `utf8`)
        .trim()
        .split(`\n`)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogEntry)
    : []
const statesIn = (report: Report, plan: Plan, files: Array<string>) =>
  plan.specs.flatMap((spec, index) =>
    (report.files.find((file) => file.file === files[index])?.tests ?? []).map(
      (test): [string, string, string] => [
        spec.id,
        short(spec.id, test.name),
        test.state,
      ],
    ),
  )

async function driveSuite(
  plan: Plan,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const directory = join(here, `.self-oracle-${process.pid}-${runCount++}`)
  mkdirSync(directory, { recursive: true })
  try {
    const log = join(directory, `log.jsonl`)
    const files = plan.specs.map((spec, index) => {
      const file = join(directory, `spec-${index}-oracle.test.ts`)
      writeFileSync(
        file,
        `import { syntheticProperty } from '../oracle-property-self-oracle-fixture'\nsyntheticProperty(${JSON.stringify(spec)})\n`,
      )
      return file
    })
    const report = runVitest(directory, files, { SELF_ORACLE_LOG: log })
    const run: SuiteRun = { files: {}, log: readLog(log) }
    for (const [index, spec] of plan.specs.entries()) {
      const reported = report.files.find((file) => file.file === files[index])
      // A passing campaign prints `<id> <campaign> reach {...}`.
      const reach: Record<string, Record<string, number>> = {}
      for (const line of report.stdout.split(`\n`)) {
        const match =
          /^(\S+) (fixed seed -?\d+|random seed) reach (\{.*\})$/.exec(line)
        if (match?.[1] === spec.id)
          reach[match[2]!] = JSON.parse(match[3]!) as Record<string, number>
      }
      run.files[spec.id] = {
        loaded: reported !== undefined && reported.errors.length === 0,
        tests: (reported?.tests ?? []).map((test) => ({
          name: short(spec.id, test.name),
          state: test.state,
          ...(test.state === `failed`
            ? { failure: classify(test.errors[0]) }
            : {}),
          seedLogs: test.console
            .split(`\n`)
            .filter((line) =>
              line.startsWith(
                `ORACLE_SEED {"property":${JSON.stringify(spec.id)},`,
              ),
            )
            .map(
              (line) =>
                (
                  JSON.parse(line.slice(`ORACLE_SEED `.length)) as {
                    seed: number
                  }
                ).seed,
            ),
        })),
        reach,
      }
    }
    observe(`run`, run)
    for (const spec of plan.specs) {
      for (const campaign of run.files[spec.id]!.tests) {
        if (!isCampaign(campaign.name) || campaign.failure?.path === undefined)
          continue
        const replayLog = join(directory, `replay-${runCount}.jsonl`)
        const replay = runVitest(directory, files, {
          TANSTACK_DB_ORACLE_SEED: String(campaign.failure.seed),
          TANSTACK_DB_ORACLE_PATH: campaign.failure.path,
          TANSTACK_DB_ORACLE_PROPERTY: spec.id,
          SELF_ORACLE_LOG: replayLog,
        })
        const index = plan.specs.indexOf(spec)
        const random = replay.files
          .find((file) => file.file === files[index])
          ?.tests.find((test) => test.name.endsWith(`random seed`))
        observe(`replay`, {
          id: spec.id,
          target: campaign.name,
          original: campaign.failure,
          states: statesIn(replay, plan, files),
          ...(random?.state === `failed`
            ? { failure: classify(random.errors[0]) }
            : {}),
          ran: readLog(replayLog)
            .filter((entry) => entry.test === `${spec.id} > random seed`)
            .map((entry) => entry.history),
        } satisfies ProbeRun)
      }
      const target = run.files[spec.id]!.tests.find(
        (test) => test.failure?.rerun !== undefined,
      )
      if (!target) continue
      const index = plan.specs.indexOf(spec)
      const rerun = runVitest(directory, [files[index]!], {}, [
        `-t`,
        target.failure!.rerun!,
      ])
      const ran = rerun.files[0]?.tests.find((test) => test.state === `failed`)
      observe(`rerun`, {
        id: spec.id,
        target: target.name,
        original: target.failure!,
        states: statesIn(rerun, plan, files),
        ...(ran ? { failure: classify(ran.errors[0]) } : {}),
      } satisfies ProbeRun)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
//
// For each property: it loads exactly when the model says so; it registers
// exactly the owed tests; each test passes, or fails with the owed kind, law,
// and cause; a campaign's counterexample still violates the owed law; a passing
// determinism test ran every history it owes; and each passing campaign printed
// the owed reach counts. Then the probes: the replays and reruns the model
// owes all happened; in each, every other test stood aside; the probed test
// failed again the same way; and a replay started from the counterexample
// itself, as a direct replay must, and reported the same one.

const lawOfTest = (name: string) =>
  name.startsWith(`calibration:`)
    ? `calibration`
    : name === `determinism`
      ? `determinism`
      : isCampaign(name)
        ? `shrink`
        : `verdict`
const lawOfKind = (kind: string, name: string) =>
  kind === `timeout`
    ? `timeout`
    : kind.endsWith(`membership`)
      ? `membership`
      : kind.endsWith(`reach`)
        ? `reach`
        : lawOfTest(name)

function checkSuite(
  plan: Plan,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
  expected: ReturnType<typeof suiteModel>,
) {
  const run = trace.find(({ checkpoint }) => checkpoint === `run`)?.value as
    SuiteRun | undefined
  if (!run) return violation(`run`, `the driver recorded no run`, `trace`)
  const probes = trace
    .filter(({ checkpoint }) => checkpoint !== `run`)
    .map(({ checkpoint, value }) => ({
      checkpoint,
      probe: value as ProbeRun,
    }))
  for (const spec of plan.specs) {
    const owed = expected.get(spec.id)!
    const seen = run.files[spec.id]!
    if (!owed.loads) {
      if (seen.loaded)
        return violation(
          `run`,
          `${spec.id} loaded, but its id is unregistered, a required state has no constructed history, or a constructed history names an undeclared state`,
          `registration`,
        )
      continue
    }
    if (!seen.loaded)
      return violation(`run`, `${spec.id} failed to load`, `registration`)
    const names = [...owed.tests.keys()].sort()
    const seenNames = seen.tests.map((test) => test.name).sort()
    if (JSON.stringify(names) !== JSON.stringify(seenNames))
      return violation(
        `run`,
        `${spec.id} registered ${JSON.stringify(seenNames)}, owed ${JSON.stringify(names)}`,
        `registration`,
        { actual: seenNames, expected: names },
      )
    for (const test of seen.tests) {
      const outcome = owed.tests.get(test.name)!
      const failure = test.failure
      const observedKind =
        test.state === `passed` ? `pass` : (failure?.kind ?? `other`)
      if (
        observedKind !== outcome.kind ||
        (outcome.law !== undefined && failure?.law !== outcome.law) ||
        (!isCampaign(test.name) && failure?.cause !== outcome.cause)
      )
        return violation(
          `run`,
          `${spec.id} "${test.name}" ${test.state} as ${JSON.stringify(failure ?? null)}, owed ${JSON.stringify(outcome)}`,
          lawOfKind(
            outcome.kind === `pass` ? observedKind : outcome.kind,
            test.name,
          ),
          { actual: failure ?? { kind: `pass` }, expected: outcome },
        )
      // A random campaign selects its seed once and logs that selection once;
      // a failing campaign's reported seed is the logged one.
      const owedSeedLogs = test.name === `random seed` ? 1 : 0
      if (test.seedLogs.length !== owedSeedLogs)
        return violation(
          `run`,
          `${spec.id} "${test.name}" logged ${test.seedLogs.length} ORACLE_SEED lines, owed ${owedSeedLogs}`,
          `seed-log`,
          { actual: test.seedLogs, expected: owedSeedLogs },
        )
      if (
        failure?.seed !== undefined &&
        test.name === `random seed` &&
        test.seedLogs[0] !== failure.seed
      )
        return violation(
          `run`,
          `${spec.id} "${test.name}" logged seed ${test.seedLogs[0]} but ran seed ${failure.seed}`,
          `seed-log`,
          { actual: failure.seed, expected: test.seedLogs[0] },
        )
      if (
        test.name === `determinism` &&
        test.state === `passed` &&
        owed.determinismRuns !== undefined
      ) {
        const runs = run.log.filter(
          (entry) =>
            entry.id === spec.id && entry.test === `${spec.id} > determinism`,
        ).length
        if (runs !== 2 * owed.determinismRuns)
          return violation(
            `run`,
            `${spec.id} determinism ran ${runs / 2} histories, owed ${owed.determinismRuns}`,
            `determinism`,
          )
      }
      if (failure?.counterexample && outcome.law) {
        const shrunk = JSON.parse(failure.counterexample) as [SyntheticHistory]
        if (verdictOf(shrunk[0]).law !== outcome.law)
          return violation(
            `run`,
            `${spec.id} "${test.name}" reported counterexample ${failure.counterexample}, which does not violate law ${outcome.law}`,
            `shrink`,
          )
      }
    }
    for (const [campaign, counts] of owed.reach)
      if (JSON.stringify(seen.reach[campaign]) !== JSON.stringify(counts))
        return violation(
          `run`,
          `${spec.id} "${campaign}" printed reach ${JSON.stringify(seen.reach[campaign] ?? null)}, owed ${JSON.stringify(counts)}`,
          `reach`,
          { actual: seen.reach[campaign], expected: counts },
        )
    for (const campaign of owed.replays)
      if (
        !probes.some(
          ({ checkpoint, probe }) =>
            checkpoint === `replay` &&
            probe.id === spec.id &&
            probe.target === campaign,
        )
      )
        return violation(
          `replay`,
          `${spec.id} "${campaign}" failed but was never replayed`,
          `replay`,
        )
    if (
      owed.rerun &&
      !probes.some(
        ({ checkpoint, probe }) =>
          checkpoint === `rerun` && probe.id === spec.id,
      )
    )
      return violation(
        `rerun`,
        `${spec.id} "${owed.rerun}" printed no rerun command`,
        `rerun`,
      )
  }
  for (const { checkpoint, probe } of probes) {
    const probed = checkpoint === `replay` ? `random seed` : probe.target
    const others = probe.states.filter(
      ([id, name]) => !(id === probe.id && name === probed),
    )
    if (others.some(([, , state]) => state !== `skipped`))
      return violation(
        checkpoint,
        `${probe.id} ${checkpoint} of "${probe.target}": other tests ran: ${JSON.stringify(others.filter(([, , state]) => state !== `skipped`))}`,
        checkpoint,
      )
    if (!probe.failure)
      return violation(
        checkpoint,
        `${probe.id} ${checkpoint} of "${probe.target}": "${probed}" did not fail again`,
        checkpoint,
      )
    if (
      probe.failure.kind !== probe.original.kind ||
      probe.failure.law !== probe.original.law
    )
      return violation(
        checkpoint,
        `${probe.id}: reproduced ${JSON.stringify(probe.failure)}, first failure ${JSON.stringify(probe.original)}`,
        checkpoint,
      )
    if (checkpoint !== `replay`) continue
    if (probe.failure.counterexample !== probe.original.counterexample)
      return violation(
        checkpoint,
        `${probe.id}: replay counterexample ${probe.failure.counterexample}, "${probe.target}" ${probe.original.counterexample}`,
        `replay`,
      )
    // fast-check walks the recorded path through the shrink tree without
    // running the property, so a direct replay runs the counterexample first.
    const counterexample = (
      JSON.parse(probe.original.counterexample!) as [SyntheticHistory]
    )[0]
    if (JSON.stringify(probe.ran?.[0]) !== JSON.stringify(counterexample))
      return violation(
        checkpoint,
        `${probe.id}: the replay first ran ${JSON.stringify(probe.ran?.[0] ?? null)}, not the counterexample ${JSON.stringify(counterexample)}`,
        `replay`,
      )
  }
  return pass
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------
//
// Fixed histories replay the regressions the framework has had and witness every
// framework state the laws are about; each names the state it witnesses.

const generatedDraft = (overrides: Partial<Draft>): Draft => ({
  source: { kind: `generated`, runs: 2, seed: 7 },
  statesMode: `exact`,
  constructed: [],
  fixed: [],
  nondeterministic: false,
  reachVia: `reached`,
  timing: `normal`,
  calibrations: [],
  unregistered: false,
  ...overrides,
})
const fixedHistory = (
  name: string,
  enters: Array<(typeof frameworkStates)[number]>,
  ...drafts: Array<Draft>
) => ({ name, enters, history: { drafts } })
const at = (history: SyntheticHistory) => ({ history, enters: null })

oracleProperty({
  id: `self-oracle.framework`,
  law: {
    statement: `oracleProperty registers, fails, shrinks, replays, reruns, calibrates, times out, and checks determinism, membership, and reach as its contract states.`,
    authority: `packages/db/tests/oracle-property.ts header; maintainer decisions of 2026-11-03; oracle rubric ORC-006, ORC-007, ORC-015`,
    limits: `Synthetic properties with histories of one to three integers, one or two per run; real Vitest child processes; one rerun probe per property.`,
    owner: `oracleProperty framework`,
  },
  histories: {
    arbitrary: suite,
    states: [],
    measured: frameworkStates,
    runs: 3,
    fixedSeeds: [1],
    fixed: [
      fixedHistory(`a rerun command escapes a label with |`, [`rerun-probe`], {
        ...generatedDraft({}),
        source: {
          kind: `enumerated`,
          histories: [
            [3, 1],
            [3, 2],
          ],
        },
      }),
      fixedHistory(
        `a driver error after a violation is the violation's cause`,
        [`cause-attached`],
        generatedDraft({ fixed: [at([3, 6])] }),
      ),
      fixedHistory(
        `shrinking keeps the first failure's law`,
        [`campaign-violation`, `replay-probe`],
        generatedDraft({ constructed: [{ prefix: [4, 3], enters: [] }] }),
      ),
      fixedHistory(
        `a replayed campaign failure reproduces its path`,
        [`replay-probe`],
        generatedDraft({
          constructed: [{ prefix: [1, 3], enters: [`saw-1`] }],
        }),
      ),
      fixedHistory(
        `shrinking keeps a setup error a setup error`,
        [`campaign-setup-failure`],
        generatedDraft({ constructed: [{ prefix: [6], enters: [] }] }),
      ),
      fixedHistory(
        `the determinism test rejects a nondeterministic driver`,
        [`determinism-caught`],
        generatedDraft({ nondeterministic: true, fixed: [at([0])] }),
      ),
      fixedHistory(
        `the determinism test also samples generated histories`,
        [`determinism-caught`],
        generatedDraft({ nondeterministic: true }),
      ),
      fixedHistory(
        `a required state needs a constructed history`,
        [`registration-error`],
        generatedDraft({
          statesMode: `extra`,
          constructed: [{ prefix: [0], enters: [`saw-0`] }],
        }),
      ),
      // An enumerated source has no random campaign, which is where an id was
      // checked before; registration itself must check it.
      fixedHistory(
        `an unregistered enumerated property fails to load`,
        [`registration-error`],
        {
          ...generatedDraft({}),
          source: { kind: `enumerated`, histories: [[0], [1]] },
          unregistered: true,
        },
      ),
      fixedHistory(
        `a calibration skips a candidate whose clean trace fails`,
        [`calibration-skipped-candidate`, `calibration-applied`],
        generatedDraft({ fixed: [at([3]), at([0])], calibrations: [`right`] }),
      ),
      fixedHistory(
        `calibrations need the named law`,
        [`calibration-applied`, `calibration-rejected`],
        generatedDraft({
          fixed: [at([0])],
          calibrations: [`right`, `wrong-law`, `no-op`],
        }),
      ),
      fixedHistory(
        `a mutant driver calibration`,
        [`calibration-applied`],
        generatedDraft({ fixed: [at([0])], calibrations: [`driver`] }),
      ),
      fixedHistory(
        `a law violation outranks a constructed history that misses its state`,
        [`campaign-violation`],
        generatedDraft({
          constructed: [{ prefix: [3, 0, 0], enters: [`saw-1`] }],
        }),
      ),
      fixedHistory(
        `a constructed history must enter the states it names`,
        [`constructed-reach-failure`],
        generatedDraft({
          constructed: [{ prefix: [0, 0, 0], enters: [`saw-1`] }],
        }),
      ),
      fixedHistory(
        `a fixed history must enter the states it names`,
        [`fixed-reach-failure`],
        generatedDraft({ fixed: [{ history: [0], enters: [`saw-1`] }] }),
      ),
      fixedHistory(
        `a fixed history outside the language fails`,
        [`fixed-membership-failure`],
        generatedDraft({ fixed: [at([5])] }),
      ),
      fixedHistory(
        `a constructed history outside the language fails`,
        [`constructed-membership-failure`],
        generatedDraft({ constructed: [{ prefix: [5], enters: [] }] }),
      ),
      fixedHistory(
        `reach the driver records counts like reach the property names`,
        [`observed-reach`],
        generatedDraft({
          reachVia: `observe`,
          constructed: [{ prefix: [0, 0, 0], enters: [`saw-0`] }],
        }),
      ),
      fixedHistory(
        `a property timeout limits every test it registers`,
        [`timeout`],
        generatedDraft({ timing: `slow`, fixed: [at([0])] }),
      ),
    ],
  },
  resolve: resolveSuite,
  model: suiteModel,
  reached: frameworkReach,
  driver: driveSuite,
  check: checkSuite,
  // Each history spawns one to five child Vitest runs.
  timeout: 600_000,
})
