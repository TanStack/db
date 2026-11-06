/**
 * # The gap report's classification, checked on run records
 *
 * Laws 4 and 7 of the gap report (gap-report-oracle.property.test.mjs states
 * them in full) say what each mutant's outcome is and what the summary lists.
 * The CLI computes both from plain records of the runs that judged a mutant
 * (classify.mjs, report.mjs): each test's state and error text, whether its
 * file's run timed out or failed to load, and its capture rows, which hold
 * the sites it reached, the `if` outcomes it saw, the hashes of what it
 * asserted on and observed, its registered route, and its law verdicts.
 * This oracle generates those records directly, including combinations that
 * a fixture package reaches only rarely, and checks the CLI's pure functions
 * against a small model in-process. The end-to-end oracle checks that real
 * runs produce such records.
 *
 * ## The law over records
 *
 * For one mutant, with the owner files of its function:
 *
 * 1. No owner: `unowned`. No owner test reached it: `unreached`.
 * 2. Otherwise the records of the owner files whose tests reached it judge
 *    it, except tests whose values differed between the two unmutated runs
 *    (nondeterministic), which judge nothing.
 * 3. A law verdict takes the route active when it fired, or the test's route
 *    when none was active. A verdict on a reproducible route (a fixed seed,
 *    a fixed, constructed, or enumerated history, a case) under a behavioral
 *    law (any law but reach agreement) kills: `killed`, even when another
 *    owner file's run timed out, and the kill names at least one such law.
 *    The runner may stop at the first one (maintainer decision, 2026-11-06),
 *    so a kill names a non-empty part of them. Failing that, a run that
 *    timed out makes it `timeout`. Failing that, reproducible verdicts under
 *    reach agreement alone make it an `agreement-only-kill`, which names
 *    them all. Failing that, a verdict on the random campaign
 *    makes it a `random-only-kill`, and one on an unknown or unregistered
 *    route an `unregistered-kill`.
 * 4. Failing that, if every failing test timed out, it is `timeout`; a
 *    failing test outside the framework's own checks makes it `crashed`; a
 *    failing framework check alone (a calibration, a probe calibration, the
 *    determinism test) makes it a `framework-error`; and errors outside any
 *    test make it a `setup-error`.
 * 5. With no failure it survived: a `comparison-gap` when a reaching,
 *    deterministic owner test's asserted or observed value changed;
 *    `indeterminate` when no such test judged it; a `generator-gap` when an
 *    `if` on its line, reached by an owner test, never took one of its
 *    outcomes in the owners' tests; and `no-observed-difference` otherwise.
 * 6. A survivor or an unreached mutant that ordinary tests reached gets
 *    their outcome for information, where an assertion failure counts on the
 *    test's route; it never changes the class.
 *
 * Law 7 over the classified mutants: the summary lists every gap (every
 * class except `killed` and `unowned`, outside probe code) once under its
 * key, with its kind and line, every unowned mutant as a warning, and counts
 * that agree.
 *
 * Authority: the maintainer's gap-check decisions (design runs v11, v14,
 * and v19), as for scripts.gap-report; ORC-006's outcome kinds; the frozen
 * design's oracle over the checker's pure core (v19 P10, F4); and the
 * maintainer's few-seconds budget for an incremental test run (2026-11-05).
 *
 * Limits: authored mutants are not generated here (the end-to-end oracle
 * has them). The records' shapes are those capture-setup.mjs writes; that a
 * real run writes them correctly is the end-to-end oracle's.
 */
import fc from 'fast-check'
import { declareOracle } from '../../packages/db/tests/oracle-declaration.ts'
import {
  oracleProperty,
  pass,
  violation,
} from '../../packages/db/tests/oracle-property.ts'
import {
  baselineOf,
  judgeMutant,
  judgeOrdinary,
  needsOrdinary,
  targetsOf,
} from './classify.mjs'
import { readSummary } from './gap-report-model-oracle.mjs'
import { assignKeys, renderReport } from './report.mjs'

const MUTANTS = 4

