/**
 * # The gap report's static laws, checked in-process
 *
 * Laws 1, 2, 3 (its static part), 6, and 8 (its key part) of the gap report
 * (gap-report-oracle.property.test.mjs states them in full) decide what the
 * report owes before any test runs: which operator mutants exist, which are
 * probe-only code, which oracle files own each function's call tree, which
 * declarations refuse the run, and each mutant's key. The CLI computes all of
 * them in `analyze` (analysis.mjs) and `assignKeys` (report.mjs), from files
 * alone. This oracle writes each generated fixture to a scratch package and
 * calls those functions directly, without Vitest or a child process, so a
 * history costs tens of milliseconds and a campaign a few seconds. The
 * end-to-end oracle keeps the laws that need real test runs.
 *
 * Laws, checked in this order:
 *
 * - **Refusal.** An owns entry that names no function, an entry that names a
 *   missing file, and an owns list that is not a literal each refuse, naming
 *   the cause. An owner whose tests fail is a runtime refusal, so here it
 *   must not refuse.
 * - **Enumeration.** The mutant set is the model's: each site by its source,
 *   function, line, operator, and order on the line.
 * - **Probe-only code.** Each mutant is marked as probe code exactly when the
 *   model says its site is probe-only code.
 * - **Ownership.** A mutant's function has an owner exactly when the model
 *   says it is not `unowned`.
 * - **Keys.** Each mutant's key is the model's anchor.
 * - **Key stability.** After the history's stability edit, every mutant
 *   that existed before keeps its key, its probe mark, and its ownership.
 *
 * Authority: as for the end-to-end oracle (the maintainer's gap-check
 * decisions in design runs v11, v14, and v19). The split itself follows the
 * frozen design's plan for the checker's oracle (v19 P10, F4: an oracle over
 * the checker's pure core, beside its process shell) and the maintainer's
 * budget of a few seconds for an incremental test run (2026-11-05).
 *
 * Limits: the grammar and model are the end-to-end oracle's
 * (gap-report-model-oracle.mjs), with its limits. Whether a mutant is
 * killed, and anything else that needs a test run, is the end-to-end
 * oracle's.
 */
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { declareOracle } from '../../packages/db/tests/oracle-declaration.ts'
import {
  oracleProperty,
  pass,
  violation,
} from '../../packages/db/tests/oracle-property.ts'
import { analyze } from './analysis.mjs'
import {
  LIB,
  SOURCE,
  edited,
  fixtureFiles,
  histories,
  interpret,
  model,
  ownersOf,
  probeHelpers,
  resolveHistory,
  writeFixture,
  written,
} from './gap-report-model-oracle.mjs'
import { assignKeys } from './report.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ts = createRequire(join(here, `../../package.json`))(`typescript`)

// ## Production driver
//
// The driver writes the fixture as the end-to-end driver does, lists the
// test files the fixture's Vitest config includes (`tests/**/*.test.ts`),
// and calls `analyze` and `assignKeys`. It records a refusal's message, or
// each mutant's site, probe mark, ownership, and key. For a stability
// history it rewrites the source and records the same again.
function analyzeFixture(dir, files) {
  writeFixture(dir, files)
  const tests = readdirSync(join(dir, `tests`))
    .filter((name) => name.endsWith(`.test.ts`))
    .map((name) => join(dir, `tests`, name))
  try {
    const { mutants, owned } = analyze(ts, dir, [SOURCE, LIB], tests)
    assignKeys(mutants)
    return {
      mutants: mutants.map((m) => ({
        source: m.source,
        function: m.function,
        line: m.line,
        operator: m.operator,
        probe: m.probeGuard === true,
        owned: owned.of(m.source, m.function).size > 0,
        key: m.key,
      })),
    }
  } catch (error) {
    return { refusal: String(error?.message ?? error) }
  }
}

const ownedStates = {
  w_leaf: `owned through a call chain`,
  'W0.step': `method owned through this`,
  wg0: `owned across files`,
  wg1: `owned through an aliased import`,
  w_valued: `owned through a value`,
  'W3.run': `owned through a field`,
  'W5.step': `owned through bind`,
  'W7.constructor': `constructor owned through new`,
  'W6.step': `a class passed as a value brings its methods`,
  w_overloaded: `overloaded function owned`,
}

