/**
 * # What does the gap report owe the oracle author?
 *
 * The gap report (`index.mjs`) is the input to the author's loop: the author
 * reads each gap, states the law it reveals, and re-plans the oracle. A gap
 * the report hides, a kill it credits wrongly, or a key that moves sends that
 * loop the wrong way. This oracle states what the report owes for one source
 * file and the test files of its package, and checks the real CLI against a
 * small model.
 *
 * Laws, checked in this order:
 *
 * 1. **Enumeration.** The report runs exactly the operator mutants that the
 *    CLI's documented interface (the header of `schemata.mjs`) promises for
 *    each source form: `if-true` and `if-false` for an `if` condition,
 *    `binary-swap` for a comparison or a logical operator, `drop-not` for
 *    `!`, and `delete-call` for a call statement. Each names its function
 *    (`name`, or `Class.method` for a method) and its line.
 * 2. **Probe-only code.** A mutant is left out as probe code exactly when its
 *    site is probe-only code: a probe statement in the decided form,
 *    `process.env.NODE_ENV !== 'production' && globalThis.__oracleProbe?.(name,
 *    condition)` (the receiver may be cast), including its condition; a call
 *    statement to a probe helper, which is a function declaration whose every
 *    statement is probe-only; an `if` with no `else` whose branch is
 *    probe-only; or a block of probe-only statements. Code beside a probe is
 *    production code and is judged: a mixed block's condition and other
 *    statements, an `if` whose `else` does work, a function that probes and
 *    also writes output, and any other probe shape, such as the older
 *    `if (devBuild() && …) probe(name)` form and its `devBuild()` helper.
 * 3. **Ownership.** The CLI discovers every oracle file in the package: a
 *    test file that calls `declareOracle({ owns })`. Each entry names a source
 *    file (`src/x.ts`, owning all of it) or a function in it
 *    (`src/x.ts#run`, `src/x.ts#Class.method`), as a string or a plain
 *    template literal. Owning a function owns its static reference tree within
 *    the package, as the type checker resolves it: every function, method,
 *    or class that its body refers to, whether it calls it by name, through
 *    an import or its alias, through `this` or a typed field, through
 *    `.bind`, or passes it as a value. A class passed as a value brings all
 *    its methods, because which one is called is unknown statically; `new
 *    C()` brings only C's constructor (named `C.constructor`), which brings
 *    what its body refers to, and C's methods are owned when something in
 *    the tree refers to them. A
 *    function's owners are the oracle files whose trees contain it; a mutant
 *    in a function with no owner is `unowned` and is listed as a warning, not
 *    a gap. An owns entry that names nothing, an owns list that is not a
 *    literal, and an owner whose tests fail with no mutant active each make
 *    the run fail and name the cause, because each would otherwise hide gaps;
 *    a failing owner is named with a failing test and its error. The CLI's
 *    capture must not change what a test observes: an owner that passes
 *    alone passes under the CLI, even when it counts the reads of a getter
 *    on a value it asserts on.
 * 4. **Classification across owners.** Each mutant is judged only by the
 *    tests of its function's owners. Each test's route is the one the
 *    framework registered for it (`__oracleRoute`), never its name; a test
 *    that runs several campaigns registers each one, and a verdict takes the
 *    route active when it fired, even when a soft assertion lets the test go
 *    on to another campaign; a test that registered none has an unknown
 *    route. A law verdict names its law; an `expect` assertion failure, as
 *    older oracles judge, is a verdict under an unnamed law (transitional,
 *    maintainer decision of 2026-11-05). A test whose observations
 *    vary between two unmutated runs is nondeterministic and judges nothing.
 *    The mutant is `killed` when an owner test on a reproducible route (a
 *    fixed seed, a fixed history, or an enumerated case) reports a law
 *    verdict, unless reach agreement is its only law, which makes it an
 *    `agreement-only-kill`. Failing that, a verdict on the random campaign
 *    makes it a `random-only-kill`, and a verdict on an unknown route an
 *    `unregistered-kill`; an owner test outside the framework's own checks
 *    that fails with no verdict, whatever its message, makes it `crashed`;
 *    and a failing framework check alone (a calibration, a probe
 *    calibration, or the determinism test) makes it a `framework-error`. A
 *    mutant that no owner test reaches is `unreached`; code that runs when
 *    a file loads the module reaches every test of that file (maintainer
 *    decision of 2026-11-06); a mutant that only nondeterministic owner tests
 *    could judge is `indeterminate`. A run is cut off when it passes its
 *    first, short budget, and it then runs again alone with the full limit
 *    (the short budget with confirmation, maintainer decision of
 *    2026-11-06): a run that ends within the full limit is judged as if it
 *    had never been cut off, so a slow kill is a kill. An owner test that
 *    does not end within the full limit cuts its file's run off, and the
 *    cut-off run records nothing, not even its earlier verdicts; a kill in another
 *    owner still decides (a kill outranks a timeout, v19), and failing one,
 *    the mutant is a `timeout`, whatever any other owner reported. A mutant
 *    that no owner test fails is a survivor: a `comparison-gap` when an owner
 *    test's observation or asserted value changed, a `generator-gap` when an
 *    `if` on its line never took one of its outcomes in an owner test, and
 *    `no-observed-difference` otherwise. A test in a file that is not an
 *    oracle file never changes any of this, and runs only when the run asks
 *    for it (`--ordinary`, maintainer decision of 2026-11-06): then a
 *    survivor or an unreached mutant that an ordinary test reached reports
 *    the ordinary tests' outcome, for information. Only `killed` closes an owned
 *    mutant; every other class is a gap.
 * 5. **Authored mutants.** An authored mutant whose text occurs exactly once
 *    is judged by law 4 against the owners of the function it edits, without
 *    the generator-gap class, and is reported at the line of its edit; one
 *    whose text occurs zero or several times is `does-not-apply`. Its key is
 *    its id, whatever its file is called.
 * 6. **Keys.** Each mutant's key is its anchor:
 *    `file#function:operator:statement`, where `statement` is the text of the
 *    innermost statement that holds the site, as tokens joined by single
 *    spaces, in full; a repeat of the same anchor in one function gets `~n`
 *    in document order. Keys are unique.
 * 7. **Report completeness.** The summary lists every gap exactly once under
 *    its key, with its kind and line, lists every unowned mutant as a
 *    warning, and its counts of mutants, kills, gaps, and left-out probe code
 *    are the model's.
 * 8. **Key stability.** Adding an unrelated function, adding a probe guard to
 *    an existing function, or reformatting whitespace changes no existing
 *    mutant's key or outcome.
 * 9. **Incremental equals cold.** A check through the daemon (`--daemon`)
 *    reports, at every state of a sequence of edits, what a cold run of that
 *    state reports: the same exit status and refusal cause, the same run
 *    identity, results, and summary. Only how the result was produced may
 *    differ: durations, the options that name the output directory and the
 *    daemon, and the counts of reused and computed evidence. The edits change
 *    a test, a source statement, the source's line numbers, an owns list,
 *    the authored mutant, a helper module that one oracle file imports, the
 *    seed, and the set of oracle files; they also restart the daemon and
 *    revert the last edit. The law says nothing unless the daemon reuses
 *    evidence, so the reach requires a check that reused evidence, one that
 *    reused some and recomputed some, one that reused evidence from disk
 *    after a restart, and, for each content edit, a cold result that the
 *    edit changed: an edit that changes nothing cannot expose a stale cache.
 *
 * Authority: the maintainer's decisions in the design runs v11, v14, and v19
 * (`~/.cache/oracle-grammar/`, 2026-11-04 and 2026-11-05; not yet in the
 * repository's decision register): a kill is a law verdict on a
 * deterministic route, and a crash, a timeout, a driver failure, or an
 * ordinary-test kill is not (v11 P7, v14 P6, v19 P3); the route comes from
 * registration (v19 A4); gaps are judged across every owner of a function,
 * and owning an entry owns its static call tree (v19 P6, v19.1, v19.2); the
 * probe form (v11, confirmed 2026-11-05: "this is a standalone framework now
 * so we can't use the devBuild() stuff"); only probe-only code is left
 * out (v19 P5, A5); gaps are anchored by function and normalized statement
 * text with an occurrence index (v11, "An allowance lists its gaps"); unowned
 * code is a warning (v14 P7); and no quiet exclusions (AGENTS.md). Law 1's
 * operator list is the CLI's documented interface. ORC-006 names the outcome
 * kinds this report must keep distinct: assertion failure, timeout, setup
 * failure, runtime failure outside the comparison, unreached, and survival.
 * A kill by reach agreement alone is a gap (maintainer decision, 2026-11-05).
 * Law 9 is the maintainer's: incremental runs must be fast enough for an
 * agent that checks hundreds of times, through a daemon whose evidence
 * table is a disk-backed TanStack DB collection, and an incremental run must
 * equal a cold one (v19.3, 2026-11-05); the daemon is a cache over the
 * evidence, never the record (v19 freeze).
 *
 * Limits. Sources are one file of exported functions and classes over one
 * number. A hang is generated only as an owner test that waits on a promise
 * that never settles, under a 1 s first budget and a 6 s full limit
 * (`--first-limit`, `--hang-limit`); a slow run that ends is only a
 * witness, a test that waits 3 s before it judges. Not generated: a busy
 * loop, a slow run past the full limit that would still end, a hang in an
 * ordinary or nondeterministic test, setup errors, multi-line
 * conditions, arrow functions and functions passed as values, nested
 * functions, two functions on one line, getters and setters,
 * `await`, `new`, and `void` statements, `--only`, `--sample`, and
 * `--diff-base`, re-exports, namespace imports, and calls into another
 * package (a package's tree stops at its boundary, by the maintainer's
 * decision of 2026-11-05). A probe-bound state is not generated, so the claim that
 * reach agreement kills every probe mutant is not checked. Gap answers and
 * the gate are not part of the CLI until answers become evidence-log events,
 * which waits on the maintainer's decision about how an answer maps to a law.
 * Law 9's edits do not include a file that a test reads through `fs`, an
 * environment variable other than the seed, a new file that changes how an
 * unchanged import resolves, a change to the Vite config or the installed
 * packages, or two checks at once.
 *
 * Structure:
 *   1. The grammar draws functions, classes, owners, tests, an authored
 *      mutant, a declaration fault, and an edit for the stability law.
 *      `resolve` renders them to files and lays out lines.
 *   2. The model runs each mutant through a small interpreter of that grammar
 *      and predicts every report fact, without the instrumenter or the CLI.
 *   3. The driver writes a scratch package, runs the real CLI on it, and
 *      records its results, summary, and exit status. For law 9 it then
 *      applies each edit, and runs each state cold and through the daemon.
 *   4. The check compares them law by law.
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { declareOracle } from '../../packages/db/tests/oracle-declaration.ts'
import {
  oracleProperty,
  pass,
  violation,
} from '../../packages/db/tests/oracle-property.ts'

import {
  SOURCE,
  LIB,
  quote,
  statement,
  edits,
  histories,
  push,
  judging,
  witness,
  resolveHistory,
  probeHelpers,
  ownersOf,
  interpret,
  refusal,
  model,
  edited,
  AUTHORED,
  initialState,
  fixtureFiles,
  written,
  writeFixture,
  applyEdit,
  readSummary,
} from './gap-report-model-oracle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, `../..`)

// ## Production driver
//
// The driver writes the plan into a scratch package inside this directory, so
// the package resolves the repository's TypeScript and Vitest, and runs the
// real CLI on it with a fixed seed. It names no test files: the CLI must find
// the oracle files and their owners itself. Each oracle file registers each
// test's route through `__oracleRoute`, as the framework does, unless the
// history says not to. The driver records the exit status, each mutant's
// result, and the summary's counts, gap keys, and unowned keys. A stability
// history runs the CLI again on the edited source.
// The child gets a clean environment: no state from this Vitest worker.
const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith(`VITEST`) && !name.startsWith(`TANSTACK_DB_ORACLE`),
    ),
  )

/**
 * Writes the fixture's files and runs the CLI on it: cold, or through the
 * daemon (law 9). A file of an earlier state that this state lacks is
 * removed.
 */
