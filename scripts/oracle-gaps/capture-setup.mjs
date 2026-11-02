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
import { afterAll, afterEach, beforeEach, chai, expect, inject } from 'vitest'

const state =
  inject(`oracleGaps`) ??
  (process.env.ORACLE_GAPS_STATE
    ? JSON.parse(readFileSync(process.env.ORACLE_GAPS_STATE, `utf8`))
    : { mutant: null, select: null, capture: null })
if (state.mutant !== null) {
  const fc = await import(`fast-check`).catch(() => undefined)
  fc?.configureGlobal({ ...fc.readConfigureGlobal(), endOnFailure: true })
}
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
const hit = (id) => (inTest ? hits : background).add(id)
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

// A stable, cycle-safe rendering. It keeps the distinctions an assertion can
// see (types, order, Map and Set entries, error identity by name and message)
// and drops ones it cannot (object identity, functions' bodies).
function render(value, seen = new Set(), depth = 0) {
  if (depth > 8) return `…`
  if (value === null) return `null`
  const type = typeof value
  if (type === `undefined`) return `undefined`
  if (type === `number`) return Object.is(value, -0) ? `-0` : String(value)
  if (type === `string`) return JSON.stringify(canonical(value.slice(0, 4000)))
  if (type === `boolean` || type === `bigint`) return `${type}:${value}`
  if (type === `symbol`) return `symbol:${value.description ?? ``}`
  if (type === `function`) return `fn:${value.name}`
  if (seen.has(value)) return `[cycle]`
  seen.add(value)
  try {
    if (value instanceof Error)
      return `Error:${value.name}:${value.message}:${render(value.cause, seen, depth + 1)}`
    if (value instanceof Date) return `Date:${value.getTime()}`
    if (value instanceof Map)
      return `Map{${[...value].map(([k, v]) => `${render(k, seen, depth + 1)}=>${render(v, seen, depth + 1)}`).join(`,`)}}`
    if (value instanceof Set)
      return `Set{${[...value].map((v) => render(v, seen, depth + 1)).join(`,`)}}`
    if (Array.isArray(value))
      return `[${value.map((v) => render(v, seen, depth + 1)).join(`,`)}]`
    if (ArrayBuffer.isView(value))
      return `${value.constructor.name}(${Array.from(value).join(`,`)})`
    if (typeof value.then === `function`) return `Promise`
    const name = value.constructor?.name ?? `null-proto`
    const keys = Object.keys(value).sort()
    return `${name}{${keys.map((k) => `${k}:${render(value[k], seen, depth + 1)}`).join(`,`)}}`
  } finally {
    seen.delete(value)
  }
}

// Every matcher is a method on chai's Assertion prototype. Wrapping each one
// records its name and the value under test before the matcher runs.
const proto = chai.Assertion.prototype
for (const name of Object.getOwnPropertyNames(proto)) {
  if (name === `constructor`) continue
  const descriptor = Object.getOwnPropertyDescriptor(proto, name)
  if (!descriptor || typeof descriptor.value !== `function`) continue
  const matcher = descriptor.value
  Object.defineProperty(proto, name, {
    ...descriptor,
    value: function (...args) {
      try {
        const rendered = `${name}(${render(chai.util.flag(this, `object`))})\n`
        digest.update(rendered)
        if (debug)
          appendFileSync(
            debug,
            `${expect.getState().currentTestName}\t${rendered}`,
          )
        count += 1
      } catch {
        digest.update(`${name}(unrenderable)\n`)
      }
      return matcher.apply(this, args)
    },
  })
}

globalThis.__oracleObserve = (checkpoint, value) => {
  observed.update(`${checkpoint}(${render(value)})\n`)
  observations += 1
}

beforeEach((context) => {
  currentFile = context.task.file?.filepath
  observed = createHash(`sha1`)
  observations = 0
  if (selected && !selected.has(testKey(context.task))) context.skip()
  digest = createHash(`sha1`)
  count = 0
  uuids = new Map()
  hits = new Set()
  outcomes = new Map()
  inTest = true
})

afterEach((context) => {
  inTest = false
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
    })}\n`,
  )
  hits = new Set()
})

afterAll(() => {
  if (!state.capture || !currentFile) return
  const file = currentFile
  appendFileSync(
    state.capture,
    `${JSON.stringify({ key: `${file} > (background)`, background: true, hits: [...background] })}\n`,
  )
})
