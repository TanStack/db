// One gap check over a package, cold or through the daemon (index.mjs,
// daemon.mjs).
//
// The evidence of a check is a set of units. A unit is one Vitest run of one
// test file under one mutant spec: an unmutated pass, an operator mutant, or
// an authored patch. Its result is plain data, the outcomes of its tests,
// their errors, its capture rows, and the modules it imported, so the
// classification (`outcomeOf` and the mutant loop) is a pure function of the
// units, the ownership, and the options. A cold run computes every unit. The
// daemon keeps each unit in its evidence store with the hash of every module
// the run imported, as Vitest reports them, and of what was served for each
// instrumented or patched source; a stored unit is reused only while every
// one of those hashes is unchanged. So a check through the daemon reports
// what a cold run reports (the CLI oracle's law 9). Not covered: a file a
// test reads through `fs`, an environment variable other than the seed, and
// a new file that changes how an unchanged import resolves.
//
// A unit's identity also carries the global inputs: this CLI's own files,
// the harness, the Vite config and the files it loads, the package's
// manifest and the lockfile, the Node version, and the options that change a
// run (the seed, the test timeout, and bail).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative as relativePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyAuthored, loadAuthored } from './authored.mjs'
import { assignKeys, renderReport } from './report.mjs'
import { analyze, isRunnerCopy } from './analysis.mjs'
import {
  baselineOf,
  judgeAuthored,
  judgeMutant,
  judgeOrdinary,
  needsOrdinary,
  outcomeOf,
  targetsOf,
} from './classify.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sha1 = (text) => createHash(`sha1`).update(text).digest(`hex`)
// How long a copy of a file with no I/O may sit idle before it is cut off as
// a hang (capture-setup.mjs). The longest idle stretch measured in correct
// tests was 51 ms (79,180 test runs, 2026-11-07), so this is ten times that.
const IDLE_MS = 500
// The least call budget a copy gets (capture-setup.mjs): mutation-helper calls
// in one test before it counts as a loop that never ends. A file's budget is
// a hundred times the most calls any of its unmutated tests made, if more.
const CALL_FLOOR = 100_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// This CLI's own code and the framework it reads. They are part of the run
// identity and of every unit's identity.
const ownFiles = [
  `index.mjs`,
  `args.mjs`,
  `check.mjs`,
  `analysis.mjs`,
  `classify.mjs`,
  `schemata.mjs`,
  `owners.mjs`,
  `report.mjs`,
  `authored.mjs`,
  `capture-setup.mjs`,
  `evidence.mjs`,
  `daemon.mjs`,
  `../../packages/db/tests/oracle-property.ts`,
].map((file) => join(here, file))

// Temporary profiling: with ORACLE_GAPS_PROFILE set, each phase and each
// run appends one JSON line to <out>/profile.jsonl.
let profileFile
const span = (kind, started, fields = {}) => {
  if (!profileFile) return
  appendFileSync(
    profileFile,
    `${JSON.stringify({ kind, ms: Date.now() - started, at: started, ...fields })}\n`,
  )
}

/** A unit's first failure: a failing test and its error, or why it did not run. */
function failureOf(unit) {
  if (unit.timedOut) return `its run timed out`
  const test = unit.tests.find((t) => t.state === `failed`)
  const text = test
    ? `${test.fullName}: ${test.message.split(`\n`)[0]}`
    : (unit.setupErrors[0] ?? unit.unhandled[0] ?? `it failed`)
  return text.slice(0, 300)
}

/** A hash of this CLI's own code and the framework it reads. */
export function codeIdentity() {
  const hash = createHash(`sha1`)
  for (const file of ownFiles)
    hash.update(`${file}\0${existsSync(file) ? readFileSync(file) : ``}\0`)
  return hash.digest(`hex`)
}


/** A sequencer that runs files in the order given. */
class KeepOrder {
  async sort(files) {
    return files
  }
  async shard(files) {
    return files
  }
}

/** Hashes of files by content, memoized by size and modification time. */
function fileHashes() {
  const memo = new Map()
  return (path) => {
    let stat
    try {
      stat = statSync(path)
    } catch {
      return `missing`
    }
    const stamp = `${stat.size}:${stat.mtimeMs}`
    const known = memo.get(path)
    if (known?.stamp === stamp) return known.hash
    const hash = sha1(readFileSync(path))
    memo.set(path, { stamp, hash })
    return hash
  }
}

/** The lockfile that pins the package's dependencies, if any. */
function lockfileOf(pkg) {
  for (let dir = pkg; ; dir = dirname(dir)) {
    for (const name of [`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`])
      if (existsSync(join(dir, name))) return join(dir, name)
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * One-file bundles of the package's workspace dependencies: the packages it
 * reaches by name through a node_modules link to a directory outside any
 * node_modules, and theirs in turn. Vitest otherwise fetches a dependency's
 * built files one at a time, about 150 for `@tanstack/db`, in every context.
 * A bundle sits in its package's own directory, so its bare imports resolve
 * as the package's do; each bundle leaves them external, so a dependency of
 * a dependency loads from its own bundle. It is outside node_modules, so
 * Vitest inlines it, and every copy evaluates it afresh after its module
 * reset (fresh module state, law 3). Its file name carries the hash of its
 * text, so evidence that read it is keyed by what it contains. The package
 * under test is never bundled: its sources are the mutated ones.
 */
export async function workspaceBundles(pkg) {
  const linked = new Map()
  const queue = [pkg]
  while (queue.length > 0) {
    const dir = queue.shift()
    const manifest = JSON.parse(readFileSync(join(dir, `package.json`), `utf8`))
    const names = Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.devDependencies,
    })
    for (const name of names) {
      if (linked.has(name)) continue
      const link = join(dir, `node_modules`, name)
      if (!existsSync(link)) continue
      const real = realpathSync(link)
      if (real.includes(`/node_modules/`) || real === pkg) continue
      linked.set(name, { dir: real, from: dir })
      queue.push(real)
    }
  }
  if (linked.size === 0) return new Map()
  const requireVite = createRequire(createRequire(join(pkg, `package.json`)).resolve(`vite`))
  const esbuild = await import(pathToFileURL(requireVite.resolve(`esbuild`)).href)
  // A package's ESM entry: its `exports` for `.`, under `import`, else
  // `node` or `default`, or its `module` or `main`.
  const entryOf = (dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, `package.json`), `utf8`))
    let entry = manifest.exports?.[`.`] ?? manifest.exports ?? manifest.module ?? manifest.main ?? `index.js`
    while (entry && typeof entry === `object`) entry = entry.import ?? entry.node ?? entry.default
    return join(dir, entry)
  }
  const bundles = new Map()
  for (const [name, { dir }] of linked) {
    const built = await esbuild.build({
      entryPoints: [entryOf(dir)],
      absWorkingDir: dir,
      bundle: true,
      write: false,
      format: `esm`,
      platform: `node`,
      packages: `external`,
      // A package's tsconfig `paths` can point a dependency at its sources;
      // the bundle keeps every package import as the built code has it.
      tsconfigRaw: `{}`,
      logLevel: `silent`,
    })
    const text = built.outputFiles[0].text
    const out = join(dir, `.oracle-gaps`, `bundle-${sha1(text).slice(0, 16)}.mjs`)
    if (!existsSync(out)) {
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, text)
    }
    bundles.set(name, out)
  }
  return bundles
}