function runCli(
  dir,
  files,
  { seed = 1, daemon = false, cli = here, ordinary = false } = {},
) {
  writeFixture(dir, files)
  const out = join(dir, daemon ? `out-daemon` : `out`)
  rmSync(out, { recursive: true, force: true })
  // The CLI runs from the repository root. A daemon check names its paths
  // relative to there, as an author types them, and the daemon must read
  // them as the CLI's caller meant them.
  const path = (absolute) => (daemon ? relative(repo, absolute) : absolute)
  const args = [
    join(cli, `index.mjs`),
    ...(daemon ? [`--daemon`] : []),
    `--package`,
    path(dir),
    `--source`,
    `${SOURCE},${LIB}`,
    `--seed`,
    String(seed),
    // Four warm contexts run mutants in parallel; results do not depend on
    // the count.
    `--contexts`,
    `4`,
    // A fixture's tests run in milliseconds. A 1 s first budget cuts off
    // the slow witness, and the 6 s full limit lets it end; each hang costs
    // about 7 s.
    `--first-limit`,
    `1000`,
    `--hang-limit`,
    `6000`,
    `--out`,
    path(out),
  ]
  if (ordinary) args.push(`--ordinary`)
  if (files[AUTHORED] !== undefined)
    args.push(`--mutants`, path(join(dir, `mutants`)))
  const env = cleanEnv()
  const child = spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: `utf8`,
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    env,
  })
  let results
  let report
  let summary = ``
  try {
    report = JSON.parse(readFileSync(join(out, `results.json`), `utf8`))
    results = report.results
    summary = readFileSync(join(out, `summary.md`), `utf8`)
  } catch {
    // A run that wrote no report is recorded by its exit status and output.
  }
  return {
    exit: child.status,
    stderr: child.status === 0 ? undefined : `${child.stderr}`.slice(-1500),
    reported: results !== undefined,
    // Law 9 compares everything the run reports except how it was
    // produced: durations, the options it was given (the output directory
    // and the daemon flag differ by construction), and the counts of reused
    // and computed evidence.
    // Paths are recorded relative to the package, so two runs of one
    // history in different scratch directories record the same report.
    report:
      report &&
      JSON.parse(
        JSON.stringify({
          run: report.run,
          excluded: report.excluded,
          nondeterministic: report.nondeterministic,
          results: report.results.map(({ seconds, ...rest }) => rest),
          summary,
        }).replaceAll(`${dir}/`, `<package>/`),
      ),
    evidence: report?.evidence,
    // A refused run is compared by the cause it names.
    refusal:
      child.status === 0
        ? undefined
        : `${child.stderr}`.match(/^Error: (.*)$/m)?.[1],
    mutants: (results ?? []).map((r) => ({
      key: r.key,
      source: r.source,
      function: r.function,
      line: r.line,
      operator: r.operator,
      authored: r.authored === true,
      outcome: r.outcome,
      class: r.class,
      laws: r.laws,
      probe: r.probeGuard === true,
      ordinaryOutcome: r.testOutcome !== undefined,
    })),
    ...readSummary(summary),
  }
}

