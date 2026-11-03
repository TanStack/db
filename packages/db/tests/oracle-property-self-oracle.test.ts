/**
 * # The oracleProperty self-oracle
 *
 * `oracleProperty` makes promises to the people who write oracles with it.
 * This oracle checks them the way every other oracle checks production: it
 * writes synthetic properties, runs them under real Vitest in a child
 * process, and compares what Vitest reports with what an independent model
 * predicts. The laws, each judged per test:
 *
 * - `registration`: a property registers its lanes, pins, calibrations, and
 *   determinism test, or fails to load when a required state has no segment
 *   or a segment names an undeclared state.
 * - `verdict`: a test fails with a violation of law L exactly when its first
 *   failing history violates L; a driver error fails it as a setup error
 *   unless a recorded item already violated a law, which then wins.
 * - `shrink`: a lane's reported failure keeps the kind and law of its first
 *   failure, and its counterexample still has them.
 * - `membership` and `reach`: a pin or segment outside the language fails,
 *   and a pin or segment that does not enter a state it names fails.
 * - `calibration`: a calibration passes only when its candidate's clean trace
 *   passes and the corrupted one fails with the named law.
 * - `determinism`: the determinism test fails for a driver whose trace
 *   changes between runs of one history, and passes otherwise.
 * - `replay`: replaying a fixed lane's reported seed and path runs only the
 *   random lane of that property and reproduces the same counterexample.
 * - `rerun`: a failure's printed rerun command runs exactly that test.
 *
 * Authority: the contract in the header of `oracle-property.ts`, and the
 * oracle rubric's replay (ORC-007), calibration (ORC-006), and declared-reach
 * (ORC-015) rules.
 *
 * Limits: synthetic properties only, with histories of one to three
 * integers; one or two properties per run; the model predicts which histories
 * a lane fails on from the histories the synthetic driver logged, not the
 * order fast-check draws them in.
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

const allStates = [`saw-0`, `saw-1`, `saw-2`]
const calibrationKinds = [`right`, `wrong-law`, `no-op`] as const
type Draft = {
  source:
    | { kind: `generated`; runs: number; seed: number }
    | { kind: `enumerated`; histories: ReadonlyArray<SyntheticHistory> }
  /** `exact` declares the segments' states; the others break registration. */
  statesMode: `exact` | `extra` | `missing`
  segments: Array<{ prefix: SyntheticHistory; enters: Array<string> }>
  pins: Array<{ history: SyntheticHistory; enters: Array<string> | null }>
  nondeterministic: boolean
  calibrations: Array<(typeof calibrationKinds)[number]>
}
type Suite = { drafts: Array<Draft> }

// A pin may lie outside the synthetic language: an item 5, or four items.
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
  segments: fc.array(
    fc.record({
      prefix: syntheticArbitrary,
      enters: fc.subarray(allStates),
    }),
    { maxLength: 2 },
  ),
  pins: fc.array(
    fc.record({
      history: fc.oneof(
        {
          arbitrary: syntheticArbitrary,
          weight: 4,
        },
        { arbitrary: outside, weight: 1 },
      ),
      enters: fc.option(fc.subarray(allStates), { freq: 2 }),
    }),
    { maxLength: 2 },
  ),
  nondeterministic: fc.oneof(
    { arbitrary: fc.constant(false), weight: 4 },
    { arbitrary: fc.constant(true), weight: 1 },
  ),
  calibrations: fc.array(fc.constantFrom(...calibrationKinds), {
    maxLength: 3,
  }),
})
const suite: fc.Arbitrary<Suite> = fc.record({
  drafts: fc.array(draft, { minLength: 1, maxLength: 2 }),
})

// ---------------------------------------------------------------------------
// Resolution: ids, names, and declared states
// ---------------------------------------------------------------------------
//
// Each draft gets a pooled id, and its segments, pins, and calibrations get
// names. `statesMode` decides the declared states: exactly the states the
// segments enter, one more (a state without a segment), or one fewer (a
// segment that names an undeclared state). An enumerated draft has no
// segments or pins.

type Plan = { specs: Array<SyntheticSpec> }