async function driver(plan, observe) {
  const dir = realpathSync(mkdtempSync(join(here, `.scratch-`)))
  try {
    const files = fixtureFiles(plan)
    const before = analyzeFixture(dir, files)
    observe(`static`, before)
    const states = new Set()
    if (before.refusal) states.add(`refused ${plan.fault}`)
    for (const m of before.mutants ?? []) {
      if (m.probe) {
        if (m.function === `w_probeonly`) states.add(`derived probe helper`)
        if (m.function === `w_callschain`) states.add(`derived probe helper chain`)
        continue
      }
      if (m.owned && ownedStates[m.function]) states.add(ownedStates[m.function])
      if (!m.owned) states.add(`unowned`)
      if (m.function === `W4.step` && !m.owned)
        states.add(`a constructed class brings only what is referenced`)
      if (m.source === LIB && !m.owned) states.add(`unowned in another file`)
      if (m.function === `reportAndPush`) states.add(`mixed helper judged`)
      const generated = plan.functions.find(
        (fn) => fn.generated && fn.id === m.function,
      )
      if (generated?.owners.length === 0 && plan.wholeFile !== `none` && m.owned)
        states.add(`owned by a whole-file entry`)
      const kind = plan.functions
        .flatMap((fn) => fn.body.map((s) => [`${fn.file}:${s.line}`, s.kind]))
        .find(([at]) => at === `${m.source}:${m.line}`)?.[1]
      if (kind === `oldProbe`) states.add(`old probe form judged`)
      if (kind === `mixed` && m.operator === `if-true`)
        states.add(`production beside a probe`)
      if (kind === `elseIf` && m.operator === `if-true`)
        states.add(`production else judged`)
    }
    if (plan.stability !== `none` && !before.refusal) {
      observe(`stability`, analyzeFixture(dir, { ...files, [SOURCE]: edited(plan) }))
      states.add(`stability rerun`)
    }
    for (const state of states) observe(`reach`, state)
  } finally {
    written.delete(dir)
    rmSync(dir, { recursive: true, force: true })
  }
}

// ## Comparison
//
// Mutants are matched to the model's by source, function, line, operator,
// and order on the line, then each law is checked in turn.
const siteOf = (m) => `${m.source}:${m.function}:${m.line}:${m.operator}#${m.ordinal}`
const withOrdinals = (mutants) => {
  const seen = new Map()
  return mutants.map((m) => {
    const at = `${m.source} ${m.line} ${m.operator}`
    const ordinal = seen.get(at) ?? 0
    seen.set(at, ordinal + 1)
    return { ...m, ordinal }
  })
}

function check(plan, observations, expected) {
  const got = observations.find((o) => o.checkpoint === `static`)?.value
  if (!got) return violation(`static`, `no analysis was observed`, `completion`)
  // An owner that fails is found only when its tests run.
  const refused = plan.fault === `brokenOwner` ? undefined : expected.refused
  if (refused) {
    if (!got.refusal)
      return violation(`static`, `the analysis did not refuse ${refused.cause}`, `refusal`)
    if (!got.refusal.includes(refused.cause))
      return violation(
        `static`,
        `the refusal does not name ${refused.cause}: ${got.refusal}`,
        `refusal`,
      )
    return pass
  }
  if (got.refusal)
    return violation(`static`, `the analysis refused: ${got.refusal}`, `refusal`)
  const owedMutants = plan.fault === `brokenOwner` ? model({ ...plan, fault: `none` }).mutants : expected.mutants
  const actual = withOrdinals(got.mutants)
  if (actual.map(siteOf).sort().join() !== owedMutants.map(siteOf).sort().join())
    return violation(`static`, `the mutant set differs`, `enumeration`, {
      actual: actual.map(siteOf).sort(),
      expected: owedMutants.map(siteOf).sort(),
    })
  const pairs = owedMutants.map((m) => [m, actual.find((a) => siteOf(a) === siteOf(m))])
  for (const [owed, m] of pairs)
    if (owed.probe !== m.probe)
      return violation(`static`, `${siteOf(m)}: probe code is ${m.probe}, owed ${owed.probe}`, `probe-only code`)
  for (const [owed, m] of pairs)
    if (!owed.probe && m.owned !== (owed.kind !== `unowned`))
      return violation(
        `static`,
        `${siteOf(m)}: ${m.owned ? `owned` : `unowned`}, owed ${owed.kind === `unowned` ? `unowned` : `owned`}`,
        `ownership`,
      )
  for (const [owed, m] of pairs)
    if (m.key !== owed.key)
      return violation(`static`, `${siteOf(m)}: key ${JSON.stringify(m.key)}, owed ${JSON.stringify(owed.key)}`, `keys`)
  const moved = observations.find((o) => o.checkpoint === `stability`)?.value
  if (moved) {
    if (moved.refusal)
      return violation(`stability`, `the edited source was refused: ${moved.refusal}`, `key stability`)
    const describe = (m) => `${m.key} ${m.probe} ${m.owned}`
    const keys = new Set(got.mutants.map((m) => m.key))
    const before = got.mutants.map(describe).sort()
    const after = moved.mutants.filter((m) => keys.has(m.key)).map(describe).sort()
    if (before.join(`\n`) !== after.join(`\n`))
      return violation(
        `stability`,
        `the ${plan.stability} edit changed existing keys, probe marks, or ownership`,
        `key stability`,
        { actual: after, expected: before },
      )
  }
  return pass
}

