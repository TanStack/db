/**
 * Law L4 (lint scope): after an edit, every oracle file whose oracle lint result
 * can change is linted again, by the edit hook, by `pnpm lint:changed`, and by
 * the pre-commit hook. An oracle file's result depends on the test modules that
 * it reaches through relative imports and re-exports: its companions, support
 * modules, drivers, and other oracle files. The rule does not read production
 * source, so an edit to production code selects nothing. The rules come from
 * the @tanstack/eslint-plugin-oracles dependency, which pnpm-lock.yaml pins,
 * under the settings in scripts/oracle-lint-settings.mjs. A change to the lint
 * configuration changes every oracle result, so it selects every oracle file:
 * any edit to the settings module, and a lockfile whose entries for the plugin
 * (its importer entry, its resolution, and its snapshot with its resolved
 * dependencies) differ from the merge-base's. Any other lockfile edit, such as
 * an unrelated dependency bump, installs the same rule, so it selects nothing,
 * as a production edit does. An oracle file is any file in the working tree whose name contains
 * `oracle`, in TypeScript or JavaScript, tracked or new and untracked: an
 * agent's new oracle file is linted like any other.
 *
 * The files belong to the checkout that the agent works in. A hook command can
 * run the script of the checkout where the session started, while the agent
 * works in a worktree nested under that checkout's `.worktrees/`. The hook
 * input's `cwd` names the agent's checkout, so the hooks select and lint that
 * checkout's files, with that checkout's own copy of the script, its settings,
 * and its installed plugin, as CI does for its branch. A directory under `.worktrees/` that is not a
 * checkout, such as a scratch copy, is never one of the launch checkout's
 * changed files.
 *
 * A worktree with no `node_modules` of its own, nested in an installed launch
 * checkout, resolves its packages by walking up to the launch checkout's
 * `node_modules`. It lints with the launch checkout's plugin, and every form
 * says so: one line, `oracle lint used the plugin installed at <location>,
 * outside <checkout>`, names the plugin's package directory and the session
 * checkout. A command-line run writes the line to stderr and keeps its exit
 * status, so the line alone does not fail it. A hook adds the line to its
 * report, or, with no report, hands it to the agent and exits 0, as a skip
 * does. A checkout whose own plugin loads prints no such line.
 *
 * The lint needs the checkout's installed dependencies: ESLint, its TypeScript
 * parser, and the plugin. When the session checkout cannot resolve them, as in
 * a fresh worktree before `pnpm install`, or cannot load them, as after a
 * partial install, nothing is linted and the script never crashes. Every form
 * produces one line that names the session checkout and says how to install:
 * `oracle lint skipped: dependencies are not installed in <checkout>; run pnpm
 * install`. A package that is installed but fails to load for another reason,
 * such as a cut-off file, produces `oracle lint failed: <message>` instead. A
 * hook, in every harness format and for both events, exits 0 and hands the
 * line to the agent on the channel that its harness reads, so the agent knows
 * that nothing was linted; at a stop, that asks for one more turn, as a report
 * does. The command-line forms (`pnpm lint:changed`, the named scope that the
 * pre-commit hook runs, and `--all`, which `pnpm lint:oracles` runs in CI)
 * write the line to stderr and exit nonzero, so a run that lints nothing
 * cannot pass as a clean one. `pnpm lint:run-budgets` follows the same rule:
 * without an install, it writes the skip line to stderr and exits nonzero.
 *
 * No other failure crashes either. An unknown `--format` or `--event`, a hook
 * input on stdin that is not a JSON object, a checkout with no `main` branch
 * for the merge-base, and an error that the rule throws while it lints each
 * end with one line, `oracle lint failed: <message>`. A run whose format is a
 * harness's exits 0 and hands the line to the agent on that harness's
 * channel, as a skip does; with an unknown event, it uses the channel for an
 * edit. Any other run writes the line to stderr and exits nonzero. A form
 * that lints no file cannot meet the rule's error, so it answers as a clean
 * run does.
 *
 * Authority: AGENTS.md "Lint feedback while you work" says the hooks and
 * `pnpm lint:changed` return the oracle reports for the files that were edited,
 * and that the pre-commit hook lints the staged files. Issue #2280, written by
 * the maintainer, states the checkout rule: a session that started in the main
 * checkout and works in `.worktrees/<name>` gets reports only for that
 * worktree's branch, a plain directory under `.worktrees/` produces no report,
 * and `pnpm lint:changed` in a worktree lints that worktree. AGENTS.md "Name oracle
 * files for discovery" defines an oracle file by its name. The rule's header
 * contract (@tanstack/eslint-plugin-oracles/rules/no-unit-test) states that the
 * rule follows relative imports of test modules and does not follow production
 * source. The configuration case follows from the same reports: the oracle
 * results are a function of the installed rule's code and its settings, so a
 * lockfile edit that leaves the plugin's resolved entries as they were cannot
 * change one (round-1 review of PR #2378, finding B1-10, which asked that an
 * unrelated dependency bump stop re-linting every oracle file). The
 * missing-dependency rule is the maintainer's decision of 2026-11-10 ("we
 * should never just crash"): the hooks skip with one line and exit 0, and the
 * command-line forms fail with the same line so that CI stays strict. The
 * review of that change asked that a hook's line reach the agent, and that a
 * partial install skip as a missing one does. The outer-plugin rule is the
 * maintainer's decision of 2026-11-11 ("using outer checkout's plugin seems
 * fine"): lint with the launch checkout's rule and say so. The failure rule for
 * arguments, hook input, the merge-base, and lint errors is the same 2026-11-10
 * decision, which review finding F26 applied to the paths that still
 * crashed. The harnesses' hook
 * documentation fixes each format's channel to the agent.
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
 * copy of the script. A plugin change is a lockfile edit together with the
 * session checkout's own installed copy of the plugin, as an install leaves
 * them; it changes one part of the plugin's entries: its version (all three
 * entries), its integrity, or one resolved dependency of its snapshot. An
 * unrelated lockfile edit bumps another package that nothing depends on. A
 * change deeper in the plugin's dependency tree, which leaves its own entries
 * alone, is not drawn, and the script would not select it. The lockfile is a
 * hand-written pnpm v9 file, not one pnpm wrote: small, or padded past the
 * 1 MiB default output buffer of a child process with packages nothing uses.
 * The base commit may lack it, and the branch then adds it. A settings edit changes
 * no report. The repository's own `.gitignore` is copied into each
 * temporary repository, so its rules are part of what is tested. A missing
 * install is a launch checkout with no `node_modules`, so its nested worktree
 * resolves nothing either; a temporary directory with an installed ancestor
 * fails the run instead of entering the state. A partial or broken install
 * breaks only the session checkout's plugin: its entry file, its subpath rule
 * module, a package that it imports, or its entry file's text. A broken ESLint
 * or parser, a missing dependency deeper in the tree, and a stop hook input
 * with `stop_hook_active` are not drawn. A worktree session under an installed
 * launch checkout has its own copy of the plugin or none; with none, ESLint,
 * the parser, and the plugin all come from the launch checkout. A launch
 * checkout's plugin linked from outside every checkout is not drawn. A failure
 * history has a full install of its own. Its unknown values are three formats
 * and three events, and its hook inputs are two texts that are not JSON and
 * three JSON values that are not objects. Without `main`, it runs only the
 * forms that always need the merge-base: the changed scope, the stop hooks,
 * and `pnpm lint:run-budgets`. Its lint error is one that the rule throws on
 * every file. Without a full install, or with a failure, the import graph
 * does not matter, so those histories enter no selection state.
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
 *      that every report came from the session checkout's own installed rule,
 *      or from the launch checkout's when the worktree has none, and that
 *      exactly those runs name the plugin's location.
 *   5. Reach counts the graph states that the campaign enters, and the
 *      campaigns run the same predicate with a fixed seed and a random seed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { afterAll, beforeAll, expect } from 'vitest'
import {
  differs,
  oracleProperty,
  oracleReplayRequested,
  pass,
} from '../packages/db/tests/oracle-config.js'

const PROPERTY = `scripts.lint-scope`
const FIXED_SEED = 2234
// Six of the constructed histories, and some random ones, have no full install
// and lint nothing, so the budget is above the 24 histories that the selection
// states had before those were drawn.
const BASE_RUNS = 28
const PRODUCTION = `src/prod.ts`
const repoRoot = fileURLToPath(new URL(`../`, import.meta.url))
const APP = `packages/app`
// The lint configuration: the lockfile, which pins the plugin, and the
// settings module. Editing the settings, or the plugin's entries in the
// lockfile, selects every oracle file.
const LOCKFILE = `pnpm-lock.yaml`
const SETTINGS = `scripts/oracle-lint-settings.mjs`
const CONFIGURATION = [LOCKFILE, SETTINGS]
// The configuration edits a branch can make: one part of the plugin's
// lockfile entries, with a new installed plugin (its version in all three
// entries, its integrity, or one resolved dependency of its snapshot);
// another package's lockfile entries; or the settings module.
const PLUGIN_EDITS = [`plugin-version`, `plugin-integrity`, `plugin-dependency`]
const LOCKFILE_EDIT = `lockfile`
const SETTINGS_EDIT = `settings`
const isPluginEdit = (edit) => PLUGIN_EDITS.includes(edit)
const fileOfEdit = (edit) => (edit === SETTINGS_EDIT ? SETTINGS : LOCKFILE)
// The installed plugin's rule that reports the generated files.
const PLUGIN = join(`node_modules`, `@tanstack`, `eslint-plugin-oracles`)
const RULE_SOURCE = join(PLUGIN, `src`, `rules`, `no-unit-test.js`)
// The plugin's `exports` target for its main entry.
const PLUGIN_ENTRY = join(PLUGIN, `src`, `index.js`)
// The ways that an install can leave the plugin's directory in place but
// unloadable: its entry file is gone, the rule module that the script imports
// by subpath is gone, it imports a package that is not installed, or its entry
// file is cut off mid-module. The first three are a partial install; the last
// is a broken file, which is not a missing install.
const PARTIAL_INSTALLS = [`no-entry`, `no-rule`, `no-dependency`]
const CORRUPT_INSTALL = `corrupt`
const BROKEN_INSTALLS = [...PARTIAL_INSTALLS, CORRUPT_INSTALL]
// A package that no checkout installs.
const ABSENT_PACKAGE = `oracle-lint-absent-package`
// The failures that end in one line: an unknown format or event, a hook input
// that is not a JSON object, a checkout with no `main`, and an error that the
// rule throws while it lints.
const FAULTS = [
  `unknown-format`,
  `unknown-event`,
  `invalid-input`,
  `no-main`,
  `lint-error`,
]
const UNKNOWN_FORMATS = [`cursor`, ``, `Claude`]
const UNKNOWN_EVENTS = [`commit`, ``, `Stop`]
const INVALID_INPUTS = [`{`, `not json`, `null`, `[]`, `3`]
const valueOf = (values, program) => values[program.faultValue % values.length]

// -- 1. Grammar ---------------------------------------------------------------
//
// Every module is a node. An oracle file imports supports, drivers, other
// oracle files, and production. A support module imports other supports and
// production. A driver imports supports. Production imports nothing. Each
// target is an index taken modulo the modules the kind may reach, so every draw
// is a legal edge. A star re-export is an import whose names the module passes
// on. An edit adds a line to a module, so its text differs from the base
// commit. An untracked oracle file exists only in the working tree, so nothing
// imports it. The edit hook names one module, or a lint configuration file.

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

const skeletonArbitrary = fc.record({
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
  // The lint configuration edit that the branch makes, if any.
  ruleEdited: fc.oneof(
    { weight: 5, arbitrary: fc.constant(false) },
    ...PLUGIN_EDITS.map((edit) => ({
      weight: 1,
      arbitrary: fc.constant(edit),
    })),
    { weight: 1, arbitrary: fc.constant(LOCKFILE_EDIT) },
    { weight: 1, arbitrary: fc.constant(SETTINGS_EDIT) },
  ),
  // The edit hook names a module of this kind, or a configuration file.
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
  // The lockfile: small, or larger than the 1 MiB that a child process's
  // output buffer holds by default; and whether the base commit has one. A
  // missing base lockfile is one the branch adds. Drawn last, so the fields
  // above keep their draws.
  lockfile: fc.record({
    size: fc.oneof(
      { weight: 3, arbitrary: fc.constant(`small`) },
      { weight: 1, arbitrary: fc.constant(`large`) },
    ),
    base: fc.oneof(
      { weight: 4, arbitrary: fc.constant(`present`) },
      { weight: 1, arbitrary: fc.constant(`missing`) },
    ),
  }),
  // Whether the checkouts have their dependencies installed: fully, not at
  // all, or with the session checkout's plugin broken. Drawn last, so the
  // fields above keep their draws.
  dependencies: fc.oneof(
    { weight: 30, arbitrary: fc.constant(`installed`) },
    { weight: 1, arbitrary: fc.constant(`missing`) },
    ...BROKEN_INSTALLS.map((kind) => ({
      weight: 1,
      arbitrary: fc.constant(kind),
    })),
  ),
  // Whether a worktree session has its own copy of the plugin, or none, so
  // that it resolves the launch checkout's by walking up. Drawn last, so the
  // fields above keep their draws.
  worktreeInstall: fc.oneof(
    { weight: 3, arbitrary: fc.constant(`own`) },
    { weight: 1, arbitrary: fc.constant(`none`) },
  ),
  // A failure that the run must report in one line, if any, and which of the
  // failure's values it uses. Drawn last, so the fields above keep their
  // draws.
  fault: fc.oneof(
    { weight: 40, arbitrary: fc.constant(`none`) },
    ...FAULTS.map((fault) => ({ weight: 1, arbitrary: fc.constant(fault) })),
  ),
  faultValue: fc.nat({ max: 5 }),
})

function programOf({ shape, ...skeleton }) {
  const drawn =
    skeleton.hookKind === `driver`
      ? { ...skeleton, driver: { ...skeleton.driver, present: true } }
      : skeleton
  return buildProgram(shapes[shape](drawn))
}

/**
 * Constructed histories. The declared states below can be missed by 28 random
 * draws: each configuration edit, a lockfile hook with unchanged plugin entries,
 * an unrelated edit of a large lockfile, a base without a lockfile, a
 * production hook whose edited production module is reached by an oracle, a
 * re-export that decides the selection, and each missing or broken install.
 * Every campaign first runs one generated skeleton per state,
 * fixing the fields that enter it. The skeletons come from the campaign's seed,
 * so they are members of the grammar and vary with the seed.
 */