// ## History grammar
//
// A history is a package's test files, each an oracle file or an ordinary
// one, and up to four mutants of one source, each with its owner files, its
// line, operator, and statement anchor (with backticks, which the summary
// must fence). Each test has a registered route or none, may be
// nondeterministic, and has, for each mutant, whether it reached it, which
// outcomes an `if` there took, and what it did under it: nothing different,
// a changed asserted or observed value, a law verdict (on the route then active, or with none
// active), an assertion failure, a crash, a timeout message, a timed-out
// run, a setup error, or an unhandled error.
const routes = [
  undefined,
  `fixed seed`,
  `fixed history`,
  `constructed history`,
  `case`,
  `enumerated`,
  `random seed`,
  `calibration`,
  `probe calibration`,
  `determinism`,
  `custom route`,
]
const effect = fc.record({
  kind: fc.constantFrom(
    `same`,
    `same`,
    `changed`,
    `observedChanged`,
    `verdict`,
    `verdict`,
    `assertion`,
    `crash`,
    `timeoutMessage`,
    `runTimeout`,
    `setupError`,
    `unhandled`,
  ),
  law: fc.constantFrom(`L`, `reach agreement`),
  // The route active when a verdict fired, when it differs from the test's.
  firedAt: fc.option(fc.constantFrom(...routes.slice(1)), { nil: undefined }),
})
const testRecord = fc.record({
  route: fc.constantFrom(...routes),
  flaky: fc.constantFrom(false, false, false, true),
  reaches: fc.array(fc.boolean(), { minLength: MUTANTS, maxLength: MUTANTS }),
  seen: fc.array(fc.constantFrom(`both`, `both`, `true`, `false`), {
    minLength: MUTANTS,
    maxLength: MUTANTS,
  }),
  under: fc.array(effect, { minLength: MUTANTS, maxLength: MUTANTS }),
})
const records = fc.record({
  files: fc.array(
    fc.record({
      oracle: fc.boolean(),
      tests: fc.array(testRecord, { minLength: 1, maxLength: 3 }),
      // Code that ran when the file loaded, outside any test.
      background: fc.array(fc.boolean(), { minLength: MUTANTS, maxLength: MUTANTS }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
  mutants: fc.array(
    fc.record({
      owners: fc.array(fc.nat({ max: 2 }), { maxLength: 2 }),
      line: fc.nat({ max: 1 }),
      operator: fc.constantFrom(`if-true`, `if-false`, `delete-call`),
      anchor: fc.constantFrom(
        `out . push ( 'a' ) ;`,
        `if ( x > 4 ) out . push ( \`b\` ) ;`,
        `x \`\` y`,
        // Longer than 80 characters, so a key cannot be cut short.
        `if ( value . total > limit . maximum && value . total !== limit . exact ) out . push ( 'over the limit' ) ;`,
      ),
      probe: fc.constantFrom(false, false, false, true),
    }),
    { minLength: 1, maxLength: MUTANTS },
  ),
})

const fileName = (index) => `/pkg/tests/f${index}.test.ts`
const keyOf = (fi, ti) => `${fileName(fi)} > t${ti}`
const reproducible = new Set([
  `fixed seed`,
  `fixed history`,
  `constructed history`,
  `case`,
  `enumerated`,
])
const framework = new Set([`calibration`, `probe calibration`, `determinism`])
const kindOf = (route) =>
  route === undefined
    ? `unknown`
    : reproducible.has(route)
      ? `reproducible`
      : route === `random seed`
        ? `random`
        : framework.has(route)
          ? `framework`
          : `unknown`

// ## Model
//
// The model states the law above over the records, without the CLI's
// functions: it reads each test's effect under the mutant directly.
function modelOutcome(h, mi) {
  const m = h.mutants[mi]
  const owners = new Set(m.owners.filter((fi) => fi < h.files.length && h.files[fi].oracle))
  const reachingIn = (fi) =>
    h.files[fi].background[mi] || h.files[fi].tests.some((t) => t.reaches[mi])
  const ordinary = h.files
    .map((f, fi) => fi)
    .filter((fi) => !h.files[fi].oracle && reachingIn(fi))
  const withOrdinary = (result) =>
    (result.outcome === `survived` || result.outcome === `unreached`) && ordinary.length > 0
      ? { ...result, testOutcome: ordinaryOutcome(h, mi, ordinary) }
      : result
  if (owners.size === 0) return { outcome: `unowned` }
  const targets = [...owners].filter(reachingIn)
  if (targets.length === 0) return withOrdinary({ outcome: `unreached` })
  const tests = targets.flatMap((fi) => h.files[fi].tests.map((t, ti) => ({ t, fi, ti })))
  const under = ({ t }) => t.under[mi].kind
  const timedOut = tests.some((x) => under(x) === `runTimeout`)
  const setup = tests.some((x) => under(x) === `setupError`)
  // A file that failed to load, or whose run timed out, ran no tests.
  const ran = tests.filter(
    (x) =>
      !h.files[x.fi].tests.some((t) => [`setupError`, `runTimeout`].includes(t.under[mi].kind)),
  )
  const failing = ran.filter(
    (x) => !x.t.flaky && [`verdict`, `assertion`, `crash`, `timeoutMessage`].includes(under(x)),
  )
  const verdictsOn = (kind) =>
    failing
      .filter((x) => under(x) === `verdict` && kindOf(x.t.under[mi].firedAt ?? x.t.route) === kind)
      .map((x) => x.t.under[mi].law)
  const kills = verdictsOn(`reproducible`)
  const behavioral = kills.filter((law) => law !== `reach agreement`)
  if (behavioral.length > 0)
    return { outcome: `killed`, laws: [...new Set(behavioral)].sort(), lawsMayBePart: true }
  if (timedOut) return { outcome: `timeout` }
  if (kills.length > 0) return { outcome: `agreement-only-kill`, laws: [`reach agreement`] }
  if (verdictsOn(`random`).length > 0) return withOrdinary({ outcome: `random-only-kill` })
  if (verdictsOn(`unknown`).length > 0) return { outcome: `unregistered-kill` }
  if (failing.length > 0 && failing.every((x) => under(x) === `timeoutMessage`))
    return { outcome: `timeout` }
  if (failing.some((x) => under(x) !== `timeoutMessage` && kindOf(x.t.route) !== `framework`))
    return { outcome: `crashed` }
  if (failing.length > 0) return { outcome: `framework-error` }
  const unhandled = ran.some((x) => under(x) === `unhandled`)
  if (setup || unhandled) return { outcome: `setup-error` }
  // A survivor. Only reaching, deterministic owner tests judge it.
  const compared = ran.filter((x) => x.t.reaches[mi] && !x.t.flaky)
  if (compared.some((x) => [`changed`, `observedChanged`].includes(under(x))))
    return withOrdinary({ outcome: `survived`, class: `comparison-gap` })
  if (compared.length === 0) return withOrdinary({ outcome: `survived`, class: `indeterminate` })
  const missing = h.mutants.some((other, oi) => {
    if (other.operator !== `if-true` || other.line !== m.line) return false
    const seen = targetsSeen(h, oi, owners)
    return seen.reached && !(seen.truthy && seen.falsy)
  })
  return withOrdinary({
    outcome: `survived`,
    class: missing ? `generator-gap` : `no-observed-difference`,
  })
}

// Whether an owner test reached an `if-true` mutant, and which outcomes the
// owners' deterministic and nondeterministic tests saw there.
function targetsSeen(h, oi, owners) {
  let reached = false
  let truthy = false
  let falsy = false
  for (const fi of owners) {
    if (h.files[fi].background[oi]) reached = true
    for (const t of h.files[fi].tests) {
      if (!t.reaches[oi]) continue
      reached = true
      truthy ||= t.seen[oi] !== `false`
      falsy ||= t.seen[oi] !== `true`
    }
  }
  return { reached, truthy, falsy }
}

// The ordinary tests' outcome: their assertion failures count on their
// test's route, and nothing is nondeterministic for them.
function ordinaryOutcome(h, mi, files) {
  const tests = files.flatMap((fi) => h.files[fi].tests.map((t) => ({ t, fi })))
  const under = ({ t }) => t.under[mi].kind
  const timedOut = tests.some((x) => under(x) === `runTimeout`)
  const ran = tests.filter(
    (x) =>
      !h.files[x.fi].tests.some((t) => [`setupError`, `runTimeout`].includes(t.under[mi].kind)),
  )
  const failing = ran.filter((x) =>
    [`verdict`, `assertion`, `crash`, `timeoutMessage`].includes(under(x)),
  )
  const judgedOn = (kind) =>
    failing.filter(
      (x) =>
        (under(x) === `verdict` && kindOf(x.t.under[mi].firedAt ?? x.t.route) === kind) ||
        (under(x) === `assertion` && kindOf(x.t.route) === kind && kind !== `framework`),
    )
  const kills = judgedOn(`reproducible`)
  const behavioral = kills.filter(
    (x) => under(x) === `assertion` || x.t.under[mi].law !== `reach agreement`,
  )
  if (behavioral.length > 0) return `killed`
  if (timedOut) return `timeout`
  if (kills.length > 0) return `agreement-only-kill`
  if (judgedOn(`random`).length > 0) return `random-only-kill`
  if (judgedOn(`unknown`).length > 0) return `unregistered-kill`
  if (failing.length > 0 && failing.every((x) => under(x) === `timeoutMessage`)) return `timeout`
  if (failing.some((x) => under(x) !== `timeoutMessage` && kindOf(x.t.route) !== `framework`))
    return `crashed`
  if (failing.length > 0) return `framework-error`
  if (tests.some((x) => under(x) === `setupError` || under(x) === `unhandled`)) return `setup-error`
  return `survived`
}

function model(h) {
  const outcomes = h.mutants.map((m, mi) => modelOutcome(h, mi))
  const kindOfResult = (o) => o.class ?? o.outcome
  const keyOf = (m, mi) => {
    const base = `src/x.ts#f${m.line}:${m.operator}:${m.anchor}`
    const before = h.mutants
      .slice(0, mi)
      .filter((o) => o.line === m.line && o.operator === m.operator && o.anchor === m.anchor).length
    return before === 0 ? base : `${base}~${before + 1}`
  }
  const listed = h.mutants.map((m, mi) => ({ m, key: keyOf(m, mi), kind: kindOfResult(outcomes[mi]) }))
  const gapsOf = listed.filter((x) => !x.m.probe && ![`killed`, `unowned`].includes(x.kind))
  return {
    outcomes,
    summary: {
      counts: {
        mutants: h.mutants.length,
        authored: 0,
        killed: listed.filter((x) => !x.m.probe && x.kind === `killed`).length,
        gaps: gapsOf.length,
        probe: listed.filter((x) => x.m.probe).length,
      },
      gaps: gapsOf.map((x) => x.key).sort(),
      unowned: listed.filter((x) => !x.m.probe && x.kind === `unowned`).map((x) => x.key).sort(),
      entries: gapsOf
        .map((x) => ({ key: x.key, kind: x.kind, line: String(x.m.line + 1) }))
        .sort((a, b) => (a.key < b.key ? -1 : 1)),
    },
  }
}

// ## Production driver
//
// The driver turns the records into the capture rows and units the CLI's
// runner produces, calls the CLI's classification for each mutant as the
// runner does (asking for units only of the files it targets), assigns keys,
// and renders the summary.
const messages = {
  verdict: `Error: violation`,
  assertion: `AssertionError: expected [ 'a' ] to deeply equal [ 'b' ]`,
  crash: `TypeError: x.y is not a function`,
  timeoutMessage: `Error: Test timed out in 15000ms.`,
}
function rowsOf(h, pass) {
  const rows = new Map()
  h.files.forEach((f, fi) => {
    f.tests.forEach((t, ti) => {
      rows.set(keyOf(fi, ti), {
        key: keyOf(fi, ti),
        hash: t.flaky && pass === 2 ? `h-again` : `h`,
        observed: `o`,
        hits: t.reaches.flatMap((r, mi) => (r && mi < h.mutants.length ? [mi] : [])),
        outcomes: t.reaches.flatMap((r, mi) =>
          r && mi < h.mutants.length && h.mutants[mi].operator === `if-true`
            ? [[mi, [t.seen[mi] !== `false`, t.seen[mi] !== `true`]]]
            : [],
        ),
        route: t.route,
        verdicts: [],
      })
    })
    rows.set(`${fileName(fi)} > (background)`, {
      key: `${fileName(fi)} > (background)`,
      background: true,
      hits: f.background.flatMap((r, mi) => (r && mi < h.mutants.length ? [mi] : [])),
    })
  })
  return rows
}
function unitOf(h, fi, mi) {
  const f = h.files[fi]
  const under = (t) => t.under[mi]
  if (f.tests.some((t) => under(t).kind === `runTimeout`))
    return { file: fileName(fi), timedOut: true, seconds: 1 }
  const loadFailed = f.tests.some((t) => under(t).kind === `setupError`)
  const tests = loadFailed ? [] : f.tests
  return {
    file: fileName(fi),
    timedOut: false,
    seconds: 1,
    setupErrors: loadFailed ? [`Error: cannot load the file`] : [],
    unhandled: tests.some((t) => under(t).kind === `unhandled`) ? [`unhandled rejection`] : [],
    tests: tests.map((t, ti) => {
      const kind = under(t).kind
      return {
        key: keyOf(fi, ti),
        fullName: `t${ti}`,
        state: messages[kind] ? `failed` : `passed`,
        message: messages[kind] ?? ``,
      }
    }),
    rows: tests.map((t, ti) => {
      const kind = under(t).kind
      return [
        keyOf(fi, ti),
        {
          key: keyOf(fi, ti),
          hash: kind === `changed` ? `h-changed` : `h`,
          observed: kind === `observedChanged` ? `o-changed` : `o`,
          hits: [],
          outcomes: [],
          route: t.route,
          verdicts:
            kind === `verdict`
              ? [{ property: `p`, law: under(t).law, checkpoint: `c`, route: under(t).firedAt }]
              : [],
        },
      ]
    }),
  }
}

async function driver(h, observe) {
  const oracleFiles = new Set(h.files.flatMap((f, fi) => (f.oracle ? [fileName(fi)] : [])))
  const baseline = baselineOf(rowsOf(h, 1), rowsOf(h, 2), oracleFiles)
  const mutants = h.mutants.map((m, mi) => ({
    id: `m${mi}`,
    number: mi,
    source: `src/x.ts`,
    function: `f${m.line}`,
    line: m.line + 1,
    operator: m.operator,
    anchor: m.anchor,
    ...(m.probe ? { probeGuard: true } : {}),
  }))
  const fileIndex = (file) => Number(file.match(/f(\d+)\.test/)[1])
  const states = new Set()
  const results = mutants.map((mutant, mi) => {
    const owners = new Set(
      h.mutants[mi].owners
        .filter((fi) => fi < h.files.length)
        .map(fileName)
        .filter((file) => oracleFiles.has(file)),
    )
    const targets = targetsOf(mutant, baseline, owners, oracleFiles)
    const units = targets.oracleTargets.map((file) => unitOf(h, fileIndex(file), mi))
    const result = {
      ...mutant,
      ...judgeMutant(mutant, { owners, targets, units, baseline, mutants }),
    }
    if (result.outcome === `killed` && units.some((u) => u.timedOut))
      states.add(`killed beside a timeout`)
    if (needsOrdinary(result, targets))
      result.testOutcome = judgeOrdinary(
        targets.testTargets.map((file) => unitOf(h, fileIndex(file), mi)),
      )
    return result
  })
  assignKeys(results)
  observe(`classified`, {
    outcomes: results.map((r) => ({
      outcome: r.outcome,
      class: r.class,
      laws: r.laws && [...r.laws].sort(),
      testOutcome: r.testOutcome,
    })),
    summary: readSummary(
      renderReport({ results, run: { id: `r`, inputs: `records` }, excluded: [] }),
    ),
  })
  for (const r of results) {
    states.add(r.class ?? r.outcome)
    if (r.testOutcome === `killed`) states.add(`ordinary killed`)
  }
  if (h.mutants.some((m) => m.anchor.includes(`\``) && !m.probe)) states.add(`a key with backticks`)
  for (const state of states) observe(`reach`, state)
}

// ## Comparison
function check(h, observations, expected) {
  const got = observations.find((o) => o.checkpoint === `classified`)?.value
  if (!got) return violation(`classified`, `nothing was classified`, `completion`)
  // A kill names a non-empty part of its behavioral laws (the runner may
  // stop at the first); an agreement-only kill names reach agreement.
  const view = (o) => JSON.stringify([o.outcome, o.class, o.testOutcome ?? null])
  for (const [mi, owed] of expected.outcomes.entries()) {
    const actual = got.outcomes[mi]
    const lawsFit =
      owed.laws === undefined ||
      (owed.lawsMayBePart
        ? (actual.laws ?? []).length > 0 && actual.laws.every((law) => owed.laws.includes(law))
        : JSON.stringify(actual.laws ?? []) === JSON.stringify(owed.laws))
    if (view(actual) !== view(owed) || !lawsFit)
      return violation(`classified`, `mutant m${mi}: ${view(actual)} laws ${JSON.stringify(actual.laws ?? [])}, owed ${view(owed)} laws ${JSON.stringify(owed.laws ?? [])}`, `classification`, { actual, expected: owed })
  }
  if (JSON.stringify(got.summary) !== JSON.stringify(expected.summary))
    return violation(`classified`, `the summary does not list exactly the owed gaps, unowned warnings, and counts`, `report completeness`, { actual: got.summary, expected: expected.summary })
  return pass
}

declareOracle({ check: [check], model: [model, modelOutcome, ordinaryOutcome], grammar: [records] })

// ## Calibrations
const corrupt = (change) => (trace) => {
  const index = trace.findIndex((o) => o.checkpoint === `classified`)
  if (index < 0) return undefined
  const value = structuredClone(trace[index].value)
  if (change(value) === false) return undefined
  return trace.map((o, i) => (i === index ? { ...o, value } : o))
}
const calibrations = [
  {
    name: `a crash is reported as a kill`,
    law: `classification`,
    corrupt: corrupt((v) => {
      const o = v.outcomes.find((x) => x.outcome === `crashed`)
      if (!o) return false
      o.outcome = `killed`
    }),
  },
  {
    name: `a random-only kill is reported as a kill`,
    law: `classification`,
    corrupt: corrupt((v) => {
      const o = v.outcomes.find((x) => x.outcome === `random-only-kill`)
      if (!o) return false
      o.outcome = `killed`
    }),
  },
  {
    name: `the summary omits a gap`,
    law: `report completeness`,
    corrupt: corrupt((v) => {
      if (v.summary.gaps.length === 0) return false
      v.summary.gaps.shift()
    }),
  },
]

const required = [
  `unowned`,
  `unreached`,
  `timeout`,
  `killed`,
  `killed beside a timeout`,
  `agreement-only-kill`,
  `random-only-kill`,
  `unregistered-kill`,
  `crashed`,
  `framework-error`,
  `setup-error`,
  `comparison-gap`,
  `indeterminate`,
  `generator-gap`,
  `no-observed-difference`,
  `ordinary killed`,
  `a key with backticks`,
]

// One constructed history per outcome class: one mutant judged by one
// oracle file's test, with the effect that makes the class, and an ordinary
// file whose assertion fails beside a survivor.
const four = (value) => Array.from({ length: MUTANTS }, () => value)
const single = (name, enters, { mutant = {}, test = {}, effect = {}, ordinary = false } = {}) => ({
  name,
  enters,
  build: () => ({
    files: [
      {
        oracle: true,
        tests: [
          {
            route: `fixed seed`,
            flaky: false,
            reaches: four(true),
            seen: four(`both`),
            under: four({ kind: `same`, law: `L`, firedAt: undefined, ...effect }),
            ...test,
          },
        ],
        background: four(false),
      },
      ...(ordinary
        ? [
            {
              oracle: false,
              tests: [
                {
                  route: `fixed seed`,
                  flaky: false,
                  reaches: four(true),
                  seen: four(`both`),
                  under: four({ kind: `assertion`, law: `L`, firedAt: undefined }),
                },
              ],
              background: four(false),
            },
          ]
        : []),
    ],
    mutants: [
      {
        owners: [0],
        line: 0,
        operator: `delete-call`,
        anchor: `out . push ( 'a' ) ;`,
        probe: false,
        ...mutant,
      },
    ],
  }),
})
const constructed = [
  single(`an unowned mutant`, [`unowned`], { mutant: { owners: [] } }),
  single(`an unreached mutant`, [`unreached`], { test: { reaches: four(false) } }),
  single(`a run that timed out`, [`timeout`], { effect: { kind: `runTimeout` } }),
  single(`a verdict on a fixed seed`, [`killed`], { effect: { kind: `verdict` } }),
  single(`reach agreement alone`, [`agreement-only-kill`], {
    effect: { kind: `verdict`, law: `reach agreement` },
  }),
  single(`a verdict that fired in the random campaign`, [`random-only-kill`], {
    effect: { kind: `verdict`, firedAt: `random seed` },
  }),
  single(`a verdict with no route`, [`unregistered-kill`], {
    test: { route: undefined },
    effect: { kind: `verdict` },
  }),
  single(`a crash`, [`crashed`], { effect: { kind: `crash` } }),
  {
    // One owner file kills; another's run times out. The kill decides.
    name: `a kill beside a timed-out run`,
    enters: [`killed beside a timeout`],
    build: () => {
      const base = single(`x`, [], { effect: { kind: `verdict` } }).build()
      return {
        ...base,
        files: [
          base.files[0],
          {
            ...base.files[0],
            tests: [{ ...base.files[0].tests[0], under: four({ kind: `runTimeout`, law: `L`, firedAt: undefined }) }],
          },
        ],
        mutants: [{ ...base.mutants[0], owners: [0, 1] }],
      }
    },
  },
  single(`a failing calibration`, [`framework-error`], {
    test: { route: `calibration` },
    effect: { kind: `crash` },
  }),
  single(`a file that fails to load`, [`setup-error`], { effect: { kind: `setupError` } }),
  single(`a changed value`, [`comparison-gap`], { effect: { kind: `changed` } }),
  single(`a changed observation`, [`comparison-gap`], { effect: { kind: `observedChanged` } }),
  single(`only a nondeterministic test`, [`indeterminate`], { test: { flaky: true } }),
  single(`an if that took one outcome`, [`generator-gap`], {
    mutant: { operator: `if-true` },
    test: { seen: four(`true`) },
  }),
  single(
    `a survivor an ordinary test fails`,
    [`no-observed-difference`, `ordinary killed`],
    { ordinary: true },
  ),
  single(`a key with backticks`, [`a key with backticks`], {
    mutant: { anchor: `x \`\` y` },
    effect: { kind: `changed` },
  }),
]

oracleProperty({
  id: `scripts.gap-report-classify`,
  law: {
    statement: `From the records of the runs that judged it, each mutant gets the outcome the law assigns: kills only by law verdicts on reproducible routes, agreement-only, random-only, and unregistered kills, timeouts, crashes, framework and setup errors as gaps, survivors split into comparison gaps, indeterminate, generator gaps, and no observed difference, and ordinary tests for information only; the summary lists every gap and unowned mutant once with consistent counts.`,
    authority: `The maintainer's gap-check decisions in design runs v11, v14, and v19 (2026-11-04 and 2026-11-05), as for scripts.gap-report; oracle-rubric ORC-006 outcome kinds; the frozen design's oracle over the checker's pure core (v19 P10, F4); the maintainer's few-seconds budget for an incremental test run (2026-11-05).`,
    limits: `No authored mutants. That real runs produce these records is scripts.gap-report's.`,
    owner: `scripts/oracle-gaps`,
  },
  histories: {
    arbitrary: records,
    states: required,
    runs: 300,
    fixedSeeds: [20261105],
    constructed,
  },
  resolve: (h) => h,
  model,
  driver,
  check,
  calibrations,
  timeout: 60_000,
})
