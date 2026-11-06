// Test-side harness for the gap report.
//
// It does three jobs inside every test worker:
//
// 1. It defines `globalThis.__oracleGaps`, the switch that the instrumented
//    source calls at each mutation site (see schemata.mjs). The switch runs
//    the original code unless the site's mutant is the active one, and it
//    records which sites each test reached and which outcomes each `if`
//    condition took.
// 2. It records what each test asserted about. Every value a test passes to
//    `expect(...)` is serialized and folded into one hash per test, so a
//    mutant run can be compared with the unmutated run: equal hashes mean
//    the assertions saw the same values in the same order.
// 3. It skips tests that the current run did not select, so a mutant runs
//    only the tests that reach it.
//
// The runner provides the current run's state (active mutant, selected tests,
// output path) with `provide('oracleGaps', …)`, read here with `inject`. Each
// warm Vitest context provides its own state, so several can run mutants at
// once. A state file named by ORACLE_GAPS_STATE is the fallback. This file is
// copied into the target package, so `vitest` here is the target's own copy
// and its `chai` is the one the tests use.
//
// In a mutant run, fast-check stops a property at its first failure instead
// of shrinking it: a kill needs one failing history, not the smallest one.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeEach, chai, expect, inject, vi } from 'vitest'

const run =
  inject(`oracleGaps`) ??
  (process.env.ORACLE_GAPS_STATE
    ? JSON.parse(readFileSync(process.env.ORACLE_GAPS_STATE, `utf8`))
    : { mutant: null, select: null, capture: null })
// A batch runs many copies of test files in one worker, each with its own
// mutant (check.mjs). This file runs before each copy loads, so it takes
// that copy's settings, and resets the module registry: the copy's imports
// then load the package's modules afresh, under its mutant, with no state
// left by an earlier copy.
const unit = run.units?.[globalThis.__vitest_worker__?.filepath]
// The mutants that a copy earlier in this batch killed. A later copy of the
// same mutant runs nothing: the mutant is decided (stop at first kill).
if (globalThis.__oracleGapsKilled?.capture !== run.capture)
  globalThis.__oracleGapsKilled = { capture: run.capture, mutants: new Set() }
const killed = globalThis.__oracleGapsKilled.mutants
const skippedCopy = unit !== undefined && killed.has(unit.mutant)
if (run.units && !skippedCopy) vi.resetModules()
const state = unit ? { ...run, ...unit } : run
// The seed travels with each run's state, so a worker that a warm context
// started under an earlier check's seed runs under this run's seed.
if (`seed` in state) {
  if (state.seed === null) delete process.env.TANSTACK_DB_ORACLE_SEED
  else process.env.TANSTACK_DB_ORACLE_SEED = String(state.seed)
}
const fc = await import(`fast-check`).catch(() => undefined)
if (fc) {
  // A property that takes no seed from the shared config would draw new
  // histories on every run; a global seed makes every run draw the same ones.
  // A mutant run stops a property at its first failure.
  fc.configureGlobal({
    ...fc.readConfigureGlobal(),
    seed: fc.readConfigureGlobal().seed ?? 20251102,
    ...(state.mutant !== null ? { endOnFailure: true } : {}),
  })
}