const installedConstructions = [
  ...[...PLUGIN_EDITS, LOCKFILE_EDIT, SETTINGS_EDIT].map(
    (edit) => (skeleton) => ({ ...skeleton, ruleEdited: edit }),
  ),
  (skeleton) => ({
    ...skeleton,
    shape: `free`,
    ruleEdited: false,
    hookKind: `rule`,
    hookIndex: CONFIGURATION.indexOf(LOCKFILE),
    lockfile: { ...skeleton.lockfile, base: `present` },
  }),
  (skeleton) => ({
    ...skeleton,
    ruleEdited: LOCKFILE_EDIT,
    lockfile: { size: `large`, base: `present` },
  }),
  (skeleton) => ({
    ...skeleton,
    lockfile: { ...skeleton.lockfile, base: `missing` },
  }),
  (skeleton) => ({
    ...skeleton,
    shape: `free`,
    hookKind: `production`,
    production: { ...skeleton.production, edited: true },
    oracles: skeleton.oracles.map((oracle, index) =>
      index === 0 ? { ...oracle, fixedTargets: [PRODUCTION] } : oracle,
    ),
  }),
  // A re-export chain decides the selection only when no configuration edit
  // selects every oracle file, and a third of the generated histories carry
  // one, so random draws can miss it.
  (skeleton) => ({
    ...skeleton,
    shape: `re-export chain`,
    ruleEdited: false,
    lockfile: { ...skeleton.lockfile, base: `present` },
  }),
]

