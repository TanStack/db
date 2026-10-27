/**
 * Law L4 (lint scope): after an edit, every oracle file whose oracle lint result
 * can change is linted again, by the edit hook, by `pnpm lint:changed`, and by
 * the pre-commit hook. An oracle file's result depends on the test modules that
 * it reaches through relative imports and re-exports: its companions, support
 * modules, and drivers. The rule does not read production source, so an edit
 * to production code selects nothing. A change to the rule's own sources
 * changes every oracle result, so it selects every oracle file.
 *
 * Authority: AGENTS.md "Lint feedback while you work" says the hooks and
 * `pnpm lint:changed` return the oracle reports for the files that were edited,
 * and that the pre-commit hook lints the staged files. The rule's header
 * contract (scripts/eslint-plugin-oracle/rules/no-unit-test.js) states that the
 * rule follows relative imports of test modules and does not follow production
 * source. The rule-source case follows from the same reports: the oracle
 * results are a function of the rule's code.
 *
 * Limits. The grammar draws up to three oracle files, two or three support
 * modules, one driver, and one production module, with relative imports and
 * re-exports. Half the programs take a re-export chain: the first oracle file
 * imports the first support module, which re-exports the second. The `.js`
 * specifier form of an import is drawn for some oracle files. Re-exports are
 * drawn for support modules only, and star re-exports are the only form. The
 * driver runs the lint command-line script in temporary git repositories. The
 * pre-commit leg is covered only by the script's file selection: the glob in
 * lint-staged.config.js is not evaluated here.
 *
 * Structure:
 *   1. The grammar draws a module graph and a set of edited modules.
 *   2. The model predicts the oracle files to lint, from the graph alone.
 *   3. The driver writes the base commit and the edited working tree, then runs
 *      the CLI's changed scope, its named scope, and its edit-hook form.
 *   4. The comparison checks that each observed selection equals the prediction.
 *   5. Reach counts the graph states that the campaign enters, and the
 *      campaigns run the same predicate with a fixed seed and a random seed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
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

const PROPERTY = `scripts.lint-scope`
const FIXED_SEED = 2234
const BASE_RUNS = 12
const PRODUCTION = `src/prod.ts`
const repoRoot = fileURLToPath(new URL(`../`, import.meta.url))
const APP = `packages/app`
const RULE = `scripts/eslint-plugin-oracle/rules/no-unit-test.js`

// -- 1. Grammar ---------------------------------------------------------------
//
// Every module is a node. An oracle file imports supports, drivers, oracle
// files, and production. A support module imports other supports and production.
// A driver imports supports. Production imports nothing. Each target is an index
// taken modulo the modules the kind may reach, so every draw is a legal edge. A
// star re-export is an import whose names the module passes on. An edit adds a
// line to a module, so its text differs from the base commit.

const moduleEdit = fc.boolean()

// Most modules import one target. A second route to an edited module would
// hide the effect of a re-export, so single targets are drawn more often.
const singleOrManyTargets = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.array(fc.nat({ max: 9 }), { minLength: 1, maxLength: 1 }),
  },
  {
    weight: 1,
    arbitrary: fc.array(fc.nat({ max: 9 }), { minLength: 1, maxLength: 3 }),
  },
)

const programArbitrary = fc
  .record({
    // A re-export chain is the shape that the re-export law needs most: the
    // first oracle file imports the first support module, which re-exports the
    // second. Random draws reach that shape too rarely, so half the programs
    // take it, and the second support's edit then depends on the re-export.
    chain: fc.oneof(
      { weight: 1, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
    oracles: fc.array(
      fc.record({
        edited: moduleEdit,
        targets: singleOrManyTargets,
        style: fc.nat({ max: 1 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    // Two supports or more let a chain form, and a single target keeps a
    // re-export on the only route to an edited module.
    supports: fc.array(
      fc.record({
        edited: moduleEdit,
        targets: singleOrManyTargets,
        reexport: fc.array(
          fc.oneof(
            { weight: 3, arbitrary: fc.constant(true) },
            { weight: 1, arbitrary: fc.constant(false) },
          ),
          { minLength: 1, maxLength: 2 },
        ),
      }),
      { minLength: 2, maxLength: 3 },
    ),
    driver: fc.record({
      present: fc.boolean(),
      edited: moduleEdit,
      targets: fc.array(fc.nat({ max: 9 }), { maxLength: 2 }),
    }),
    production: fc.record({ edited: moduleEdit }),
    ruleEdited: fc.oneof(
      { weight: 3, arbitrary: fc.constant(false) },
      { weight: 1, arbitrary: fc.constant(true) },
    ),
  })
  .map(({ chain, ...skeleton }) =>
    buildProgram(chain ? reexportChain(skeleton) : skeleton),
  )

/**
 * The skeleton with the re-export chain drawn: oracle 0 imports support 0, which
 * re-exports support 1. Oracle 0 and support 0 are unedited and support 1 is
 * edited, so the re-export is the only route from the edit to oracle 0.
 */