// Ambient randomness is made deterministic per test: `Math.random`,
// `crypto.getRandomValues`, and `crypto.randomUUID` draw from a generator
// seeded by the test's name, so a test sees the same values in every run
// whatever ran before it. Production paths are unchanged; only the values
// they draw repeat.
function seededRandom(text) {
  let seed = 2166136261
  for (let i = 0; i < text.length; i += 1)
    seed = Math.imul(seed ^ text.charCodeAt(i), 16777619)
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function installRandom(text) {
  const next = seededRandom(text)
  Math.random = next
  const crypto = globalThis.crypto
  if (!crypto) return
  crypto.getRandomValues = (array) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(next() * 256)
    return array
  }
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () =>
      Math.floor(next() * 16).toString(16),
    )
    hex[12] = `4`
    hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)
    const text = hex.join(``)
    return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
  }
}
// Code that runs while the test file loads, such as a runtime nonce created
// on first use, draws from its own seeded generator; it runs in a fixed order.
installRandom(`module`)
const selected = state.select ? new Set(state.select) : null
// Set ORACLE_GAPS_DEBUG to a path to keep every rendered value, for finding
// the source of a nondeterministic capture.
const debug = process.env.ORACLE_GAPS_DEBUG
let digest = createHash(`sha1`)
let count = 0
// An oracle property's observations (oracle-property.ts) are hashed on their
// own. A mutant that changes one without failing the check is a comparison
// gap: the driver records an output that the check does not compare.
let observed = createHash(`sha1`)
let observations = 0

// Site hits and `if` outcomes for the running test. Code that runs outside
// any test (module setup, or async work that outlives its test) records into
// the file's background set, which counts for every test in the file.
let hits = new Set()
let outcomes = new Map()
let inTest = false
// The current test file. `afterAll`'s arguments differ between Vitest 3
// (the suite) and Vitest 4 (a fixture context, then the suite), so the file
// is taken from the last test instead.
let currentFile
const background = new Set()
const active = state.mutant
const hit = (id) => {
  ;(inTest ? hits : background).add(id)
  historyHits?.add(id)
}

// Temporary profiling (ORACLE_GAPS_PROFILE): how many fast-check histories
// each test ran, and in how many of them each site was hit, to measure what
// replaying only the reaching histories would save.
let histories = 0
let siteHistories = new Map()
let historyHits = null
// fast-check also outlives a batch's copies, so its wrapper calls the
// copy now running.
globalThis.__oracleGapsHistory = {
  get: () => historyHits,
  set: (value) => {
    historyHits = value
  },
  done: () => {
    if (!inTest || !historyHits) return
    histories += 1
    for (const id of historyHits)
      siteHistories.set(id, (siteHistories.get(id) ?? 0) + 1)
  },
}
if (fc && process.env.ORACLE_GAPS_PROFILE) {
  const samples = [
    () => fc.property(fc.constant(0), () => true),
    () => fc.asyncProperty(fc.constant(0), async () => true),
  ]
  for (const sample of samples) {
    const prototype = Object.getPrototypeOf(sample())
    const run = prototype.run
    if (typeof run !== `function` || run.counted) continue
    const counted = function (...args) {
      const history = globalThis.__oracleGapsHistory
      const outer = history.get()
      history.set(new Set())
      const done = () => {
        history.done()
        history.set(outer)
      }
      let result
      try {
        result = run.apply(this, args)
      } catch (error) {
        done()
        throw error
      }
      if (typeof result?.then === `function`) return result.finally(done)
      done()
      return result
    }
    counted.counted = true
    prototype.run = counted
  }
}
const swapped = {
  '===': `!==`,
  '!==': `===`,
  '<': `<=`,
  '<=': `<`,
  '>': `>=`,
  '>=': `>`,
}
function compare(op, a, b) {
  switch (op) {
    case `===`:
      return a === b
    case `!==`:
      return a !== b
    case `<`:
      return a < b
    case `<=`:
      return a <= b
    case `>`:
      return a > b
    default:
      return a >= b
  }
}
globalThis.__oracleGaps = {
  m(id) {
    hit(id)
    return id === active
  },
  v: (value) => value,
  cmp(id, a, b, op) {
    hit(id)
    return compare(id === active ? swapped[op] : op, a, b)
  },
  not(id, value) {
    hit(id)
    return id === active ? value : !value
  },
  // Records whether the condition was truthy or falsy, then applies a forced
  // value if one of this `if`'s two mutants is active.
  cond(idTrue, idFalse, value) {
    hit(idTrue)
    hit(idFalse)
    if (inTest) {
      const seen = outcomes.get(idTrue) ?? [false, false]
      seen[value ? 0 : 1] = true
      outcomes.set(idTrue, seen)
    }
    if (active === idTrue) return true
    if (active === idFalse) return false
    return value
  },
}