/**
 * Law 9: the daemon checks each state of the steps, and the same state is
 * run cold. A cold run is deterministic, so a state seen before (after
 * `restart` or `revert`) keeps its first cold result.
 */
function incremental(dir, plan, cli, observe, states) {
  // The history runs its own copy of the CLI, beside this one so that its
  // relative imports resolve, and the `cli` edit changes the copy's wording.
  const copy = mkdtempSync(join(here, `..`, `oracle-gaps-mutant-cli-`))
  cpSync(here, copy, {
    recursive: true,
    filter: (path) => !/\.scratch-|node_modules/.test(path),
  })
  const reportFile = join(copy, `report.mjs`)
  const reportText = readFileSync(reportFile, `utf8`)
  const RUN_LINE = '`Run ${run.id}. Inputs: ${run.inputs}.`'
  if (!reportText.includes(RUN_LINE))
    throw new Error(`the cli edit no longer finds the summary's run line`)
  const cold = new Map()
  const fingerprint = (files, state) =>
    JSON.stringify([files, state.seed, state.cliEdited])
  cold.set(fingerprint(fixtureFiles(plan), initialState(plan)), cli)
  // A cold result without the run identity, which every edit changes, so
  // that two states compare by what they report.
  const result = (run) =>
    JSON.stringify([
      run.exit,
      run.refusal,
      run.report && {
        ...run.report,
        run: undefined,
        summary: run.report.summary.replace(/^Run \w+/m, `Run`),
      },
    ])
  const trail = [initialState(plan)]
  // The steps that made each state after the first, so a revert knows what
  // it undid.
  const made = []
  let reverted
  let previous = cli
  const checkAt = (step) => {
    const state = trail.at(-1)
    writeFileSync(
      reportFile,
      state.cliEdited
        ? reportText.replace(RUN_LINE, '`Run ${run.id} (edited). Inputs: ${run.inputs}.`')
        : reportText,
    )
    const files = fixtureFiles(resolveHistory(state.history), state)
    const key = fingerprint(files, state)
    const how = { seed: state.seed, cli: copy, ordinary: plan.ordinary }
    if (!cold.has(key)) cold.set(key, runCli(dir, files, how))
    const coldRun = cold.get(key)
    const daemon = runCli(dir, files, { ...how, daemon: true })
    observe(`incremental`, {
      step,
      cold: {
        exit: coldRun.exit,
        refusal: coldRun.refusal,
        report: coldRun.report,
      },
      daemon: {
        exit: daemon.exit,
        refusal: daemon.refusal,
        report: daemon.report,
        // The first line of a failure, for the message, without the paths
        // of this history's scratch package and CLI copy.
        stderr: daemon.stderr
          ?.split(`\n`)[0]
          .replaceAll(copy, `<cli>`)
          .replaceAll(dir, `<package>`),
      },
    })
    const reused = daemon.evidence?.reused ?? 0
    const computed = daemon.evidence?.computed ?? 0
    if (step !== `start` && reused > 0)
      states.add(`incremental check reused evidence`)
    if (step !== `start` && reused > 0 && computed > 0)
      states.add(`incremental check reused some evidence and recomputed some`)
    if (step === `restart` && reused > 0)
      states.add(`evidence reused after a daemon restart`)
    // Undoing an edit to a file returns to a state the daemon has seen, so
    // it reruns nothing.
    if (
      step === `revert` &&
      [`test`, `source`, `prepend`, `owns`, `authored`, `helper`, `newOracle`].includes(reverted) &&
      reused > 0 &&
      computed === 0
    )
      states.add(`a revert of a file edit reran nothing`)
    // An edit that changes the cold result is one a stale cache could miss.
    if (step !== `start` && result(previous) !== result(coldRun))
      states.add(`edit ${step} changed the cold result`)
    previous = coldRun
  }
  const stop = () =>
    spawnSync(
      process.execPath,
      [join(copy, `index.mjs`), `--stop-daemon`, `--package`, dir],
      { cwd: repo, encoding: `utf8`, timeout: 60_000, env: cleanEnv() },
    )
  try {
    checkAt(`start`)
    for (const step of plan.steps) {
      if (step === `restart`) stop()
      else if (step === `revert`) {
        if (trail.length > 1) trail.pop()
        reverted = made.pop()
      } else {
        trail.push(applyEdit(trail.at(-1), step))
        made.push(step)
      }
      checkAt(step)
    }
  } finally {
    stop()
    rmSync(copy, { recursive: true, force: true })
  }
}