/**
 * A session over one package: the TypeScript and Vitest that the package
 * resolves, and warm Vitest contexts that later checks reuse. A cold run
 * opens a session for one check; the daemon keeps one open.
 */
export async function openSession(pkg) {
  const requireTarget = createRequire(join(pkg, `package.json`))
  const ts = requireTarget(`typescript`)
  const { createVitest } = await import(
    pathToFileURL(requireTarget.resolve(`vitest/node`)).href
  )
  // Each process uses its own harness files, so a cold run beside the daemon
  // cannot remove the daemon's.
  const harness = join(pkg, `.oracle-gaps-${process.pid}.capture-setup.mjs`)
  copyFileSync(join(here, `capture-setup.mjs`), harness)
  // One wrapper config per context. Each serves its own context's patched
  // sources, so authored mutants run in every context at once without one
  // seeing another's patch.
  const wrappers = new Map()
  const wrapperFor = (index) => {
    if (!wrappers.has(index)) {
      const wrapper = join(pkg, `.oracle-gaps-${process.pid}-${index}.vitest.config.ts`)
      writeFileSync(
        wrapper,
        `import { realpathSync } from 'node:fs'
import { mergeConfig } from 'vitest/config'
import base from './vite.config.ts'
export default mergeConfig(base, {
  plugins: [{
    name: 'oracle-gaps-schemata',
    enforce: 'pre',
    // A workspace dependency loads from its one-file bundle (workspaceBundles).
    resolveId(source) {
      return globalThis.__oracleGapsBundles?.get(source)
    },
    load(id) {
      const path = id.split('?')[0]
      // This context's authored patch, or else the instrumented source of the
      // current check, both set by the runner in this process.
      try {
        const real = realpathSync(path)
        return globalThis.__oracleGapsServe?.[${index}]?.get(real) ?? globalThis.__oracleGapsSchemata?.get(real)
      } catch { return undefined }
    },
  }],
  test: { setupFiles: ['./${harness.split(`/`).at(-1)}'] },
})
`,
      )
      wrappers.set(index, wrapper)
    }
    return wrappers.get(index)
  }
  globalThis.__oracleGapsServe = []
  // Vitest resolves test-file filters and parts of its project setup against
  // the working directory, so the runner works from the package directory.
  process.chdir(pkg)
  const hashOf = fileHashes()
  // The text served for each path in the current check, and the hash each
  // context last served, so a changed file is invalidated in the warm
  // contexts before it is read again.
  globalThis.__oracleGapsSchemata = new Map()
  const servedHash = (path, index) => {
    const text =
      globalThis.__oracleGapsServe[index]?.get(path) ??
      globalThis.__oracleGapsSchemata.get(path)
    return text === undefined ? hashOf(path) : sha1(text)
  }
  // Per context: the hash of what it last served for each path.
  const lastServed = new Map()
  const servedBy = (index) => {
    if (!lastServed.has(index)) lastServed.set(index, new Map())
    return lastServed.get(index)
  }
  const indexOf = new Map()
  let contexts = []
  let contextsKey
  let contextsConfig
  const contextSpecs = new Map()
  let runCounter = 0

  async function warmContext(settings, index) {
    const context = await createVitest(`test`, {
      root: pkg,
      config: wrapperFor(index),
      watch: false,
      maxWorkers: 1,
      // Every test in a file runs, so a kill is attributed to each route
      // that produces it (see routeOf). A property still stops at its first
      // failure.
      bail: settings.bail,
      testTimeout: settings.testTimeout,
      hookTimeout: settings.testTimeout,
      teardownTimeout: settings.testTimeout,
      typecheck: { enabled: false },
      coverage: { enabled: false },
      // Vitest 5 caches transformed modules on disk by default, keyed by
      // the file, not by what this runner's plugin serves for it, so a
      // patched or instrumented source could come back as an earlier text.
      // Vitest 4 caches nothing unless asked.
      fsModuleCache: false,
      // Every module each test file imports, which a unit records as its
      // inputs.
      experimental: { importDurations: { limit: 1_000_000 } },
      // A batch runs copies of test files in one worker, sharing its
      // environment (runBatch), in the order given, so a hang is attributed
      // to the copy that was running.
      isolate: false,
      // Worker threads start much faster than child processes, and each
      // batch starts one (`--pool`; see args.mjs).
      pool: settings.pool,
      sequence: { sequencer: KeepOrder },
      reporters: [{}],
    })
    // Vitest 3 calls this step `init`; Vitest 4 renamed it `standalone`.
    await (context.standalone ? context.standalone() : context.init())
    indexOf.set(context, index)
    lastServed.delete(index)
    return context
  }
  async function globSpecs(context) {
    // A warm context caches the test files it found; a file added since the
    // last check, such as a new oracle file, appears only after the cache is
    // cleared.
    context.clearSpecificationsCache?.()
    const map = new Map()
    for (const spec of await context.globTestSpecifications()) {
      if (isRunnerCopy(spec.moduleId)) continue
      map.set(spec.moduleId, [...(map.get(spec.moduleId) ?? []), spec])
    }
    contextSpecs.set(context, map)
  }
  async function closeContexts() {
    await Promise.all(
      contexts.map((context) =>
        Promise.race([context.close().catch(() => undefined), sleep(10_000)]),
      ),
    )
    contexts = []
    lastServed.clear()
  }
  // This process's harness files are generated from this CLI's own files,
  // which every key covers, and their names carry the process id, so they
  // are left out of every key and input.
  const ownHarness = (path) => path.startsWith(`${pkg}/.oracle-gaps-${process.pid}`)
  // The files the Vite config loaded, for the global key.
  const configFiles = () =>
    (contexts[0]?.vite?.config?.configFileDependencies ?? []).filter(
      (path) => !ownHarness(path),
    )

  /** Invalidates every path whose served text changed since a context read it. */
  function invalidateChanged(paths, only) {
    for (const context of only ? [only] : contexts) {
      const index = indexOf.get(context)
      const served = servedBy(index)
      for (const path of paths) {
        const hash = servedHash(path, index)
        if (served.get(path) === hash) continue
        context.invalidateFile(path)
        served.set(path, hash)
      }
    }
  }

  // Cancels a context's run so that its close stops the workers at once.
  // Vitest 5 stops a worker by asking it to and waits up to a minute for
  // the answer, which a worker stuck in a synchronous loop never gives; a
  // second cancel while the first is under way stops it by force, as a
  // second Ctrl+C does. Vitest 4 needs only the first.
  function forceCancel(context) {
    context.cancelCurrentRun(`keyboard-input`).catch(() => undefined)
    context.cancelCurrentRun(`keyboard-input`).catch(() => undefined)
  }

  /** One Vitest run of one test file, as plain data. */
  async function runUnit(
    context,
    out,
    file,
    {
      mutant = null,
      seed = null,
      limitMs,
      select = null,
      stopOnKill = false,
      ignore = [],
    } = {},
  ) {
    const capture = join(out, `run-${process.pid}-${++runCounter}.jsonl`)
    const state = { mutant, select, capture, seed, stopOnKill, ignore }
    // Vitest 3 and 4 both expose the root project's `provide`; the state file
    // remains for setups that cannot `inject`.
    context.getRootProject?.().provide(`oracleGaps`, state)
    writeFileSync(join(out, `state.json`), JSON.stringify(state))
    const started = Date.now()
    const running = context.runTestSpecifications(
      contextSpecs.get(context).get(file) ?? [],
      false,
    )
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
    const seconds = (Date.now() - started) / 1000
    const profiled = {
      file: file.split(`/`).at(-1),
      mutant,
      select: select?.length ?? null,
      limitMs,
    }
    if (result === undefined) {
      // A run cut off is cancelled without waiting: a worker stuck in a
      // synchronous loop never answers. The cancel lets the caller's
      // replacement close the context at once, which stops the worker (a
      // close with no cancel waits for the run).
      running.catch(() => undefined)
      forceCancel(context)
      span(`run`, started, { ...profiled, timedOut: true })
      rmSync(capture, { force: true })
      return { file, timedOut: true, seconds }
    }
    // The result also lists test modules from earlier runs, with their old
    // results. Only this run's file counts.
    const modules = result.testModules.filter((m) => m.moduleId === file)
    if (profileFile) {
      const d = modules[0]?.diagnostic?.() ?? {}
      const states = modules.flatMap((m) =>
        [...m.children.allTests()].map((t) => t.result().state),
      )
      span(`run`, started, {
        ...profiled,
        tests: states.length,
        ran: states.filter((x) => x !== `skipped`).length,
        environment: Math.round(d.environmentSetupDuration ?? 0),
        prepare: Math.round(d.prepareDuration ?? 0),
        collect: Math.round(d.collectDuration ?? 0),
        setup: Math.round(d.setupDuration ?? 0),
        testsMs: Math.round(d.duration ?? 0),
      })
    }
    const rows = []
    if (existsSync(capture)) {
      for (const line of readFileSync(capture, `utf8`).split(`\n`).filter(Boolean)) {
        const row = JSON.parse(line)
        // A closing row marks the end of a file for a batch's watchdog.
        if (!row.closed && !row.idle) rows.push([row.key, row])
      }
      rmSync(capture)
    }
    const tests = modules.flatMap((module) =>
      [...module.children.allTests()].map((testCase) => {
        const testResult = testCase.result()
        return {
          key: `${module.moduleId} > ${testCase.fullName}`,
          fullName: testCase.fullName,
          state: testResult.state,
          // fast-check attaches the error its predicate threw as the cause.
          message: (testResult.errors ?? [])
            .map((error) => {
              const cause = error.cause
              return cause?.message
                ? `${cause.name ?? ``}: ${cause.message}`
                : `${error.name ?? ``}: ${error.message ?? ``}`
            })
            .join(`\n`),
        }
      }),
    )
    return {
      file,
      timedOut: false,
      seconds,
      // The file's own time: loading and collecting it, and its tests.
      duration: Math.max(
        0,
        ...modules.map((m) => {
          const d = m.diagnostic?.() ?? {}
          return ((d.collectDuration ?? 0) + (d.duration ?? 0)) / 1000
        }),
      ),
      setupErrors: modules.flatMap((m) =>
        (m.errors?.() ?? []).map((error) => error.message),
      ),
      tests,
      unhandled: (result.unhandledErrors ?? []).map((error) =>
        String(error?.message ?? error),
      ),
      rows,
      inputs: [
        ...new Set([
          file,
          ...modules.flatMap((m) =>
            Object.keys(m.diagnostic?.().importDurations ?? {}),
          ),
        ]),
      ].filter((path) => path.startsWith(`/`) && !ownHarness(path)),
    }
  }

  /**
   * Many units in one Vitest run. Each item runs in its own copy of its test
   * file, next to the original so that its imports resolve. The worker keeps
   * its environment between copies, and the capture setup gives each copy
   * its own mutant and a fresh module registry. A copy that passes its time
   * limit is cut off: the copies before it keep their results, it is
   * `timedOut`, and the caller reruns the rest. Returns one unit per
   * finished item, in order, and the index of the item that timed out.
   */
  let copyCounter = 0
  async function runBatch(context, out, items, seed) {
    const capture = join(out, `run-${process.pid}-${++runCounter}.jsonl`)
    const copies = items.map((item) => {
      const copy = join(
        dirname(item.file),
        `.oracle-gaps-${process.pid}-${++copyCounter}-${basename(item.file)}`,
      )
      writeFileSync(copy, readFileSync(item.file))
      return copy
    })
    const keyFor = (copy, file) => (key) =>
      key.startsWith(`${copy} > `) ? `${file}${key.slice(copy.length)}` : key
    // A file's test keys, named as its copy names them.
    const inCopy = (copy, file, keys) =>
      keys.map((key) =>
        key.startsWith(`${file} > `) ? `${copy}${key.slice(file.length)}` : key,
      )
    const units = Object.fromEntries(
      copies.map((copy, i) => [
        copy,
        {
          mutant: items[i].mutant ?? null,
          select: items[i].select ? inCopy(copy, items[i].file, items[i].select) : null,
          stopOnKill: items[i].stopOnKill ?? false,
          ignore: inCopy(copy, items[i].file, items[i].ignore ?? []),
          idleMs: items[i].idleMs ?? null,
          callBudget: items[i].callBudget ?? null,
          idleHorizonMs: items[i].idleHorizonMs ?? null,
        },
      ]),
    )
    const state = { mutant: null, select: null, capture, seed, units }
    context.getRootProject?.().provide(`oracleGaps`, state)
    writeFileSync(join(out, `state.json`), JSON.stringify(state))
    const project = context.getRootProject()
    const started = Date.now()
    const running = context.runTestSpecifications(
      copies.map((copy) => project.createSpecification(copy)),
      false,
    )
    // The watchdog: each copy writes a closing row when it finishes, so the
    // copy that is running is the first without one. A copy that passes its
    // file's time limit is cut off.
    // A copy that reported itself idle, or past its call budget, is cut off
    // at once (capture-setup.mjs).
    const idle = new Set()
    const spun = new Set()
    // When each copy's spin row was first seen. The budget's throw usually
    // ends the loop and the copy finishes on its own; a copy still running
    // IDLE_MS after it spun swallowed the throw and is cut off.
    const spunAt = new Map()
    const finished = () => {
      if (!existsSync(capture)) return 0
      const done = new Set()
      for (const line of readFileSync(capture, `utf8`).split(`\n`)) {
        if (line.includes(`"closed":true`)) done.add(JSON.parse(line).file)
        if (line.includes(`"idle":true`)) idle.add(JSON.parse(line).file)
        if (line.includes(`"spin":true`)) {
          const file = JSON.parse(line).file
          spun.add(file)
          if (!spunAt.has(file)) spunAt.set(file, Date.now())
        }
      }
      return copies.findIndex((copy) => !done.has(copy))
    }
    let current = 0
    let copyStarted = Date.now()
    let timer
    const watchdog = new Promise((resolve) => {
      const poll = () => {
        const at = finished()
        if (at === -1) return
        if (at !== current) {
          current = at
          copyStarted = Date.now()
        }
        if (
          idle.has(copies[current]) ||
          Date.now() - (spunAt.get(copies[current]) ?? Infinity) > IDLE_MS ||
          Date.now() - copyStarted > items[current].limitMs
        )
          return resolve(undefined)
        timer = setTimeout(poll, 50)
      }
      timer = setTimeout(poll, 50)
    })
    const result = await Promise.race([running, watchdog])
    clearTimeout(timer)
    const seconds = (Date.now() - started) / 1000
    // Each copy's rows, and the copies that skipped their tests because an
    // earlier copy in the batch killed their mutant.
    const skipped = new Set()
    const rowsOf = () => {
      const rows = new Map(copies.map((copy) => [copy, []]))
      if (existsSync(capture))
        for (const line of readFileSync(capture, `utf8`).split(`\n`).filter(Boolean)) {
          const row = JSON.parse(line)
          const copy = copies.find((c) => row.key?.startsWith(`${c} > `) || row.file === c)
          if (copy && row.skipped) skipped.add(copy)
          if (copy && row.spin) spun.add(copy)
          if (copy && !row.closed && !row.idle && !row.spin) rows.get(copy).push(row)
        }
      return rows
    }
    const skippedUnit = (item) => ({ file: item.file, skipped: true })
    // A copy that ran past its call budget, even one whose throw ended the
    // loop and let it finish, is a timeout as it stands (a count, not a
    // clock: no confirming run).
    const spunUnit = (item) => ({ file: item.file, timedOut: true, spin: true, seconds })
    try {
      if (result === undefined) {
        // Cancelled without waiting; the caller replaces the context (see
        // runUnit).
        running.catch(() => undefined)
        forceCancel(context)
        span(`run`, started, { file: `batch`, items: items.length, timedOut: current })
        // The copies before the one that hung finished: their units come
        // from their capture rows.
        const rows = rowsOf()
        return {
          units: items.slice(0, current).map((item, i) => {
            if (skipped.has(copies[i])) return skippedUnit(item)
            if (spun.has(copies[i])) return spunUnit(item)
            const map = keyFor(copies[i], item.file)
            const own = rows.get(copies[i]).map((row) => ({ ...row, key: map(row.key) }))
            return {
              file: item.file,
              timedOut: false,
              seconds: seconds / items.length,
              setupErrors: [],
              tests: own
                .filter((row) => !row.background)
                .map((row) => ({
                  key: row.key,
                  fullName: row.key.split(` > `).slice(1).join(` > `),
                  state: row.state === `fail` ? `failed` : row.state === `skip` ? `skipped` : `passed`,
                  message: row.message ?? ``,
                })),
              unhandled: [],
              rows: own.map((row) => [row.key, row]),
            }
          }),
          timedOutAt: current,
          idle: idle.has(copies[current]),
          spin: spun.has(copies[current]),
        }
      }
      // Errors outside any test cannot be attributed to one copy, so the
      // caller runs those items alone.
      if ((result.unhandledErrors ?? []).length > 0) return { units: [], unattributed: true }
      const rows = rowsOf()
      span(`run`, started, { file: `batch`, items: items.length })
      return {
        units: items.map((item, i) => {
          const copy = copies[i]
          if (skipped.has(copy)) return skippedUnit(item)
          if (spun.has(copy)) return spunUnit(item)
          const map = keyFor(copy, item.file)
          const modules = result.testModules.filter((m) => m.moduleId === copy)
          return {
            file: item.file,
            timedOut: false,
            seconds: Math.max(0, ...modules.map((m) => (m.diagnostic?.().duration ?? 0) / 1000)),
            setupErrors: modules.flatMap((m) =>
              (m.errors?.() ?? []).map((error) => error.message),
            ),
            tests: modules.flatMap((module) =>
              [...module.children.allTests()].map((testCase) => {
                const testResult = testCase.result()
                return {
                  key: map(`${module.moduleId} > ${testCase.fullName}`),
                  fullName: testCase.fullName,
                  state: testResult.state,
                  message: (testResult.errors ?? [])
                    .map((error) => {
                      const cause = error.cause
                      return cause?.message
                        ? `${cause.name ?? ``}: ${cause.message}`
                        : `${error.name ?? ``}: ${error.message ?? ``}`
                    })
                    .join(`\n`),
                }
              }),
            ),
            unhandled: [],
            rows: rows.get(copy).map((row) => [map(row.key), { ...row, key: map(row.key) }]),
          }
        }),
      }
    } finally {
      for (const copy of copies) rmSync(copy, { force: true })
      rmSync(capture, { force: true })
    }
  }

  async function check(options, store, log = console.error) {
    const authored = options.mutants ? loadAuthored(options.mutants) : []
    mkdirSync(options.out, { recursive: true })
    profileFile = process.env.ORACLE_GAPS_PROFILE
      ? join(options.out, `profile.jsonl`)
      : undefined
    if (profileFile) rmSync(profileFile, { force: true })
    const checkStarted = Date.now()
    let phase = Date.now()
    const endPhase = (name, fields) => {
      span(`phase`, phase, { name, ...fields })
      phase = Date.now()
    }
    // The state file is the fallback for setups that cannot `inject`.
    process.env.ORACLE_GAPS_STATE = join(options.out, `state.json`)
    // Workspace dependencies load from one-file bundles (workspaceBundles),
    // which are part of the settings: a changed dependency warms the
    // contexts again and changes the evidence key.
    const bundles = await workspaceBundles(pkg)
    globalThis.__oracleGapsBundles = bundles
    const settings = {
      testTimeout: options.testTimeout,
      pool: options.pool,
      bail: Number(process.env.ORACLE_GAPS_BAIL ?? 0),
      bundles: [...bundles],
    }
    // Contexts are warmed again when their settings or the Vite config they
    // loaded changed.
    const configHash = () =>
      sha1(JSON.stringify(configFiles().map((file) => [file, hashOf(file)])))
    if (
      JSON.stringify(settings) !== contextsKey ||
      (contexts.length > 0 && configHash() !== contextsConfig)
    ) {
      await closeContexts()
      for (let i = 0; i < options.contexts; i += 1)
        contexts.push(await warmContext(settings, i))
      contextsKey = JSON.stringify(settings)
      contextsConfig = configHash()
    }
    while (contexts.length < options.contexts)
      contexts.push(await warmContext(settings, contexts.length))
    endPhase(`warm contexts`, { contexts: contexts.length })
    for (const context of contexts) await globSpecs(context)
    endPhase(`find test files`)

    // 1. The static half (analysis.mjs): instrumented sources, mutants,
    // declarations, and ownership. A broken declaration refuses the run.
    const { instrumented, mutants, declarations, owned } = analyze(
      ts,
      pkg,
      options.sources,
      [...contextSpecs.get(contexts[0]).keys()],
    )
    const previous = [...globalThis.__oracleGapsSchemata.keys()]
    globalThis.__oracleGapsSchemata = instrumented
    invalidateChanged(
      new Set([
        ...previous,
        ...instrumented.keys(),
        ...[...lastServed.values()].flatMap((served) => [...served.keys()]),
      ]),
    )
    endPhase(`static analysis`, { mutants: mutants.length })

    // The global inputs of every unit.
    const lockfile = lockfileOf(pkg)
    const globalKey = sha1(
      JSON.stringify([
        // The harness is this CLI's capture setup and a wrapper that
        // check.mjs writes, both covered by `ownFiles`; their file names
        // carry the process id, so they are not part of the key.
        [...ownFiles, join(pkg, `package.json`), ...configFiles(), ...(lockfile ? [lockfile] : [])]
          .sort()
          .map((file) => [file, hashOf(file)]),
        process.version,
        options.seed ?? null,
        settings,
        // A run cut off under one limit may end under a longer one.
        options.hangLimit,
      ]),
    )
    // How the evidence was produced: units reused and computed, runs cut off
    // at their time limit or for idleness (of them, `idle`), items rerun
    // after a cut-off batch, and mutants that changed no value and so needed
    // no run.
    const evidence = { reused: 0, computed: 0, cut: 0, idle: 0, spin: 0, rerun: 0, unchanged: 0 }
    // Each file's imports in its unmutated run. A run that timed out reports
    // none, so it is stored under these: a mutant changes no import.
    const fileInputs = new Map()
    // The tests whose verdicts cannot stop a run (see `ignoredIn`) are part
    // of a unit's id: they change which tests run.
    const idOf = (file, spec, select, ignore = []) =>
      sha1(JSON.stringify([globalKey, file, spec, select ?? null, ignore]))
    // A run is reused when every input of one of its stored versions is
    // unchanged; undoing an edit finds the version from before it.
    const lookup = (id, index) =>
      store
        .get(id)
        ?.variants.find((variant) =>
          variant.inputs.every(([path, hash]) => servedHash(path, index) === hash),
        )
    // A batch item reads the modules its file's unmutated run read: a mutant
    // changes no import.
    const remember = (id, file, result, index) => {
      const paths = fileInputs.get(file)
      if (!paths) return
      const inputs = paths.map((path) => [path, servedHash(path, index)])
      store.put(id, { inputs, unit: result })
    }
    async function unit(context, file, spec, runOptions = {}) {
      const index = indexOf.get(context)
      const id = idOf(file, spec, runOptions.select, runOptions.ignore)
      const looked = Date.now()
      const valid = lookup(id, index)
      span(`lookup`, looked, { file: file.split(`/`).at(-1), spec, hit: Boolean(valid) })
      if (valid) {
        evidence.reused += 1
        if (spec.startsWith(`unmutated:`) && valid.unit.inputs)
          fileInputs.set(file, valid.unit.inputs)
        return valid.unit
      }
      const result = await runUnit(context, options.out, file, {
        seed: options.seed ?? null,
        ...runOptions,
      })
      evidence.computed += 1
      if (result.timedOut) evidence.cut += 1
      const paths = result.timedOut ? fileInputs.get(file) : result.inputs
      if (!result.timedOut && spec.startsWith(`unmutated:`))
        fileInputs.set(file, result.inputs)
      if (paths) {
        const inputs = paths.map((path) => [path, servedHash(path, index)])
        for (const [path, hash] of inputs) servedBy(index).set(path, hash)
        store.put(id, { inputs, unit: result })
      }
      return result
    }
    // Units for many requests at once. Each is looked up first; the rest run
    // as one batch (runBatch). A batch cut off by a hang queues that item's
    // confirming run, which any free slot takes, and reruns the rest in a
    // fresh context; a batch with
    // errors outside any test runs its items alone. `needed` says, from the
    // units found so far, whether a request must still run; a request that
    // need not run, or whose copy skipped its tests, gets no unit.
    async function unitsBatch(slot, requests, needed = () => true) {
      const index = indexOf.get(slot.context)
      const got = new Array(requests.length)
      let rest = []
      // The confirming runs of hung copies, which may run on other slots.
      const confirming = []
      const settle = (request, u, at) => {
        if (u.skipped) return
        got[request.i] = u
        remember(request.id, request.file, u, at)
        evidence.computed += 1
      }
      requests.forEach((request, i) => {
        const id = idOf(request.file, request.spec, request.select, request.ignore)
        const valid = lookup(id, index)
        if (valid) {
          evidence.reused += 1
          got[i] = valid.unit
        } else rest.push({ ...request, i, id })
      })
      for (;;) {
        rest = rest.filter((r) => needed(r, got))
        if (rest.length === 0) break
        const batch = await runBatch(slot.context, options.out, rest, options.seed ?? null)
        if (batch.unattributed) {
          for (const r of rest)
            if (needed(r, got)) {
              got[r.i] = await unit(slot.context, r.file, r.spec, {
                mutant: r.mutant,
                select: r.select,
                stopOnKill: r.stopOnKill,
                ignore: r.ignore,
                limitMs: r.limitMs,
              })
              if (got[r.i].timedOut) await replace(slot)
            }
          break
        }
        batch.units.forEach((u, k) => {
          if (u.skipped) return
          if (u.spin) evidence.spin += 1
          got[rest[k].i] = u
          remember(rest[k].id, rest[k].file, u, index)
          evidence.computed += 1
        })
        if (batch.timedOutAt === undefined) break
        // A copy past its first budget may only be slow: a loaded machine
        // slows a run that ends. It runs again alone, in a fresh context,
        // with the full limit, and only a run cut off there too is a timeout.
        const hung = rest[batch.timedOutAt]
        const full = limitFor(hung.file)
        evidence.cut += 1
        if (batch.idle) evidence.idle += 1
        if (batch.spin) evidence.spin += 1
        await replace(slot)
        // A copy that already had the full limit, or that sat idle, is
        // final; any other is confirmed on the next free slot, so a mutant
        // that hangs in several files confirms them in parallel.
        if (hung.limitMs >= full || batch.idle || batch.spin)
          settle(hung, { file: hung.file, timedOut: true, seconds: full / 1000 }, index)
        else
          confirming.push(
            new Promise((resolve, reject) =>
              confirm((other) =>
                confirmAlone(other, hung, full).then(resolve, reject),
              ),
            ).then(({ unit: u, at }) =>
              // A run with errors outside any test is not remembered.
              at === undefined ? (got[hung.i] = u) : settle(hung, u, at),
            ),
          )
        rest = rest.slice(batch.timedOutAt + 1)
        evidence.rerun += rest.length
      }
      // This slot takes what no other slot has, then waits for the rest.
      await confirmOn(slot)
      await Promise.all(confirming)
      return got
    }
    // A hung copy's confirming run: alone, in a clean context, with the full
    // limit. Only a run cut off there too is a timeout. An idle copy in a
    // file with no I/O is final at once (see unitsBatch): it waits on
    // nothing that can come.
    async function confirmAlone(slot, hung, full) {
      const alone = await runBatch(
        slot.context,
        options.out,
        [{ ...hung, limitMs: full }],
        options.seed ?? null,
      )
      if (alone.unattributed) {
        const u = await unit(slot.context, hung.file, hung.spec, {
          mutant: hung.mutant,
          select: hung.select,
          stopOnKill: hung.stopOnKill,
          ignore: hung.ignore,
          limitMs: full,
        })
        if (u.timedOut) await replace(slot)
        return { unit: u }
      }
      // The index of the context that ran it, before any replacement.
      const at = indexOf.get(slot.context)
      if (alone.timedOutAt === 0) {
        evidence.cut += 1
        if (alone.idle) evidence.idle += 1
        await replace(slot)
        return { unit: { file: hung.file, timedOut: true, seconds: full / 1000 }, at }
      }
      return { unit: alone.units[0], at }
    }

    const vitest = contexts[0]
    const fileSpecs = new Map(contextSpecs.get(vitest))
    const relative = (file) => file.slice(pkg.length + 1)
    const oracleFiles = new Set(declarations.keys())
    const runIdentity = identityOf(options, authored, [...fileSpecs.keys()], oracleFiles.size)
    const fileOf = (key) => key.split(` > `)[0]

    // 2. Two unmutated runs of each file, split across the contexts. A file
    // that fails with no mutant active is left out of the report: it cannot
    // detect anything, and it may read source text that instrumentation
    // changes. Each file's unmutated duration sets a mutant run's time limit.
    const fileSeconds = new Map()
    // A mutant can slow a run that still ends, for example by lengthening a
    // retry backoff, and a loaded machine slows every run. A mutant run
    // first gets a short budget (`--first-limit`); a copy cut off there runs
    // again alone, with the full limit (`--hang-limit`, 10 s by default:
    // a 5 s base once turned a slow kill into a timeout), and only a run
    // cut off there too is a timeout (see unitsBatch).
    const limitFor = (file) => options.hangLimit + 3000 * (fileSeconds.get(file) ?? 10)
    const firstLimitFor = (file) =>
      Math.min(limitFor(file), options.firstLimit + 3000 * (fileSeconds.get(file) ?? 10))
    // A run cut off is still running, so its context is replaced; closing
    // it stops the worker.
    const replace = async (slot) => {
      const started = Date.now()
      await Promise.race([slot.context.close().catch(() => undefined), sleep(10_000)])
      slot.context = await warmContext(settings, slot.index)
      await globSpecs(slot.context)
      contexts[slot.index] = slot.context
      span(`replace context`, started, { slot: slot.index })
    }
    // Confirming runs of hung copies (unitsBatch), waiting for a free slot.
    // A slot takes them before its next group, and a slot with no groups
    // left waits for more until every slot is done with its groups.
    const confirmations = []
    const waiting = []
    const wake = () => {
      for (const resolve of waiting.splice(0)) resolve()
    }
    const confirm = (job) => {
      confirmations.push(job)
      wake()
    }
    const confirmOn = async (slot) => {
      for (let job = confirmations.shift(); job; job = confirmations.shift()) await job(slot)
    }
    // `after(index)` is more work for context `index` once its files ran.
    const runAcross = async (files, pass, after = async () => {}) => {
      const parts = contexts.map(() => [])
      files.forEach((file, index) => parts[index % contexts.length].push(file))
      const units = (
        await Promise.all(
          contexts.map(async (context, index) => {
            const done = []
            for (const file of parts[index])
              done.push(await unit(context, file, `unmutated:${pass}`))
            await after(index)
            return done
          }),
        )
      ).flat()
      const rows = new Map(units.flatMap((u) => u.rows ?? []))
      for (const u of units)
        fileSeconds.set(u.file, Math.max(fileSeconds.get(u.file) ?? 0, u.duration ?? 0))
      // Each failing file, with its first failure, so a refusal says why.
      const failed = new Map(
        units
          .filter((u) => outcomeOf([u]).outcome !== `survived`)
          .map((u) => [u.file, failureOf(u)]),
      )
      return { rows, units, failed, seconds: Math.max(0, ...units.map((u) => u.seconds)) }
    }
    // Without --ordinary, only oracle files run.
    let files = [...fileSpecs.keys()].filter(
      (file) => options.ordinary || oracleFiles.has(file),
    )
    const first = await runAcross(files, 1)
    endPhase(`unmutated pass 1`, { files: files.length })
    if (profileFile)
      for (const [key, row] of first.rows)
        if (row.histories)
          span(`baseline histories`, Date.now(), {
            key,
            histories: row.histories,
            sites: row.siteHistories,
          })
    // An oracle file that fails with no mutant active cannot judge the code
    // it owns, so the run refuses rather than report that code as unowned.
    const failingOwners = [...first.failed.keys()].filter((file) =>
      oracleFiles.has(file),
    )
    if (failingOwners.length > 0)
      throw new Error(
        `oracle files fail with no mutant active, so their owned code cannot be judged: ${failingOwners.map((file) => `${relative(file)} (${first.failed.get(file)})`).join(`, `)}`,
      )
    const excluded = [...first.failed.keys()]
    if (excluded.length > 0) {
      log(`left out, failing with no mutant active: ${excluded.join(`, `)}`)
      files = files.filter((file) => !first.failed.has(file))
      for (const file of excluded) {
        fileSpecs.delete(file)
        oracleFiles.delete(file)
        for (const key of [...first.rows.keys()])
          if (fileOf(key) === file) first.rows.delete(key)
      }
    }
    const ownersOf = (mutant) => owned.of(mutant.source, mutant.function)
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
    // The tests of a file that a mutant must run: every test from the first
    // one that reached its site. A later test can see the mutant through
    // state that a reaching test changed, so only the tests before the
    // first reaching one are left out, and only when running the rest with
    // no mutant active reproduces what they recorded when the whole file
    // ran: a later test can depend on state that a left-out test set. Reach
    // comes from the first pass alone, so every mutant's selections are
    // known before the second, and their checks run beside it, on the
    // contexts it leaves idle.
    const selectionOf = (file, keys) => {
      if (keys.some((k) => k === `${file} > (background)`)) return null
      const all = [...first.rows.keys()].filter(
        (k) => fileOf(k) === file && !first.rows.get(k).background,
      )
      const reaching = new Set(keys)
      const at = all.findIndex((k) => reaching.has(k))
      return at <= 0 ? null : all.slice(at)
    }
    const selectionId = (file, selection) => `${file}\0${selection.join(`\0`)}`
    const reproduces = (selection, run) => {
      const rows = new Map(run.rows ?? [])
      return (
        !run.timedOut &&
        outcomeOf([run]).outcome === `survived` &&
        selection.every(
          (k) =>
            rows.get(k)?.hash === first.rows.get(k)?.hash &&
            rows.get(k)?.observed === first.rows.get(k)?.observed,
        )
      )
    }
    const selectionChecks = new Map()
    const planned = new Map()
    const reach = baselineOf(first.rows, first.rows, oracleFiles)
    for (const mutant of queue) {
      const owners = ownersOf(mutant)
      if (owners.size === 0) continue
      const { oracleKeys, oracleTargets } = targetsOf(mutant, reach, owners, oracleFiles)
      for (const file of oracleTargets) {
        const selection = selectionOf(file, oracleKeys)
        if (selection) planned.set(selectionId(file, selection), { file, selection })
      }
    }
    // Each context's share of the checks: contexts that run no second-pass
    // file take theirs first.
    const shares = contexts.map(() => [])
    const byLoad = contexts
      .map((_, index) => index)
      .sort((a, b) => (a < files.length) - (b < files.length) || a - b)
    ;[...planned.entries()].forEach(([id, item], i) =>
      shares[byLoad[i % byLoad.length]].push({ id, ...item }),
    )
    const checkShare = async (index) => {
      const share = shares[index]
      if (share.length === 0) return
      const slot = { context: contexts[index], index }
      const runs = await unitsBatch(
        slot,
        share.map(({ file, selection }) => ({
          file,
          spec: `selected`,
          mutant: null,
          select: selection,
          limitMs: limitFor(file),
          stopOnKill: false,
        })),
      )
      share.forEach(({ id, selection }, i) =>
        selectionChecks.set(id, Promise.resolve(reproduces(selection, runs[i]))),
      )
    }
    const second = await runAcross(files, 2, checkShare)
    endPhase(`unmutated pass 2`, { files: files.length, selections: planned.size })
    const baseline = baselineOf(first.rows, second.rows, oracleFiles)
    const { nondeterministic } = baseline
    // A nondeterministic test judges nothing, so its verdict must not stop
    // a run at its first kill: a later test of the file may decide.
    const ignoredIn = (file) => [...nondeterministic].filter((key) => fileOf(key) === file).sort()
    // The mutants that change a value somewhere in each file's unmutated
    // runs (both passes), at load or in a test (capture-setup.mjs). A mutant
    // that changes no value in any of its owners' runs runs exactly as the
    // unmutated code does, as long as no nondeterministic test reaches it,
    // so its units are the unmutated ones and it needs no run of its own.
    const valueChanges = new Map()
    for (const rows of [first.rows, second.rows])
      for (const [key, row] of rows) {
        const file = fileOf(key)
        if (!valueChanges.has(file)) valueChanges.set(file, new Set())
        for (const number of row.infected ?? []) valueChanges.get(file).add(number)
      }
    const unmutatedUnits = new Map(first.units.map((u) => [u.file, u]))
    // Files whose unmutated tests had an I/O handle open (a socket, a child
    // process, file I/O): a test there may wait on something outside the
    // worker, so no copy of it is cut for idleness (capture-setup.mjs).
    const ioFiles = new Set()
    for (const rows of [first.rows, second.rows])
      for (const [key, row] of rows) if (row.io) ioFiles.add(fileOf(key))
    // Each file's call budget: a hundred times the most mutation-helper calls
    // any of its unmutated tests made, and at least CALL_FLOOR. A copy past it
    // is spinning (capture-setup.mjs) and is a timeout as it stands.
    const mostCalls = new Map()
    for (const rows of [first.rows, second.rows])
      for (const [key, row] of rows)
        if (!row.background)
          mostCalls.set(fileOf(key), Math.max(mostCalls.get(fileOf(key)) ?? 0, row.calls ?? 0))
    const callBudgetFor = (file) => Math.max(CALL_FLOOR, 100 * (mostCalls.get(file) ?? 0))
    const changesNothing = (mutant, targets) =>
      targets.oracleTargets.every(
        (file) => unmutatedUnits.has(file) && !valueChanges.get(file)?.has(mutant.number),
      ) && targets.oracleKeys.every((key) => !nondeterministic.has(key))
    log(
      `unmutated: ${[...first.rows.values()].filter((r) => !r.background).length} tests in ${first.seconds.toFixed(1)}s and ${second.seconds.toFixed(1)}s; nondeterministic: ${nondeterministic.size}`,
    )

    // 3–5. Mutants.
    const diffs = new Map(
      options.sources.map((source) => [source, diffLines(pkg, options.diffBase, source)]),
    )
    const results = []
    const started = Date.now()
    // Results are appended as they finish, so a stopped survey keeps them.
    const partial = join(options.out, `results.jsonl`)
    rmSync(partial, { force: true })
    // A selection no plan foresaw (the ordinary tier's) is checked when a
    // mutant first asks for it, once even when several contexts ask at once.
    const selectionFor = async (slot, file, keys) => {
      const selection = selectionOf(file, keys)
      if (!selection) return null
      const id = selectionId(file, selection)
      if (!selectionChecks.has(id))
        selectionChecks.set(
          id,
          (async () => {
            const run = await unit(slot.context, file, `selected`, {
              select: selection,
              limitMs: limitFor(file),
            })
            if (run.timedOut) await replace(slot)
            return reproduces(selection, run)
          })(),
        )
      return (await selectionChecks.get(id)) ? selection : null
    }
    // Mutants run in groups per context, all in one batch: each undecided
    // mutant's owner files, file by file, so every mutant's first file runs
    // before any mutant's second. A copy whose mutant an earlier copy killed
    // skips its tests, and a file after a kill is not run at all. A mutant's
    // units are those of its files in order, up to and including the first
    // that kills it, however they were found (run, reused, or rerun after a
    // hang), so a result never depends on how its evidence was produced. The
    // ordinary tier, when asked for, runs the same way afterwards.
    const GROUP = 4
    const kills = (u) => outcomeOf([u], baseline.nondeterministic).outcome === `killed`
    const runOwners = async (slot, states, filesOf, keysOf) => {
      const active = states.filter((st) => !st.done)
      const requests = []
      const depth = Math.max(0, ...active.map((st) => filesOf(st).length))
      for (let position = 0; position < depth; position += 1)
        for (const st of active) {
          const file = filesOf(st)[position]
          if (file === undefined) continue
          requests.push({
            st,
            position,
            file,
            spec: `mutant:${st.mutant.number}`,
            mutant: st.mutant.number,
            select: await selectionFor(slot, file, keysOf(st)),
            limitMs: firstLimitFor(file),
            // Idle detection only where no unmutated test of the file did I/O.
            idleMs: ioFiles.has(file) ? null : IDLE_MS,
            // A loop that spins on instrumented code is cut by count.
            callBudget: callBudgetFor(file),
            // Timers due after the full limit do not keep a copy busy.
            idleHorizonMs: limitFor(file),
            stopOnKill: true,
            ignore: ignoredIn(file),
          })
        }
      // A request is needed until one of its mutant's earlier files kills.
      const killedBefore = (request, got) =>
        requests.some(
          (other, i) =>
            other.st === request.st &&
            other.position < request.position &&
            got[i] !== undefined &&
            kills(got[i]),
        )
      const got = await unitsBatch(slot, requests, (request, found) => !killedBefore(request, found))
      for (const st of active) {
        for (const [i, request] of requests.entries()) {
          if (request.st !== st) continue
          // Only a kill earlier in the mutant's files leaves a file without
          // a unit.
          if (got[i] === undefined) {
            if (st.units.some(kills)) break
            throw new Error(`${st.mutant.id}: ${relative(request.file)} has no unit and no earlier kill`)
          }
          st.units.push(got[i])
          if (kills(got[i])) break
        }
        st.done = true
      }
    }
    async function evaluateGroup(group, slot) {
      const evaluated = Date.now()
      const states = group.map((mutant) => {
        mutant.inDiff = diffs.get(mutant.source)?.has(mutant.line)
        const owners = ownersOf(mutant)
        const targets = targetsOf(mutant, baseline, owners, oracleFiles)
        const decided = owners.size === 0 || targets.oracleTargets.length === 0
        const unchanged = !decided && changesNothing(mutant, targets)
        if (unchanged) evidence.unchanged += 1
        return {
          mutant,
          owners,
          targets,
          units: unchanged
            ? targets.oracleTargets.map((file) => ({ ...unmutatedUnits.get(file), seconds: 0 }))
            : [],
          done: decided || unchanged,
        }
      })
      await runOwners(
        slot,
        states,
        (st) => st.targets.oracleTargets,
        (st) => st.targets.oracleKeys,
      )
      const ordinary = []
      for (const st of states) {
        st.result = {
          ...st.mutant,
          oracleFiles: st.targets.oracleTargets,
          ordinaryFiles: st.targets.testTargets,
          ...judgeMutant(st.mutant, {
            owners: st.owners,
            targets: st.targets,
            units: st.units,
            baseline,
            mutants,
          }),
        }
        if (needsOrdinary(st.result, st.targets))
          ordinary.push({ ...st, units: [], done: false })
      }
      await runOwners(
        slot,
        ordinary,
        (st) => st.targets.testTargets,
        (st) => st.targets.testKeys,
      )
      for (const st of ordinary)
        states.find((x) => x.mutant === st.mutant).result.testOutcome = judgeOrdinary(st.units)
      for (const st of states) {
        results.push(st.result)
        span(`mutant`, evaluated, {
          id: st.mutant.id,
          slot: slot.index,
          outcome: st.result.class ?? st.result.outcome,
          files: st.units.length,
          targets: st.targets.oracleTargets.length,
        })
        appendFileSync(partial, `${JSON.stringify(st.result)}\n`)
        log(
          `${st.mutant.id} L${st.mutant.line} ${st.mutant.operator} ${st.result.outcome}${st.result.class ? ` (${st.result.class})` : ``}${st.result.testOutcome ? ` [ordinary: ${st.result.testOutcome}]` : ``}`,
        )
      }
    }
    let evaluating = contexts.length
    await Promise.all(
      contexts.map(async (context, index) => {
        const slot = { context, index }
        for (let group = queue.splice(0, GROUP); group.length > 0; group = queue.splice(0, GROUP)) {
          await confirmOn(slot)
          await evaluateGroup(group, slot)
        }
        evaluating -= 1
        wake()
        for (;;) {
          await confirmOn(slot)
          if (evaluating === 0) break
          await new Promise((resolve) => waiting.push(resolve))
        }
      }),
    )
    results.sort((a, b) => a.number - b.number || a.source.localeCompare(b.source))
    endPhase(`operator mutants`, { mutants: results.length })

    // 6. Authored mutants, spread across the contexts. Each serves a patched
    // copy of its source only to the context that runs it. The copy is not
    // instrumented, so an authored mutant runs against every owner of the
    // function its edit lands in, whole files, still stopping at its first
    // kill.
    const authoredJobs = []
    for (const mutant of authored) {
      const id = `authored:${mutant.id}`
      if (options.only && !options.only.has(id)) continue
      const path = realpathSync(join(pkg, mutant.source))
      const patched = applyAuthored(readFileSync(path, `utf8`), mutant)
      const result = {
        id,
        authored: true,
        authoredId: mutant.id,
        source: mutant.source,
        operator: `authored`,
        function: `authored mutants`,
        intent: mutant.intent,
        author: mutant.author,
        original: mutant.find,
        replacement: mutant.replace,
        line: patched?.line,
      }
      results.push(result)
      if (!patched) {
        result.outcome = `does-not-apply`
        continue
      }
      result.function = owned.functionAt(mutant.source, patched.line)
      const owners = owned.of(mutant.source, result.function)
      if (owners.size === 0) {
        result.outcome = `unowned`
        continue
      }
      authoredJobs.push({
        id,
        path,
        patched,
        result,
        targets: [...owners].filter((file) => fileSpecs.has(file)),
      })
    }
    // Each owner file of each authored mutant is its own item, taken by any
    // free context, which serves the patch only to itself. A hang in one
    // owner then waits beside the others, not before them; a kill in any
    // owner decides the mutant (a kill outranks a timeout).
    const authoredItems = authoredJobs.flatMap((job) =>
      job.targets.map((file) => ({ job, file })),
    )
    for (const job of authoredJobs) job.units = []
    await Promise.all(
      contexts.map(async (context, index) => {
        const slot = { context, index }
        const serve = globalThis.__oracleGapsServe
        for (let item = authoredItems.shift(); item; item = authoredItems.shift()) {
          const { job, file } = item
          serve[slot.index] = new Map([[job.path, job.patched.text]])
          invalidateChanged([job.path], slot.context)
          const [got] = await unitsBatch(slot, [
            {
              file,
              spec: job.id,
              mutant: -1,
              select: null,
              limitMs: limitFor(file),
              stopOnKill: true,
              ignore: ignoredIn(file),
            },
          ])
          job.units.push(got)
          serve[slot.index] = undefined
          invalidateChanged([job.path], slot.context)
        }
      }),
    )
    for (const job of authoredJobs) {
      Object.assign(job.result, judgeAuthored(job.units, baseline))
      log(`${job.id} ${job.result.outcome}${job.result.class ? ` (${job.result.class})` : ``}`)
    }
    endPhase(`authored mutants`, { mutants: authored.length })
    // Keys go into every output, so an agent reads them from the JSON
    // results.
    assignKeys(results)
    const mutantSeconds = (Date.now() - started) / 1000
    log(`mutant phase: ${results.length} mutants in ${mutantSeconds.toFixed(1)}s`)
    await store.flush?.()
    writeFileSync(
      join(options.out, `results.json`),
      JSON.stringify(
        {
          run: runIdentity,
          options: { ...options, only: options.only && [...options.only] },
          excluded,
          nondeterministic: [...nondeterministic],
          mutantSeconds,
          // How the result was produced: units reused from the evidence
          // store and units run in this check, runs cut off at their time
          // limit, and items rerun after a cut-off batch.
          evidence,
          results,
        },
        null,
        1,
      ),
    )
    span(`check`, checkStarted, { evidence })
    const summary = renderReport({
      results,
      run: runIdentity,
      excluded: excluded.map(relative),
    })
    writeFileSync(join(options.out, `summary.md`), summary)
    return summary
  }

  async function close() {
    await closeContexts()
    for (const wrapper of wrappers.values()) rmSync(wrapper, { force: true })
    rmSync(harness, { force: true })
  }

  return { check, close }
}

