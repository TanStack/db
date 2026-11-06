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
import { dirname, join, relative as relativePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyAuthored, loadAuthored } from './authored.mjs'
import { assignKeys, renderReport } from './report.mjs'
import { analyze } from './analysis.mjs'
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
      // Every module each test file imports, which a unit records as its
      // inputs.
      experimental: { importDurations: { limit: 1_000_000 } },
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
    for (const spec of await context.globTestSpecifications())
      map.set(spec.moduleId, [...(map.get(spec.moduleId) ?? []), spec])
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

  /** One Vitest run of one test file, as plain data. */
  async function runUnit(
    context,
    out,
    file,
    { mutant = null, seed = null, limitMs, select = null, stopOnKill = false } = {},
  ) {
    const capture = join(out, `run-${process.pid}-${++runCounter}.jsonl`)
    const state = { mutant, select, capture, seed, stopOnKill }
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
      const cancelled = Date.now()
      await Promise.race([
        context.cancelCurrentRun(`keyboard-input`).catch(() => undefined),
        sleep(5000),
      ])
      span(`cancel`, cancelled, profiled)
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
        rows.push([row.key, row])
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
      duration: Math.max(
        0,
        ...modules.map((m) => (m.diagnostic?.().duration ?? 0) / 1000),
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
    const settings = {
      testTimeout: options.testTimeout,
      bail: Number(process.env.ORACLE_GAPS_BAIL ?? 0),
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
      ]),
    )
    const evidence = { reused: 0, computed: 0 }
    // Each file's imports in its unmutated run. A run that timed out reports
    // none, so it is stored under these: a mutant changes no import.
    const fileInputs = new Map()
    async function unit(context, file, spec, runOptions = {}) {
      const index = indexOf.get(context)
      const id = sha1(JSON.stringify([globalKey, file, spec, runOptions.select ?? null]))
      const row = store.get(id)
      const looked = Date.now()
      const valid =
        row && row.inputs.every(([path, hash]) => servedHash(path, index) === hash)
      span(`lookup`, looked, { file: file.split(`/`).at(-1), spec, hit: Boolean(valid) })
      if (valid) {
        evidence.reused += 1
        if (!row.unit.timedOut) fileInputs.set(file, row.unit.inputs)
        return row.unit
      }
      const result = await runUnit(context, options.out, file, {
        seed: options.seed ?? null,
        ...runOptions,
      })
      evidence.computed += 1
      const paths = result.timedOut ? fileInputs.get(file) : result.inputs
      if (!result.timedOut && spec.startsWith(`unmutated:`))
        fileInputs.set(file, result.inputs)
      if (paths) {
        const inputs = paths.map((path) => [path, servedHash(path, index)])
        for (const [path, hash] of inputs) servedBy(index).set(path, hash)
        store.put({ id, inputs, unit: result })
      }
      return result
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
    const limitFor = (file) => 5_000 + 3000 * (fileSeconds.get(file) ?? 10)
    const runAcross = async (files, pass) => {
      const parts = contexts.map(() => [])
      files.forEach((file, index) => parts[index % contexts.length].push(file))
      const units = (
        await Promise.all(
          contexts.map(async (context, index) => {
            const done = []
            for (const file of parts[index])
              done.push(await unit(context, file, `unmutated:${pass}`))
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
      return { rows, failed, seconds: Math.max(0, ...units.map((u) => u.seconds)) }
    }
    // Without --ordinary, only oracle files run.
    let files = [...fileSpecs.keys()].filter(
      (file) => options.ordinary || oracleFiles.has(file),
    )
    const first = await runAcross(files, 1)
    endPhase(`unmutated pass 1`, { files: files.length })
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
    const second = await runAcross(files, 2)
    endPhase(`unmutated pass 2`, { files: files.length })
    const baseline = baselineOf(first.rows, second.rows, oracleFiles)
    const { nondeterministic } = baseline
    log(
      `unmutated: ${[...first.rows.values()].filter((r) => !r.background).length} tests in ${first.seconds.toFixed(1)}s and ${second.seconds.toFixed(1)}s; nondeterministic: ${nondeterministic.size}`,
    )

    const ownersOf = (mutant) => owned.of(mutant.source, mutant.function)

    // 3–5. Mutants.
    const diffs = new Map(
      options.sources.map((source) => [source, diffLines(pkg, options.diffBase, source)]),
    )
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
    // The tests of a file that a mutant must run: every test from the first
    // one that reached its site. A later test can see the mutant through
    // state that a reaching test changed, so only the tests before the
    // first reaching one are left out, and only when running the rest with
    // no mutant active reproduces what they recorded when the whole file
    // ran: a later test can depend on state that a left-out test set.
    const selectionChecks = new Map()
    const selectionFor = async (slot, file, keys) => {
      const all = [...baseline.firstRows.keys()].filter(
        (k) => fileOf(k) === file && !baseline.firstRows.get(k).background,
      )
      const reaching = new Set(keys)
      if (keys.some((k) => k === `${file} > (background)`)) return null
      const first = all.findIndex((k) => reaching.has(k))
      if (first <= 0) return null
      const selection = all.slice(first)
      const id = `${file}\0${selection.join(`\0`)}`
      // The check runs once per selection, even when several contexts ask
      // for it at the same time.
      if (!selectionChecks.has(id))
        selectionChecks.set(
          id,
          (async () => {
            const run = await unit(slot.context, file, `selected`, {
              select: selection,
              limitMs: limitFor(file),
            })
            if (run.timedOut) await replace(slot)
            const rows = new Map(run.rows ?? [])
            return (
              !run.timedOut &&
              outcomeOf([run]).outcome === `survived` &&
              selection.every(
                (k) =>
                  rows.get(k)?.hash === baseline.firstRows.get(k)?.hash &&
                  rows.get(k)?.observed === baseline.firstRows.get(k)?.observed,
              )
            )
          })(),
        )
      return (await selectionChecks.get(id)) ? selection : null
    }
    // A cancelled run can leave work behind, so its context is replaced.
    const replace = async (slot) => {
      const started = Date.now()
      await Promise.race([slot.context.close().catch(() => undefined), sleep(10_000)])
      slot.context = await warmContext(settings, slot.index)
      await globSpecs(slot.context)
      contexts[slot.index] = slot.context
      span(`replace context`, started, { slot: slot.index })
    }
    // The units of one mutant against some files, one file at a time and
    // only the tests that reached it. The runner stops at the first kill: a
    // kill decides the outcome whatever the other files would do.
    const unitsFor = async (slot, targets, keys, mutant) => {
      const done = []
      for (const file of targets) {
        const result = await unit(slot.context, file, `mutant:${mutant}`, {
          mutant,
          limitMs: limitFor(file),
          select: await selectionFor(slot, file, keys),
          stopOnKill: true,
        })
        done.push(result)
        if (result.timedOut) await replace(slot)
        if (outcomeOf(done, baseline.nondeterministic).outcome === `killed`) break
      }
      return done
    }
    async function evaluate(mutant, slot) {
      const evaluated = Date.now()
      mutant.inDiff = diffs.get(mutant.source)?.has(mutant.line)
      const owners = ownersOf(mutant)
      const targets = targetsOf(mutant, baseline, owners, oracleFiles)
      const result = {
        ...mutant,
        oracleFiles: targets.oracleTargets,
        ordinaryFiles: targets.testTargets,
      }
      const units =
        owners.size > 0 && targets.oracleTargets.length > 0
          ? await unitsFor(slot, targets.oracleTargets, targets.oracleKeys, mutant.number)
          : []
      Object.assign(
        result,
        judgeMutant(mutant, { owners, targets, units, baseline, mutants }),
      )
      if (needsOrdinary(result, targets))
        result.testOutcome = judgeOrdinary(
          await unitsFor(slot, targets.testTargets, targets.testKeys, mutant.number),
        )
      results.push(result)
      span(`mutant`, evaluated, {
        id: mutant.id,
        slot: slot.index,
        outcome: result.class ?? result.outcome,
        files: units.length,
        targets: targets.oracleTargets.length,
      })
      appendFileSync(partial, `${JSON.stringify(result)}\n`)
      log(
        `${mutant.id} L${mutant.line} ${mutant.operator} ${result.outcome}${result.class ? ` (${result.class})` : ``}${result.testOutcome ? ` [ordinary: ${result.testOutcome}]` : ``}`,
      )
    }
    await Promise.all(
      contexts.map(async (context, index) => {
        const slot = { context, index }
        for (let mutant = queue.shift(); mutant; mutant = queue.shift())
          await evaluate(mutant, slot)
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
    const judgeAuthoredJob = async (slot, job) => {
      const serve = globalThis.__oracleGapsServe
      serve[slot.index] = new Map([[job.path, job.patched.text]])
      invalidateChanged([job.path], slot.context)
      const units = []
      for (const file of job.targets) {
        units.push(
          await unit(slot.context, file, job.id, {
            mutant: -1,
            limitMs: limitFor(file),
            stopOnKill: true,
          }),
        )
        if (units.at(-1).timedOut) {
          await replace(slot)
          invalidateChanged([job.path], slot.context)
        }
        if (outcomeOf(units, baseline.nondeterministic).outcome === `killed`) break
      }
      serve[slot.index] = undefined
      invalidateChanged([job.path], slot.context)
      Object.assign(job.result, judgeAuthored(units, baseline))
      log(`${job.id} ${job.result.outcome}${job.result.class ? ` (${job.result.class})` : ``}`)
    }
    await Promise.all(
      contexts.map(async (context, index) => {
        const slot = { context, index }
        for (let job = authoredJobs.shift(); job; job = authoredJobs.shift())
          await judgeAuthoredJob(slot, job)
      }),
    )
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
          // store and units run in this check.
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