// The states above need an install to be observed. A missing install is
// drawn in each kind of session, and each broken install in the session that
// the skeleton draws.
const constructions = [
  ...installedConstructions.map((build) => (skeleton) => ({
    ...build(skeleton),
    dependencies: `installed`,
    fault: `none`,
  })),
  ...[`launch`, `worktree`].map((session) => (skeleton) => ({
    ...skeleton,
    session,
    dependencies: `missing`,
  })),
  ...BROKEN_INSTALLS.map((kind) => (skeleton) => ({
    ...skeleton,
    dependencies: kind,
  })),
  (skeleton) => ({
    ...skeleton,
    session: `worktree`,
    dependencies: `installed`,
    worktreeInstall: `none`,
    fault: `none`,
  }),
  ...FAULTS.map((fault) => (skeleton) => ({
    ...skeleton,
    dependencies: `installed`,
    worktreeInstall: `own`,
    fault,
  })),
]

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
  // An installed launch checkout under a worktree that has no install of its
  // own. A launch session has no outer checkout, and a missing or broken
  // install is drawn only in the session checkout.
  const outerInstall =
    skeleton.session === `worktree` &&
    skeleton.dependencies === `installed` &&
    skeleton.worktreeInstall === `none`
  const hookTarget =
    skeleton.hookName ??
    (ofKind.length === 0
      ? CONFIGURATION[skeleton.hookIndex % CONFIGURATION.length]
      : ofKind[skeleton.hookIndex % ofKind.length].name)
  return {
    oracles,
    supports,
    driver,
    production,
    ruleEdited: skeleton.ruleEdited,
    session: skeleton.session,
    scratch: skeleton.scratch,
    lockfile: skeleton.lockfile,
    dependencies: skeleton.dependencies,
    outerInstall,
    // A failure is drawn only with the session checkout's own full install.
    fault:
      skeleton.dependencies === `installed` && !outerInstall
        ? skeleton.fault
        : `none`,
    faultValue: skeleton.faultValue,
    edges,
    reexports,
    modules,
    hookTarget,
  }
}