async function driver(plan, observe) {
  const dir = mkdtempSync(join(here, `.scratch-`))
  try {
    const files = fixtureFiles(plan)
    const cli = runCli(dir, files, { ordinary: plan.ordinary })
    // How many units were computed or reused says how the result was
    // produced, not what it is, so it is not observed.
    observe(`cli`, { ...cli, evidence: undefined })
    // Reach comes from what the CLI reported, mapped onto the plan.
    const states = new Set()
    // Each kind of declaration fault is its own state, so each refusal has
    // a history that depends on it.
    if (plan.fault !== `none` && cli.exit !== 0)
      states.add(`refused ${plan.fault}`)
    const kindAt = new Map(
      plan.functions.flatMap((fn) =>
        fn.body.map((s) => [`${fn.file}:${s.line}`, s.kind]),
      ),
    )
    for (const m of cli.mutants) {
      if (m.authored) {
        const others = cli.mutants.filter((x) => x.authored && x.key !== m.key)
        if (
          others.some(
            (x) =>
              x.outcome !== `does-not-apply` &&
              m.outcome !== `does-not-apply` &&
              (x.class ?? x.outcome) !== (m.class ?? m.outcome),
          )
        )
          states.add(`two authored mutants judged apart`)
        states.add(
          m.outcome !== `does-not-apply`
            ? `authored mutant`
            : plan.authored.kind === `ambiguous`
              ? `ambiguous authored mutant`
              : `stale authored mutant`,
        )
        continue
      }
      if (m.probe) {
        if (m.function === `w_probeonly`) states.add(`derived probe helper`)
        if (m.function === `w_callschain`)
          states.add(`derived probe helper chain`)
        continue
      }
      const generatedFn = plan.functions.find(
        (fn) => fn.generated && fn.id === m.function,
      )
      if (
        generatedFn &&
        generatedFn.owners.length === 0 &&
        plan.wholeFile !== `none` &&
        m.outcome !== `unowned`
      )
        states.add(`owned by a whole-file entry`)
      if (m.function === `w_overloaded` && m.outcome !== `unowned`)
        states.add(`overloaded function owned`)
      if (m.function === `w_both` && m.outcome === `killed`)
        states.add(`killed on both routes`)
      if (m.function === `wg0` && m.outcome === `killed`)
        states.add(`owned across files`)
      if (m.function === `wg1` && m.outcome === `killed`)
        states.add(`owned through an aliased import`)
      if (m.source === LIB && m.outcome === `unowned`)
        states.add(`unowned in another file`)
      if (m.function === `w_valued` && m.outcome === `killed`)
        states.add(`owned through a value`)
      if (m.function === `W3.run` && m.outcome === `killed`)
        states.add(`owned through a field`)
      if (m.function === `W7.constructor` && m.outcome === `killed`)
        states.add(`constructor owned through new`)
      if (m.function === `W4.step` && m.outcome === `unowned`)
        states.add(`a constructed class brings only what is referenced`)
      if (m.function === `W6.step` && m.outcome !== `unowned`)
        states.add(`a class passed as a value brings its methods`)
      if (
        m.function === `w_assert` &&
        m.outcome === `killed` &&
        m.laws?.includes(`(unnamed)`)
      )
        states.add(`killed under an unnamed law`)
      if (m.function === `w_getter` && m.outcome === `killed`)
        states.add(`a getter the capture left unread`)
      if (m.function === `w_shared` && m.class === `generator-gap`)
        states.add(`a test that depends on an earlier test`)
      if (m.function === `w_late` && m.outcome === `killed`)
        states.add(`a kill after a caught verdict`)
      if (m.function === `w_prop` && m.outcome === `killed`)
        states.add(`a kill through state an earlier test stored`)
      if (m.function === `w_load` && m.outcome === `killed`)
        states.add(`a mutant of code run at module load killed`)
      if (m.function === `w_memo` && m.operator === `if-false` && m.outcome === `killed`)
        states.add(`a module-level cache judged afresh`)
      if (m.function === `w_campaigns` && m.outcome === `random-only-kill`)
        states.add(`second campaign's route attributed`)
      if (m.function === `w_soft` && m.outcome === `random-only-kill`)
        states.add(`a soft verdict keeps its campaign's route`)
      if (m.function === `W5.step` && m.outcome === `killed`)
        states.add(`owned through bind`)
      if (kindAt.get(`${m.source}:${m.line}`) === `oldProbe`) states.add(`old probe form judged`)
      if (kindAt.get(`${m.source}:${m.line}`) === `mixed` && m.operator === `if-true`)
        states.add(`production beside a probe`)
      if (kindAt.get(`${m.source}:${m.line}`) === `elseIf` && m.operator === `if-true`)
        states.add(`production else judged`)
      if (m.function === `reportAndPush`) states.add(`mixed helper judged`)
      if (m.function === `w_leaf` && m.outcome !== `unowned`)
        states.add(`owned through a call chain`)
      if (m.function === `W0.step` && m.outcome !== `unowned`)
        states.add(`method owned through this`)
      if (m.function === `w_union` && m.outcome === `killed`)
        states.add(`killed by a second owner`)
      if (m.function === `w_crosskill` && m.outcome === `killed`)
        states.add(`a kill in one owner after a gap in another`)
      if (m.function === `w_flakykill` && m.outcome === `killed`)
        states.add(`a kill after a nondeterministic verdict in its file`)
      if (m.function === `w_slowkill` && m.outcome === `killed`)
        states.add(`a slow kill past the first time limit killed`)
      if (m.function === `w_hang` && m.outcome === `timeout`)
        states.add(`a hang alone timed out`)
      if (m.function === `w_hangkill` && m.outcome === `killed`)
        states.add(`a hang in one owner and a kill in another killed`)
      if (m.function === `w_hangsurvive` && m.outcome === `timeout`)
        states.add(`a hang in one owner and a survivor in another timed out`)
      const named = {
        killed: `killed`,
        'random-only-kill': `random-only kill`,
        'agreement-only-kill': `agreement-only kill`,
        'unregistered-kill': `unregistered kill`,
        crashed: `crash gap`,
        'framework-error': `framework-only failure`,
        unreached: `unreached`,
        unowned: `unowned`,
        timeout: `timeout`,
      }[m.outcome]
      if (named) states.add(named)
      if (m.class === `comparison-gap`) states.add(`comparison gap`)
      if (m.class === `generator-gap`) states.add(`generator gap`)
      if (m.class === `no-observed-difference`)
        states.add(`no observed difference`)
      if (m.class === `indeterminate`) states.add(`indeterminate`)
    }
    // A batch that a hang cut off reran its other items in a new context.
    if (cli.evidence?.rerun > 0) states.add(`a batch cut off by a hang reran the rest`)
    if (plan.ordinary && cli.mutants.some((m) => m.ordinaryOutcome))
      states.add(`ordinary tests run when asked`)
    if (!plan.ordinary && plan.tests.some((t) => t.file === `c`))
      states.add(`ordinary tests left out by default`)
    if (plan.stability !== `none` && cli.exit === 0) {
      const moved = { ...files, [SOURCE]: edited(plan) }
      observe(`stability`, runCli(dir, moved, { ordinary: plan.ordinary }))
      states.add(`stability rerun`)
    }
    if (plan.steps.length > 0) incremental(dir, plan, cli, observe, states)
    for (const state of states) observe(`reach`, state)
  } finally {
    written.delete(dir)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Cleanup must not replace the observation or its failure.
    }
  }
}

