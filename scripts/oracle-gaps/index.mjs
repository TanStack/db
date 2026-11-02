#!/usr/bin/env node
// Gap report prototype: which production behaviour do the oracles leave
// unexercised or unchecked?
//
// The report does not locate bugs or judge laws. It lists places where an
// oracle could improve, so that each one can be closed or given a reason
// (oracle-framework design, decisions D41 and D42). For each source file it:
//
// 1. Compiles every mutant into one instrumented copy (schemata.mjs) and
//    serves that copy to Vitest through a plugin. Nothing is written to the
//    source file.
// 2. Runs all given test files twice with no mutant active. Each test reports
//    which mutation sites it reached, which outcomes each `if` took, and a
//    hash of the values it asserted about. Tests whose hash differs between
//    the two runs are nondeterministic.
// 3. Runs each mutant against the oracle files whose tests reached its site,
//    in one warm Vitest process, stopping at the first failure. Whole files
//    run, because tests in one file can share state (jsdom's localStorage
//    persists across them), so skipping some can change the others.
// 4. Classifies each run: `killed` (an assertion failed), `crashed` (a test
//    failed with a non-assertion error), `survived`, `timeout`, or
//    `setup-error` (an error outside any test). A site that no oracle test
//    reached is `unreached`. Killed and crashed are both detections. Because
//    a run stops at its first failure, which of the two a mutant gets can
//    depend on which file ran first.
// 5. Sorts each survivor:
//    - `comparison-gap`: asserted values, or an oracle property's recorded
//      observations, changed but no assertion failed.
//    - `generator-gap`: no asserted value changed, and an `if` on the mutated
//      line never took one of its outcomes in any oracle test.
//    - `no-observed-difference`: no asserted value changed and every `if`
//      outcome on the line occurred. This is not evidence of no contract: the
//      explored histories may simply never distinguish the edit (D42).
//    - `indeterminate`: only nondeterministic tests reached the site.
//
// Ordinary test files given with --tests form a second tier. A mutant that no
// oracle kills is run against the ordinary tests that reach it, and a kill
// there is reported as `killed-by-ordinary-test` (D41 (d)).
//
// --seed sets TANSTACK_DB_ORACLE_SEED, so random campaigns run the same
// histories every time and captured values stay comparable.
//
// Usage:
//   node scripts/oracle-gaps/index.mjs --package <dir> --oracles <a,b>
//     --source <src/x.ts,...> [--tests <c,d>] [--seed <n>]
//     [--diff-base <rev>] [--out <dir>] [--only <id,id>]
//     [--test-timeout <ms>]   (default 15000; also bounds hooks and teardown.
//                              Each mutant run also has a wall-clock limit of
//                              10 s plus three times its files' unmutated time.)
//     [--sample <n>]          (a fixed-seed sample of n mutants per source)
//     [--contexts <n>]        (warm contexts, one worker each; default
//                              the machine's parallelism minus 2, at most 8)
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { instrument } from './schemata.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].replace(/^--/, ``).split(`=`)
    args[key] = inline ?? argv[++i]
  }
  if (!args.package || !args.oracles || !args.source)
    throw new Error(`--package, --oracles and --source are required`)
  return {
    // Test reports name files by their real path (on macOS, /tmp is
    // /private/tmp), so the package path is resolved the same way.
    pkg: realpathSync(resolve(args.package)),
    oracles: args.oracles.split(`,`),
    // Each warm context runs one mutant at a time with one worker. Measured on
    // main's LocalStorage owners (320 mutants): 2 contexts 297 s, 4 185 s,
    // 8 137 s, with identical oracle-tier classes.
    contexts: Number(
      args.contexts ?? Math.min(8, Math.max(2, availableParallelism() - 2)),
    ),
    tests: args.tests ? args.tests.split(`,`) : [],
    sources: args.source.split(`,`),
    seed: args.seed,
    diffBase: args[`diff-base`],
    out: resolve(args.out ?? `/tmp/oracle-gaps`),
    only: args.only ? new Set(args.only.split(`,`)) : undefined,
    // A fixed-seed random sample of this many mutants per source file, for
    // surveys across many modules.
    sample: args.sample ? Number(args.sample) : undefined,
    // A mutant can make a test hang. Oracles that run in milliseconds do not
    // need Vitest's default limits, which would make each hang cost seconds.
    testTimeout: Number(args[`test-timeout`] ?? 15000),
  }
}