/**
 * The files that each scope treats as edited. The changed scope sees every
 * edited tracked module and every untracked file, including a lockfile that
 * the base commit lacks. The named scope, which the
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
  const rule = program.ruleEdited ? [fileOfEdit(program.ruleEdited)] : []
  const added = program.lockfile.base === `missing` ? [LOCKFILE] : []
  return {
    changed: [...tracked, ...untracked, ...added, ...rule],
    named: [...tracked, ...rule],
    hook: [program.hookTarget],
    // The stop hook lints the changed files of the session's checkout.
    stop: [...tracked, ...untracked, ...added, ...rule],
  }
}

// -- 2. Model -----------------------------------------------------------------
//
// The model reads only the graph. It grows the set of affected modules to a
// fixed point: an edited test module is affected, and so is every module with
// an edge into an affected module. Production is never affected, because the
// rule never reads it, so an edge into production carries nothing. The oracle
// files in the affected set are the ones to lint. When the edited files
// include the settings module, or the lockfile of a branch that changed the
// plugin's entries, every oracle file must be linted. A lockfile that the
// branch adds, where the base commit had none, changes them too: the base has
// no plugin entries. The model knows which edit the branch drew; it does not
// read the lockfile, so its size cannot matter to it. A lockfile that the
// branch left alone, or edited only for another package, is like production:
// no test module imports it, so it affects nothing.

/** The oracle files that a lint of `edited` must cover, as sorted basenames. */
function predictSelected(program, edited) {
  if (
    edited.includes(SETTINGS) ||
    (edited.includes(LOCKFILE) &&
      (isPluginEdit(program.ruleEdited) || program.lockfile.base === `missing`))
  )
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

// Each checkout is linted by its own installed copy of the rule. The driver
// marks the message of the copy that a branch's lockfile edit installs, and
// only that copy, so a report carries the mark exactly when the session
// checkout's branch changed the plugin. The launch checkout's copy is unmarked
// in a worktree session, so a report that the launch checkout's rule makes for
// a worktree carries no mark. A settings edit installs nothing.
//
// A worktree with no install of its own has no copy to mark: the branch's
// lockfile edit installed nothing there, and the launch checkout's rule
// lints it (maintainer decision, 2026-11-11). Every form then names where
// that plugin is: the launch checkout's `node_modules`, outside the session
// checkout. No other history names a location.

/** Whether the session checkout's reports carry the edited rule's mark. */
function predictRuleMarked(program) {
  return isPluginEdit(program.ruleEdited) && !program.outerInstall
}

const NOTICE_PREFIX = `oracle lint used the plugin installed at `
const NOTICE_LINE = `${NOTICE_PREFIX}<launch>/${PLUGIN}, outside <checkout>`

/** The lines that name an outer plugin's location, in each form's response. */
function predictNotices(program) {
  return program.outerInstall ? [NOTICE_LINE] : []
}

// Without a full install, no form lints, and none crashes. A missing or
// partial install owes the skip line, which names the session checkout (the
// driver writes it as `<checkout>`) and says how to install. A broken file in
// an installed package is not a missing install, so it owes a failure line
// that carries the error's message, which the driver writes as `<message>`.
// A command-line run writes the line to stderr and exits nonzero, so CI
// fails. A hook exits 0 and writes nothing to stderr; it hands the line to the
// agent on the channel that its harness reads for an exit-0 hook, the one
// that already carries Gemini's and Copilot's lint reports. After an edit,
// the line is context beside the tool result. At a stop, it asks for one more
// turn, as a report does, so the agent learns that nothing was linted.
//
// The channels are the harnesses' hook contracts, read from their
// documentation: Claude Code and Codex read `hookSpecificOutput` with
// `hookEventName: 'PostToolUse'` and `additionalContext` after a tool, and
// `decision: 'block'` with a `reason` at a stop. Gemini CLI reads
// `hookSpecificOutput` with `hookEventName: 'AfterTool'` after a tool, and
// `decision: 'deny'` at the end of a turn. Copilot reads `additionalContext`
// after a tool and `decision: 'block'` at a stop.

const SKIP_LINE = `oracle lint skipped: dependencies are not installed in <checkout>; run pnpm install`
const FAILURE_PREFIX = `oracle lint failed: `
const FAILURE_LINE = `${FAILURE_PREFIX}<message>`
const HOOK_FORMATS = [`claude`, `codex`, `gemini`, `copilot`]
const HOOK_EVENTS = [`edit`, `stop`]

/** The JSON that hands `text` to the agent in a harness, for an exit-0 hook. */
function agentChannel(format, event, text) {
  if (event === `stop`)
    return { decision: format === `gemini` ? `deny` : `block`, reason: text }
  if (format === `copilot`) return { additionalContext: text }
  return {
    hookSpecificOutput: {
      hookEventName: format === `gemini` ? `AfterTool` : `PostToolUse`,
      additionalContext: text,
    },
  }
}

// A run that lints nothing answers as a clean run: exit 0 and no output, but
// Codex reads JSON from a stop hook that exits 0, so it gets `{}`.
const CLEAN = { exit: `zero`, stdout: ``, stderr: [] }
const cleanRun = (format, event) =>
  format === `codex` && event === `stop` ? { ...CLEAN, stdout: {} } : CLEAN
const CLI_FAILURE = { exit: `nonzero`, stdout: ``, stderr: [FAILURE_LINE] }
const hookFailure = (format, event) => ({
  exit: `zero`,
  stdout: agentChannel(format, event, FAILURE_LINE),
  stderr: [],
})

/** The skip that each form owes, by the form's name. */
function predictSkips(program) {
  const line =
    program.dependencies === CORRUPT_INSTALL ? FAILURE_LINE : SKIP_LINE
  const cli = { exit: `nonzero`, stdout: ``, stderr: [line] }
  // The run-budget report needs only the parser, so a broken plugin leaves
  // it clean.
  const skips = {
    changed: cli,
    all: cli,
    'run-budgets': program.dependencies === `missing` ? cli : CLEAN,
  }
  if (editedByScope(program).named.length > 0) skips.named = cli
  for (const format of HOOK_FORMATS) {
    for (const event of HOOK_EVENTS) {
      skips[`${format}-${event}`] = {
        exit: `zero`,
        stdout: agentChannel(format, event, line),
        stderr: [],
      }
    }
  }
  return skips
}

// A failure owes one line in each form that it reaches. An unknown format
// leaves no harness to answer through, so the run answers on the command
// line. An unknown event in a harness's format answers on its edit channel.
// A hook input that is not a JSON object fails both hook events. Without
// `main`, the forms that always compare with the merge-base fail. A rule that
// throws fails each form that lints a file, which is each form whose
// selection is not empty; `--all` lints every oracle file, so it always
// fails, and the run-budget report runs no rule.

/** The run that each failure owes, by the form's name. */
function predictFaults(program) {
  const runs = {}
  const { fault } = program
  if (fault === `unknown-format`)
    for (const event of HOOK_EVENTS) runs[`unknown-${event}`] = CLI_FAILURE
  if (fault === `unknown-event`) {
    runs.text = CLI_FAILURE
    for (const format of HOOK_FORMATS)
      runs[format] = hookFailure(format, `edit`)
  }
  for (const format of HOOK_FORMATS) {
    for (const event of HOOK_EVENTS) {
      if (fault === `invalid-input`)
        runs[`${format}-${event}`] = hookFailure(format, event)
    }
  }
  if (fault === `no-main`) {
    runs.changed = CLI_FAILURE
    runs[`run-budgets`] = CLI_FAILURE
    for (const format of HOOK_FORMATS)
      runs[`${format}-stop`] = hookFailure(format, `stop`)
  }
  if (fault === `lint-error`) {
    const scopes = editedByScope(program)
    const lints = (edited) => predictSelected(program, edited).length > 0
    runs.changed = lints(scopes.changed) ? CLI_FAILURE : CLEAN
    runs.all = CLI_FAILURE
    runs[`run-budgets`] = CLEAN
    if (scopes.named.length > 0)
      runs.named = lints(scopes.named) ? CLI_FAILURE : CLEAN
    for (const format of HOOK_FORMATS) {
      for (const event of HOOK_EVENTS) {
        runs[`${format}-${event}`] = lints(
          event === `edit` ? scopes.hook : scopes.stop,
        )
          ? hookFailure(format, event)
          : cleanRun(format, event)
      }
    }
  }
  return runs
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
// The start of the rule's `create`, where a lint error is thrown.
const RULE_CREATE = `create(context) {`

// Packages that nothing depends on, which make a large lockfile larger than
// the 1 MiB default output buffer of a child process (about 1.2 MiB).
const PADDING = Array.from(
  { length: 10_000 },
  (_, index) =>
    `  pad-${index}@1.0.0:\n    resolution: {integrity: sha512-${`p`.repeat(88)}}\n`,
).join(`\n`)

/**
 * A pnpm v9 lockfile that pins the plugin and one unrelated package. The
 * plugin has entries in the importers, packages, and snapshots sections, and
 * its snapshot lists one resolved dependency. A plugin edit changes one of
 * `plugin`'s parts; an unrelated edit changes `other`, which nothing else
 * depends on. A large lockfile also holds the padding packages.
 */
function lockfileText({ plugin = {}, other = `1.0.0`, size = `small` } = {}) {
  const {
    version = `1.0.0`,
    integrity = `sha512-plugin`,
    dependency = `8.0.0`,
  } = plugin
  const name = `@tanstack/eslint-plugin-oracles`
  return [
    `lockfileVersion: '9.0'`,
    ``,
    `importers:`,
    ``,
    `  .:`,
    `    devDependencies:`,
    `      '${name}':`,
    `        specifier: ${version}`,
    `        version: ${version}`,
    `      left-pad:`,
    `        specifier: ${other}`,
    `        version: ${other}`,
    ``,
    `packages:`,
    ``,
    `  '${name}@${version}':`,
    `    resolution: {integrity: ${integrity}}`,
    ``,
    `  left-pad@${other}:`,
    `    resolution: {integrity: sha512-left-pad-${other}}`,
    ``,
    ...(size === `large` ? [PADDING] : []),
    `snapshots:`,
    ``,
    `  '${name}@${version}':`,
    `    dependencies:`,
    `      '@typescript-eslint/utils': ${dependency}`,
    ``,
    `  left-pad@${other}: {}`,
    ``,
  ].join(`\n`)
}

/** The edited lockfile for a configuration edit. */
function editedLockfile(program) {
  const { size } = program.lockfile
  if (program.ruleEdited === LOCKFILE_EDIT)
    return lockfileText({ other: `1.0.1`, size })
  const plugin = {
    'plugin-version': { version: `1.0.1` },
    'plugin-integrity': { integrity: `sha512-plugin-rebuilt` },
    'plugin-dependency': { dependency: `8.0.1` },
  }[program.ruleEdited]
  return lockfileText({ plugin, size })
}

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
let pluginPackage
let settingsFile
let feedbackScript
let runCountScript
let loadFailureModule
let gitignoreFile

beforeAll(() => {
  // Each run has its own directory, so concurrent runs cannot remove each
  // other's repositories. The real path keeps the file names that the driver
  // passes in the spelling that the script's repository root uses.
  work = realpathSync(mkdtempSync(join(tmpdir(), `lint-scope-oracle-`)))
  pluginPackage = realpathSync(join(repoRoot, PLUGIN))
  settingsFile = join(repoRoot, SETTINGS)
  // A mutant is run from a copy: LINT_SCOPE_SCRIPT names the copy of the
  // script under test, and LINT_SCOPE_GITIGNORE the copy of `.gitignore`.
  feedbackScript =
    process.env.LINT_SCOPE_SCRIPT ??
    join(repoRoot, `scripts`, `agent-lint-feedback.mjs`)
  runCountScript = join(repoRoot, `scripts`, `check-oracle-run-counts.mjs`)
  loadFailureModule = join(repoRoot, `scripts`, `lint-load-failure.mjs`)
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

/**
 * Installs the repository's dependencies in a launch checkout: a link to each
 * package, and a copy of the oracle lint plugin, which the checkout owns.
 */
function installDependencies(checkout) {
  const modules = join(repoRoot, `node_modules`)
  mkdirSync(join(checkout, `node_modules`, `@tanstack`), { recursive: true })
  for (const entry of readdirSync(modules)) {
    if (entry !== `@tanstack`)
      symlinkSync(join(modules, entry), join(checkout, `node_modules`, entry))
  }
  for (const entry of readdirSync(join(modules, `@tanstack`))) {
    if (entry !== `eslint-plugin-oracles`)
      symlinkSync(
        join(modules, `@tanstack`, entry),
        join(checkout, `node_modules`, `@tanstack`, entry),
      )
  }
  installPlugin(checkout)
}

/** Copies the installed plugin's sources into a checkout's node_modules. */
function installPlugin(checkout) {
  cpSync(pluginPackage, join(checkout, PLUGIN), {
    recursive: true,
    filter: (source) => !source.includes(`${pluginPackage}/node_modules`),
  })
}

/** Whether Node resolves a package from a checkout's root. */
function resolvesFrom(checkout, specifier) {
  try {
    createRequire(join(checkout, `package.json`)).resolve(specifier)
    return true
  } catch {
    return false
  }
}

/** Leaves a checkout's installed plugin in place but unloadable. */
function breakPlugin(checkout, kind) {
  const entry = join(checkout, PLUGIN_ENTRY)
  if (kind === `no-entry`) rmSync(entry)
  else if (kind === `no-rule`) rmSync(join(checkout, RULE_SOURCE))
  else if (kind === `no-dependency`) {
    if (resolvesFrom(checkout, ABSENT_PACKAGE))
      throw new Error(`the temporary checkout resolves ${ABSENT_PACKAGE}`)
    writeFileSync(
      entry,
      `import '${ABSENT_PACKAGE}'\n${readFileSync(entry, `utf8`)}`,
    )
  } else writeFileSync(entry, `export default {\n`)
}

/** The path of a module in a checkout. */
function modulePath(checkout, name) {
  if (CONFIGURATION.includes(name)) return join(checkout, name)
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
  // A checkout without `main` names its first branch otherwise.
  gitIn(
    launch,
    `init`,
    `-q`,
    `-b`,
    program.fault === `no-main` ? `trunk` : `main`,
  )
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
  // The lint configuration: the settings module and a lockfile.
  mkdirSync(join(launch, `scripts`), { recursive: true })
  writeFileSync(join(launch, SETTINGS), readFileSync(settingsFile, `utf8`))
  if (program.lockfile.base === `present`)
    writeFileSync(
      join(launch, LOCKFILE),
      lockfileText({ size: program.lockfile.size }),
    )
  writeFileSync(
    join(launch, `scripts`, `agent-lint-feedback.mjs`),
    readFileSync(feedbackScript, `utf8`),
  )
  writeFileSync(
    join(launch, `scripts`, `check-oracle-run-counts.mjs`),
    readFileSync(runCountScript, `utf8`),
  )
  writeFileSync(
    join(launch, `scripts`, `lint-load-failure.mjs`),
    readFileSync(loadFailureModule, `utf8`),
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
  // up from its own files. Each checkout has its own installed plugin, unless
  // the worktree draws none. A missing install leaves both checkouts without
  // packages; a broken install breaks the session checkout's plugin after the
  // install.
  const missing = program.dependencies === `missing`
  if (!missing) installDependencies(launch)
  let checkout = launch
  if (program.session === `worktree`) {
    gitIn(launch, `worktree`, `add`, `-q`, `-b`, `feature`, WORKTREE)
    checkout = join(launch, WORKTREE)
    if (!missing && !program.outerInstall) installPlugin(checkout)
  }
  if (missing && resolvesFrom(checkout, `eslint`))
    throw new Error(
      `the temporary checkout ${checkout} resolves eslint from an ancestor directory, so it cannot draw a missing install`,
    )
  if (BROKEN_INSTALLS.includes(program.dependencies))
    breakPlugin(checkout, program.dependencies)
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
  if (program.ruleEdited === SETTINGS_EDIT) {
    // A settings edit adds a line to the module.
    const edited = modulePath(checkout, SETTINGS)
    writeFileSync(edited, `${readFileSync(edited, `utf8`)}// edited\n`)
  } else if (program.ruleEdited) {
    writeFileSync(modulePath(checkout, LOCKFILE), editedLockfile(program))
  }
  if (
    program.lockfile.base === `missing` &&
    !existsSync(join(checkout, LOCKFILE))
  )
    // The branch adds the lockfile that the base commit lacks.
    writeFileSync(
      join(checkout, LOCKFILE),
      lockfileText({ size: program.lockfile.size }),
    )
  if (
    program.dependencies === `installed` &&
    isPluginEdit(program.ruleEdited) &&
    !program.outerInstall
  ) {
    // The new lockfile installs a changed plugin in the session checkout.
    const rule = join(checkout, RULE_SOURCE)
    const text = readFileSync(rule, `utf8`)
    if (!text.includes(RULE_MESSAGE))
      throw new Error(`the rule no longer has the message ${RULE_MESSAGE}`)
    writeFileSync(
      rule,
      text.replace(RULE_MESSAGE, `${RULE_MESSAGE} ${RULE_MARK}`),
    )
  }
  if (program.fault === `lint-error`) {
    // The session checkout's rule throws on every file that it lints.
    const rule = join(checkout, RULE_SOURCE)
    const text = readFileSync(rule, `utf8`)
    if (!text.includes(RULE_CREATE))
      throw new Error(`the rule no longer has ${RULE_CREATE}`)
    writeFileSync(
      rule,
      text.replace(
        RULE_CREATE,
        `${RULE_CREATE}\n    throw new Error('the rule crashed')`,
      ),
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
 * Runs a copy of the CLI from `cwd` and returns what it reported, with the
 * lines that name a plugin's location as `notices`, the checkouts' paths
 * written as in `runRaw`. In text format the CLI exits 0 with no report, or 1
 * with report lines on stderr. As a Claude hook it exits 0 with no output, or
 * 2 with a report on stderr. A notice can join either: on stderr, or, from a
 * hook with no report, as the exit-0 JSON that hands it to the agent. Anything
 * else, such as a crash, which exits 1 with a stack trace, fails.
 */
function runCli(cwd, script, args, input, { launch, checkout }) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: `utf8`,
    input,
  })
  const named = (line) =>
    line.split(checkout).join(`<checkout>`).split(launch).join(`<launch>`)
  const isNotice = (line) => line.startsWith(NOTICE_PREFIX)
  const all = result.stderr.split(`\n`).filter(Boolean)
  const lines = all.filter((line) => !isNotice(line))
  const notices = all.filter(isNotice)
  const hook = args.includes(`--format=claude`)
  const reported = hook ? 2 : 1
  let { stdout } = result
  if (hook && result.status === 0 && stdout !== ``) {
    // A hook that has only a notice hands it to the agent on its channel.
    const event = args.includes(`--event=stop`) ? `stop` : `edit`
    const value = stdoutValue(stdout)
    const text = value?.reason ?? value?.hookSpecificOutput?.additionalContext
    if (
      typeof text === `string` &&
      JSON.stringify(value) ===
        JSON.stringify(agentChannel(`claude`, event, text)) &&
      text.split(`\n`).every(isNotice)
    ) {
      notices.push(...text.split(`\n`))
      stdout = ``
    }
  }
  const valid =
    stdout === `` &&
    (result.status === 0
      ? lines.length === 0
      : result.status === reported &&
        (hook
          ? lines[0]?.startsWith(`Oracle lint reports`)
          : lines.every(
              (line) => lintLine.test(line) || budgetLine.test(line),
            )))
  if (!valid) {
    throw new Error(
      `cli failed (exit ${result.status}):\n${result.stdout}${result.stderr}`,
    )
  }
  return { ...reportedOracles(lines), notices: notices.map(named) }
}

/**
 * Runs a copy of the CLI from `cwd` and returns its exit status, its stdout
 * as the JSON value that a harness parses (or as text), and its stderr lines, with the session checkout's path written as
 * `<checkout>` and the launch checkout's, in a worktree session, as `<launch>`.
 * A failure line's message comes from the runtime, not from the law, so the
 * driver writes it as `<message>`; the rest of the line, and the number of
 * lines, stay as observed. A missing install is judged on this raw record, so
 * a crash is a mismatch, not a thrown driver error.
 */
function runRaw(cwd, script, args, input, { launch, checkout }) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: `utf8`,
    input,
  })
  const named = (text) =>
    text.split(checkout).join(`<checkout>`).split(launch).join(`<launch>`)
  return {
    exit: result.status === 0 ? `zero` : `nonzero`,
    stdout: withoutMessages(stdoutValue(named(result.stdout))),
    stderr: withoutMessages(named(result.stderr).split(`\n`).filter(Boolean)),
  }
}

/** Stdout as the JSON value that a harness parses, or as text when it is not JSON. */
function stdoutValue(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** A value with each failure line's message written as `<message>`. */
function withoutMessages(value) {
  if (typeof value === `string`)
    return value.startsWith(FAILURE_PREFIX) ? FAILURE_LINE : value
  if (Array.isArray(value)) return value.map(withoutMessages)
  if (value !== null && typeof value === `object`)
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        withoutMessages(child),
      ]),
    )
  return value
}