// ## Comparison
//
// The check matches the CLI's mutants to the model's by function, line,
// operator, and order on the line, then checks each law in turn and reports
// the first that fails. A run that must be refused is checked for that
// alone. A run that did not complete fails `completion`, so a crash of the
// tool is not read as a wrong enumeration.
/**
 * Law 9: each check through the daemon reports what the cold run of the same
 * state reports. A refused state is compared by the cause it names.
 */
function incrementalCheck(observations) {
  for (const { value } of observations.filter(
    (o) => o.checkpoint === `incremental`,
  )) {
    const { step, cold, daemon } = value
    if (
      daemon.exit !== cold.exit ||
      daemon.refusal !== cold.refusal ||
      (cold.report !== undefined) !== (daemon.report !== undefined)
    )
      return violation(
        `incremental`,
        `after ${step}, the daemon's check exited ${daemon.exit} (${daemon.refusal ?? daemon.stderr ?? `no refusal`}) and the cold run exited ${cold.exit} (${cold.refusal ?? `no refusal`})`,
        `incremental equals cold`,
        { actual: daemon, expected: cold },
      )
    if (!cold.report) continue
    if (JSON.stringify(daemon.report) === JSON.stringify(cold.report)) continue
    const at = cold.report.results.findIndex(
      (r, i) =>
        JSON.stringify(r) !== JSON.stringify(daemon.report.results[i]),
    )
    return violation(
      `incremental`,
      `after ${step}, the daemon's report differs from the cold run's${at >= 0 ? ` at ${cold.report.results[at].key}` : ``}`,
      `incremental equals cold`,
      at >= 0
        ? { actual: daemon.report.results[at], expected: cold.report.results[at] }
        : { actual: daemon.report, expected: cold.report },
    )
  }
  return undefined
}