const options = parseArgs(process.argv.slice(2))
mkdirSync(options.out, { recursive: true })
const requireTarget = createRequire(join(options.pkg, `package.json`))
const ts = requireTarget(`typescript`)

// 1. Instrument every source file once.
const instrumented = {}
const mutants = []
for (const source of options.sources) {
  const path = realpathSync(join(options.pkg, source))
  const result = instrument(
    ts,
    path,
    readFileSync(path, `utf8`),
    source,
    mutants.length,
  )
  instrumented[path] = result.code
  mutants.push(...result.mutants)
}
const schemataFile = join(options.out, `schemata.json`)
writeFileSync(schemataFile, JSON.stringify(instrumented))

// The wrapper config adds the harness setup to the package's own config and
// a plugin that serves the instrumented sources in place of the originals.
const wrapper = join(options.pkg, `.oracle-gaps.vitest.config.ts`)
const harness = join(options.pkg, `.oracle-gaps.capture-setup.mjs`)
const stateFile = join(options.out, `state.json`)
function installHarness() {
  copyFileSync(join(here, `capture-setup.mjs`), harness)
  writeFileSync(
    wrapper,
    `import { readFileSync, realpathSync } from 'node:fs'
import { mergeConfig } from 'vitest/config'
import base from './vite.config.ts'
const schemata = JSON.parse(readFileSync(process.env.ORACLE_GAPS_SCHEMATA, 'utf8'))
export default mergeConfig(base, {
  plugins: [{
    name: 'oracle-gaps-schemata',
    enforce: 'pre',
    load(id) {
      const path = id.split('?')[0]
      try { return schemata[realpathSync(path)] } catch { return undefined }
    },
  }],
  test: { setupFiles: ['./.oracle-gaps.capture-setup.mjs'] },
})
`,
  )
}
function removeHarness() {
  rmSync(wrapper, { force: true })
  rmSync(harness, { force: true })
}

// Lines changed relative to the diff base, for diff-scoped summaries.
function diffLines(source) {
  if (!options.diffBase) return undefined
  const child = spawnSync(
    `git`,
    [`diff`, `-U0`, options.diffBase, `--`, source],
    { cwd: options.pkg, encoding: `utf8` },
  )
  const lines = new Set()
  for (const match of child.stdout.matchAll(
    /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    const start = Number(match[1])
    for (let line = start; line < start + Number(match[2] ?? 1); line += 1)
      lines.add(line)
  }
  return lines
}

let runCounter = 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A mutant can hang a run outside any test, in a hook or teardown, where no
// test timeout applies. A run with a time limit that passes it is cancelled
// and reported as timed out; its context is then replaced (see the mutant
// loop), because a cancelled run can leave work behind in its workers.
async function run(
  vitest,
  specs,
  { mutant = null, select = null, limitMs } = {},
) {
  const capture = join(options.out, `run-${++runCounter}.jsonl`)
  const state = { mutant, select: select && [...select], capture }
  // Vitest 3 and 4 both expose the root project's `provide`; the state file
  // remains for setups that cannot `inject`.
  vitest.getRootProject?.().provide(`oracleGaps`, state)
  writeFileSync(stateFile, JSON.stringify(state))
  const started = Date.now()
  const running = vitest.runTestSpecifications(specs, false)
  let timer
  const result =
    limitMs === undefined
      ? await running
      : await Promise.race([
          running,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(undefined), limitMs)
          }),
        ])
  clearTimeout(timer)
  if (result === undefined) {
    await Promise.race([
      vitest.cancelCurrentRun(`keyboard-input`).catch(() => undefined),
      sleep(5000),
    ])
    return {
      timedOut: true,
      result: { testModules: [], unhandledErrors: [] },
      modules: [],
      rows: new Map(),
      seconds: (Date.now() - started) / 1000,
    }
  }
  // The result also lists test modules from earlier runs that this run did
  // not execute, with their old results. Only this run's files count.
  const ran = new Set(specs.map((spec) => spec.moduleId))
  const modules = result.testModules.filter((module) =>
    ran.has(module.moduleId),
  )
  const rows = new Map()
  if (existsSync(capture)) {
    for (const line of readFileSync(capture, `utf8`)
      .split(`\n`)
      .filter(Boolean)) {
      const row = JSON.parse(line)
      if (!select || select.has(row.key)) rows.set(row.key, row)
    }
    rmSync(capture)
  }
  return { result, modules, rows, seconds: (Date.now() - started) / 1000 }
}