function reexportChain(skeleton) {
  return {
    ...skeleton,
    oracles: skeleton.oracles.map((oracle, index) =>
      index === 0 ? { ...oracle, edited: false, targets: [0] } : oracle,
    ),
    supports: skeleton.supports.map((support, index) => {
      if (index === 0) {
        return { ...support, edited: false, targets: [1], reexport: [true] }
      }
      if (index === 1) return { ...support, edited: true }
      return support
    }),
  }
}

/**
 * The modules of a program, with the import edges that the grammar drew. A
 * re-export is an edge that the module passes on by star export.
 */
function buildProgram(skeleton) {
  const oracles = skeleton.oracles.map((oracle, index) => ({
    // The rule skips basenames that start with `oracle-`, which are its own
    // machinery, so generated oracle files use another prefix.
    name: `case-${index}-oracle.test.ts`,
    kind: `oracle`,
    edited: oracle.edited,
    style: oracle.style,
    targets: oracle.targets,
  }))
  const supports = skeleton.supports.map((support, index) => ({
    name: `support-${index}.ts`,
    kind: `support`,
    edited: support.edited,
    targets: support.targets,
    reexport: support.reexport,
  }))
  const driver = skeleton.driver.present
    ? [
        {
          name: `driver.test.ts`,
          kind: `driver`,
          edited: skeleton.driver.edited,
          targets: skeleton.driver.targets,
          reexport: [],
        },
      ]
    : []
  const production = {
    name: PRODUCTION,
    kind: `production`,
    edited: skeleton.production.edited,
    targets: [],
    reexport: [],
  }
  const test = [...oracles, ...supports, ...driver]
  const allowed = {
    oracle: [...supports, ...driver, production],
    support: [...supports, production],
    driver: [...supports],
  }
  const edges = new Map()
  const reexports = new Map()
  for (const module of test) {
    const targets = allowed[module.kind]
    const chosen = []
    for (const [position, index] of module.targets.entries()) {
      if (targets.length === 0) break
      const target = targets[index % targets.length]
      if (chosen.some((edge) => edge.target === target) || target === module) {
        continue
      }
      chosen.push({ target, reexport: module.reexport?.[position] === true })
    }
    edges.set(
      module.name,
      chosen.map((edge) => edge.target.name),
    )
    reexports.set(
      module.name,
      new Set(
        chosen.filter((edge) => edge.reexport).map((edge) => edge.target.name),
      ),
    )
  }
  edges.set(production.name, [])
  reexports.set(production.name, new Set())
  return {
    oracles,
    supports,
    driver,
    production,
    ruleEdited: skeleton.ruleEdited,
    edges,
    reexports,
    modules: [...oracles, ...supports, ...driver, production],
  }
}

// -- 2. Model -----------------------------------------------------------------
//
// The model reads only the graph. An oracle file must be linted when it is
// edited, or when an edited module is reachable from it through edges that
// lead only into test modules. Production is a leaf: the rule never follows it,
// so an edited production module reaches no oracle file. When the rule's own
// sources change, every oracle file must be linted.

