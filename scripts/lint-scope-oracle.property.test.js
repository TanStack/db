/**
 * Law L4 (lint scope): after an edit, every oracle file whose oracle lint result
 * can change is linted again, by the edit hook, by `pnpm lint:changed`, and by
 * the pre-commit hook. An oracle file's result depends on the test modules that
 * it reaches through relative imports and re-exports: its companions, support
 * modules, drivers, and other oracle files. The rule does not read production
 * source, so an edit to production code selects nothing. A change to the
 * rule's own sources changes every oracle result, so it selects every oracle
 * file. An oracle file is any file in the working tree whose name contains
 * `oracle`, in TypeScript or JavaScript, tracked or new and untracked: an
 * agent's new oracle file is linted like any other.
 *
 * The files belong to the checkout that the agent works in. A hook command can
 * run the script of the checkout where the session started, while the agent
 * works in a worktree nested under that checkout's `.worktrees/`. The hook
 * input's `cwd` names the agent's checkout, so the hooks select and lint that
 * checkout's files, with that checkout's own copy of the script and the rule,
 * as CI does for its branch. A directory under `.worktrees/` that is not a
 * checkout, such as a scratch copy, is never one of the launch checkout's
 * changed files.
 *
 * Authority: AGENTS.md "Lint feedback while you work" says the hooks and
 * `pnpm lint:changed` return the oracle reports for the files that were edited,
 * and that the pre-commit hook lints the staged files. Issue #2280, written by
 * the maintainer, states the checkout rule: a session that started in the main
 * checkout and works in `.worktrees/<name>` gets reports only for that
 * worktree's branch, a plain directory under `.worktrees/` produces no report,
 * and `pnpm lint:changed` in a worktree lints that worktree. AGENTS.md "Name oracle
 * files for discovery" defines an oracle file by its name. The rule's header
 * contract (scripts/eslint-plugin-oracle/rules/no-unit-test.js) states that the
 * rule follows relative imports of test modules and does not follow production
 * source. The rule-source case follows from the same reports: the oracle
 * results are a function of the rule's code.
 *
 * Limits. The grammar draws up to three oracle files, two or three support
 * modules, one driver, and one production module, with relative imports and
 * re-exports. Half the programs take a re-export chain: the first oracle file
 * imports the first support module, which re-exports the second. An oracle file
 * is `.ts` or `.js`, and one can be new and untracked. Support modules and
 * drivers are `.ts`, and only a tracked `.ts` oracle file is imported by another
 * oracle file, because the rule resolves only TypeScript test modules. The
 * `.js` specifier form of an import is drawn for some oracle files. Re-exports
 * are drawn for support modules only, and star re-exports are the only form.
 * The driver runs the lint command-line script in temporary git repositories.
 * The pre-commit leg is covered only by the script's file selection: the glob in
 * lint-staged.config.js is not evaluated here. A session works in the launch
 * checkout or in one worktree at `.worktrees/wt`, and a launch checkout can hold
 * one scratch directory. The hooks always pass `cwd`, and the hook process runs
 * in the launch checkout: a hook input without `cwd` is not generated, and
 * neither is a worktree outside the launch checkout or one whose branch has no
 * copy of the script. The repository's own `.gitignore` is copied into each
 * temporary repository, so its rules are part of what is tested.
 *
 * Structure:
 *   1. The grammar draws a module graph, the edited and untracked modules, and
 *      the file that an edit hook names.
 *   2. The model predicts the oracle files to lint for each scope, by a
 *      fixed-point closure over the graph's edges.
 *   3. The driver writes the base commit and the edited working tree, in the
 *      launch checkout or a worktree, then runs the CLI's changed scope, its
 *      named scope, and its edit-hook and stop-hook forms. A crashed CLI is a
 *      failure, not an empty selection.
 *   4. The comparison checks that each observed selection equals the prediction,
 *      and that every report came from the session checkout's own rule.
 *   5. Reach counts the graph states that the campaign enters, and the
 *      campaigns run the same predicate with a fixed seed and a random seed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
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
const BASE_RUNS = 24
const PRODUCTION = `src/prod.ts`
const repoRoot = fileURLToPath(new URL(`../`, import.meta.url))
const APP = `packages/app`
const RULE = `scripts/eslint-plugin-oracle/rules/no-unit-test.js`

// -- 1. Grammar ---------------------------------------------------------------
//
// Every module is a node. An oracle file imports supports, drivers, other
// oracle files, and production. A support module imports other supports and
// production. A driver imports supports. Production imports nothing. Each
// target is an index taken modulo the modules the kind may reach, so every draw
// is a legal edge. A star re-export is an import whose names the module passes
// on. An edit adds a line to a module, so its text differs from the base
// commit. An untracked oracle file exists only in the working tree, so nothing
// imports it. The edit hook names one module, or the rule's source.

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
    // Random draws reach three shapes too rarely, so a share of the programs
    // take each of them. See the shape functions below.
    shape: fc.oneof(
      { weight: 2, arbitrary: fc.constant(`free`) },
      { weight: 2, arbitrary: fc.constant(`re-export chain`) },
      { weight: 2, arbitrary: fc.constant(`oracle chain`) },
      { weight: 1, arbitrary: fc.constant(`untracked dependent`) },
    ),
    oracles: fc.array(
      fc.record({
        edited: moduleEdit,
        targets: singleOrManyTargets,
        style: fc.nat({ max: 1 }),
        extension: fc.oneof(
          { weight: 2, arbitrary: fc.constant(`ts`) },
          { weight: 1, arbitrary: fc.constant(`js`) },
        ),
        untracked: fc.oneof(
          { weight: 3, arbitrary: fc.constant(false) },
          { weight: 1, arbitrary: fc.constant(true) },
        ),
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
    // The edit hook names a module of this kind, or the rule's source.
    hookKind: fc.oneof(
      { weight: 2, arbitrary: fc.constant(`oracle`) },
      { weight: 2, arbitrary: fc.constant(`support`) },
      { weight: 2, arbitrary: fc.constant(`driver`) },
      { weight: 1, arbitrary: fc.constant(`production`) },
      { weight: 2, arbitrary: fc.constant(`rule`) },
    ),
    hookIndex: fc.nat({ max: 9 }),
    // The checkout that the session works in: the one where it started, or a
    // worktree nested in it.
    session: fc.constantFrom(`launch`, `worktree`),
    // A plain directory under the launch checkout's `.worktrees/`, holding an
    // oracle-named file that the rule reports.
    scratch: fc.boolean(),
  })
  .map(({ shape, ...skeleton }) => {
    const drawn =
      skeleton.hookKind === `driver`
        ? { ...skeleton, driver: { ...skeleton.driver, present: true } }
        : skeleton
    return buildProgram(shapes[shape](drawn))
  })

const shapes = {
  free: (skeleton) => skeleton,
  're-export chain': reexportChain,
  'oracle chain': oracleChain,
  'untracked dependent': untrackedDependent,
}

/** The skeleton's first two oracle files, adding a second when there is one. */
function twoOracles(skeleton) {
  const [first, second = first] = skeleton.oracles
  return [first, second, ...skeleton.oracles.slice(2)]
}