// A failure counts as a kill only when it is an assertion. A test that fails
// with any other error after setup is `crashed`: production threw where the
// oracle did not expect it, which the oracle noticed but did not judge
// (ORC-006 "runtime failure after setup outside the intended comparison").
// An error outside any test is `setup-error`. Typed verdicts will make this
// exact; for now the error text decides.
function outcomeOf({ result, modules, timedOut }) {
  if (timedOut) return { outcome: `timeout`, detail: `run time limit` }
  const failures = []
  for (const module of modules) {
    for (const error of module.errors?.() ?? [])
      failures.push({ assertion: false, setup: true, message: error.message })
    for (const testCase of module.children.allTests()) {
      const testResult = testCase.result()
      if (testResult.state !== `failed`) continue
      for (const error of testResult.errors ?? []) {
        const message = `${error.name ?? ``}: ${error.message ?? ``}`
        failures.push({
          test: testCase.fullName,
          // An oracle property's check reports a typed OracleViolation.
          assertion:
            /OracleViolation|AssertionError|Property failed|expected .+ to |Counterexample/.test(
              message,
            ),
          timeout: /Test timed out/.test(message),
          message: message.slice(0, 300),
        })
      }
    }
  }
  for (const error of result.unhandledErrors ?? [])
    failures.push({
      assertion: false,
      message: String(error?.message ?? error),
    })
  if (failures.length === 0) return { outcome: `survived` }
  if (failures.some((f) => f.assertion))
    return {
      outcome: `killed`,
      by: failures.filter((f) => f.assertion).map((f) => f.test),
    }
  if (failures.every((f) => f.timeout)) return { outcome: `timeout` }
  if (failures.some((f) => f.test && !f.timeout))
    return {
      outcome: `crashed`,
      by: failures.filter((f) => f.test).map((f) => f.test),
      detail: failures.find((f) => f.test).message,
    }
  return { outcome: `setup-error`, detail: failures[0].message }
}

process.env.ORACLE_GAPS_STATE = stateFile
process.env.ORACLE_GAPS_SCHEMATA = schemataFile
if (options.seed) process.env.TANSTACK_DB_ORACLE_SEED = options.seed

installHarness()
// Vitest resolves test-file filters and parts of its project setup against
// the working directory, so the runner works from the package directory.
process.chdir(options.pkg)
const { createVitest } = await import(
  pathToFileURL(requireTarget.resolve(`vitest/node`)).href
)
// Two warm contexts with one worker each run two mutants at a time. A mutant
// run usually executes one file, so one context with two workers would leave
// a worker idle. The unmutated runs use the first context.
const contexts = []
let exitCode = 0
const newContext = () =>
  createVitest(`test`, {
    root: options.pkg,
    config: wrapper,
    watch: false,
    maxWorkers: 1,
    bail: Number(process.env.ORACLE_GAPS_BAIL ?? 1),
    testTimeout: options.testTimeout,
    hookTimeout: options.testTimeout,
    teardownTimeout: options.testTimeout,
    typecheck: { enabled: false },
    coverage: { enabled: false },
    reporters: [{}],
  })