function check(plan, observations, expected) {
  const cli = observations.find((o) => o.checkpoint === `cli`)?.value
  if (!cli) return violation(`cli`, `no CLI run was observed`, `completion`)
  if (expected.refused) {
    if (cli.exit === 0)
      return violation(
        `cli`,
        `the run completed although ${expected.refused.cause} must refuse it`,
        `ownership`,
      )
    if (!`${cli.stderr}`.includes(expected.refused.cause))
      return violation(
        `cli`,
        `the refusal does not name ${expected.refused.cause}: ${cli.stderr}`,
        `ownership`,
      )
    if (expected.refused.detail && !`${cli.stderr}`.includes(expected.refused.detail))
      return violation(
        `cli`,
        `the refusal does not give the failing test's error, ${expected.refused.detail}: ${cli.stderr}`,
        `ownership`,
      )
    return incrementalCheck(observations) ?? pass
  }
  if (cli.exit !== 0 || !cli.reported)
    return violation(
      `cli`,
      `the CLI did not complete (exit ${cli.exit}): ${cli.stderr ?? `no results`}`,
      `completion`,
    )
  const seen = new Map()
  const actual = cli.mutants
    .filter((m) => !m.authored)
    .map((m) => {
      const key = `${m.source} ${m.line} ${m.operator}`
      const ordinal = seen.get(key) ?? 0
      seen.set(key, ordinal + 1)
      return { ...m, ordinal }
    })
  const site = (m) =>
    `${m.source}:${m.function}:${m.line}:${m.operator}#${m.ordinal}`
  if (
    actual.map(site).sort().join() !== expected.mutants.map(site).sort().join()
  )
    return violation(`cli`, `the mutant set differs`, `enumeration`, {
      actual: actual.map(site).sort(),
      expected: expected.mutants.map(site).sort(),
    })
  const pairs = expected.mutants.map((m) => [
    m,
    actual.find((a) => site(a) === site(m)),
  ])
  for (const [owed, got] of pairs)
    if (owed.probe !== got.probe)
      return violation(
        `cli`,
        `${site(got)}: probe code is ${got.probe}, owed ${owed.probe}`,
        `probe-only code`,
        { actual: got, expected: owed },
      )
  for (const [owed, got] of pairs) {
    if (owed.probe) continue
    const kind = got.class ?? got.outcome
    if (kind !== owed.kind)
      return violation(
        `cli`,
        `${site(got)}: ${kind}, owed ${owed.kind}`,
        owed.kind === `unowned` || kind === `unowned`
          ? `ownership`
          : `classification`,
        { actual: got, expected: owed },
      )
  }
  for (const [owed, got] of pairs)
    if (!owed.probe && got.ordinaryOutcome !== owed.ordinaryOutcome)
      return violation(
        `cli`,
        `${site(got)}: the ordinary tests' outcome is ${got.ordinaryOutcome ? `` : `not `}reported, owed ${owed.ordinaryOutcome ? `reported` : `not reported`}`,
        `ordinary tier`,
        { actual: got, expected: owed },
      )
  // Each authored mutant, by its key: its id, whatever its file is called.
  const authoredGot = cli.mutants.filter((m) => m.authored)
  if (authoredGot.length !== expected.authoredAll.length)
    return violation(
      `cli`,
      `${authoredGot.length} authored mutants are reported, owed ${expected.authoredAll.length}`,
      `authored mutants`,
    )
  for (const owed of expected.authoredAll) {
    const got = authoredGot.find((m) => m.key === owed.key)
    const kind = got && (got.class ?? got.outcome)
    if (kind !== owed.kind)
      return violation(
        `cli`,
        `the authored mutant ${owed.id} is ${kind}, owed ${owed.kind}`,
        `authored mutants`,
        { actual: kind, expected: owed.kind },
      )
    if (owed.line !== undefined && got.line !== owed.line)
      return violation(
        `cli`,
        `the authored mutant ${owed.id} is reported at line ${got.line}, owed ${owed.line}`,
        `authored mutants`,
      )
  }
  for (const [owed, got] of pairs)
    if (got.key !== owed.key)
      return violation(
        `cli`,
        `${site(got)}: key ${JSON.stringify(got.key)}, owed ${JSON.stringify(owed.key)}`,
        `keys`,
        { actual: got.key, expected: owed.key },
      )
  if (
    cli.gaps.join(`\n`) !== expected.gaps.join(`\n`) ||
    JSON.stringify(cli.entries) !== JSON.stringify(expected.entries) ||
    cli.unowned.join(`\n`) !== expected.unowned.join(`\n`) ||
    JSON.stringify(cli.counts) !== JSON.stringify(expected.counts)
  )
    return violation(
      `cli`,
      `the summary does not list exactly the owed gaps, unowned warnings, and counts`,
      `report completeness`,
      {
        actual: { entries: cli.entries, unowned: cli.unowned, counts: cli.counts },
        expected: {
          entries: expected.entries,
          unowned: expected.unowned,
          counts: expected.counts,
        },
      },
    )
  const moved = observations.find((o) => o.checkpoint === `stability`)?.value
  if (moved) {
    if (moved.exit !== 0 || !moved.reported)
      return violation(
        `stability`,
        `the CLI did not complete on the edited source (exit ${moved.exit}): ${moved.stderr ?? `no results`}`,
        `completion`,
      )
    const describe = (m) => `${m.key} ${m.class ?? m.outcome} ${m.probe}`
    const before = cli.mutants.map(describe).sort()
    const keys = new Set(cli.mutants.map((m) => m.key))
    const after = moved.mutants
      .filter((m) => keys.has(m.key))
      .map(describe)
      .sort()
    if (before.join(`\n`) !== after.join(`\n`))
      return violation(
        `stability`,
        `the ${plan.stability} edit changed existing keys or outcomes`,
        `key stability`,
        { actual: after, expected: before },
      )
  }
  return incrementalCheck(observations) ?? pass
}

declareOracle({
  check: [check, incrementalCheck],
  model: [model, interpret, ownersOf, probeHelpers],
  grammar: [histories],
})

// ## Calibrations
//
// Each one hands the check a wrong report, so a check that cannot see the
// difference fails here instead of passing every CLI.
const corruptCli = (change) => (trace) => {
  const index = trace.findIndex((o) => o.checkpoint === `cli`)
  if (index < 0) return undefined
  const value = change(structuredClone(trace[index].value))
  if (value === undefined) return undefined
  return trace.map((o, i) => (i === index ? { ...o, value } : o))
}
const firstWhere = (predicate, change) =>
  corruptCli((cli) => {
    if (cli.exit !== 0) return undefined
    const m = cli.mutants.find((x) => !x.authored && predicate(x))
    if (!m) return undefined
    change(m)
    return cli
  })