function testKey(task) {
  const names = []
  for (let t = task; t; t = t.suite) if (t.name) names.unshift(t.name)
  return `${task.file?.filepath} > ${names.join(` > `)}`
}

// Random identifiers such as `crypto.randomUUID()` version keys differ on
// every run. Within one test, each distinct UUID is renamed `uuid#n` in order
// of first appearance: whether two values share an identity is kept, the
// random value is not.
const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
let uuids = new Map()
function canonical(text) {
  return text.replace(uuidPattern, (uuid) => {
    const key = uuid.toLowerCase()
    if (!uuids.has(key)) uuids.set(key, `uuid#${uuids.size}`)
    return uuids.get(key)
  })
}

// Wall-clock times such as `Date.now()` stamps differ on every run too. An
// integer or Date within ten years of this run's start is a time and renders
// as `time`. Even whether two stamps are equal depends on whether two events
// fell in the same millisecond, so no identity is kept. Time cannot be made
// deterministic the way randomness is (below): timers depend on it.
const runStart = Date.now()
const tenYears = 10 * 365 * 24 * 60 * 60 * 1000
const time = () => `time`

// A class instance renders as its identity, `ClassName#n` in order of first
// appearance in the test, not as its fields. A matcher such as `toBe` compares
// identity, and a production object's fields hold internal state, including
// clock readings, that no assertion sees. A class with its own `toJSON`, and a
// Temporal value, render through it instead. Limit: a mutant that changes
// only the fields of a class instance compared with `toEqual` reads as no
// observed difference; captures classify survivors and never decide a kill.
let identities = new Map()
function identity(value, name) {
  if (!identities.has(value))
    identities.set(value, `${name}#${identities.size}`)
  return identities.get(value)
}
const isTime = (value) =>
  Number.isInteger(value) && Math.abs(value - runStart) < tenYears

// A stable, cycle-safe rendering. It keeps the distinctions an assertion can
// see (types, order, Map and Set entries, error identity by name and message)
// and drops ones it cannot (object identity, functions' bodies).
function render(value, seen = new Set(), depth = 0) {
  if (depth > 8) return `…`
  if (value === null) return `null`
  const type = typeof value
  if (type === `undefined`) return `undefined`
  if (type === `number`)
    return Object.is(value, -0) ? `-0` : isTime(value) ? time() : String(value)
  if (type === `string`) return JSON.stringify(canonical(value.slice(0, 4000)))
  if (type === `boolean` || type === `bigint`) return `${type}:${value}`
  if (type === `symbol`) return `symbol:${value.description ?? ``}`
  if (type === `function`) return `fn:${value.name}`
  if (seen.has(value)) return `[cycle]`
  seen.add(value)
  try {
    if (value instanceof Error)
      return `Error:${value.name}:${canonical(value.message)}:${render(value.cause, seen, depth + 1)}`
    if (value instanceof Date)
      return `Date:${isTime(value.getTime()) ? time() : value.getTime()}`
    if (value instanceof Map)
      return `Map{${[...value].map(([k, v]) => `${render(k, seen, depth + 1)}=>${render(v, seen, depth + 1)}`).join(`,`)}}`
    if (value instanceof Set)
      return `Set{${[...value].map((v) => render(v, seen, depth + 1)).join(`,`)}}`
    if (Array.isArray(value))
      return `[${value.map((v) => render(v, seen, depth + 1)).join(`,`)}]`
    if (ArrayBuffer.isView(value))
      return `${value.constructor.name}(${Array.from(value).join(`,`)})`
    if (typeof value.then === `function`) return `Promise`
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      const name = value.constructor?.name ?? `anonymous`
      if (typeof value.toJSON === `function`)
        return `${name}(${render(value.toJSON(), seen, depth + 1)})`
      if (String(value[Symbol.toStringTag] ?? ``).startsWith(`Temporal.`))
        return `${name}(${String(value)})`
      return identity(value, name)
    }
    const name = prototype === null ? `null-proto` : `Object`
    const keys = Object.keys(value).sort()
    // An accessor is recorded as one, never called: a getter can count its
    // reads, and the capture must not change what the test observes.
    const field = (k) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, k)
      return descriptor && !(`value` in descriptor)
        ? `accessor`
        : render(value[k], seen, depth + 1)
    }
    return `${name}{${keys.map((k) => `${k}:${field(k)}`).join(`,`)}}`
  } finally {
    seen.delete(value)
  }
}