/** The oracle files that a lint must cover, as sorted basenames. */
function predictSelected(program) {
  if (program.ruleEdited)
    return program.oracles.map((oracle) => oracle.name).sort()
  const edited = new Set(
    program.modules
      .filter((module) => module.edited)
      .map((module) => module.name),
  )
  return program.oracles
    .filter((oracle) => reachesEdited(program, oracle.name, edited))
    .map((oracle) => oracle.name)
    .sort()
}

/** Whether `start` is edited or reaches an edited module through test modules. */
function reachesEdited(program, start, edited) {
  const seen = new Set([start])
  const pending = [start]
  while (pending.length > 0) {
    const current = pending.pop()
    if (edited.has(current)) return true
    for (const target of program.edges.get(current) ?? []) {
      // The rule does not follow production, so an edit there reaches nothing.
      if (target === PRODUCTION) continue
      if (!seen.has(target)) {
        seen.add(target)
        pending.push(target)
      }
    }
  }
  return false
}

// -- 3. Driver ----------------------------------------------------------------
//
// The driver runs the lint script that a developer or hook runs. It writes the
// modules and the copy of the script and the rule into a temporary repository,
// commits them, and edits the modules in the working tree. It runs the changed
// scope (`lint:changed`), the named scope (the pre-commit hook), and the edit
// hook. The script reports oracle results on stderr, and each report line
// names its oracle file. The driver reads those names; it does not compute them.

/** The text of one module, with or without its edit. */
function moduleText(program, module, edited) {
  const lines = []
  const reexported = program.reexports.get(module.name) ?? new Set()
  for (const target of program.edges.get(module.name) ?? []) {
    const spec =
      target === PRODUCTION
        ? `../src/prod.js`
        : `./${target.replace(/\.ts$/, module.kind === `oracle` && module.style === 1 ? `.js` : ``)}`
    lines.push(
      reexported.has(target) ? `export * from '${spec}'` : `import '${spec}'`,
    )
  }
  if (module.kind === `oracle`) {
    lines.push(`it('reads one value', () => { expect(1).toBe(1) })`)
  }
  if (module.kind === `production`) lines.push(`export const prod = 1`)
  if (edited) lines.push(`// edited`)
  return `${lines.join(`\n`)}\n`
}

let work
let pluginDir
let scriptDir