/**
 * What each form does without an install: the command-line forms in the
 * session checkout, and each harness's hooks from the launch checkout.
 */
function observedSkips(program, repository) {
  const { launch, checkout, pathOf } = repository
  const own = join(checkout, `scripts`, `agent-lint-feedback.mjs`)
  const launchScript = join(launch, `scripts`, `agent-lint-feedback.mjs`)
  const named = editedByScope(program).named
  const skips = {
    changed: runRaw(checkout, own, [`--format=text`], ``, repository),
    all: runRaw(checkout, own, [`--format=text`, `--all`], ``, repository),
    'run-budgets': runBudgets(repository),
  }
  if (named.length > 0)
    skips.named = runRaw(
      checkout,
      own,
      [`--format=text`, ...named.map((name) => pathOf(name))],
      ``,
      repository,
    )
  for (const format of HOOK_FORMATS) {
    for (const event of HOOK_EVENTS) {
      const input =
        event === `edit`
          ? {
              cwd: checkout,
              tool_input: { file_path: pathOf(program.hookTarget) },
            }
          : { cwd: checkout }
      skips[`${format}-${event}`] = runRaw(
        launch,
        launchScript,
        [`--format=${format}`, `--event=${event}`],
        JSON.stringify(input),
        repository,
      )
    }
  }
  return skips
}

