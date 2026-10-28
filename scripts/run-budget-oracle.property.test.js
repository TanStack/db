/**
 * Law (L5): every run budget that an oracle property uses is tracked by
 * scripts/check-oracle-run-counts.mjs, wherever its constant is defined. A budget
 * is the numRuns of a fixed-seed campaign, or the run count of a registered
 * property. When the script reports a lowered budget, the change that lowered it
 * is visible to the reviewer, and the constant may live in a support module,
 * which an oracle file imports or re-exports.
 *
 * Authority: AGENTS.md "How oracle work is scored" names a lowered budget as a
 * shortcut that the oracle pass hides, and the run-count script is the tripwire
 * for it. docs/contributing/oracle-rubric.md ORC-007 requires the same
 * property, generators, and budget in each campaign. The script's contract is
 * its header: a budget is keyed by its registered property or by its fixed seed,
 * and a count is a literal or a constant that the file declares or imports.
 *
 * Limits. The grammar builds one oracle file and up to two support modules, with
 * at most three budgets. A support module re-exports by name, so star re-exports
 * are not generated. A property key, and a count, is written as a literal or
 * imported; a count may be wrapped in oracleRuns. The model judges only the
 * value, so it does not predict the report line itself.
 *
 * Structure:
 *   1. The grammar draws a base and a head version of the files.
 *   2. The model predicts which budget keys went down, from the skeleton's values.
 *   3. The driver writes both versions into a temporary git repository and runs
 *      the script's command-line report in it, with a copy of the script under test.
 *   4. The comparison checks that the report equals the prediction.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { declareOracle } from '../packages/db/tests/oracle-declaration.js'
import {
  oraclePropertyOptions,
  oracleRuns,
} from '../packages/db/tests/oracle-config.js'
import { createOracleReach } from '../packages/db/tests/oracle-reach.js'

declareOracle({
  model: [predictLowered],
  check: [compareReport],
  grammar: [programArbitrary],
})

const PROPERTY = `scripts.run-budget`
const FIXED_SEED = 2234
const BASE_RUNS = 20
const repoRoot = fileURLToPath(new URL(`../`, import.meta.url))
const ORACLE = `tests/case-oracle.test.ts`
const SUPPORT = `tests/support-a.ts`
const REEXPORT = `tests/support-b.ts`

// -- 1. Grammar ---------------------------------------------------------------
//
// A budget is written in one of three places for its count (inline in the
// oracle, imported from support A, or re-exported through support B), and its
// property key or seed is written inline or imported. A change either edits the
// constant where it lives, or writes a literal in the oracle's expression.

const budgetSkeleton = fc.record({
  form: fc.constantFrom(`property`, `seed`),
  source: fc.constantFrom(`inline`, `imported`, `reexported`),
  keySource: fc.constantFrom(`inline`, `imported`),
  wrapped: fc.boolean(),
  base: fc.nat({ max: 398 }).map((n) => n + 2),
  // Lowering, and editing the definition, are the cases that the law is about,
  // so the grammar draws them more often.
  change: fc.oneof(
    { weight: 3, arbitrary: fc.constant(`lower`) },
    { weight: 1, arbitrary: fc.constant(`raise`) },
    { weight: 1, arbitrary: fc.constant(`keep`) },
  ),
  delta: fc.nat({ max: 50 }).map((n) => n + 1),
  editAt: fc.oneof(
    { weight: 3, arbitrary: fc.constant(`definition`) },
    { weight: 1, arbitrary: fc.constant(`oracle`) },
  ),
})

/** Feature gates: which sources a campaign may draw. */
const ALL = [`inline`, `imported`, `reexported`]

function programArbitrary(sources, supportOnly = false) {
  return fc
    .array(budgetSkeleton, { minLength: 1, maxLength: 3 })
    .map((budgets) =>
      budgets.map((budget, index) =>
        resolveBudget(
          supportOnly ? supportOnlyBudget(budget) : budget,
          index,
          sources,
        ),
      ),
    )
    .map((budgets) => ({ budgets }))
}

/**
 * A budget whose edit lives in a support module: its count is imported or
 * re-exported, and the edit is at its definition, so the oracle file stays the same.
 */
function supportOnlyBudget(skeleton) {
  return {
    ...skeleton,
    source: skeleton.source === `inline` ? `reexported` : skeleton.source,
    editAt: `definition`,
  }
}

/**
 * A budget with its index, its values before and after the change, and the
 * source the grammar drew from the allowed sources.
 */