declareOracle({
  check: [check],
  model: [model, interpret, ownersOf, probeHelpers],
  grammar: [histories],
})

// ## Calibrations
//
// Each hands the check a wrong analysis.
const corrupt = (checkpoint, change) => (trace) => {
  const index = trace.findIndex((o) => o.checkpoint === checkpoint)
  if (index < 0 || !trace[index].value.mutants?.length) return undefined
  const value = structuredClone(trace[index].value)
  if (change(value) === false) return undefined
  return trace.map((o, i) => (i === index ? { ...o, value } : o))
}
const calibrations = [
  {
    name: `a mutant is dropped`,
    law: `enumeration`,
    corrupt: corrupt(`static`, (v) => void v.mutants.shift()),
  },
  {
    name: `production code is marked as probe code`,
    law: `probe-only code`,
    corrupt: corrupt(`static`, (v) => {
      const m = v.mutants.find((x) => !x.probe)
      if (!m) return false
      m.probe = true
    }),
  },
  {
    name: `an owned mutant is reported unowned`,
    law: `ownership`,
    corrupt: corrupt(`static`, (v) => {
      const m = v.mutants.find((x) => !x.probe && x.owned)
      if (!m) return false
      m.owned = false
    }),
  },
  {
    name: `a key drops its statement`,
    law: `keys`,
    corrupt: corrupt(`static`, (v) => {
      v.mutants[0].key = v.mutants[0].key.slice(0, v.mutants[0].key.lastIndexOf(`:`))
    }),
  },
  {
    name: `an edit moves a key`,
    law: `key stability`,
    corrupt: (trace) => {
      const before = trace.find((o) => o.checkpoint === `static`)?.value
      const keys = new Set(before?.mutants?.map((m) => m.key) ?? [])
      return corrupt(`stability`, (v) => {
        const m = v.mutants.find((x) => keys.has(x.key))
        if (!m) return false
        m.key = `${m.key}~moved`
      })(trace)
    },
  },
]

const faults = [`badEntry`, `missingSource`, `nonLiteral`]
const required = [
  ...Object.values(ownedStates),
  `derived probe helper`,
  `derived probe helper chain`,
  `mixed helper judged`,
  `unowned`,
  `a constructed class brings only what is referenced`,
  `unowned in another file`,
  `owned by a whole-file entry`,
  `old probe form judged`,
  `production beside a probe`,
  `production else judged`,
  `stability rerun`,
  ...faults.map((fault) => `refused ${fault}`),
]

oracleProperty({
  id: `scripts.gap-report-static`,
  law: {
    statement: `The gap report's static half enumerates the promised operator mutants, marks exactly the probe-only code, refuses broken owns declarations, gives each function the owners whose call trees contain it, anchors each mutant's key, and keeps keys, probe marks, and ownership stable under unrelated edits.`,
    authority: `The maintainer's gap-check decisions in design runs v11, v14, and v19 (2026-11-04 and 2026-11-05), as for scripts.gap-report; the frozen design's plan for an oracle over the checker's pure core (v19 P10, F4); the maintainer's few-seconds budget for an incremental test run (2026-11-05).`,
    limits: `The grammar and model of scripts.gap-report, with its limits. Outcomes that need test runs, and the failing-owner refusal, belong to scripts.gap-report.`,
    owner: `scripts/oracle-gaps`,
  },
  histories: {
    arbitrary: histories,
    states: required,
    runs: 40,
    fixedSeeds: [20261105],
    constructed: [
      {
        name: `every static state`,
        enters: required.filter(
          (s) =>
            ![`owned by a whole-file entry`, ...faults.map((f) => `refused ${f}`)].includes(s),
        ),
        build: (generated) => ({
          ...generated,
          witness: true,
          wholeFile: `none`,
          fault: `none`,
          stability: `insertGuard`,
          steps: null,
        }),
      },
      {
        name: `a whole-file owner`,
        enters: [`owned by a whole-file entry`],
        build: (generated) => ({
          ...generated,
          functions: [
            [{ kind: `push`, quote: `'` }, ...generated.functions[0].slice(0, 4)],
            ...generated.functions.slice(1),
          ],
          owners: [],
          wholeFile: `a`,
          witness: false,
          fault: `none`,
          stability: `none`,
          steps: null,
        }),
      },
      ...faults.map((fault) => ({
        name: `a declaration fault: ${fault}`,
        enters: [`refused ${fault}`],
        build: (generated) => ({ ...generated, fault, steps: null }),
      })),
    ],
  },
  resolve: resolveHistory,
  model,
  driver,
  check,
  calibrations,
  timeout: 120_000,
})