/** The run-budget report, as `pnpm lint:run-budgets` runs it in the checkout. */
function runBudgets(repository) {
  const { checkout } = repository
  return runRaw(
    checkout,
    join(checkout, `scripts`, `check-oracle-run-counts.mjs`),
    [],
    ``,
    repository,
  )
}

/**
 * What each form does in a failure history. The hooks run from the launch
 * checkout, as a harness runs them, and the command-line forms in the session
 * checkout. A rule that throws is observed in every form that a missing
 * install is.
 */
function observedFaults(program, repository) {
  const { launch, checkout, pathOf } = repository
  const launchScript = join(launch, `scripts`, `agent-lint-feedback.mjs`)
  const own = join(checkout, `scripts`, `agent-lint-feedback.mjs`)
  const hookInput = (event) =>
    JSON.stringify(
      event === `edit`
        ? {
            cwd: checkout,
            tool_input: { file_path: pathOf(program.hookTarget) },
          }
        : { cwd: checkout },
    )
  const hook = (format, event, input = hookInput(event)) =>
    runRaw(
      launch,
      launchScript,
      [`--format=${format}`, `--event=${event}`],
      input,
      repository,
    )
  const runs = {}
  const { fault } = program
  if (fault === `lint-error`) return observedSkips(program, repository)
  if (fault === `unknown-format`) {
    for (const event of HOOK_EVENTS)
      runs[`unknown-${event}`] = hook(valueOf(UNKNOWN_FORMATS, program), event)
  }
  if (fault === `unknown-event`) {
    for (const format of [`text`, ...HOOK_FORMATS])
      runs[format] = hook(format, valueOf(UNKNOWN_EVENTS, program))
  }
  if (fault === `invalid-input`) {
    for (const format of HOOK_FORMATS) {
      for (const event of HOOK_EVENTS)
        runs[`${format}-${event}`] = hook(
          format,
          event,
          valueOf(INVALID_INPUTS, program),
        )
    }
  }
  if (fault === `no-main`) {
    runs.changed = runRaw(checkout, own, [`--format=text`], ``, repository)
    runs[`run-budgets`] = runBudgets(repository)
    for (const format of HOOK_FORMATS)
      runs[`${format}-stop`] = hook(format, `stop`)
  }
  return runs
}