// Every matcher is a method on chai's Assertion prototype. Wrapping each one
// records its name and the value under test before the matcher runs. chai
// outlives the copies of a batch (check.mjs), so the wrappers are installed
// once per worker and call the hooks of the copy now running.
globalThis.__oracleGapsHooks = {
  matcher(name, assertion) {
    try {
      const rendered = `${name}(${render(chai.util.flag(assertion, `object`))})\n`
      digest.update(rendered)
      if (debug)
        appendFileSync(debug, `${expect.getState().currentTestName}\t${rendered}`)
      count += 1
    } catch {
      digest.update(`${name}(unrenderable)\n`)
    }
  },
  inTest: () => inTest,
  errors: () => currentTask?.result?.errors ?? [],
  recordAssertion: () => recordAssertion(),
}
const proto = chai.Assertion.prototype
// `withTest` is Vitest's binding of an assertion to its test, and `assert` is
// the check every matcher calls; neither is a matcher. Whether `withTest`
// runs varies between runs, and wrapping `assert` counts each matcher twice.
const notMatchers = new Set([`constructor`, `withTest`, `assert`])
const WRAPPED = Symbol.for(`oracle-gaps.wrapped`)
if (!proto[WRAPPED]) {
  proto[WRAPPED] = true
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (notMatchers.has(name)) continue
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (!descriptor || typeof descriptor.value !== `function`) continue
    const matcher = descriptor.value
    Object.defineProperty(proto, name, {
      ...descriptor,
      value: function (...args) {
        const hooks = globalThis.__oracleGapsHooks
        hooks.matcher(name, this)
        // A soft assertion (`expect.soft`) does not throw: Vitest records its
        // failure among the test's errors and the test goes on. A failure is
        // seen as a new assertion error there.
        const soft = hooks.inTest() && chai.util.flag(this, `soft`)
        const errorsBefore = hooks.errors().length
        try {
          const returned = matcher.apply(this, args)
          if (
            soft &&
            hooks
              .errors()
              .slice(errorsBefore)
              .some((error) => error?.name === `AssertionError`)
          )
            hooks.recordAssertion()
          return returned
        } catch (error) {
          // A thrown assertion error is recognized by its type, never by its
          // message.
          if (hooks.inTest() && error instanceof chai.AssertionError)
            hooks.recordAssertion()
          throw error
        }
      },
    })
  }
}

// An assertion that fails is a verdict under an unnamed law, as older
// oracles judge (transitional; check.mjs), with the route active when it
// failed.
function recordAssertion() {
  verdicts.set(`(unnamed)\u0000${route}`, {
    property: currentFile,
    law: `(unnamed)`,
    checkpoint: `assertion`,
    route,
  })
}

// A mutant run may stop at its first kill (maintainer decision,
// 2026-11-06): once a test fails with a verdict under a behavioral law, any
// but reach agreement, on a reproducible route, the file's remaining tests
// are skipped. The runner also runs no further file (check.mjs). A verdict
// in a test that passes kills nothing, as in the classification, and so does
// a verdict in a nondeterministic test.
const reproducibleRoutes = new Set([
  `fixed seed`,
  `fixed history`,
  `constructed history`,
  `case`,
  `enumerated`,
])
let stopped = skippedCopy
let currentTask
// When the current test started, so its row records how long it took.
let testStarted = 0