/**
 * The skeleton with the re-export chain drawn: oracle 0 imports support 0, which
 * re-exports support 1. Oracle 0 and support 0 are unedited and support 1 is
 * edited, so the re-export is the only route from the edit to oracle 0.
 */
function reexportChain(skeleton) {
  return {
    ...skeleton,
    oracles: skeleton.oracles.map((oracle, index) =>
      index === 0
        ? { ...oracle, edited: false, untracked: false, targets: [0] }
        : oracle,
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
 * The skeleton with an oracle chain drawn: oracle 1 imports only oracle 0, which
 * imports the edited support 0. The other oracle file is the only route from
 * the edit to oracle 1.
 */
function oracleChain(skeleton) {
  const [first, second, ...rest] = twoOracles(skeleton)
  return {
    ...skeleton,
    oracles: [
      {
        ...first,
        extension: `ts`,
        untracked: false,
        edited: false,
        targets: [0],
      },
      {
        ...second,
        untracked: false,
        edited: false,
        fixedTargets: [`case-0-oracle.test.ts`],
      },
      ...rest,
    ],
    supports: skeleton.supports.map((support, index) =>
      index === 0 ? { ...support, edited: true } : support,
    ),
  }
}

/**
 * The skeleton with an untracked dependent drawn: oracle 1 is new and untracked
 * and imports support 0, which the edit hook names.
 */
function untrackedDependent(skeleton) {
  const [first, second, ...rest] = twoOracles(skeleton)
  return {
    ...skeleton,
    oracles: [
      first,
      { ...second, untracked: true, fixedTargets: [`support-0.ts`] },
      ...rest,
    ],
    hookName: `support-0.ts`,
  }
}

/**
 * The modules of a program, with the import edges that the grammar drew. A
 * re-export is an edge that the module passes on by star export. A shape can
 * fix a module's targets by name.
 */
function buildProgram(skeleton) {
  const oracles = skeleton.oracles.map((oracle, index) => ({
    // The rule skips basenames that start with `oracle-`, which are its own
    // machinery, so generated oracle files use another prefix.
    name: `case-${index}-oracle.test.${oracle.extension}`,
    kind: `oracle`,
    untracked: oracle.untracked,
    // An untracked file is new, so it has no separate edit.
    edited: oracle.edited && !oracle.untracked,
    style: oracle.style,
    targets: oracle.targets,
    fixedTargets: oracle.fixedTargets,
  }))
  const supports = skeleton.supports.map((support, index) => ({
    name: `support-${index}.ts`,
    kind: `support`,
    untracked: false,
    edited: support.edited,
    targets: support.targets,
    reexport: support.reexport,
  }))
  const driver = skeleton.driver.present
    ? [
        {
          name: `driver.test.ts`,
          kind: `driver`,
          untracked: false,
          edited: skeleton.driver.edited,
          targets: skeleton.driver.targets,
          reexport: [],
        },
      ]
    : []
  const production = {
    name: PRODUCTION,
    kind: `production`,
    untracked: false,
    edited: skeleton.production.edited,
    targets: [],
    reexport: [],
  }
  const test = [...oracles, ...supports, ...driver]
  // Only a tracked TypeScript oracle file can be imported by another one.
  const importableOracles = oracles.filter(
    (oracle) => !oracle.untracked && oracle.name.endsWith(`.ts`),
  )
  const allowed = {
    oracle: [...supports, ...driver, ...importableOracles, production],
    support: [...supports, production],
    driver: [...supports],
  }
  const edges = new Map()
  const reexports = new Map()
  const byName = new Map(
    [...test, production].map((module) => [module.name, module]),
  )
  for (const module of test) {
    const targets = allowed[module.kind]
    const chosen = (module.fixedTargets ?? []).map((name) => ({
      target: byName.get(name),
      reexport: false,
    }))
    for (const [position, index] of module.fixedTargets
      ? []
      : module.targets.entries()) {
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
  const modules = [...oracles, ...supports, ...driver, production]
  const ofKind = modules.filter((module) => module.kind === skeleton.hookKind)
  const hookTarget =
    skeleton.hookName ??
    (ofKind.length === 0
      ? RULE
      : ofKind[skeleton.hookIndex % ofKind.length].name)
  return {
    oracles,
    supports,
    driver,
    production,
    ruleEdited: skeleton.ruleEdited,
    session: skeleton.session,
    scratch: skeleton.scratch,
    edges,
    reexports,
    modules,
    hookTarget,
  }
}

/**
 * The files that each scope treats as edited. The changed scope sees every
 * edited tracked module and every untracked file. The named scope, which the
 * pre-commit hook runs, sees the files it is given: the edited tracked modules.
 * It runs only when there is one: the hook never runs it without files.
 * The edit hook sees the one file that the hook input names.
 */
function editedByScope(program) {
  const tracked = program.modules
    .filter((module) => module.edited)
    .map((module) => module.name)
  const untracked = program.modules
    .filter((module) => module.untracked)
    .map((module) => module.name)
  const rule = program.ruleEdited ? [RULE] : []
  return {
    changed: [...tracked, ...untracked, ...rule],
    named: [...tracked, ...rule],
    hook: [program.hookTarget],
    // The stop hook lints the changed files of the session's checkout.
    stop: [...tracked, ...untracked, ...rule],
  }
}

// -- 2. Model -----------------------------------------------------------------
//
// The model reads only the graph. It grows the set of affected modules to a
// fixed point: an edited test module is affected, and so is every module with
// an edge into an affected module. Production is never affected, because the
// rule never reads it, so an edge into production carries nothing. The oracle
// files in the affected set are the ones to lint. When the edited files
// include the rule's own source, every oracle file must be linted.

/** The oracle files that a lint of `edited` must cover, as sorted basenames. */
function predictSelected(program, edited) {
  if (edited.includes(RULE))
    return program.oracles.map((oracle) => oracle.name).sort()
  const affected = new Set(edited.filter((name) => name !== PRODUCTION))
  let grew = true
  while (grew) {
    grew = false
    for (const [from, targets] of program.edges) {
      if (affected.has(from)) continue
      if (targets.some((target) => affected.has(target))) {
        affected.add(from)
        grew = true
      }
    }
  }
  return program.oracles
    .filter((oracle) => affected.has(oracle.name))
    .map((oracle) => oracle.name)
    .sort()
}

// Each checkout is linted by its own copy of the rule. The driver marks the
// message of the rule copy that a branch edits, and only that copy, so a report
// carries the mark exactly when the session checkout's branch edited the rule.
// The launch checkout's copy is unmarked in a worktree session, so a report
// that the launch checkout's rule makes for a worktree carries no mark.

/** Whether the session checkout's reports carry the edited rule's mark. */
function predictRuleMarked(program) {
  return program.ruleEdited
}

// -- 3. Driver ----------------------------------------------------------------
//
// The driver runs the lint script that a developer or hook runs. It writes the
// modules and the copy of the script and the rule into a temporary repository,
// the launch checkout, with the repository's `.gitignore`, and commits the
// tracked modules. A worktree session then adds a worktree of that commit at
// `.worktrees/wt`, on its own branch. The session checkout gets the edits and
// the untracked oracle files. A scratch directory is a plain directory of
// untracked files under the launch checkout's `.worktrees/`.
//
// The changed scope (`lint:changed`) and the named scope (the pre-commit hook)
// run the session checkout's own script there, as a developer runs them. The
// edit hook and the stop hook run the launch checkout's script from the launch
// checkout, as a harness that started there runs them, with the session
// checkout as the input's `cwd`. The edit hook selects from the file that its
// input names, not from the working tree's edits. Each report line names its
// oracle file, and the driver reads those names and whether the line carries
// the edited rule's mark; it does not compute them. An exit status or stderr
// that is not a report is a failed run, so a crashed script cannot pass as an
// empty selection.

const WORKTREE = `.worktrees/wt`
const SCRATCH = `.worktrees/scratch/${APP}/tests/scratch-oracle.test.ts`
// The rule's message for these generated files, and the mark that an edited
// copy of the rule adds to it.
const RULE_MESSAGE = `registers tests and declares no oracle part.`
const RULE_MARK = `[branch rule]`

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
  if (module.kind === `oracle`) lines.push(UNDECLARED_TEST)
  if (module.kind === `production`) lines.push(`export const prod = 1`)
  if (edited) lines.push(`// edited`)
  return `${lines.join(`\n`)}\n`
}

// A test in a file that declares nothing, so the rule reports the file.
const UNDECLARED_TEST = `it('reads one value', () => { expect(1).toBe(1) })`

let work
let pluginDir
let feedbackScript
let runCountScript
let gitignoreFile

beforeAll(() => {
  // Each run has its own directory, so concurrent runs cannot remove each
  // other's repositories. The real path keeps the file names that the driver
  // passes in the spelling that the script's repository root uses.
  work = realpathSync(mkdtempSync(join(tmpdir(), `lint-scope-oracle-`)))
  pluginDir = join(repoRoot, `scripts`, `eslint-plugin-oracle`)
  // A mutant is run from a copy: LINT_SCOPE_SCRIPT names the copy of the
  // script under test, and LINT_SCOPE_GITIGNORE the copy of `.gitignore`.
  feedbackScript =
    process.env.LINT_SCOPE_SCRIPT ??
    join(repoRoot, `scripts`, `agent-lint-feedback.mjs`)
  runCountScript = join(repoRoot, `scripts`, `check-oracle-run-counts.mjs`)
  gitignoreFile =
    process.env.LINT_SCOPE_GITIGNORE ?? join(repoRoot, `.gitignore`)
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

function gitIn(cwd, ...args) {
  return execFileSync(
    `git`,
    [
      `-c`,
      `user.name=oracle`,
      `-c`,
      `user.email=oracle@example.invalid`,
      ...args,
    ],
    { cwd, encoding: `utf8`, stdio: [`ignore`, `pipe`, `pipe`] },
  )
}

/** The path of a module in a checkout. */
function modulePath(checkout, name) {
  if (name === RULE) return join(checkout, RULE)
  if (name === PRODUCTION) return join(checkout, APP, `src`, `prod.ts`)
  return join(checkout, APP, `tests`, name)
}

/**
 * Writes the base files and commits them in the launch checkout, adds the
 * session's worktree, then writes the edited working tree of the session
 * checkout and the scratch directory.
 */
function repositoryOf(program) {
  const launch = mkdtempSync(join(work, `r`))
  gitIn(launch, `init`, `-q`, `-b`, `main`)
  writeFileSync(
    join(launch, `package.json`),
    // The repository's root is an ES module package, as here.
    JSON.stringify({ name: `root`, type: `module` }),
  )
  writeFileSync(join(launch, `.gitignore`), readFileSync(gitignoreFile, `utf8`))
  mkdirSync(join(launch, APP, `tests`), { recursive: true })
  mkdirSync(join(launch, APP, `src`), { recursive: true })
  writeFileSync(
    join(launch, APP, `package.json`),
    JSON.stringify({ name: `app` }),
  )
  // The plugin's sources, without its tests: its own oracle file would be an
  // oracle file of this repository too.
  cpSync(pluginDir, join(launch, `scripts`, `eslint-plugin-oracle`), {
    recursive: true,
    filter: (source) => !source.endsWith(`.test.js`),
  })
  writeFileSync(
    join(launch, `scripts`, `agent-lint-feedback.mjs`),
    readFileSync(feedbackScript, `utf8`),
  )
  writeFileSync(
    join(launch, `scripts`, `check-oracle-run-counts.mjs`),
    readFileSync(runCountScript, `utf8`),
  )
  for (const module of program.modules) {
    if (!module.untracked)
      writeFileSync(
        modulePath(launch, module.name),
        moduleText(program, module, false),
      )
  }
  gitIn(launch, `add`, `-A`)
  gitIn(launch, `commit`, `-q`, `-m`, `base`)
  // A worktree nested in the launch checkout finds these packages by walking
  // up from its own files.
  symlinkSync(join(repoRoot, `node_modules`), join(launch, `node_modules`))
  let checkout = launch
  if (program.session === `worktree`) {
    gitIn(launch, `worktree`, `add`, `-q`, `-b`, `feature`, WORKTREE)
    checkout = join(launch, WORKTREE)
  }
  if (program.scratch) {
    mkdirSync(dirname(join(launch, SCRATCH)), { recursive: true })
    writeFileSync(join(launch, SCRATCH), `${UNDECLARED_TEST}\n`)
  }
  for (const module of program.modules) {
    if (module.edited || module.untracked)
      writeFileSync(
        modulePath(checkout, module.name),
        moduleText(program, module, true),
      )
  }
  if (program.ruleEdited) {
    const rule = modulePath(checkout, RULE)
    const text = readFileSync(rule, `utf8`)
    if (!text.includes(RULE_MESSAGE))
      throw new Error(`the rule no longer has the message ${RULE_MESSAGE}`)
    writeFileSync(
      rule,
      `${text.replace(RULE_MESSAGE, `${RULE_MESSAGE} ${RULE_MARK}`)}\n// edited\n`,
    )
  }
  return {
    launch,
    checkout,
    pathOf: (name) => modulePath(checkout, name),
  }
}

const lintLine = /^(\S+?):\d+:\d+ .* \((oracle\/[\w-]+|parse)\)$/
const budgetLine = /^\S+: .+: run budget (lowered|removed) /

/**
 * The oracle basenames in a report's lint lines, and the set of the lines'
 * marks: whether each one carries the edited rule's mark.
 */
function reportedOracles(lines) {
  const found = new Set()
  const marks = new Set()
  for (const line of lines) {
    const match = lintLine.exec(line)
    if (match === null) continue
    found.add(match[1].split(`/`).pop())
    marks.add(line.includes(RULE_MARK))
  }
  return { oracles: [...found].sort(), marks }
}

/**
 * Runs a copy of the CLI from `cwd` and returns what it reported. In text
 * format the CLI exits 0 with no output, or 1 with report lines on stderr. As a
 * Claude hook it exits 0 with no output, or 2 with a report on stderr.
 * Anything else, such as a crash, which exits 1 with a stack trace, fails.
 */
function runCli(cwd, script, args, input) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: `utf8`,
    input,
  })
  const lines = result.stderr.split(`\n`).filter(Boolean)
  const hook = args.includes(`--format=claude`)
  const reported = hook ? 2 : 1
  const valid =
    result.stdout === `` &&
    (result.status === 0
      ? lines.length === 0
      : result.status === reported &&
        (hook
          ? lines[0]?.startsWith(`Oracle lint reports`)
          : lines.every(
              (line) => lintLine.test(line) || budgetLine.test(line),
            )))
  if (!valid) {
    throw new Error(`cli failed (exit ${result.status}):\n${result.stderr}`)
  }
  return reportedOracles(lines)
}

/** What each scope reports, from one repository. */
function observedSelections(program) {
  const { launch, checkout, pathOf } = repositoryOf(program)
  try {
    const scopes = editedByScope(program)
    const own = join(checkout, `scripts`, `agent-lint-feedback.mjs`)
    const launchScript = join(launch, `scripts`, `agent-lint-feedback.mjs`)
    const changed = runCli(checkout, own, [`--format=text`])
    // lint-staged runs the named scope once per nonempty chunk of staged
    // files; without files the script runs its changed scope instead.
    const named =
      scopes.named.length === 0
        ? undefined
        : runCli(checkout, own, [
            `--format=text`,
            ...scopes.named.map((name) => pathOf(name)),
          ])
    const hook = runCli(
      launch,
      launchScript,
      [`--format=claude`, `--event=edit`],
      JSON.stringify({
        cwd: checkout,
        tool_input: { file_path: pathOf(program.hookTarget) },
      }),
    )
    const stop = runCli(
      launch,
      launchScript,
      [`--format=claude`, `--event=stop`],
      JSON.stringify({ cwd: checkout }),
    )
    return { changed, named, hook, stop }
  } finally {
    rmSync(launch, { recursive: true, force: true })
  }
}

// -- 4. Comparison ------------------------------------------------------------
//
// Each observed selection must equal the model's prediction for its scope, as
// sorted basenames. The check reports the first oracle file that the script
// linted or missed, so a failure names the oracle file whose lint scope
// diverged.

/** Each observation equals the model's prediction, as sorted basenames. */
function compareSelected(observed, expected) {
  expect(observed).toEqual(expected)
}

/**
 * Every report line came from the session checkout's own rule: each line
 * carries the edited rule's mark exactly when the model predicts it.
 */
function compareRuleSource(marks, marked) {
  expect([...marks].filter((mark) => mark !== marked)).toEqual([])
}

// -- 5. Reach -----------------------------------------------------------------
//
// The states below are coverage of the graph, not a second model. A path is a
// simple path of imports from one oracle file. A state counts once per history:
//   direct-dependent: a one-import path from an oracle file to an edited module.
//   transitive-dependent: a longer path of test modules to an edited module.
//   re-export-dependent: a re-export decides the selection: without the
//     re-export edges, the model selects fewer oracle files.
//   oracle-dependent: an oracle file reaches an edited module only through
//     another oracle file.
//   oracle-edit: an oracle file that is itself edited.
//   unrelated-edit: an edited test module that no oracle file reaches.
//   production-boundary: an edited production module that an oracle file reaches.
//   rule-edit: the rule's sources changed, so every oracle file is selected.
//   untracked-dependent: an untracked oracle file reaches the hook's file.
//   js-oracle: a JavaScript oracle file is selected.
//   hook-oracle, hook-support, hook-driver, hook-production, hook-rule: the
//     kind of file that the edit hook names.
//   worktree-session: the session works in a worktree, and the hooks run the
//     launch checkout's script.
//   worktree-own-rule: the worktree's branch edited the rule, so its reports
//     must come from its own copy.
//   scratch-directory: a launch session's checkout holds a scratch directory
//     under `.worktrees/`.

const STATES = [
  `direct-dependent`,
  `transitive-dependent`,
  `re-export-dependent`,
  `oracle-dependent`,
  `oracle-edit`,
  `unrelated-edit`,
  `production-boundary`,
  `rule-edit`,
  `untracked-dependent`,
  `js-oracle`,
  `hook-oracle`,
  `hook-support`,
  `hook-driver`,
  `hook-production`,
  `hook-rule`,
  `worktree-session`,
  `worktree-own-rule`,
  `scratch-directory`,
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

/** The program with some edges removed. */
function withoutEdges(program, drop) {
  return {
    ...program,
    edges: new Map(
      [...program.edges].map(([from, targets]) => [
        from,
        targets.filter((target) => !drop(from, target)),
      ]),
    ),
  }
}

/** Marks the states that the program enters. */
function recordStates(program) {
  reach.beginHistory()
  const states = new Set()
  const { changed, hook } = editedByScope(program)
  const edited = new Set(changed)
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
  const selected = predictSelected(program, changed).length
  const oracleNames = new Set(program.oracles.map((oracle) => oracle.name))
  if (
    predictSelected(
      withoutEdges(program, (from, target) =>
        program.reexports.get(from)?.has(target),
      ),
      changed,
    ).length < selected
  )
    states.add(`re-export-dependent`)
  if (
    predictSelected(
      withoutEdges(program, (_, target) => oracleNames.has(target)),
      changed,
    ).length < selected
  )
    states.add(`oracle-dependent`)
  for (const module of program.modules) {
    const testModule = module.kind !== `production` && module.kind !== `oracle`
    if (module.edited && testModule && !reached.has(module.name)) {
      states.add(`unrelated-edit`)
    }
  }
  const hookSelected = new Set(predictSelected(program, hook))
  if (
    program.oracles.some(
      (oracle) =>
        oracle.untracked &&
        oracle.name !== program.hookTarget &&
        hookSelected.has(oracle.name),
    )
  )
    states.add(`untracked-dependent`)
  if (
    program.oracles.some(
      (oracle) =>
        oracle.name.endsWith(`.js`) &&
        predictSelected(program, changed).includes(oracle.name),
    )
  )
    states.add(`js-oracle`)
  const target = program.modules.find(
    (module) => module.name === program.hookTarget,
  )
  states.add(`hook-${target?.kind ?? `rule`}`)
  if (program.session === `worktree`) {
    states.add(`worktree-session`)
    if (program.ruleEdited) states.add(`worktree-own-rule`)
  } else if (program.scratch) {
    states.add(`scratch-directory`)
  }
  for (const state of states) reach.reach(state)
}

function campaign(name) {
  // A history runs its child processes synchronously, so the predicate yields
  // between complete histories: the test worker then answers its progress
  // messages, and a long campaign cannot time out the worker's RPC channel.
  const predicate = async (program) => {
    await setImmediate()
    recordStates(program)
    const observed = observedSelections(program)
    const scopes = editedByScope(program)
    const marked = predictRuleMarked(program)
    for (const scope of [`changed`, `named`, `hook`, `stop`]) {
      if (observed[scope] === undefined) continue
      compareSelected(
        observed[scope].oracles,
        predictSelected(program, scopes[scope]),
      )
      compareRuleSource(observed[scope].marks, marked)
    }
  }
  it(`${name}: fixed-seed campaign`, async () => {
    await fc.assert(fc.asyncProperty(programArbitrary, predicate), {
      numRuns: oracleRuns(BASE_RUNS),
      seed: FIXED_SEED,
    })
  }, 1_200_000)
  it(`${name}: random-seed campaign`, async () => {
    await fc.assert(
      fc.asyncProperty(programArbitrary, predicate),
      oraclePropertyOptions(BASE_RUNS, PROPERTY),
    )
  }, 1_200_000)
}

describe(`lint selection after an edit`, () => {
  campaign(`changed, named, edit-hook, and stop-hook scopes`)
  // Every declared state must be entered by the campaigns above.
  afterAll(() => {
    if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT)
      console.log(`REACH`, JSON.stringify([...reach.counts()]))
    reach.assertReached()
  })
})

// The declaration names the parts above. It runs nothing, so it follows them.
declareOracle({
  model: [predictSelected, predictRuleMarked],
  check: [compareSelected, compareRuleSource],
  grammar: [programArbitrary],
})