/** What each scope reports, from one repository. */
function observedSelections(program) {
  const repository = repositoryOf(program)
  const { launch, checkout, pathOf } = repository
  try {
    if (program.dependencies !== `installed`)
      return { skips: observedSkips(program, repository) }
    if (program.fault !== `none`)
      return { faults: observedFaults(program, repository) }
    const scopes = editedByScope(program)
    const own = join(checkout, `scripts`, `agent-lint-feedback.mjs`)
    const launchScript = join(launch, `scripts`, `agent-lint-feedback.mjs`)
    const changed = runCli(checkout, own, [`--format=text`], ``, repository)
    // lint-staged runs the named scope once per nonempty chunk of staged
    // files; without files the script runs its changed scope instead.
    const named =
      scopes.named.length === 0
        ? undefined
        : runCli(
            checkout,
            own,
            [`--format=text`, ...scopes.named.map((name) => pathOf(name))],
            ``,
            repository,
          )
    const hook = runCli(
      launch,
      launchScript,
      [`--format=claude`, `--event=edit`],
      JSON.stringify({
        cwd: checkout,
        tool_input: { file_path: pathOf(program.hookTarget) },
      }),
      repository,
    )
    const stop = runCli(
      launch,
      launchScript,
      [`--format=claude`, `--event=stop`],
      JSON.stringify({ cwd: checkout }),
      repository,
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
// diverged. Then its rule source must be the predicted one, and its location
// lines must equal the predicted ones: a missing line hides an outer plugin
// from the agent, and an extra one names a plugin that is the checkout's own.

/** Each observation equals the model's prediction, as sorted basenames. */
function compareSelected(observed, expected) {
  return differs(`selected files`, `lint selection`, observed, expected) ?? pass
}

/**
 * Every report line came from the session checkout's own rule: each line
 * carries the edited rule's mark exactly when the model predicts it.
 */
function compareRuleSource(marks, marked) {
  return (
    differs(
      `rule source`,
      `session rule`,
      [...marks].filter((mark) => mark !== marked),
      [],
    ) ?? pass
  )
}

/** A run names the plugin's location exactly when the model predicts it. */
function comparePluginLocation(notices, expected) {
  return differs(`plugin location`, `outer plugin`, notices, expected) ?? pass
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
//   plugin-version-edit, plugin-integrity-edit, plugin-dependency-edit: the
//     lockfile changed one part of the plugin's entries, with a new installed
//     plugin, so every oracle file is selected.
//   lockfile-edit: the lockfile changed only another package's entries, so it
//     selects nothing.
//   settings-edit: the settings module changed, so every oracle file is
//     selected.
//   hook-lockfile-same-plugin: the edit hook names the lockfile, and the
//     plugin's entries are the merge-base's, so the hook selects nothing.
//   large-lockfile-same-plugin: a lockfile larger than 1 MiB is edited or
//     named while the plugin's entries stay the merge-base's, so the base's
//     lockfile must be read whole to find that nothing changed.
//   missing-base-lockfile: the base commit has no lockfile and the branch
//     adds one, so the plugin's entries are new.
//   untracked-dependent: an untracked oracle file reaches the hook's file.
//   js-oracle: a JavaScript oracle file is selected.
//   hook-production-boundary: the production hook names an edited production
//     module that an oracle file reaches. Merely naming production is weaker.
//   hook-oracle, hook-support, hook-driver, hook-production, hook-rule: the
//     kind of file that the edit hook names; `rule` is a configuration file.
//   worktree-session: the session works in a worktree, and the hooks run the
//     launch checkout's script.
//   worktree-own-rule: the worktree's branch changed the plugin, so its reports
//     must come from its own installed copy.
//   worktree-outer-plugin: the worktree has no install of its own under an
//     installed launch checkout, so it lints with the launch checkout's plugin
//     and names its location.
//   scratch-directory: a launch session's checkout holds a scratch directory
//     under `.worktrees/`.
//   missing-dependencies-launch, missing-dependencies-worktree: the checkouts
//     have no install, and the session works in the launch checkout or in the
//     worktree, whose hooks reach its own script through the launch
//     checkout's.
//   no-entry-install, no-rule-install, no-dependency-install: the session
//     checkout's plugin directory is installed, but its entry file, its
//     subpath rule module, or a package that it imports is missing.
//   corrupt-install: the session checkout's plugin entry file is cut off.
//   unknown-format-fault, unknown-event-fault, invalid-input-fault,
//     no-main-fault, lint-error-fault: the run meets that failure.
//   Histories without a full install, or with a failure, enter no other
//   state.

const STATES = [
  `direct-dependent`,
  `transitive-dependent`,
  `re-export-dependent`,
  `oracle-dependent`,
  `oracle-edit`,
  `unrelated-edit`,
  `production-boundary`,
  `plugin-version-edit`,
  `plugin-integrity-edit`,
  `plugin-dependency-edit`,
  `lockfile-edit`,
  `settings-edit`,
  `hook-lockfile-same-plugin`,
  `large-lockfile-same-plugin`,
  `missing-base-lockfile`,
  `untracked-dependent`,
  `js-oracle`,
  `hook-oracle`,
  `hook-support`,
  `hook-driver`,
  `hook-production`,
  `hook-production-boundary`,
  `hook-rule`,
  `worktree-session`,
  `worktree-own-rule`,
  `worktree-outer-plugin`,
  `scratch-directory`,
  `missing-dependencies-launch`,
  `missing-dependencies-worktree`,
  ...BROKEN_INSTALLS.map((kind) => `${kind}-install`),
  ...FAULTS.map((fault) => `${fault}-fault`),
]
const counts = new Map(STATES.map((state) => [state, 0]))

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
function recordStates(program, observe) {
  const states = new Set()
  if (program.dependencies !== `installed`) {
    states.add(
      program.dependencies === `missing`
        ? `missing-dependencies-${program.session}`
        : `${program.dependencies}-install`,
    )
    countStates(states, observe)
    return
  }
  if (program.fault !== `none`) {
    states.add(`${program.fault}-fault`)
    countStates(states, observe)
    return
  }
  const { changed, hook } = editedByScope(program)
  const edited = new Set(changed)
  if (program.ruleEdited) states.add(`${program.ruleEdited}-edit`)
  const basePresent = program.lockfile.base === `present`
  const samePlugin = basePresent && !isPluginEdit(program.ruleEdited)
  if (program.hookTarget === LOCKFILE && samePlugin)
    states.add(`hook-lockfile-same-plugin`)
  if (
    program.lockfile.size === `large` &&
    samePlugin &&
    (program.ruleEdited === LOCKFILE_EDIT || program.hookTarget === LOCKFILE)
  )
    states.add(`large-lockfile-same-plugin`)
  if (!basePresent) states.add(`missing-base-lockfile`)
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
  if (target?.kind === `production` && states.has(`production-boundary`))
    states.add(`hook-production-boundary`)
  if (program.session === `worktree`) {
    states.add(`worktree-session`)
    if (program.outerInstall) states.add(`worktree-outer-plugin`)
    else if (isPluginEdit(program.ruleEdited)) states.add(`worktree-own-rule`)
  } else if (program.scratch) {
    states.add(`scratch-directory`)
  }
  countStates(states, observe)
}

/** Observes each entered state, and counts it outside the determinism run. */
function countStates(states, observe) {
  for (const state of states) {
    observe(`reach`, state)
    if (!expect.getState().currentTestName.endsWith(`determinism`))
      counts.set(state, counts.get(state) + 1)
  }
}

// Native constructions preserve the original configuration and production-hook
// prefixes, drawing their varying fields from this campaign's skeleton source.
// Original generated prefixes may add this one explicit production edge. Keep
// random generation and shrinking unchanged while recognizing that existing
// finite prefix in the native constructor-membership check.
class SkeletonWithProductionPrefix extends fc.Arbitrary {
  generate(...args) {
    return skeletonArbitrary.generate(...args)
  }
  shrink(...args) {
    return skeletonArbitrary.shrink(...args)
  }
  canShrinkWithoutContext(skeleton) {
    if (skeletonArbitrary.canShrinkWithoutContext(skeleton)) return true
    if (skeleton?.shape !== `free` || !Array.isArray(skeleton.oracles))
      return false
    const oracles = skeleton.oracles.map((oracle, index) => {
      if (oracle.fixedTargets === undefined) return oracle
      if (
        index !== 0 ||
        oracle.fixedTargets.length !== 1 ||
        oracle.fixedTargets[0] !== PRODUCTION
      )
        return oracle
      const { fixedTargets, ...generated } = oracle
      return generated
    })
    return skeletonArbitrary.canShrinkWithoutContext({ ...skeleton, oracles })
  }
}

const constructedStates = [
  ...PLUGIN_EDITS.map((edit) => `${edit}-edit`),
  `lockfile-edit`,
  `settings-edit`,
  `hook-lockfile-same-plugin`,
  `large-lockfile-same-plugin`,
  `missing-base-lockfile`,
  `hook-production-boundary`,
  `re-export-dependent`,
  `missing-dependencies-launch`,
  `missing-dependencies-worktree`,
  ...BROKEN_INSTALLS.map((kind) => `${kind}-install`),
  `worktree-outer-plugin`,
  ...FAULTS.map((fault) => `${fault}-fault`),
]

oracleProperty({
  id: PROPERTY,
  law: {
    statement: `Every oracle whose lint judgment can change is selected, and each report uses the session checkout's installed rule, or, for a worktree with no install of its own, the launch checkout's rule with one line that names its location. Without a full install, every form produces one line that names the checkout, or the load error, and so does each other failure: a hook exits 0 and hands it to the agent, and a command-line run writes it to stderr and exits nonzero.`,
    authority: `AGENTS.md: Lint feedback while you work and Name oracle files for discovery; maintainer issue 2280; review 2378 B1-10; maintainer decision 2026-11-10 that the hook never crashes, applied by review finding F26; maintainer decision 2026-11-11 to lint with the outer checkout's plugin and say so; the harnesses' hook output documentation.`,
    limits: `The bounded import, checkout, hook, lockfile, install, and failure language described above.`,
  },
  histories: {
    arbitrary: new SkeletonWithProductionPrefix(),
    runs: BASE_RUNS,
    fixedSeeds: [FIXED_SEED],
    states: constructedStates,
    measured: STATES.filter((state) => !constructedStates.includes(state)),
    constructed: constructions.map((build, index) => ({
      name: constructedStates[index],
      enters: [constructedStates[index]],
      build,
    })),
  },
  resolve: programOf,
  model: (program) => {
    if (program.dependencies !== `installed`)
      return { skips: predictSkips(program) }
    if (program.fault !== `none`) return { faults: predictFaults(program) }
    const scopes = editedByScope(program)
    return {
      marked: predictRuleMarked(program),
      notices: predictNotices(program),
      selections: Object.fromEntries(
        [`changed`, `named`, `hook`, `stop`].map((scope) => [
          scope,
          predictSelected(program, scopes[scope]),
        ]),
      ),
    }
  },
  driver: async (program, observe) => {
    await setImmediate()
    recordStates(program, observe)
    const observed = observedSelections(program)
    observe(
      `completed selections`,
      Object.fromEntries(
        Object.entries(observed).map(([scope, value]) => [
          scope,
          // A skip or failure record is plain data; a selection's marks are
          // a set.
          value === undefined || scope === `skips` || scope === `faults`
            ? value
            : { ...value, marks: [...value.marks] },
        ]),
      ),
    )
  },
  check: (_program, trace, expected) => {
    const observed = trace.find(
      ({ checkpoint }) => checkpoint === `completed selections`,
    )?.value
    if (expected.skips !== undefined)
      return (
        differs(
          `completed selections`,
          `missing install`,
          observed?.skips,
          expected.skips,
        ) ?? pass
      )
    if (expected.faults !== undefined)
      return (
        differs(
          `completed selections`,
          `one failure line`,
          observed?.faults,
          expected.faults,
        ) ?? pass
      )
    if (observed === undefined)
      return differs(
        `completed selections`,
        `lint selection`,
        observed,
        expected.selections,
      )
    for (const scope of [`changed`, `named`, `hook`, `stop`]) {
      if (observed[scope] === undefined) continue
      const selection = compareSelected(
        observed[scope].oracles,
        expected.selections[scope],
      )
      if (selection.kind !== `pass`) return selection
      const source = compareRuleSource(observed[scope].marks, expected.marked)
      if (source.kind !== `pass`) return source
      const location = comparePluginLocation(
        observed[scope].notices,
        expected.notices,
      )
      if (location.kind !== `pass`) return location
    }
    return pass
  },
  timeout: 1_200_000,
})

// Keep the original aggregate reach minimum for the remaining graph states;
// the native per-campaign constructor checks additionally enforce their prefixes.
afterAll(() => {
  if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT)
    console.log(`REACH`, JSON.stringify([...counts]))
  if (!oracleReplayRequested())
    expect([...counts].filter(([, count]) => count < 2)).toEqual([])
})