function resolveBudget(skeleton, index, sources) {
  const source = sources.includes(skeleton.source) ? skeleton.source : `inline`
  const headValue =
    skeleton.change === `lower`
      ? Math.max(1, skeleton.base - skeleton.delta)
      : skeleton.change === `raise`
        ? skeleton.base + skeleton.delta
        : skeleton.base
  const changed = headValue !== skeleton.base
  return {
    index,
    form: skeleton.form,
    source,
    keySource: skeleton.keySource,
    wrapped: skeleton.wrapped,
    before: skeleton.base,
    after: headValue,
    changed,
    editAt: skeleton.editAt,
    // An inline count is always written in the oracle, so it changes there.
    // An imported count changes at its definition, or as a literal in the oracle.
    changedAt: source === `inline` ? `oracle` : skeleton.editAt,
    key:
      skeleton.form === `property`
        ? `property budget.${skeleton.keySource === `imported` ? `q` : `p`}${index}`
        : `fixed seed ${1000 + index}`,
  }
}

// -- 2. Model -----------------------------------------------------------------
//
// The model reads the skeleton's values. A budget is reported when its count went
// down, and its key is the same at both versions: a property key by its name, a
// fixed seed by its value. The model does not look at the files, so it predicts
// what the script should say from the change the grammar drew.

/** The budget keys that went down, as sorted `file|key|before|after` strings. */
function predictLowered(program) {
  return program.budgets
    .filter((budget) => budget.after < budget.before)
    .map((budget) => `${ORACLE}|${budget.key}|${budget.before}|${budget.after}`)
    .sort()
}

// -- 3. Driver ----------------------------------------------------------------
//
// The driver writes the base files and commits them, then writes the head files
// into the working tree, as an edit leaves them. It runs the script's command-line
// report in that repository, with a copy of the script under test, and reads the
// report lines back into the same `file|key|before|after` form.

/** The base and head versions of every file in a program. */
function renderFiles(program, version) {
  const budgets = program.budgets
  const supportLines = []
  const reexportLines = []
  const oracleImports = { support: [], reexport: [] }
  const body = []
  const isHead = version === `head`
  for (const budget of budgets) {
    const count = isHead ? budget.after : budget.before
    const key =
      budget.keySource === `imported` ? `budget.q${budget.index}` : undefined
    const seed = 1000 + budget.index
    // The count's expression in the oracle, and its definition in support.
    const oracleWritesLiteral =
      budget.source === `inline` ||
      (isHead && budget.changed && budget.changedAt === `oracle`)
    const expression = oracleWritesLiteral
      ? `${count}`
      : budget.source === `reexported`
        ? `RUNS_${budget.index}`
        : `RUNS_${budget.index}`
    if (budget.source !== `inline` && !oracleWritesLiteral) {
      const value =
        isHead && budget.changed && budget.changedAt === `definition`
          ? budget.after
          : budget.before
      supportLines.push(`export const RUNS_${budget.index} = ${value}`)
      if (budget.source === `reexported`) {
        reexportLines.push(`RUNS_${budget.index}`)
        oracleImports.reexport.push(`RUNS_${budget.index}`)
      } else {
        oracleImports.support.push(`RUNS_${budget.index}`)
      }
    }
    const wrapped = budget.wrapped ? `oracleRuns(${expression})` : expression
    if (budget.form === `property`) {
      if (budget.keySource === `imported`) {
        supportLines.push(`export const PROP_${budget.index} = \x27${key}\x27`)
        oracleImports.support.push(`PROP_${budget.index}`)
        body.push(
          `export const opts${budget.index} = oraclePropertyOptions(${wrapped}, PROP_${budget.index})`,
        )
      } else {
        body.push(
          `export const opts${budget.index} = oraclePropertyOptions(${wrapped}, \x27budget.p${budget.index}\x27)`,
        )
      }
    } else {
      const seedText =
        budget.keySource === `imported` ? `SEED_${budget.index}` : `${seed}`
      if (budget.keySource === `imported`) {
        supportLines.push(`export const SEED_${budget.index} = ${seed}`)
        oracleImports.support.push(`SEED_${budget.index}`)
      }
      body.push(
        `fc.assert(fc.property(fc.integer(), () => undefined), { numRuns: ${wrapped}, seed: ${seedText} })`,
      )
    }
  }
  const oracleLines = []
  if (oracleImports.support.length > 0) {
    oracleLines.push(
      `import { ${oracleImports.support.join(`, `)} } from './support-a'`,
    )
  }
  if (oracleImports.reexport.length > 0) {
    oracleLines.push(
      `import { ${oracleImports.reexport.join(`, `)} } from './support-b'`,
    )
  }
  oracleLines.push(...body)
  const files = new Map()
  files.set(ORACLE, `${oracleLines.join(`\n`)}\n`)
  files.set(SUPPORT, `${supportLines.join(`\n`)}\n`)
  if (reexportLines.length > 0) {
    files.set(
      REEXPORT,
      `export { ${reexportLines.join(`, `)} } from './support-a'\n`,
    )
  }
  return files
}

let work
let scriptText