beforeAll(() => {
  work = join(process.env.HOME, `.cache`, `oracle-2234`, `lint-scope-runs`)
  mkdirSync(work, { recursive: true })
  pluginDir = join(repoRoot, `scripts`, `eslint-plugin-oracle`)
  scriptDir = join(repoRoot, `scripts`)
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

/** Writes the base files, commits them, then writes the edited working tree. */
function repositoryOf(program) {
  mkdirSync(work, { recursive: true })
  const directory = mkdtempSync(join(work, `r`))
  const git = (...args) =>
    execFileSync(
      `git`,
      [
        `-c`,
        `user.name=oracle`,
        `-c`,
        `user.email=oracle@example.invalid`,
        ...args,
      ],
      {
        cwd: directory,
        encoding: `utf8`,
        stdio: [`ignore`, `pipe`, `pipe`],
      },
    )
  git(`init`, `-q`, `-b`, `main`)
  writeFileSync(
    join(directory, `package.json`),
    JSON.stringify({ name: `root` }),
  )
  mkdirSync(join(directory, APP, `tests`), { recursive: true })
  mkdirSync(join(directory, APP, `src`), { recursive: true })
  writeFileSync(
    join(directory, APP, `package.json`),
    JSON.stringify({ name: `app` }),
  )
  cpSync(pluginDir, join(directory, `scripts`, `eslint-plugin-oracle`), {
    recursive: true,
  })
  for (const name of [
    `agent-lint-feedback.mjs`,
    `check-oracle-run-counts.mjs`,
  ]) {
    writeFileSync(
      join(directory, `scripts`, name),
      readFileSync(join(scriptDir, name), `utf8`),
    )
  }
  const pathOf = (module) =>
    module.kind === `production`
      ? join(directory, APP, `src`, `prod.ts`)
      : join(directory, APP, `tests`, module.name)
  for (const module of program.modules) {
    writeFileSync(pathOf(module), moduleText(program, module, false))
  }
  git(`add`, `-A`)
  git(`commit`, `-q`, `-m`, `base`)
  symlinkSync(join(repoRoot, `node_modules`), join(directory, `node_modules`))
  for (const module of program.modules) {
    if (module.edited)
      writeFileSync(pathOf(module), moduleText(program, module, true))
  }
  if (program.ruleEdited) {
    const rule = join(directory, RULE)
    writeFileSync(rule, `${readFileSync(rule, `utf8`)}\n// edited\n`)
  }
  return { directory, pathOf }
}

/** The oracle basenames that a CLI run reports. */
function reportedOracles(stderr) {
  const found = new Set()
  for (const line of stderr.split(`\n`)) {
    const match = /^(\S+?):\d+:\d+ .* \(oracle\/no-unit-test\)$/.exec(line)
    if (match !== null) found.add(match[1].split(`/`).pop())
  }
  return [...found].sort()
}

function runCli(directory, args, input) {
  const result = spawnSync(
    process.execPath,
    [`scripts/agent-lint-feedback.mjs`, ...args],
    {
      cwd: directory,
      encoding: `utf8`,
      input,
    },
  )
  if (result.status !== 0 && result.status !== 1 && result.status !== 2) {
    throw new Error(`cli failed: ${result.stderr}`)
  }
  return reportedOracles(result.stderr)
}

/** The oracle files that the changed scope and the named scope lint, from one repository. */
function observedSelections(program) {
  const { directory, pathOf } = repositoryOf(program)
  try {
    const edited = program.modules
      .filter((module) => module.edited)
      .map((module) => pathOf(module))
    if (program.ruleEdited) edited.push(join(directory, RULE))
    const changed = runCli(directory, [`--format=text`])
    const named = runCli(directory, [`--format=text`, ...edited])
    return { changed, named }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** The edit hook, for one edited file, with its path in the hook input. */
function observedHookSelection(program, module) {
  const { directory, pathOf } = repositoryOf(program)
  try {
    const input = JSON.stringify({ tool_input: { file_path: pathOf(module) } })
    return runCli(directory, [`--format=claude`, `--event=edit`], input)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// -- 4. Comparison ------------------------------------------------------------
//
// Each observed selection must equal the model's prediction, as sorted
// basenames. The check reports the first oracle file that the script linted or
// missed, so a failure names the oracle file whose lint scope diverged.

/** Each observation equals the model's prediction, as sorted basenames. */
function compareSelected(observed, expected) {
  expect(observed).toEqual(expected)
}

// -- 5. Reach -----------------------------------------------------------------
//
// The states below are coverage of the graph, not a second model. A path is a
// simple path of imports from one oracle file. Its end is an edited module that
// the oracle reaches, or any module that the oracle reaches. A state counts once
// per history:
//   direct-dependent: a one-import path from an oracle file to an edited module.
//   transitive-dependent: a longer path of test modules to an edited module.
//   re-export-dependent: a re-export decides the selection: without the
//     re-export edges, the model selects fewer oracle files.
//   oracle-edit: an oracle file that is itself edited.
//   unrelated-edit: an edited test module that no oracle file reaches.
//   production-boundary: an edited production module that an oracle file reaches.
//   rule-edit: the rule's sources changed, so every oracle file is selected.

const STATES = [
  `direct-dependent`,
  `transitive-dependent`,
  `re-export-dependent`,
  `oracle-edit`,
  `unrelated-edit`,
  `production-boundary`,
  `rule-edit`,
]
const reach = createOracleReach(PROPERTY, STATES, { minimum: 2 })

/** Every simple path of imports from `start`, as its list of modules. */
function pathsFrom(program, start) {
  const found = []
  const walk = (node, nodes) => {
    for (const target of program.edges.get(node) ?? []) {
      if (nodes.includes(target)) continue
      const path = [...nodes, target]
      found.push(path)
      if (target !== PRODUCTION) walk(target, path)
    }
  }
  walk(start, [start])
  return found
}

/**
 * Whether a re-export edge decides a selection: the model selects fewer oracle
 * files once every re-export edge is removed. A path that a re-export shares
 * with another route does not count, because the other route still selects.
 */
function reexportDecides(program) {
  const withoutReexports = {
    ...program,
    edges: new Map(
      [...program.edges].map(([from, targets]) => [
        from,
        targets.filter((target) => !program.reexports.get(from)?.has(target)),
      ]),
    ),
  }
  return (
    predictSelected(withoutReexports).length < predictSelected(program).length
  )
}

/** Marks the states that the program enters. */
function recordStates(program) {
  reach.beginHistory()
  const states = new Set()
  const edited = new Set(
    program.modules
      .filter((module) => module.edited)
      .map((module) => module.name),
  )
  if (program.ruleEdited) states.add(`rule-edit`)
  const reached = new Set()
  for (const oracle of program.oracles) {
    if (oracle.edited) states.add(`oracle-edit`)
    for (const path of pathsFrom(program, oracle.name)) {
      for (const node of path) reached.add(node)
      const end = path.at(-1)
      if (!edited.has(end)) continue
      if (end === PRODUCTION) {
        states.add(`production-boundary`)
        continue
      }
      states.add(
        path.length === 2 ? `direct-dependent` : `transitive-dependent`,
      )
    }
  }
  if (reexportDecides(program)) states.add(`re-export-dependent`)
  for (const module of program.modules) {
    const testModule = module.kind !== `production` && module.kind !== `oracle`
    if (module.edited && testModule && !reached.has(module.name)) {
      states.add(`unrelated-edit`)
    }
  }
  for (const state of states) reach.reach(state)
}

function campaign(name) {
  const predicate = (program) => {
    recordStates(program)
    const { changed, named } = observedSelections(program)
    const expected = predictSelected(program)
    compareSelected(changed, expected)
    compareSelected(named, expected)
  }
  it(`${name}: fixed-seed campaign`, () => {
    fc.assert(fc.property(programArbitrary, predicate), {
      numRuns: oracleRuns(BASE_RUNS),
      seed: FIXED_SEED,
    })
  }, 1_200_000)
  it(`${name}: random-seed campaign`, () => {
    fc.assert(
      fc.property(programArbitrary, predicate),
      oraclePropertyOptions(BASE_RUNS, PROPERTY),
    )
  }, 1_200_000)
}

describe(`lint selection after an edit`, () => {
  campaign(`changed and named scopes`)
  it(`the edit hook lints the oracle files that depend on the edited file`, () => {
    fc.assert(
      fc.property(
        programArbitrary.filter((program) =>
          program.modules.some((module) => module.kind !== `oracle`),
        ),
        (program) => {
          const module = program.modules.find(
            (candidate) => candidate.kind !== `oracle`,
          )
          const onlyEdited = {
            ...program,
            ruleEdited: false,
            modules: program.modules.map((candidate) => ({
              ...candidate,
              edited: candidate === module,
            })),
          }
          const hooked = observedHookSelection(onlyEdited, module)
          compareSelected(hooked, predictSelected(onlyEdited))
        },
      ),
      { numRuns: oracleRuns(4), seed: FIXED_SEED },
    )
  }, 1_200_000)
})

describe(`declared reach ledger`, () => {
  it(`every declared reach state is entered`, () => {
    reach.assertReached()
  })
})

// The declaration names the parts above. It runs nothing, so it follows them.
declareOracle({
  model: [predictSelected],
  check: [compareSelected],
  grammar: [programArbitrary],
})
