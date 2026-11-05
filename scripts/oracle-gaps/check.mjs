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
  const wrapper = join(pkg, `.oracle-gaps-${process.pid}.vitest.config.ts`)
  const harness = join(pkg, `.oracle-gaps-${process.pid}.capture-setup.mjs`)
  copyFileSync(join(here, `capture-setup.mjs`), harness)
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
      // An authored mutant's patched source, or else the instrumented source
      // of the current check, both set by the runner in this process.
      try {
        const real = realpathSync(path)
        return globalThis.__oracleGapsServe?.get(real) ?? globalThis.__oracleGapsSchemata?.get(real)
      } catch { return undefined }
    },
  }],
  test: { setupFiles: ['./${harness.split(`/`).at(-1)}'] },
})
`,
  )
  // Vitest resolves test-file filters and parts of its project setup against
  // the working directory, so the runner works from the package directory.
  process.chdir(pkg)
  const hashOf = fileHashes()
  // The text served for each path in the current check, and the hash each
  // context last served, so a changed file is invalidated in the warm
  // contexts before it is read again.
  globalThis.__oracleGapsSchemata = new Map()
  const servedHash = (path) => {
    const text =
      globalThis.__oracleGapsServe?.get(path) ??
      globalThis.__oracleGapsSchemata.get(path)
    return text === undefined ? hashOf(path) : sha1(text)
  }
  const lastServed = new Map()
  let contexts = []
  let contextsKey
  let contextsConfig
  const contextSpecs = new Map()
  let runCounter = 0

  async function warmContext(settings) {
    const context = await createVitest(`test`, {
      root: pkg,
      config: wrapper,
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
  const ownHarness = (path) => path === wrapper || path === harness
  // The files the Vite config loaded, for the global key.
  const configFiles = () =>
    (contexts[0]?.vite?.config?.configFileDependencies ?? []).filter(
      (path) => !ownHarness(path),
    )

  /** Invalidates every path whose served text changed since a context read it. */
  function invalidateChanged(paths) {
    for (const path of paths) {
      const hash = servedHash(path)
      if (lastServed.get(path) === hash) continue
      for (const context of contexts) context.invalidateFile(path)
      lastServed.set(path, hash)
    }
  }

  /** One Vitest run of one test file, as plain data. */
  async function runUnit(context, out, file, { mutant = null, seed = null, limitMs } = {}) {
    const capture = join(out, `run-${process.pid}-${++runCounter}.jsonl`)
    const state = { mutant, select: null, capture, seed }
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
    if (result === undefined) {
      await Promise.race([
        context.cancelCurrentRun(`keyboard-input`).catch(() => undefined),
        sleep(5000),
      ])
      rmSync(capture, { force: true })
      return { file, timedOut: true, seconds }
    }
    // The result also lists test modules from earlier runs, with their old
    // results. Only this run's file counts.
    const modules = result.testModules.filter((m) => m.moduleId === file)
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
        contexts.push(await warmContext(settings))
      contextsKey = JSON.stringify(settings)
      contextsConfig = configHash()
    }
    while (contexts.length < options.contexts)
      contexts.push(await warmContext(settings))
    for (const context of contexts) await globSpecs(context)

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
    invalidateChanged(new Set([...previous, ...instrumented.keys(), ...lastServed.keys()]))

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
    async function unit(context, file, spec, runOptions = {}) {
      const id = sha1(JSON.stringify([globalKey, file, spec]))
      const row = store.get(id)
      if (row && row.inputs.every(([path, hash]) => servedHash(path) === hash)) {
        evidence.reused += 1
        return row.unit
      }
      const result = await runUnit(context, options.out, file, {
        seed: options.seed ?? null,
        ...runOptions,
      })
      evidence.computed += 1
      if (!result.timedOut) {
        const inputs = result.inputs.map((path) => [path, servedHash(path)])
        for (const [path, hash] of inputs) lastServed.set(path, hash)
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
    const limitFor = (file) => 10_000 + 3000 * (fileSeconds.get(file) ?? 10)
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
      const failed = new Set(
        units
          .filter((u) => outcomeOf([u]).outcome !== `survived`)
          .map((u) => u.file),
      )
      return { rows, failed, seconds: Math.max(0, ...units.map((u) => u.seconds)) }
    }
    let files = [...fileSpecs.keys()]
    const first = await runAcross(files, 1)
    // An oracle file that fails with no mutant active cannot judge the code
    // it owns, so the run refuses rather than report that code as unowned.
    const failingOwners = [...first.failed].filter((file) => oracleFiles.has(file))
    if (failingOwners.length > 0)
      throw new Error(
        `oracle files fail with no mutant active, so their owned code cannot be judged: ${failingOwners.map(relative).join(`, `)}`,
      )
    const excluded = [...first.failed]
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
    // The units of one mutant against some files, one file at a time. A
    // unit that timed out makes the mutant's outcome `timeout`, and its
    // cancelled context must be replaced before it runs anything else, so
    // the rest are not run.
    const unitsFor = async (context, targets, mutant) => {
      const done = []
      for (const file of targets) {
        const result = await unit(context, file, `mutant:${mutant}`, {
          mutant,
          limitMs: limitFor(file),
        })
        done.push(result)
        if (result.timedOut) break
      }
      return done
    }
    async function evaluate(mutant, context) {
      mutant.inDiff = diffs.get(mutant.source)?.has(mutant.line)
      const owners = ownersOf(mutant)
      const targets = targetsOf(mutant, baseline, owners, oracleFiles)
      const result = {
        ...mutant,
        oracleFiles: targets.oracleTargets,
        ordinaryFiles: targets.testTargets,
      }
      let replace = false
      const units =
        owners.size > 0 && targets.oracleTargets.length > 0
          ? await unitsFor(context, targets.oracleTargets, mutant.number)
          : []
      replace ||= units.some((u) => u.timedOut)
      Object.assign(
        result,
        judgeMutant(mutant, { owners, targets, units, baseline, mutants }),
      )
      if (needsOrdinary(result, targets)) {
        const ordinary = await unitsFor(context, targets.testTargets, mutant.number)
        replace ||= ordinary.some((u) => u.timedOut)
        result.testOutcome = judgeOrdinary(ordinary)
      }
      results.push(result)
      appendFileSync(partial, `${JSON.stringify(result)}\n`)
      log(
        `${mutant.id} L${mutant.line} ${mutant.operator} ${result.outcome}${result.class ? ` (${result.class})` : ``}${result.testOutcome ? ` [ordinary: ${result.testOutcome}]` : ``}`,
      )
      return replace
    }
    await Promise.all(
      contexts.map(async (initial, slot) => {
        let context = initial
        for (let mutant = queue.shift(); mutant; mutant = queue.shift()) {
          if (!(await evaluate(mutant, context))) continue
          // A cancelled run can leave work behind, so its context is
          // replaced.
          await Promise.race([context.close().catch(() => undefined), sleep(10_000)])
          context = await warmContext(settings)
          await globSpecs(context)
          contexts[slot] = context
        }
      }),
    )
    results.sort((a, b) => a.number - b.number || a.source.localeCompare(b.source))

    // 6. Authored mutants, one at a time in the first context. Each one
    // serves a patched copy of its source, which every context in this
    // process would see. The copy is not instrumented, so an authored mutant
    // runs against every owner of the function its edit lands in.
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
      const targets = [...owners].filter((file) => fileSpecs.has(file))
      if (owners.size === 0) {
        result.outcome = `unowned`
        continue
      }
      let context = contexts[0]
      globalThis.__oracleGapsServe = new Map([[path, patched.text]])
      invalidateChanged([path])
      const units = []
      for (const file of targets) {
        units.push(
          await unit(context, file, id, { mutant: -1, limitMs: limitFor(file) }),
        )
        if (units.at(-1).timedOut) break
      }
      globalThis.__oracleGapsServe = undefined
      invalidateChanged([path])
      Object.assign(result, judgeAuthored(units, baseline))
      log(`${id} ${result.outcome}${result.class ? ` (${result.class})` : ``}`)
      if (units.some((u) => u.timedOut)) {
        await Promise.race([context.close().catch(() => undefined), sleep(10_000)])
        context = await warmContext(settings)
        await globSpecs(context)
        contexts[0] = context
      }
    }
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
    rmSync(wrapper, { force: true })
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
