/**
 * Law (L5): every run budget that an oracle property uses is tracked by
 * scripts/check-oracle-run-counts.mjs, wherever it is written. A budget is the
 * numRuns of a fixed-seed campaign, or the run count of a registered property.
 * When the branch lowers a budget, or removes it from every tracked oracle
 * file, the script reports it, so the change is visible to the reviewer.
 *
 * A budget belongs to the oracle file that uses it: its own campaigns, and the
 * campaigns and constants in the test modules that it imports or re-exports.
 * Moving a budget between those places keeps it tracked. So does moving it to
 * another tracked oracle file. A budget is removed when its key is in no
 * tracked oracle file at head: it was deleted, or moved into an ordinary test
 * file that no oracle file imports.
 *
 * Authority: AGENTS.md "Lint feedback while you work" names a lowered budget
 * as a shortcut that the oracle pass hides, and the run-count script is the
 * tripwire for it. docs/contributing/oracle-rubric.md ORC-007 requires the same
 * property, generators, and budget in each campaign. The removal rule is the
 * maintainer's decision of 2026-10-27: a key present in a tracked oracle file
 * at base and in no tracked oracle file at head is reported as removed, and a
 * move into an imported support module is not a removal. The script's header
 * states the key and value forms that it reads.
 *
 * Limits. The grammar builds one oracle file, up to two support modules, an
 * ordinary test file, and a second oracle file, with at most three budgets. A
 * key is unique to its budget, except that a fixed seed can be shared with an
 * unrelated campaign in the second oracle file. Then the removal law treats
 * the seed as still present, and the model follows it. Star re-exports are not
 * generated. A count may be wrapped in oracleRuns. The model judges the
 * reported budget, its base value, and its head value or removal; it does not
 * predict the wording of a line.
 *
 * Structure:
 *   1. The grammar draws budgets: their form, the places their count and key
 *      are written, where the campaign is at base, and where it is at head.
 *   2. The model predicts the lowered and removed budgets from those draws.
 *   3. The driver writes both versions into a temporary git repository and runs
 *      the script's command-line report there, with a copy of the script under
 *      test. A crashed script is a failure, not an empty report.
 *   4. The comparison checks that the report equals the prediction.
 */
import { execFile } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { declareOracle } from '../packages/db/tests/oracle-declaration.js'
import {
  oraclePropertyOptions,
  oracleRuns,
} from '../packages/db/tests/oracle-config.js'
import { createOracleReach } from '../packages/db/tests/oracle-reach.js'

declareOracle({
  model: [predictReport],
  check: [compareReport],
  grammar: [programArbitrary],
})

const PROPERTY = `scripts.run-budget`
const FIXED_SEED = 2234
const BASE_RUNS = 20
const repoRoot = fileURLToPath(new URL(`../`, import.meta.url))
const OTHER_ORACLE = `tests/other-oracle.test.ts`
const ORDINARY = `tests/ordinary.test.ts`
// A base oracle file above the default 1 MiB child-process buffer. Reading it
// at the base commit must not be mistaken for a missing file.
const LARGE_PADDING = 1_100_000

// -- 1. Grammar ---------------------------------------------------------------
//
// A budget's count is written inline, in support module A, or in A and passed
// on by support module B's re-export. Its key is inline or imported from A. A
// change edits the count where it is defined, or writes a literal at the call.
// The campaign itself is in the oracle file or in A at base (`callAt`). At
// head it stays, moves between the oracle file and A, moves to the ordinary
// file or the second oracle file, or is deleted (`fate`). The oracle file and
// A are `.ts` or `.js`; an import names A with or without the `.js` suffix.

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
    { weight: 1, arbitrary: fc.constant(`call`) },
  ),
  callAt: fc.oneof(
    { weight: 2, arbitrary: fc.constant(`oracle`) },
    { weight: 1, arbitrary: fc.constant(`support`) },
  ),
  fate: fc.oneof(
    { weight: 4, arbitrary: fc.constant(`stay`) },
    { weight: 1, arbitrary: fc.constant(`swap`) },
    { weight: 2, arbitrary: fc.constant(`remove`) },
    { weight: 2, arbitrary: fc.constant(`ordinary`) },
    { weight: 2, arbitrary: fc.constant(`other-oracle`) },
  ),
  sharedSeed: fc.boolean(),
})