const calibrations = [
  {
    name: `a refused run is reported as complete`,
    law: `ownership`,
    corrupt: corruptCli((cli) =>
      cli.exit === 0 ? undefined : { ...cli, exit: 0 },
    ),
  },
  {
    name: `a mutant is dropped from the enumeration`,
    law: `enumeration`,
    corrupt: corruptCli((cli) => {
      const index = cli.mutants.findIndex((m) => !m.authored)
      if (cli.exit !== 0 || index < 0) return undefined
      cli.mutants.splice(index, 1)
      return cli
    }),
  },
  {
    name: `production code is reported as probe code`,
    law: `probe-only code`,
    corrupt: firstWhere(
      (m) => !m.probe,
      (m) => {
        m.probe = true
      },
    ),
  },
  {
    name: `a crash is reported as a kill`,
    law: `classification`,
    corrupt: firstWhere(
      (m) => !m.probe && m.outcome === `crashed`,
      (m) => {
        m.outcome = `killed`
      },
    ),
  },
  {
    name: `an owned mutant is reported as unowned`,
    law: `ownership`,
    corrupt: firstWhere(
      (m) => !m.probe && m.outcome !== `unowned`,
      (m) => {
        m.outcome = `unowned`
        delete m.class
      },
    ),
  },
  {
    name: `a key drops its statement text`,
    law: `keys`,
    corrupt: firstWhere(
      () => true,
      (m) => {
        m.key = m.key.slice(0, m.key.lastIndexOf(`:`))
      },
    ),
  },
  {
    name: `the summary omits a gap`,
    law: `report completeness`,
    corrupt: corruptCli((cli) => {
      if (cli.exit !== 0 || cli.gaps.length === 0) return undefined
      cli.gaps.shift()
      return cli
    }),
  },
  {
    name: `an edit moves a key`,
    law: `key stability`,
    corrupt: (trace) => {
      const cli = trace.find((o) => o.checkpoint === `cli`)?.value
      const index = trace.findIndex((o) => o.checkpoint === `stability`)
      if (!cli || index < 0) return undefined
      const value = structuredClone(trace[index].value)
      const keys = new Set(cli.mutants.map((m) => m.key))
      const kept = value.mutants.find((m) => keys.has(m.key))
      if (!kept) return undefined
      kept.key = `${kept.key}~moved`
      return trace.map((o, i) => (i === index ? { ...o, value } : o))
    },
  },
]

calibrations.push({
  name: `the daemon reports another outcome than the cold run`,
  law: `incremental equals cold`,
  corrupt: (trace) => {
    const index = trace.findIndex(
      (o) => o.checkpoint === `incremental` && o.value.daemon.report,
    )
    if (index < 0) return undefined
    const value = structuredClone(trace[index].value)
    const changed = value.daemon.report.results[0]
    if (!changed) return undefined
    changed.outcome = changed.outcome === `killed` ? `unreached` : `killed`
    return trace.map((o, i) => (i === index ? { ...o, value } : o))
  },
})

// Law 9's states: reuse, a mix of reuse and recomputation, reuse from disk
// after a restart, and each content edit changing the cold result, without
// which a stale cache would match the cold run by chance.
const incrementalStates = [
  `incremental check reused evidence`,
  `incremental check reused some evidence and recomputed some`,
  `evidence reused after a daemon restart`,
  `a revert of a file edit reran nothing`,
  ...edits
    .filter((edit) => edit !== `restart`)
    .map((edit) => `edit ${edit} changed the cold result`),
]
// The static states (probe structure and ownership through the reference
// tree) are gap-report-static-oracle's: it reaches each in every campaign,
// in-process. This oracle still judges those laws in every history it runs,
// and counts how often it reaches them.
const staticStates = [
  `production beside a probe`,
  `production else judged`,
  `derived probe helper`,
  `mixed helper judged`,
  `owned through a call chain`,
  `method owned through this`,
  `derived probe helper chain`,
  `overloaded function owned`,
  `owned by a whole-file entry`,
  `old probe form judged`,
  `owned across files`,
  `owned through an aliased import`,
  `unowned in another file`,
  `owned through a value`,
  `owned through a field`,
  `a constructed class brings only what is referenced`,
  `constructor owned through new`,
  `a class passed as a value brings its methods`,
  `owned through bind`,
]
const required = [
  `killed by a second owner`,
  `killed`,
  `random-only kill`,
  `agreement-only kill`,
  `unregistered kill`,
  `crash gap`,
  `framework-only failure`,
  `indeterminate`,
  `comparison gap`,
  `generator gap`,
  `no observed difference`,
  `unreached`,
  `unowned`,
  `authored mutant`,
  `stale authored mutant`,
  `ambiguous authored mutant`,
  `stability rerun`,
  `refused badEntry`,
  `refused missingSource`,
  `refused nonLiteral`,
  `refused brokenOwner`,
  `killed on both routes`,
  `killed under an unnamed law`,
  `second campaign's route attributed`,
  `a soft verdict keeps its campaign's route`,
  `a getter the capture left unread`,
  `a test that depends on an earlier test`,
  `a kill after a caught verdict`,
  `a kill through state an earlier test stored`,
  `a mutant of code run at module load killed`,
  `a module-level cache judged afresh`,
  `ordinary tests run when asked`,
  `ordinary tests left out by default`,
  `two authored mutants judged apart`,
  `timeout`,
  `a kill after a nondeterministic verdict in its file`,
  `a kill in one owner after a gap in another`,
  `a slow kill past the first time limit killed`,
  `a hang alone timed out`,
  `a hang in one owner and a kill in another killed`,
  `a hang in one owner and a survivor in another timed out`,
  `a batch cut off by a hang reran the rest`,
  ...incrementalStates,
]
const faults = [`badEntry`, `missingSource`, `nonLiteral`, `brokenOwner`]
const separate = [
  `ordinary tests left out by default`,
  `two authored mutants judged apart`,
  `stale authored mutant`,
  `ambiguous authored mutant`,
  ...faults.map((fault) => `refused ${fault}`),
  ...incrementalStates,
]
const witnessed = required.filter((s) => !separate.includes(s))