// Each context's specs are its own objects, so specs are looked up per
// context by file.
const contextSpecs = new Map()
async function warmContext() {
  const context = await newContext()
  // Vitest 3 calls this step `init`; Vitest 4 renamed it `standalone`.
  await (context.standalone ? context.standalone() : context.init())
  const map = new Map()
  for (const file of [...options.oracles, ...options.tests]) {
    // Filters resolve against the working directory, not `root`, so each
    // file is passed by its absolute path.
    const path = realpathSync(join(options.pkg, file))
    const specs = await context.globTestSpecifications([path])
    if (specs.length === 0) throw new Error(`no test file matches ${file}`)
    map.set(path, specs)
  }
  contextSpecs.set(context, map)
  return context
}
try {
  for (let i = 0; i < options.contexts; i += 1)
    contexts.push(await warmContext())
  const vitest = contexts[0]
  const fileSpecs = contextSpecs.get(vitest)
  const oracleFiles = new Set(
    options.oracles.map((f) => realpathSync(join(options.pkg, f))),
  )
  const fileOf = (key) => key.split(` > `)[0]

  // 2. Two unmutated runs, with the files split across the contexts. A file
  // that fails with no mutant active is left out of the report: it cannot
  // detect anything, and it may read source text that instrumentation changes.
  // Each file's unmutated duration, which sets a mutant run's time limit.
  const fileSeconds = new Map()
  const limitFor = (keys) =>
    10_000 +
    3000 *
      [...new Set(keys.map(fileOf))].reduce(
        (sum, file) => sum + (fileSeconds.get(file) ?? 10),
        0,
      )
  const runAcross = async (files) => {
    const parts = contexts.map(() => [])
    files.forEach((file, index) => parts[index % contexts.length].push(file))
    const runs = await Promise.all(
      contexts.map((context, index) =>
        run(
          context,
          parts[index].flatMap((file) => contextSpecs.get(context).get(file)),
        ),
      ),
    )
    const rows = new Map(runs.flatMap((r) => [...r.rows]))
    for (const r of runs)
      for (const module of r.modules)
        fileSeconds.set(
          module.moduleId,
          Math.max(
            fileSeconds.get(module.moduleId) ?? 0,
            (module.diagnostic?.().duration ?? 0) / 1000,
          ),
        )
    const failed = new Set()
    for (const r of runs)
      for (const module of r.modules)
        if (
          outcomeOf({ result: r.result, modules: [module] }).outcome !==
          `survived`
        )
          failed.add(module.moduleId)
    return { rows, failed, seconds: Math.max(...runs.map((r) => r.seconds)) }
  }
  let files = [...fileSpecs.keys()]
  const first = await runAcross(files)
  const excluded = [...first.failed]
  if (excluded.length > 0) {
    console.error(
      `left out, failing with no mutant active: ${excluded.join(`, `)}`,
    )
    files = files.filter((file) => !first.failed.has(file))
    for (const file of excluded) {
      fileSpecs.delete(file)
      oracleFiles.delete(file)
      for (const key of [...first.rows.keys()])
        if (fileOf(key) === file) first.rows.delete(key)
    }
  }
  const second = await runAcross(files)
  const nondeterministic = new Set()
  for (const [key, row] of first.rows) {
    const again = second.rows.get(key)
    if (
      !row.background &&
      (again?.hash !== row.hash || again?.observed !== row.observed)
    )
      nondeterministic.add(key)
  }
  console.error(
    `unmutated: ${[...first.rows.values()].filter((r) => !r.background).length} tests in ${first.seconds.toFixed(1)}s and ${second.seconds.toFixed(1)}s; nondeterministic: ${nondeterministic.size}`,
  )

  // Which tests reached each site, and which `if` outcomes never occurred in
  // an oracle test.
  const reachedBy = new Map()
  const outcomeSeen = new Map()
  for (const [key, row] of first.rows) {
    for (const id of row.hits)
      reachedBy.set(id, [...(reachedBy.get(id) ?? []), key])
    if (row.background || !oracleFiles.has(fileOf(key))) continue
    for (const [id, [truthy, falsy]] of row.outcomes) {
      const seen = outcomeSeen.get(id) ?? [false, false]
      outcomeSeen.set(id, [seen[0] || truthy, seen[1] || falsy])
    }
  }
  // Reach over every site, by source, so a sampled survey still reports
  // exact reach.
  const reach = Object.fromEntries(
    options.sources.map((source) => {
      const own = mutants.filter((m) => m.source === source)
      const reached = own.filter((m) =>
        (reachedBy.get(m.number) ?? []).some((k) => oracleFiles.has(fileOf(k))),
      )
      return [source, { sites: own.length, reachedByAnOracle: reached.length }]
    }),
  )
  const missingOutcomeLines = new Set()
  for (const mutant of mutants) {
    if (mutant.operator !== `if-true`) continue
    const [truthy, falsy] = outcomeSeen.get(mutant.number) ?? [false, false]
    if (reachedBy.has(mutant.number) && !(truthy && falsy))
      missingOutcomeLines.add(`${mutant.source}:${mutant.line}`)
  }

  // 3–5. Mutants.
  const diffs = new Map(options.sources.map((s) => [s, diffLines(s)]))
  const results = []
  const started = Date.now()
  let queue = mutants.filter((m) => !options.only || options.only.has(m.id))
  if (options.sample !== undefined) {
    // A fixed-seed shuffle, so a survey samples the same mutants every run.
    let seed = 20251102
    const random = () =>
      (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    queue = options.sources.flatMap((source) => {
      const own = queue.filter((m) => m.source === source)
      for (let i = own.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1))
        ;[own[i], own[j]] = [own[j], own[i]]
      }
      return own.slice(0, options.sample)
    })
  }
  // Results are appended as they finish, so a stopped survey keeps them.
  const partial = join(options.out, `results.jsonl`)
  rmSync(partial, { force: true })
  async function evaluate(mutant, vitest) {
    let replace = false
    const specsFor = (keys) =>
      [...new Set(keys.map(fileOf))].flatMap(
        (f) => contextSpecs.get(vitest).get(f) ?? [],
      )
    mutant.inDiff = diffs.get(mutant.source)?.has(mutant.line)
    const keys = reachedBy.get(mutant.number) ?? []
    const oracleKeys = keys.filter((k) => oracleFiles.has(fileOf(k)))
    const testKeys = keys.filter((k) => !oracleFiles.has(fileOf(k)))
    const oracleTargets = [...new Set(oracleKeys.map(fileOf))]
    const testTargets = [...new Set(testKeys.map(fileOf))]
    const result = {
      ...mutant,
      oracleFiles: oracleTargets,
      ordinaryFiles: testTargets,
    }
    if (oracleKeys.length > 0) {
      const mutated = await run(vitest, specsFor(oracleKeys), {
        mutant: mutant.number,
        limitMs: limitFor(oracleKeys),
      })
      if (mutated.timedOut) replace = true
      Object.assign(result, outcomeOf(mutated), { seconds: mutated.seconds })
      if (result.outcome === `survived`) {
        const compared = [...mutated.rows.keys()].filter(
          (k) => !mutated.rows.get(k).background && !nondeterministic.has(k),
        )
        // A changed asserted value or a changed property observation, with no
        // failure, is a difference that the check did not judge.
        result.changedTests = compared.filter(
          (k) =>
            mutated.rows.get(k)?.hash !== first.rows.get(k)?.hash ||
            mutated.rows.get(k)?.observed !== first.rows.get(k)?.observed,
        )
        result.class =
          result.changedTests.length > 0
            ? `comparison-gap`
            : compared.length === 0
              ? `indeterminate`
              : missingOutcomeLines.has(`${mutant.source}:${mutant.line}`)
                ? `generator-gap`
                : `no-observed-difference`
      }
    } else result.outcome = `unreached`
    if (
      (result.outcome === `survived` || result.outcome === `unreached`) &&
      testKeys.length > 0
    ) {
      const tier = await run(vitest, specsFor(testKeys), {
        mutant: mutant.number,
        limitMs: limitFor(testKeys),
      })
      if (tier.timedOut) replace = true
      result.testOutcome = outcomeOf(tier).outcome
      // A crash in an ordinary test is a detection, as it is for an oracle.
      if (
        result.outcome === `unreached` &&
        (result.testOutcome === `killed` || result.testOutcome === `crashed`)
      )
        result.outcome = `killed-by-ordinary-test`
    }
    results.push(result)
    appendFileSync(partial, `${JSON.stringify(result)}\n`)
    console.error(
      `${mutant.id} L${mutant.line} ${mutant.operator} ${result.outcome}${result.class ? ` (${result.class})` : ``}${result.testOutcome ? ` [ordinary: ${result.testOutcome}]` : ``}`,
    )
    return replace
  }
  await Promise.all(
    contexts.map(async (initial, slot) => {
      let context = initial
      for (let mutant = queue.shift(); mutant; mutant = queue.shift()) {
        if (!(await evaluate(mutant, context))) continue
        // A cancelled run can leave work behind, so its context is replaced.
        await Promise.race([
          context.close().catch(() => undefined),
          sleep(10_000),
        ])
        context = await warmContext()
        contexts[slot] = context
      }
    }),
  )
  results.sort(
    (a, b) => a.number - b.number || a.source.localeCompare(b.source),
  )
  const mutantSeconds = (Date.now() - started) / 1000
  console.error(
    `mutant phase: ${results.length} mutants in ${mutantSeconds.toFixed(1)}s`,
  )
  writeFileSync(
    join(options.out, `results.json`),
    JSON.stringify(
      {
        options: { ...options, only: undefined },
        excluded,
        reach,
        nondeterministic: [...nondeterministic],
        mutantSeconds,
        results,
      },
      null,
      1,
    ),
  )
  const summary = summarize(results)
  writeFileSync(join(options.out, `summary.md`), summary)
  console.log(summary)
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  for (const context of contexts) await context.close()
  removeHarness()
}
process.exit(exitCode)