function resolveSuite({ drafts }: Suite): Plan {
  return {
    specs: drafts.map((d, index) => {
      const generated = d.source.kind === `generated`
      const segments = generated
        ? d.segments.map((segment, at) => ({ name: `seg-${at}`, ...segment }))
        : []
      const entered = [
        ...new Set(segments.flatMap((segment) => segment.enters)),
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
        segments,
        pins: generated
          ? d.pins.map((pin, at) => ({
              name: `pin-${at}`,
              history: pin.history,
              ...(pin.enters ? { enters: pin.enters } : {}),
            }))
          : [],
        nondeterministic: d.nondeterministic,
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
// a history reaches `saw-k` when it holds k. The model reads the histories
// the synthetic driver logged for a test only to learn which histories that
// test ran; it never reads what Vitest reported.

type Kind =
  | `pass`
  | `violation`
  | `setup`
  | `pin-membership`
  | `segment-membership`
  | `pin-reach`
  | `segment-reach`
  | `determinism`
  | `calibration-passed`
  | `calibration-wrong-law`
  | `calibration-none`
type Outcome = { kind: Kind; law?: `three` | `four` }
type LogEntry = { id: string; test: string; history: SyntheticHistory }

const member = (history: SyntheticHistory) =>
  history.length >= 1 &&
  history.length <= 3 &&
  history.every((item) => [0, 1, 2, 3, 4, 6].includes(item))
function verdictOf(history: SyntheticHistory): Outcome {
  for (const item of history) {
    if (item === 3) return { kind: `violation`, law: `three` }
    if (item === 4) return { kind: `violation`, law: `four` }
    if (item === 6) return { kind: `setup` }
  }
  return { kind: `pass` }
}
const reaches = (history: SyntheticHistory, states: ReadonlyArray<string>) =>
  states.every((state) => history.includes(Number(state.slice(4))))
const label = (history: SyntheticHistory) => `items ${history.join(` | `)}`

type SpecExpectation =
  | { loads: false }
  | {
      loads: true
      tests: Map<string, Outcome>
      /** Histories a passing determinism test must run, each twice. */
      determinismRuns?: number
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
  // A calibration needs a candidate whose clean trace passes; it skips the
  // others (maintainer decision, 2026-11-03). Every history has an item, so
  // the corruption applies to every candidate.
  const calibrate = (name: string, kind: (typeof calibrationKinds)[number]) => {
    const used = ran(`calibration: ${name}`).find(
      (history) => verdictOf(history).kind === `pass`,
    )
    if (!used) return { kind: `calibration-none` } as Outcome
    if (kind === `right`) return { kind: `pass` } as Outcome
    return {
      kind: kind === `no-op` ? `calibration-passed` : `calibration-wrong-law`,
    } as Outcome
  }
  // The determinism test runs each of its histories twice, in order; the
  // log names them, including segment histories built from generated ones.
  // A generated property's determinism test also runs three generated
  // histories (maintainer decision, 2026-11-03), so a nondeterministic driver
  // fails it even without pins or segments.
  const determinism = (): Outcome => {
    const histories = ran(`determinism`).filter((_, at) => at % 2 === 0)
    for (const history of histories) {
      if (history.includes(6)) return { kind: `setup` }
      if (spec.nondeterministic) return { kind: `determinism` }
    }
    if (spec.nondeterministic && spec.source.kind === `generated`)
      return { kind: `determinism` }
    return { kind: `pass` }
  }
  if (spec.source.kind === `enumerated`) {
    const { histories } = spec.source
    for (const history of histories)
      tests.set(label(history), verdictOf(history))
    for (const { name, kind } of spec.calibrations)
      tests.set(`calibration: ${name}`, calibrate(name, kind))
    tests.set(`determinism`, determinism())
    return { loads: true, tests }
  }
  const declared = new Set(spec.states)
  const entered = new Set(spec.segments.flatMap((segment) => segment.enters))
  if (
    spec.states.some((state) => !entered.has(state)) ||
    [...entered].some((state) => !declared.has(state))
  )
    return { loads: false }
  const lane = (test: string): Outcome => {
    if (spec.segments.some((segment) => !member(segment.prefix)))
      return { kind: `segment-membership` }
    // A driver error decides a history first, then a law violation, then a
    // missed segment state: a violation outranks a reach failure (maintainer
    // decision, 2026-11-03).
    for (const [at, history] of ran(test).entries()) {
      const verdict = verdictOf(history)
      if (verdict.kind !== `pass`) return verdict
      const segment = spec.segments[at]
      if (
        at < spec.segments.length &&
        segment &&
        !reaches(history, segment.enters)
      )
        return { kind: `segment-reach` }
    }
    return { kind: `pass` }
  }
  tests.set(
    `fixed seed ${spec.source.seed}`,
    lane(`fixed seed ${spec.source.seed}`),
  )
  tests.set(`random seed`, lane(`random seed`))
  for (const pin of spec.pins) {
    const verdict = verdictOf(pin.history)
    tests.set(
      `pin: ${pin.name}`,
      !member(pin.history)
        ? { kind: `pin-membership` }
        : verdict.kind !== `pass`
          ? verdict
          : !reaches(pin.history, pin.enters ?? [])
            ? { kind: `pin-reach` }
            : { kind: `pass` },
    )
  }
  for (const { name, kind } of spec.calibrations)
    tests.set(`calibration: ${name}`, calibrate(name, kind))
  tests.set(`determinism`, determinism())
  return {
    loads: true,
    tests,
    determinismRuns: spec.pins.length + spec.segments.length + 3,
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

// ---------------------------------------------------------------------------
// Production driver: real Vitest in a child process
// ---------------------------------------------------------------------------
//
// The driver writes each spec to its own test file in a fresh directory
// under tests/, runs Vitest once over them with the self-oracle reporter, and
// records each file's load errors and each test's state and failure. It then
// probes replay (one failing fixed lane's seed and path) and rerun (one
// failing test's printed `-t` command), and records what ran.

type ReportedError = { name?: string; message?: string; cause?: ReportedError }
type ReportedTest = {
  name: string
  state: string
  errors: Array<ReportedError>
}
type ReportedFile = {
  file: string
  errors: Array<ReportedError>
  tests: Array<ReportedTest>
}
type SuiteRun = {
  files: Record<
    string,
    {
      loaded: boolean
      tests: Array<{ name: string; state: string; failure?: Failure }>
    }
  >
  log: Array<LogEntry>
}
type Failure = {
  kind: Kind | `other`
  law?: string
  counterexample?: string
  seed?: number
  path?: string
  rerun?: string
}
type ProbeRun = {
  id: string
  /** Each test's state in the probe run, by name without the property prefix. */
  states: Record<string, string>
  failure?: Failure
  /** The probe target's failure in the first run. */
  target: string
  original?: Failure
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
  // fast-check reports a property failure and attaches the property's error
  // as its cause; the cause carries the framework's own failure.
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
  const facts = {
    ...(seed !== undefined ? { seed: Number(seed) } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(counterexample !== undefined ? { counterexample } : {}),
    ...(rerun !== undefined ? { rerun: JSON.parse(rerun) as string } : {}),
  }
  const law = /\(law: ([^)]+)\)/.exec(text)?.[1]
  const kind: Kind | `other` =
    inner.name === `OracleViolation`
      ? `violation`
      : text.includes(`is not a history the arbitrary can generate`)
        ? `pin-membership`
        : text.includes(`built a history the arbitrary cannot generate`)
          ? `segment-membership`
          : text.includes(`did not enter`) && text.includes(`: pin "`)
            ? `pin-reach`
            : text.includes(`did not enter`) && text.includes(`: segment "`)
              ? `segment-reach`
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
  return { kind, ...(law ? { law } : {}), ...facts }
}

function runVitest(
  directory: string,
  files: Array<string>,
  env: Record<string, string>,
  args: Array<string> = [],
) {
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
      // A seed without a path selects no replay; it only fixes the random
      // lane's seed, so a child run records the same facts every time.
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
  return JSON.parse(readFileSync(report, `utf8`)) as {
    files: Array<ReportedFile>
  }
}

const short = (id: string, name: string) => name.replace(`${id} > `, ``)

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
    const logged: Array<LogEntry> = existsSync(log)
      ? readFileSync(log, `utf8`)
          .trim()
          .split(`\n`)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as LogEntry)
      : []
    const run: SuiteRun = { files: {}, log: logged }
    for (const [index, spec] of plan.specs.entries()) {
      const reported = report.files.find((file) => file.file === files[index])
      run.files[spec.id] = {
        loaded: reported !== undefined && reported.errors.length === 0,
        tests: (reported?.tests ?? []).map((test) => ({
          name: short(spec.id, test.name),
          state: test.state,
          ...(test.state === `failed`
            ? { failure: classify(test.errors[0]) }
            : {}),
        })),
      }
    }
    observe(`run`, run)
    // Replay: the first failing fixed lane that reported a seed and path.
    for (const [index, spec] of plan.specs.entries()) {
      const lane = run.files[spec.id]!.tests.find(
        (test) =>
          test.name.startsWith(`fixed seed`) &&
          test.failure?.path !== undefined,
      )
      if (!lane) continue
      const replay = runVitest(directory, [files[index]!], {
        TANSTACK_DB_ORACLE_SEED: String(lane.failure!.seed),
        TANSTACK_DB_ORACLE_PATH: lane.failure!.path!,
        TANSTACK_DB_ORACLE_PROPERTY: spec.id,
      }).files[0]
      const states = Object.fromEntries(
        (replay?.tests ?? []).map((test) => [
          short(spec.id, test.name),
          test.state,
        ]),
      )
      const random = replay?.tests.find((test) =>
        test.name.endsWith(`random seed`),
      )
      const probe: ProbeRun = {
        id: spec.id,
        states,
        target: lane.name,
        original: lane.failure,
        ...(random?.state === `failed`
          ? { failure: classify(random.errors[0]) }
          : {}),
      }
      observe(`replay`, probe)
      break
    }
    // Rerun: the first failing pin or enumerated history with a rerun command.
    for (const [index, spec] of plan.specs.entries()) {
      const target = run.files[spec.id]!.tests.find(
        (test) => test.failure?.rerun !== undefined,
      )
      if (!target) continue
      const pattern = target.failure!.rerun!
      const rerun = runVitest(directory, [files[index]!], {}, [`-t`, pattern])
        .files[0]
      const states = Object.fromEntries(
        (rerun?.tests ?? []).map((test) => [
          short(spec.id, test.name),
          test.state,
        ]),
      )
      const ran = rerun?.tests.find((test) => test.state === `failed`)
      const probe: ProbeRun = {
        id: spec.id,
        states,
        target: target.name,
        original: target.failure,
        ...(ran ? { failure: classify(ran.errors[0]) } : {}),
      }
      observe(`rerun`, probe)
      break
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

const lawOfTest = (name: string) =>
  name.startsWith(`calibration:`)
    ? `calibration`
    : name === `determinism`
      ? `determinism`
      : `verdict`

function checkSuite(
  plan: Plan,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
  expected: ReturnType<typeof suiteModel>,
) {
  const run = trace.find(({ checkpoint }) => checkpoint === `run`)?.value as
    SuiteRun | undefined
  if (!run) return violation(`run`, `the driver recorded no run`, `trace`)
  for (const spec of plan.specs) {
    const owed = expected.get(spec.id)!
    const seen = run.files[spec.id]!
    if (!owed.loads) {
      if (seen.loaded)
        return violation(
          `run`,
          `${spec.id} loaded, but a required state has no segment or a segment names an undeclared state`,
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
        (outcome.law !== undefined && failure?.law !== outcome.law)
      )
        return violation(
          `run`,
          `${spec.id} "${test.name}" ${test.state} as ${JSON.stringify(failure ?? null)}, owed ${JSON.stringify(outcome)}`,
          test.name.startsWith(`fixed seed`) || test.name === `random seed`
            ? `shrink`
            : lawOfTest(test.name),
          { actual: failure ?? { kind: `pass` }, expected: outcome },
        )
      // A passing determinism test ran every history it owes.
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
      // A lane's counterexample keeps the first failure's law.
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
  }
  for (const { checkpoint, value } of trace) {
    if (checkpoint !== `replay` && checkpoint !== `rerun`) continue
    const probe = value as ProbeRun
    const others = Object.entries(probe.states).filter(([name]) =>
      checkpoint === `replay` ? name !== `random seed` : name !== probe.target,
    )
    if (others.some(([, state]) => state !== `skipped`))
      return violation(
        checkpoint,
        `${probe.id}: other tests ran: ${JSON.stringify(Object.fromEntries(others))}`,
        checkpoint,
      )
    if (!probe.failure)
      return violation(
        checkpoint,
        `${probe.id}: "${checkpoint === `replay` ? `random seed` : probe.target}" did not fail again: ${JSON.stringify(probe.states)}`,
        checkpoint,
      )
    if (
      probe.failure.kind !== probe.original?.kind ||
      probe.failure.law !== probe.original.law
    )
      return violation(
        checkpoint,
        `${probe.id}: reproduced ${JSON.stringify(probe.failure)}, first failure ${JSON.stringify(probe.original)}`,
        checkpoint,
      )
    if (
      checkpoint === `replay` &&
      probe.failure.counterexample !== probe.original.counterexample
    )
      return violation(
        checkpoint,
        `${probe.id}: replay counterexample ${probe.failure.counterexample}, fixed lane ${probe.original.counterexample}`,
        `replay`,
      )
  }
  return pass
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

const generatedDraft = (overrides: Partial<Draft>): Draft => ({
  source: { kind: `generated`, runs: 2, seed: 7 },
  statesMode: `exact`,
  segments: [],
  pins: [],
  nondeterministic: false,
  calibrations: [],
  ...overrides,
})

oracleProperty({
  id: `self-oracle.framework`,
  law: {
    statement: `oracleProperty registers, fails, shrinks, replays, reruns, calibrates, and checks determinism and reach as its contract states.`,
    authority: `packages/db/tests/oracle-property.ts header; oracle rubric ORC-006, ORC-007, ORC-015`,
    limits: `Synthetic properties with histories of one to three integers, one or two per run; real Vitest child processes.`,
    owner: `oracleProperty framework`,
  },
  histories: {
    arbitrary: suite,
    states: [],
    runs: 3,
    fixedSeeds: [1],
    pins: [
      {
        name: `a rerun command escapes a label with |`,
        history: {
          drafts: [
            {
              ...generatedDraft({}),
              source: { kind: `enumerated`, histories: [[3, 1]] },
            },
          ],
        },
      },
      {
        name: `a driver error after a violation reports the violation`,
        history: {
          drafts: [
            generatedDraft({ pins: [{ history: [3, 6], enters: null }] }),
          ],
        },
      },
      {
        name: `shrinking keeps the first failure's law`,
        history: {
          drafts: [
            generatedDraft({ segments: [{ prefix: [4, 3], enters: [] }] }),
          ],
        },
      },
      {
        name: `a replayed fixed-lane failure reproduces in the random lane`,
        history: {
          drafts: [
            generatedDraft({
              segments: [{ prefix: [1, 3], enters: [`saw-1`] }],
            }),
          ],
        },
      },
      {
        name: `shrinking keeps a setup error a setup error`,
        history: {
          drafts: [generatedDraft({ segments: [{ prefix: [6], enters: [] }] })],
        },
      },
      {
        name: `the determinism test rejects a nondeterministic driver`,
        history: {
          drafts: [
            generatedDraft({
              nondeterministic: true,
              pins: [{ history: [0], enters: null }],
            }),
          ],
        },
      },
      {
        name: `a required state needs a segment`,
        history: {
          drafts: [
            generatedDraft({
              statesMode: `extra`,
              segments: [{ prefix: [0], enters: [`saw-0`] }],
            }),
          ],
        },
      },
      {
        name: `a calibration skips a candidate whose clean trace fails`,
        history: {
          drafts: [
            generatedDraft({
              pins: [
                { history: [3], enters: null },
                { history: [0], enters: null },
              ],
              calibrations: [`right`],
            }),
          ],
        },
      },
      {
        name: `a law violation outranks a missed segment state`,
        history: {
          drafts: [
            generatedDraft({
              segments: [{ prefix: [3, 0, 0], enters: [`saw-1`] }],
            }),
          ],
        },
      },
      {
        name: `the determinism test also samples generated histories`,
        history: { drafts: [generatedDraft({ nondeterministic: true })] },
      },
      {
        name: `calibrations need the named law`,
        history: {
          drafts: [
            generatedDraft({
              pins: [{ history: [0], enters: null }],
              calibrations: [`right`, `wrong-law`, `no-op`],
            }),
          ],
        },
      },
    ],
  },
  resolve: resolveSuite,
  model: suiteModel,
  driver: driveSuite,
  check: checkSuite,
})