/**
 * The run's identity: a hash of everything that decides its outcome (the
 * sources, every test file, the authored mutants, the options that change a
 * result, and this CLI's own code and the framework it reads), so a count
 * can be traced to the run that produced it and reproduced by running it
 * again. Where the report is written and whether the daemon produced it do
 * not change the result, so they are not part of it.
 */
function identityOf(options, authored, testFiles, oracleCount) {
  const hash = createHash(`sha1`)
  // Files are named relative to the package or to this CLI, and taken in
  // the order of those names, so the same inputs in another checkout, or
  // the same CLI in another directory, have the same identity.
  const name = (file) =>
    file.startsWith(`${options.pkg}/`)
      ? file.slice(options.pkg.length + 1)
      : `cli:${relativePath(here, file)}`
  const files = [
    ...options.sources.map((file) => join(options.pkg, file)),
    ...testFiles,
    ...ownFiles,
  ].sort((a, b) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0))
  for (const file of files)
    if (existsSync(file))
      hash.update(`${name(file)}\0${readFileSync(file, `utf8`)}\0`)
  hash.update(JSON.stringify(authored))
  const { out, daemon, pkg, mutants, ...decisive } = options
  hash.update(JSON.stringify({ ...decisive, only: [...(options.only ?? [])] }))
  return {
    id: hash.digest(`hex`).slice(0, 12),
    inputs: `${options.sources.length} source files, ${oracleCount} oracle files, ${testFiles.length - oracleCount} ordinary test files, ${authored.length} authored mutants, seed ${options.seed ?? `(none)`}${options.only || options.sample !== undefined ? `; a partial run (--only or --sample)` : ``}`,
  }
}

// Lines changed relative to the diff base, for diff-scoped summaries.
function diffLines(pkg, diffBase, source) {
  if (!diffBase) return undefined
  const child = spawnSync(`git`, [`diff`, `-U0`, diffBase, `--`, source], {
    cwd: pkg,
    encoding: `utf8`,
  })
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