function summarize(results) {
  const count = (rows, predicate) => rows.filter(predicate).length
  const line = (label, rows) =>
    `| ${label} | ${rows.length} | ${count(rows, (r) => r.outcome === `killed`)} | ${count(rows, (r) => r.class === `comparison-gap`)} | ${count(rows, (r) => r.class === `generator-gap`)} | ${count(rows, (r) => r.class === `no-observed-difference`)} | ${count(rows, (r) => r.class === `indeterminate`)} | ${count(rows, (r) => r.outcome === `unreached` || r.outcome === `killed-by-ordinary-test`)} | ${count(rows, (r) => r.outcome === `crashed`)} | ${count(rows, (r) => r.outcome === `setup-error` || r.outcome === `timeout`)} | ${count(rows, (r) => r.testOutcome === `killed` || r.testOutcome === `crashed`)} |`
  const header =
    `| Scope | Mutants | Killed by an oracle | Comparison gap | Generator gap | No observed difference | Indeterminate | No oracle reaches it | Crashed (not an assertion) | Setup error or timeout | Of the uncaught, an ordinary test kills |\n` +
    `|---|---|---|---|---|---|---|---|---|---|---|`
  const byFunction = new Map()
  for (const r of results)
    byFunction.set(r.function, [...(byFunction.get(r.function) ?? []), r])
  const rows = [line(`all`, results)]
  if (results.some((r) => r.inDiff !== undefined))
    rows.push(
      line(
        `diff`,
        results.filter((r) => r.inDiff),
      ),
    )
  const functions = [...byFunction]
    .filter(([, rs]) => rs.some((r) => r.outcome !== `killed`))
    .map(([name, rs]) => line(`fn ${name}`, rs))
  return [
    `# Gap report`,
    ``,
    header,
    ...rows,
    ``,
    `## Functions with gaps`,
    ``,
    header,
    ...functions,
    ``,
  ].join(`\n`)
}