oracleProperty({
  id: `scripts.gap-report`,
  law: {
    statement: `The gap report enumerates the promised operator mutants, leaves out exactly the probe-only code, discovers every oracle that owns a function's call tree and refuses broken ownership, judges each mutant only by its owners' tests on their registered routes and counts only law verdicts on reproducible routes as kills, which outrank a run that never ends, anchors each mutant by its function and normalized statement, lists every gap and unowned mutant once with consistent counts, keeps keys stable under unrelated edits, and reports through its daemon what a cold run reports at every state of a sequence of edits.`,
    authority: `The maintainer's decisions in design runs v11, v14, and v19 (2026-11-04 and 2026-11-05), not yet in the repository's decision register, including that a kill by reach agreement alone is a gap and that an incremental run through the daemon equals a cold one (v19.3); AGENTS.md on quiet exclusions; oracle-rubric ORC-006 outcome kinds; the CLI's documented operator list in schemata.mjs.`,
    limits: `Hangs only as an owner test that awaits a promise that never settles, under a 1 s first budget and a 6 s full limit, and a slow run only as one witness that waits 3 s before it judges; no busy loops, slow runs past the full limit that would end, hangs in ordinary or nondeterministic tests, setup errors, loops, multi-line conditions, arrow or nested functions, two functions on one line, getters and setters, or await, new, and void statements; two source files of one package, with no re-exports, namespace imports, or calls into another package; no --only, --sample, or --diff-base; no probe-bound states, so reach agreement's killing of probe mutants is not checked; no gap answers or gate; law 9's edits leave out files read through fs, other environment variables, new files that change how an unchanged import resolves, Vite config and installed-package changes, and concurrent checks.`,
    owner: `scripts/oracle-gaps`,
  },
  histories: {
    arbitrary: histories,
    states: required,
    measured: staticStates,
    runs: 2,
    fixedSeeds: [20261105],
    constructed: [
      {
        name: `every outcome class`,
        enters: witnessed,
        // A whole-file owns entry would own the unowned witness, so the
        // construction keeps ownership per function.
        build: (generated) => ({
          ...generated,
          witness: `capture`,
          wholeFile: `none`,
          fault: `none`,
          authored: { stmt: 0, kind: `apply` },
          stability: `insertGuard`,
          steps: null,
          ordinary: true,
        }),
      },
      {
        name: `a stale authored mutant and a reformat`,
        enters: [`stale authored mutant`, `stability rerun`],
        build: (generated) => ({
          ...generated,
          witness: false,
          functions: [
            [{ kind: `push`, quote: `'` }, ...generated.functions[0].slice(0, 4)],
            ...generated.functions.slice(1),
          ],
          fault: `none`,
          authored: { stmt: 0, kind: `stale` },
          stability: `reformat`,
        }),
      },
      {
        name: `an ambiguous authored mutant`,
        enters: [`ambiguous authored mutant`],
        build: (generated) => ({
          ...generated,
          witness: false,
          functions: [
            [{ kind: `push`, quote: `'` }, ...generated.functions[0].slice(0, 4)],
            ...generated.functions.slice(1),
          ],
          wholeFile: `none`,
          fault: `none`,
          authored: { stmt: 0, kind: `ambiguous` },
        }),
      },
      {
        // Two small owned functions, so that each check is quick, and every
        // edit in an order where each one changes the cold result: file b's
        // helper (only b's evidence is recomputed), the seed, a revert to
        // the state before it (all reused), then the rest, and a restart.
        name: `an edit sequence through the daemon`,
        enters: incrementalStates,
        build: (generated) => ({
          ...generated,
          functions: [
            [{ kind: `if`, op: `>`, k: 4, not: false, quote: `'` }],
            [{ kind: `push`, quote: `'` }],
          ],
          containers: [],
          overloads: [],
          owners: [`a`, `b`],
          library: [],
          libraryOwners: [],
          wholeFile: `none`,
          template: false,
          tests: [
            { ...judging(`a`, `fixed seed`, 5), fn: 0 },
            { ...judging(`b`, `fixed seed`, 1), fn: 1 },
          ],
          witness: false,
          authored: { stmt: 0, kind: `apply` },
          fault: `none`,
          stability: `none`,
          steps: [
            `helper`,
            `seed`,
            `revert`,
            `test`,
            `revert`,
            `test`,
            `source`,
            `prepend`,
            `owns`,
            `authored`,
            `newOracle`,
            `cli`,
            `restart`,
          ],
        }),
      },
      {
        // Two authored mutants in one source file, one killed and one a
        // comparison gap: a run that let one see the other's patch would
        // judge them alike.
        name: `two authored mutants`,
        enters: [`two authored mutants judged apart`],
        build: (generated) => ({
          ...generated,
          functions: [[{ kind: `push`, quote: `'` }], [{ kind: `push`, quote: `'` }]],
          containers: [],
          overloads: [],
          owners: [`a`, `a`],
          wholeFile: `none`,
          witness: false,
          tests: [
            { ...judging(`a`, `fixed seed`, 1), fn: 0 },
            { ...judging(`a`, `fixed seed`, 1, { judges: false }), fn: 1 },
          ],
          authored: { stmt: 0, kind: `apply` },
          secondAuthored: true,
          fault: `none`,
          stability: `none`,
          steps: null,
        }),
      },
      {
        // An ordinary test exists, and the run does not ask for it.
        name: `ordinary tests left out by default`,
        enters: [`ordinary tests left out by default`],
        // One owned function with no oracle test, so it is unreached, and
        // an ordinary test that calls it: asked, its outcome is reported.
        build: (generated) => ({
          ...generated,
          functions: [[{ kind: `push`, quote: `'` }]],
          containers: [],
          overloads: [],
          owners: [`a`],
          wholeFile: `none`,
          witness: false,
          tests: [{ ...judging(`c`, `case`, 1), fn: 0 }],
          authored: null,
          fault: `none`,
          stability: `none`,
          ordinary: false,
          steps: null,
        }),
      },
      ...faults.map((fault) => ({
        name: `a declaration fault: ${fault}`,
        enters: [`refused ${fault}`],
        build: (generated) => ({ ...generated, fault }),
      })),
    ],
  },
  resolve: resolveHistory,
  model,
  driver,
  check,
  calibrations,
  timeout: 900_000,
})