const fileForms = fc.record({
  oracleExtension: fc.oneof(
    { weight: 2, arbitrary: fc.constant(`ts`) },
    { weight: 1, arbitrary: fc.constant(`js`) },
  ),
  supportExtension: fc.oneof(
    { weight: 2, arbitrary: fc.constant(`ts`) },
    { weight: 1, arbitrary: fc.constant(`js`) },
  ),
  jsSpecifier: fc.boolean(),
  large: fc.oneof(
    { weight: 2, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  // The second oracle file exists at base, or is new and untracked at head.
  otherNew: fc.boolean(),
})

/** Feature gates: which count sources a campaign may draw. */
const ALL = [`inline`, `imported`, `reexported`]

function programArbitrary(sources, supportOnly = false) {
  return fc
    .record({
      budgets: fc.array(budgetSkeleton, { minLength: 1, maxLength: 3 }),
      files: fileForms,
    })
    .map(({ budgets, files }) => ({
      files: resolveFiles(files),
      budgets: budgets.map((budget, index) =>
        resolveBudget(
          supportOnly ? supportOnlyBudget(budget) : budget,
          index,
          sources,
          files,
        ),
      ),
    }))
}

/**
 * A budget whose only edit lives in a support module: its count is imported
 * or re-exported, its campaign stays in the oracle file, and the edit is at
 * the count's definition, so the oracle file stays the same.
 */
function supportOnlyBudget(skeleton) {
  return {
    ...skeleton,
    source: skeleton.source === `inline` ? `reexported` : skeleton.source,
    editAt: `definition`,
    callAt: `oracle`,
    fate: `stay`,
  }
}

function resolveFiles(files) {
  return {
    ...files,
    oracle: `tests/case-oracle.test.${files.oracleExtension}`,
    support: `tests/support-a.${files.supportExtension}`,
    reexport: `tests/support-b.ts`,
  }
}

/**
 * A budget with its index, its values before and after the change, and the
 * places the grammar drew, restricted to the allowed count sources.
 */
function resolveBudget(skeleton, index, sources, files) {
  const source = sources.includes(skeleton.source) ? skeleton.source : `inline`
  const headValue =
    skeleton.change === `lower`
      ? Math.max(1, skeleton.base - skeleton.delta)
      : skeleton.change === `raise`
        ? skeleton.base + skeleton.delta
        : skeleton.base
  return {
    index,
    form: skeleton.form,
    source,
    keySource: skeleton.keySource,
    wrapped: skeleton.wrapped,
    before: skeleton.base,
    after: headValue,
    changed: headValue !== skeleton.base,
    // An inline count is always written at the call, so it changes there.
    // An imported count changes at its definition, or as a literal at the call.
    changedAt: source === `inline` ? `call` : skeleton.editAt,
    callAt: skeleton.callAt,
    fate: skeleton.fate,
    // A shared seed is an unrelated campaign in the second oracle file, at
    // base and at head. The budget's own campaign never moves there, and the
    // file is not new: a campaign that appears with the key at head is a move.
    sharedSeed:
      skeleton.form === `seed` &&
      skeleton.sharedSeed &&
      skeleton.fate !== `other-oracle` &&
      !files.otherNew,
    key:
      skeleton.form === `property`
        ? `property budget.${skeleton.keySource === `imported` ? `q` : `p`}${index}`
        : `fixed seed ${1000 + index}`,
  }
}

// -- 2. Model -----------------------------------------------------------------
//
// The model reads the draws, not the files. Every budget starts in the oracle
// file's scope: its campaign is in the oracle file or in a module that the
// oracle file imports. A budget that is deleted, or moved into the ordinary
// file, leaves every tracked oracle file, so it is reported as removed, unless
// its fixed seed is still written in the second oracle file. A budget that
// stays, moves between the oracle file and its support module, or moves to the
// second oracle file is still tracked, and it is reported when its count went
// down. Each line names the oracle file that used the budget at base.

/** The reported budgets, as sorted `file|key|before|after-or-removed` strings. */
function predictReport(program) {
  const lines = []
  for (const budget of program.budgets) {
    const leaves = budget.fate === `remove` || budget.fate === `ordinary`
    if (leaves) {
      if (!budget.sharedSeed) {
        lines.push(
          `${program.files.oracle}|${budget.key}|${budget.before}|removed`,
        )
      }
    } else if (budget.after < budget.before) {
      lines.push(
        `${program.files.oracle}|${budget.key}|${budget.before}|${budget.after}`,
      )
    }
  }
  return lines.sort()
}

// -- 3. Driver ----------------------------------------------------------------
//
// The driver renders every file at base and at head, commits the base files,
// and writes the head files into the working tree, as an edit leaves them. A
// second oracle file that is new at head stays untracked. It runs the script's
// command-line report with a copy of the script under test, and reads the
// report lines back into the model's form.

/** Where a budget's campaign is at a revision, or undefined when it is gone. */
function campaignFile(program, budget, revision) {
  const { files } = program
  const atBase = budget.callAt === `oracle` ? files.oracle : files.support
  if (revision === `base`) return atBase
  switch (budget.fate) {
    case `stay`:
      return atBase
    case `swap`:
      return atBase === files.oracle ? files.support : files.oracle
    case `ordinary`:
      return ORDINARY
    case `other-oracle`:
      return OTHER_ORACLE
    default:
      return undefined
  }
}

/** A module's source text, collected as imports, then body lines. */
class ModuleText {
  #imports = new Map()
  #lines = []

  import(specifier, name) {
    if (!this.#imports.has(specifier)) this.#imports.set(specifier, new Set())
    this.#imports.get(specifier).add(name)
  }

  line(text) {
    this.#lines.push(text)
  }

  render(padding = 0) {
    const imports = [...this.#imports].map(
      ([specifier, names]) =>
        `import { ${[...names].join(`, `)} } from '${specifier}'`,
    )
    const pad = padding > 0 ? [`// ${`x`.repeat(padding)}`] : []
    return `${[...imports, ...this.#lines, ...pad].join(`\n`)}\n`
  }
}

/** The base or head text of every file in a program. */
function renderFiles(program, revision) {
  const { files } = program
  const isHead = revision === `head`
  const supportSpecifier = files.jsSpecifier ? `./support-a.js` : `./support-a`
  const modules = new Map(
    [files.oracle, files.support, files.reexport, ORDINARY].map((file) => [
      file,
      new ModuleText(),
    ]),
  )
  const otherPresent = !files.otherNew || isHead
  if (otherPresent) modules.set(OTHER_ORACLE, new ModuleText())
  const support = modules.get(files.support)
  const reexported = []

  for (const budget of program.budgets) {
    const i = budget.index
    const host = campaignFile(program, budget, revision)
    const count = isHead ? budget.after : budget.before
    const seed = 1000 + i
    // The definition of an imported key and count lives in support module A.
    if (budget.keySource === `imported`) {
      support.line(
        budget.form === `property`
          ? `export const PROP_${i} = 'budget.q${i}'`
          : `export const SEED_${i} = ${seed}`,
      )
    }
    const literalAtCall =
      budget.source === `inline` ||
      (isHead && budget.changed && budget.changedAt === `call`)
    if (!literalAtCall) {
      const defined =
        isHead && budget.changed && budget.changedAt === `definition`
          ? budget.after
          : budget.before
      support.line(`export const RUNS_${i} = ${defined}`)
      if (budget.source === `reexported`) reexported.push(`RUNS_${i}`)
    }
    // An unrelated campaign in the second oracle file that shares the seed.
    if (budget.sharedSeed) {
      modules
        .get(OTHER_ORACLE)
        .line(
          `fc.assert(fc.property(fc.integer(), () => undefined), { numRuns: 7, seed: ${seed} })`,
        )
    }
    if (host === undefined) continue
    const hostText = modules.get(host)
    const inSupport = host === files.support
    const fromHost = (file) =>
      file === files.support ? supportSpecifier : `./support-b`
    // A campaign in A reads A's own constants; elsewhere it imports them.
    const use = (name, file) => {
      if (!inSupport) hostText.import(fromHost(file), name)
      return name
    }
    const countText = literalAtCall
      ? `${count}`
      : budget.source === `reexported` && !inSupport
        ? use(`RUNS_${i}`, files.reexport)
        : use(`RUNS_${i}`, files.support)
    const runs = budget.wrapped ? `oracleRuns(${countText})` : countText
    const keyText =
      budget.keySource === `imported`
        ? use(
            budget.form === `property` ? `PROP_${i}` : `SEED_${i}`,
            files.support,
          )
        : budget.form === `property`
          ? `'budget.p${i}'`
          : `${seed}`
    const call =
      budget.form === `property`
        ? `export const opts${i} = oraclePropertyOptions(${runs}, ${keyText})`
        : `export function campaign${i}() { fc.assert(fc.property(fc.integer(), () => undefined), { numRuns: ${runs}, seed: ${keyText} }) }`
    hostText.line(call)
    // The oracle file uses a campaign in A by importing it.
    if (inSupport) {
      modules
        .get(files.oracle)
        .import(
          supportSpecifier,
          budget.form === `property` ? `opts${i}` : `campaign${i}`,
        )
    }
  }
  if (reexported.length > 0) {
    modules
      .get(files.reexport)
      .line(`export { ${reexported.join(`, `)} } from '${supportSpecifier}'`)
  }
  const rendered = new Map()
  for (const [file, text] of modules) {
    rendered.set(
      file,
      text.render(file === files.oracle && files.large ? LARGE_PADDING : 0),
    )
  }
  return rendered
}

let work
let scriptText

beforeAll(() => {
  // Each run has its own directory, so concurrent runs cannot remove each
  // other's repositories.
  work = mkdtempSync(join(tmpdir(), `run-budget-oracle-`))
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

const loweredLine = /^(.+?): (.+): run budget lowered from (\d+) to (\d+)$/
const removedLine = /^(.+?): (.+): run budget removed \(was (\d+)\)$/

/**
 * The script's report as model lines. The script exits 0 with no output when
 * it reports nothing, and 1 with one line per budget when it reports. Any
 * other outcome, including a crash, which also exits 1, fails the driver.
 */
function reportLines({ code, stdout, stderr }) {
  if (stderr !== `` || (code !== 0 && code !== 1)) {
    throw new Error(`script failed (exit ${code}):\n${stderr}`)
  }
  const lines = stdout.split(`\n`).filter(Boolean)
  if ((code === 1) !== lines.length > 0) {
    throw new Error(`exit ${code} does not match report:\n${stdout}`)
  }
  return lines
    .map((line) => {
      const lowered = loweredLine.exec(line)
      if (lowered !== null) {
        const [, file, key, was, now] = lowered
        return `${file}|${key}|${was}|${now}`
      }
      const removed = removedLine.exec(line)
      if (removed !== null) {
        const [, file, key, was] = removed
        return `${file}|${key}|${was}|removed`
      }
      throw new Error(`unexpected report line: ${line}`)
    })
    .sort()
}

/**
 * Runs the script in a fresh repository whose base commit holds the base files
 * and whose working tree holds the head files. Returns the reported budgets.
 */
async function reportOf(program) {
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
  const write = (files) => {
    for (const [file, text] of files) {
      mkdirSync(join(directory, file, `..`), { recursive: true })
      writeFileSync(join(directory, file), text)
    }
  }
  try {
    await git(`init`, `-q`, `-b`, `main`)
    mkdirSync(join(directory, `scripts`))
    writeFileSync(
      join(directory, `scripts`, `check-oracle-run-counts.mjs`),
      scriptText,
    )
    write(renderFiles(program, `base`))
    await git(`add`, `-A`)
    await git(`commit`, `-q`, `-m`, `base`)
    // The dependencies are linked after the commit, so they are not tracked.
    symlinkSync(join(repoRoot, `node_modules`), join(directory, `node_modules`))
    write(renderFiles(program, `head`))
    const result = await run(
      process.execPath,
      [`scripts/check-oracle-run-counts.mjs`, `--format=text`],
      { cwd: directory, encoding: `utf8`, maxBuffer: 64 * 1024 * 1024 },
    ).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error) => {
        if (typeof error.code !== `number`) throw error
        return { code: error.code, stdout: error.stdout, stderr: error.stderr }
      },
    )
    return reportLines(result)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// -- 4. Comparison ------------------------------------------------------------

/** The script's report equals the model's prediction, as sorted lists. */
function compareReport(actual, expected) {
  expect(actual).toEqual(expected)
}

// -- 5. Reach -----------------------------------------------------------------
//
// The states that the laws above depend on. A state counts once per history.

const STATES = [
  `imported-count`,
  `re-exported-count`,
  `imported-key`,
  `support-only-change`,
  `oracle-and-support-change`,
  `lowered-budget`,
  `campaign-in-support`,
  `moved-into-support`,
  `removed-budget`,
  `moved-to-ordinary`,
  `moved-to-oracle`,
  `moved-to-untracked-oracle`,
  `shared-seed-kept`,
  `large-base-file`,
  `js-oracle`,
  `js-support`,
]
const reach = createOracleReach(PROPERTY, STATES, { minimum: 1 })

/** Marks the states that the program enters. */
function recordStates(program) {
  reach.beginHistory()
  const states = new Set()
  const { files } = program
  for (const budget of program.budgets) {
    if (budget.source === `imported`) states.add(`imported-count`)
    if (budget.source === `reexported`) states.add(`re-exported-count`)
    if (budget.keySource === `imported`) states.add(`imported-key`)
    if (budget.after < budget.before) states.add(`lowered-budget`)
    if (budget.callAt === `support`) states.add(`campaign-in-support`)
    if (budget.callAt === `oracle` && budget.fate === `swap`) {
      states.add(`moved-into-support`)
    }
    if (budget.fate === `remove`) states.add(`removed-budget`)
    if (budget.fate === `ordinary`) states.add(`moved-to-ordinary`)
    if (budget.fate === `other-oracle`) {
      states.add(
        files.otherNew ? `moved-to-untracked-oracle` : `moved-to-oracle`,
      )
    }
    if (
      budget.sharedSeed &&
      (budget.fate === `remove` || budget.fate === `ordinary`)
    ) {
      states.add(`shared-seed-kept`)
    }
  }
  const atCall = program.budgets.some(
    (budget) => budget.changed && budget.changedAt === `call`,
  )
  const atDefinition = program.budgets.some(
    (budget) => budget.changed && budget.changedAt === `definition`,
  )
  if (atDefinition && !atCall) states.add(`support-only-change`)
  if (atDefinition && atCall) states.add(`oracle-and-support-change`)
  if (files.large) states.add(`large-base-file`)
  if (files.oracleExtension === `js`) states.add(`js-oracle`)
  if (files.supportExtension === `js`) states.add(`js-support`)
  for (const state of states) reach.reach(state)
}

// Each campaign has its own fixed seed, so the four campaigns do not draw the
// same programs. The fixed options are written where the campaign is named, so
// the run-count script tracks each budget.
function campaign(name, sources, fixed, supportOnly = false) {
  const arbitrary = programArbitrary(sources, supportOnly)
  const predicate = async (program) => {
    recordStates(program)
    compareReport(await reportOf(program), predictReport(program))
  }
  it(`${name}: fixed-seed campaign`, async () => {
    await fc.assert(fc.asyncProperty(arbitrary, predicate), fixed)
  }, 900_000)
  it(`${name}: random-seed campaign`, async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary, predicate),
      oraclePropertyOptions(BASE_RUNS, PROPERTY),
    )
  }, 900_000)
}

describe(`run budgets that the run-count script tracks`, () => {
  campaign(`inline and imported counts`, [`inline`, `imported`], {
    seed: FIXED_SEED,
    numRuns: oracleRuns(BASE_RUNS),
  })
  campaign(`re-exported counts`, [`reexported`], {
    seed: 2235,
    numRuns: oracleRuns(BASE_RUNS),
  })
  campaign(`every source`, ALL, { seed: 2236, numRuns: oracleRuns(BASE_RUNS) })
  campaign(
    `support-only edits`,
    [`imported`, `reexported`],
    { seed: 2237, numRuns: oracleRuns(BASE_RUNS) },
    true,
  )
  // Every declared state must be entered by the campaigns above.
  afterAll(() => {
    if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT)
      console.log(`REACH`, JSON.stringify([...reach.counts()]))
    reach.assertReached()
  })
})