beforeAll(() => {
  work = join(process.env.HOME, `.cache`, `oracle-2234`, `budget-runs`)
  mkdirSync(work, { recursive: true })
  // A mutant is run from a copy: RUN_BUDGET_SCRIPT names the copy under test.
  scriptText = readFileSync(
    process.env.RUN_BUDGET_SCRIPT ??
      join(repoRoot, `scripts`, `check-oracle-run-counts.mjs`),
    `utf8`,
  )
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

// Child processes run asynchronously so a long campaign never blocks the
// test worker's event loop.
const run = promisify(execFile)

/**
 * Runs the script in a fresh repository whose base commit holds the base files
 * and whose working tree holds the head files. Returns the reported keys.
 */
async function reportOf(program) {
  mkdirSync(work, { recursive: true })
  const directory = mkdtempSync(join(work, `r`))
  const git = (...args) =>
    run(
      `git`,
      [
        `-c`,
        `user.name=oracle`,
        `-c`,
        `user.email=oracle@example.invalid`,
        ...args,
      ],
      { cwd: directory, encoding: `utf8` },
    )
  try {
    await git(`init`, `-q`, `-b`, `main`)
    mkdirSync(join(directory, `scripts`))
    writeFileSync(
      join(directory, `scripts`, `check-oracle-run-counts.mjs`),
      scriptText,
    )
    for (const [file, text] of renderFiles(program, `base`)) {
      mkdirSync(join(directory, file, `..`), { recursive: true })
      writeFileSync(join(directory, file), text)
    }
    await git(`add`, `-A`)
    await git(`commit`, `-q`, `-m`, `base`)
    // The dependencies are linked after the commit, so they are not tracked.
    symlinkSync(join(repoRoot, `node_modules`), join(directory, `node_modules`))
    for (const [file, text] of renderFiles(program, `head`)) {
      writeFileSync(join(directory, file), text)
    }
    // The script exits 0 when nothing was lowered and 1 when it reports.
    const result = await run(
      process.execPath,
      [`scripts/check-oracle-run-counts.mjs`, `--format=text`],
      { cwd: directory, encoding: `utf8` },
    ).catch((error) => {
      if (error.code === 1) return error
      throw new Error(`script failed: ${error.stderr}`)
    })
    return result.stdout
      .split(`\n`)
      .filter(Boolean)
      .map((line) => {
        const match =
          /^(.+?): (.+): run budget lowered from (\d+) to (\d+)$/.exec(line)
        if (match === null) throw new Error(`unexpected report line: ${line}`)
        const [, file, key, was, now] = match
        return `${file}|${key}|${was}|${now}`
      })
      .sort()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// -- 4. Comparison ----------------------------------------------------------------

/** The script's report equals the model's prediction, as sorted lists. */
function compareReport(actual, expected) {
  expect(actual).toEqual(expected)
}

const STATES = [
  `imported-count`,
  `re-exported-count`,
  `imported-key`,
  `support-only-change`,
  `oracle-and-support-change`,
  `lowered-budget`,
]
const reach = createOracleReach(PROPERTY, STATES, { minimum: 1 })

/** Marks the states that the program enters. */
function recordStates(program) {
  reach.beginHistory()
  const states = new Set()
  for (const budget of program.budgets) {
    if (budget.source === `imported`) states.add(`imported-count`)
    if (budget.source === `reexported`) states.add(`re-exported-count`)
    if (budget.keySource === `imported`) states.add(`imported-key`)
    if (budget.after < budget.before) states.add(`lowered-budget`)
  }
  const oracleChanged = program.budgets.some(
    (budget) => budget.changed && budget.changedAt === `oracle`,
  )
  const supportChanged = program.budgets.some(
    (budget) => budget.changed && budget.changedAt === `definition`,
  )
  if (supportChanged && !oracleChanged) states.add(`support-only-change`)
  if (supportChanged && oracleChanged) states.add(`oracle-and-support-change`)
  for (const state of states) reach.reach(state)
}

function campaign(name, sources, supportOnly = false) {
  const arbitrary = programArbitrary(sources, supportOnly)
  const predicate = async (program) => {
    recordStates(program)
    compareReport(await reportOf(program), predictLowered(program))
  }
  it(`${name}: fixed-seed campaign`, async () => {
    await fc.assert(fc.asyncProperty(arbitrary, predicate), {
      numRuns: oracleRuns(BASE_RUNS),
      seed: FIXED_SEED,
    })
  }, 900_000)
  it(`${name}: random-seed campaign`, async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary, predicate),
      oraclePropertyOptions(BASE_RUNS, PROPERTY),
    )
  }, 900_000)
}

describe(`run budgets that the run-count script tracks`, () => {
  campaign(`inline and imported counts`, [`inline`, `imported`])
  campaign(`re-exported counts`, [`reexported`])
  campaign(`every source`, ALL)
  campaign(`support-only edits`, [`imported`, `reexported`], true)
})

describe(`declared reach ledger`, () => {
  it(`every declared reach state is entered`, () => {
    reach.assertReached()
  })
})