// Each law violation the oracle framework raises, so the runner classifies
// a kill by the law that rejected the mutant rather than by error text.
let verdicts = new Map()
globalThis.__oracleVerdict = ({ property, law, checkpoint }) => {
  // A verdict after its test ended cannot be attributed to it.
  if (!inTest) return
  // A verdict carries the route active when it fired, so a test that runs
  // several campaigns is attributed per campaign.
  const key = `${property}\u0000${law}\u0000${checkpoint}\u0000${route}`
  verdicts.set(key, { property, law, checkpoint, route })
}
// The route the framework registered for the current test (index.mjs routeOf).
let route
globalThis.__oracleRoute = (registered) => {
  if (inTest) route = registered
}

globalThis.__oracleObserve = (checkpoint, value) => {
  observed.update(`${checkpoint}(${render(value)})\n`)
  observations += 1
}

beforeEach((context) => {
  currentFile = context.task.file?.filepath
  currentTask = context.task
  observed = createHash(`sha1`)
  observations = 0
  if (stopped || (selected && !selected.has(testKey(context.task))))
    context.skip()
  installRandom(testKey(context.task))
  digest = createHash(`sha1`)
  count = 0
  uuids = new Map()
  identities = new Map()
  hits = new Set()
  outcomes = new Map()
  verdicts = new Map()
  testStarted = performance.now()
  histories = 0
  siteHistories = new Map()
  route = undefined
  inTest = true
})

// Tests whose observations varied between the two unmutated runs: their
// verdicts judge nothing, so they never stop a run.
const ignored = new Set(state.ignore ?? [])
afterEach((context) => {
  inTest = false
  if (
    state.stopOnKill &&
    !ignored.has(testKey(context.task)) &&
    (context.task.result?.state === `fail` ||
      (context.task.result?.errors?.length ?? 0) > 0) &&
    [...verdicts.values()].some(
      (v) =>
        v.law !== `reach agreement` && reproducibleRoutes.has(v.route ?? route),
    )
  ) {
    stopped = true
    if (unit) killed.add(unit.mutant)
  }
  if (!state.capture) return
  appendFileSync(
    state.capture,
    `${JSON.stringify({
      key: testKey(context.task),
      hash: digest.digest(`hex`),
      count,
      observed: observations > 0 ? observed.digest(`hex`) : undefined,
      hits: [...hits],
      outcomes: [...outcomes],
      verdicts: [...verdicts.values()],
      route,
      ms: Math.round(performance.now() - testStarted),
      // The test's own result, so a batch cut short by a hang still has the
      // results of the copies that finished.
      state: context.task.result?.state,
      message: (context.task.result?.errors ?? [])
        .map((error) =>
          error?.cause?.message
            ? `${error.cause.name ?? ``}: ${error.cause.message}`
            : `${error?.name ?? ``}: ${error?.message ?? ``}`,
        )
        .join(`\n`)
        .slice(0, 2000),
      ...(process.env.ORACLE_GAPS_PROFILE
        ? { histories, siteHistories: [...siteHistories] }
        : {}),
    })}\n`,
  )
  hits = new Set()
})

const thisFile = globalThis.__vitest_worker__?.filepath
afterAll(() => {
  if (!state.capture) return
  if (currentFile)
    appendFileSync(
      state.capture,
      `${JSON.stringify({ key: `${currentFile} > (background)`, background: true, hits: [...background] })}\n`,
    )
  // A batch's watchdog reads this row to know that the copy finished; a
  // skipped copy says so, and its run is no evidence.
  appendFileSync(
    state.capture,
    `${JSON.stringify({ file: thisFile, closed: true, ...(skippedCopy ? { skipped: true } : {}) })}\n`,
  )
})
