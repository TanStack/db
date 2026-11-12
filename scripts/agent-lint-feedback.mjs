#!/usr/bin/env node
/**
 * Returns oracle lint reports to a coding agent while it works.
 *
 * AGENTS.md forbids the shortcuts that make an oracle pass without enforcing
 * its law. Prose did not stop them, because nothing made a shortcut visible
 * while the agent was still working. Each agent harness can run a command
 * after an edit and at the end of a turn, and can return the command's output
 * to the model. This script is that command for every harness: a thin
 * adapter per harness reads its hook input and writes its response format.
 *
 *   --format=claude|codex|gemini|copilot   the harness that runs the hook
 *   --event=edit   after an edit: lint the edited files' oracle files, and the
 *                  oracle files that reach them through test-module imports
 *   --event=stop   at the end of a turn: lint every file the branch changed
 *   --format=text  print the reports and exit 1: `pnpm lint:changed` lints
 *                  the changed files, `pnpm lint:oracles` (`--all`) every
 *                  oracle file, and the pre-commit hook the staged files it
 *                  passes as arguments
 *
 * Every mode runs only the `oracle/` rules, and ignores inline directives.
 * The rules have no inline exception, and ESLint cannot protect one rule from
 * an `eslint-disable` comment, so this pass is where they are enforced. The
 * root ESLint config also runs them, so editors show them, but a directive can
 * silence them there. The rules need no type information, so a typical file
 * takes tens of milliseconds, and the largest about a second. The repository
 * config builds a TypeScript program and takes several seconds per file,
 * which is too slow for every edit; `pnpm lint`, the pre-commit hook, and CI
 * run it.
 *
 * An edit hook sees only the harness's own edit tools. An edit made through a
 * shell command reaches the model at the end of the turn, when the stop hook
 * lints every changed file. When a harness's hook input names no file that
 * this script can find, the edit hook lints every changed file as well.
 *
 * A hook lints the checkout that the agent works in, which the hook input's
 * `cwd` names. A harness can run this script from the checkout where the
 * session started while the agent works in a worktree under `.worktrees/`.
 * When `cwd` is in another checkout that has its own copy of this script, that
 * copy runs instead, so a branch is linted by its own rule, as CI lints it.
 * Without `cwd`, the checkout is the one that holds this script.
 *
 * A worktree with no `node_modules` of its own resolves its packages by
 * walking up to an outer checkout's, so the outer checkout's plugin lints it.
 * The maintainer accepted that on 2026-11-11, so every form says so: one line
 * names the plugin's package directory and the checkout that it is outside.
 * The line alone fails no command-line run and blocks no stop. A hook hands
 * it to the agent with its report, or alone after an edit.
 *
 * The lint needs the checkout's installed dependencies, which a fresh worktree
 * does not have. This script loads them with dynamic imports and catches a
 * failure, so it never crashes on a missing or partial install: it reports one
 * line that names the checkout and says to run `pnpm install`, or, for another
 * load error, one line with its message. A hook hands the line to the agent and
 * exits 0. A command-line run writes it to stderr and exits 1, because CI and
 * the pre-commit hook must not pass a lint that did not run.
 *
 * Every other failure ends the same way, with one `oracle lint failed:` line
 * (maintainer, 2026-11-10: "we should never just crash"): an unknown
 * `--format` or `--event`, a hook input that is not a JSON object, a checkout
 * with no main branch for the merge-base, and an error thrown while linting.
 * An unknown format has no harness to answer through, so it answers on the
 * command line. An unknown event in a harness's format answers on the edit
 * event's channel, and so does any other bad argument beside a known format.
 * A failure while an outer plugin lints, or while the merge-base is found,
 * follows the line that names that plugin.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { failureLine, loadFailureLine } from './lint-load-failure.mjs'
import {
  oracleLintSettings,
  registrationExceptionConfig,
} from './oracle-lint-settings.mjs'

const formats = new Set([`claude`, `codex`, `gemini`, `copilot`, `text`])

/** The hook input, which is empty or a JSON object. */
function parseHookInput(text) {
  if (text.trim() === ``) return {}
  try {
    const value = JSON.parse(text)
    if (value !== null && typeof value === `object` && !Array.isArray(value))
      return value
  } catch {
    // Not JSON, which is reported below.
  }
  throw new Error(`the hook input is not a JSON object`)
}

const argumentOptions = {
  format: { type: `string`, default: `text` },
  event: { type: `string`, default: `edit` },
  all: { type: `boolean`, default: false },
}

/**
 * The run's options and hook input, and `failure`, the line that says why
 * they cannot be used, if one does. A lenient first reading takes the format
 * and event that report a failure: a known format, or the command line, and
 * the stop event, or the edit event. So any other bad argument with a
 * harness's format answers on that harness's channel. A hook's input is read
 * before the options are judged, so a failed stop still sees
 * `stop_hook_active` and blocks a turn only once.
 */
function readInvocation() {
  const lenient = parseArgs({
    options: argumentOptions,
    strict: false,
    allowPositionals: true,
  }).values
  const invocation = {
    options: {
      format: formats.has(lenient.format) ? lenient.format : `text`,
      event: lenient.event === `stop` ? `stop` : `edit`,
      all: false,
    },
    positionals: [],
    inputText:
      formats.has(lenient.format) && lenient.format !== `text`
        ? readFileSync(0, `utf8`)
        : ``,
    input: {},
  }
  try {
    const { values, positionals } = parseArgs({
      options: argumentOptions,
      allowPositionals: true,
    })
    if (!formats.has(values.format))
      throw new Error(`--format must be one of ${[...formats].join(`, `)}`)
    if (![`edit`, `stop`].includes(values.event))
      throw new Error(`--event must be edit or stop`)
    invocation.options = values
    invocation.positionals = positionals
    invocation.input = parseHookInput(invocation.inputText)
  } catch (error) {
    invocation.failure = failureLine(error)
    try {
      invocation.input = parseHookInput(invocation.inputText)
    } catch {
      // Input that is not a JSON object has no guard to read.
    }
  }
  return invocation
}

const { options, positionals, inputText, input, failure } = readInvocation()
const isHook = options.format !== `text`
const scriptRoot = realpathSync(fileURLToPath(new URL(`../`, import.meta.url)))

/** The top level of the git checkout that holds `cwd`, or undefined. */
function checkoutOf(cwd) {
  try {
    return realpathSync(
      execFileSync(`git`, [`rev-parse`, `--show-toplevel`], {
        cwd,
        encoding: `utf8`,
        stdio: [`ignore`, `pipe`, `ignore`],
      }).trim(),
    )
  } catch {
    return undefined
  }
}

const root =
  (typeof input.cwd === `string` ? checkoutOf(input.cwd) : undefined) ??
  scriptRoot
const ownScript = join(root, `scripts`, `agent-lint-feedback.mjs`)
const delegate =
  failure === undefined && root !== scriptRoot && existsSync(ownScript)

/**
 * The lint modules, or `unavailable`: the one line that says why they cannot
 * load. Only loading them proves an install: a package can resolve while its
 * entry file, or a package that it imports, is missing. A missing module means
 * the install is missing or partial. Any other error, such as a cut-off file,
 * is reported by its message, so the run still does not crash.
 */
async function loadLint() {
  try {
    const [parser, eslint, plugin, rule, runBudgets] = await Promise.all([
      import(`@typescript-eslint/parser`),
      import(`eslint`),
      import(`@tanstack/eslint-plugin-oracles`),
      import(`@tanstack/eslint-plugin-oracles/rules/no-unit-test`),
      // The run-budget module imports the parser too.
      import(`./check-oracle-run-counts.mjs`),
    ])
    // The real path of the plugin that loaded.
    const pluginDirectory = dirname(
      fileURLToPath(
        import.meta.resolve(`@tanstack/eslint-plugin-oracles/package.json`),
      ),
    )
    return {
      outerPlugin: relative(root, pluginDirectory).startsWith(`..`)
        ? `oracle lint used the plugin installed at ${pluginDirectory}, outside ${root}`
        : ``,
      tsParser: parser.default,
      ESLint: eslint.ESLint,
      oraclePlugin: plugin.default,
      resolveImportedTestModule: rule.resolveImportedTestModule,
      ...runBudgets,
    }
  } catch (error) {
    return { unavailable: loadFailureLine(error, scriptRoot) }
  }
}

// A delegating run, or one that cannot run, lints nothing itself, so it loads
// nothing.
const {
  tsParser,
  ESLint,
  oraclePlugin,
  resolveImportedTestModule,
  describeLoweredRunBudget,
  isOracleFile,
  loweredRunBudgetsBetween,
  mergeBase,
  outerPlugin,
  unavailable,
} = delegate || failure !== undefined ? {} : await loadLint()

function git(...args) {
  return execFileSync(`git`, args, { cwd: root, encoding: `utf8` }).trim()
}

function repositoryFiles(...outputs) {
  return outputs
    .flatMap((output) => output.split(`\n`))
    .filter(Boolean)
    .map((file) => join(root, file))
}

/**
 * Every oracle file in the working tree, tracked or new. A new file that an
 * agent has not added yet is linted like any other. Git leaves out ignored
 * files: builds, and `.worktrees/`, where other checkouts and scratch copies
 * live. A plain directory there has no `.git` entry, so without the ignore rule
 * git would list each of its files as new work on this branch.
 */
function oracleFilesInTree() {
  return repositoryFiles(
    git(`ls-files`, `--cached`, `--others`, `--exclude-standard`),
  ).filter((file) => isOracleFile(file))
}

// A relative import or re-export. Reading too much is harmless: a specifier
// that names no test module resolves to nothing.
const relativeSpecifier =
  /\b(?:from|import|require)\s*\(?\s*['"](\.{1,2}\/[^'"\n]*)['"]/g
const dependencies = new Map()

/** The test modules that a file imports or re-exports, as the rule resolves them. */
function testModuleDependencies(file) {
  if (!dependencies.has(file)) {
    const found = existsSync(file)
      ? [...readFileSync(file, `utf8`).matchAll(relativeSpecifier)]
          .map(([, specifier]) => resolveImportedTestModule(file, specifier))
          .filter((dependency) => dependency !== undefined)
      : []
    dependencies.set(file, found)
  }
  return dependencies.get(file)
}

/** Whether an oracle file is edited, or reaches an edited file through test modules. */
function reachesEdited(oracle, edited) {
  const seen = new Set([oracle])
  const pending = [oracle]
  while (pending.length > 0) {
    const current = pending.pop()
    if (edited.has(current)) return true
    for (const dependency of testModuleDependencies(current)) {
      if (!seen.has(dependency)) {
        seen.add(dependency)
        pending.push(dependency)
      }
    }
  }
  return false
}

// The lint configuration: the settings module configures the plugin for this
// repository, and the lockfile pins @tanstack/eslint-plugin-oracles.
const lintSettings = join(root, `scripts`, `oracle-lint-settings.mjs`)
const lockfile = join(root, `pnpm-lock.yaml`)
const pluginName = `@tanstack/eslint-plugin-oracles`

/**
 * The lockfile's entries for the plugin: each line that names it, with the
 * lines indented under it. They are its importer entry, its resolution, and
 * its snapshot with its resolved dependencies, so they change exactly when an
 * install would put another copy of the plugin or of its direct dependencies
 * in place.
 */
function pluginEntries(text) {
  const lines = text.split(`\n`)
  const entries = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes(pluginName)) continue
    const indent = lines[index].search(/\S/)
    entries.push(lines[index])
    while (lines[index + 1]?.search(/\S/) > indent) entries.push(lines[++index])
  }
  return entries.join(`\n`)
}

/**
 * Whether the plugin's lockfile entries differ from the merge-base's.
 * `mergeBase` fails without a main branch, as `changedFiles` does. A merge-base
 * without a lockfile has no plugin entries; any other git failure throws. The
 * lockfile is larger than a child process's default 1 MiB output buffer, so
 * its text is read with no limit.
 */
function pluginChanged() {
  const base = mergeBase(root)
  const tracked = git(`ls-tree`, `--name-only`, base, `--`, `pnpm-lock.yaml`)
  const before =
    tracked === ``
      ? ``
      : execFileSync(`git`, [`show`, `${base}:pnpm-lock.yaml`], {
          cwd: root,
          encoding: `utf8`,
          maxBuffer: Infinity,
        })
  const current = existsSync(lockfile) ? readFileSync(lockfile, `utf8`) : ``
  return pluginEntries(before) !== pluginEntries(current)
}

/**
 * The oracle files that a lint of `files` must cover. The rule reads relative
 * imports of test modules, so an oracle file is covered when it is named, or
 * when it reaches a named file through test modules. Production files select
 * nothing, because the rule does not follow them. A change to the lint
 * configuration changes every oracle result, so it selects every oracle file:
 * an edit to the settings, or a lockfile whose plugin entries differ from the
 * merge-base's. Another lockfile edit, such as an unrelated dependency bump,
 * installs the same rule, so it selects nothing.
 */
function affectedOracleFiles(files) {
  const edited = new Set(files)
  const oracles = new Set(
    [...oracleFilesInTree(), ...files].filter((file) => isOracleFile(file)),
  )
  if (edited.has(lintSettings) || (edited.has(lockfile) && pluginChanged()))
    return [...oracles]
  return [...oracles].filter((oracle) => reachesEdited(oracle, edited))
}

/**
 * Every file that the branch adds or changes, including uncommitted work.
 * `mergeBase` fails without a main branch, instead of linting only the
 * uncommitted work.
 */
function changedFiles() {
  const base = mergeBase(root)
  return repositoryFiles(
    git(`diff`, `--name-only`, `--diff-filter=ACMR`, base),
    git(`ls-files`, `--others`, `--exclude-standard`),
  )
}

const pathKeys = /^(file_?path|filePath|path|absolute_path|target_file)$/i
const patchHeader = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm

/**
 * The files that a hook input names. Harnesses put the path in different
 * fields, and Codex sends the text of an `apply_patch` call instead, so this
 * searches the whole input for path fields and patch headers.
 */
function editedFiles(input) {
  const base = typeof input.cwd === `string` ? input.cwd : root
  const found = new Set()
  const visit = (value, key) => {
    if (typeof value === `string`) {
      if (key !== undefined && pathKeys.test(key)) found.add(value)
      for (const match of value.matchAll(patchHeader))
        found.add(match[1].trim())
      // Copilot's tool arguments can arrive as a JSON string.
      if (/^\s*\{/.test(value)) {
        try {
          visit(JSON.parse(value))
        } catch {
          // Not JSON; already searched as text.
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value !== null && typeof value === `object`) {
      for (const [childKey, child] of Object.entries(value))
        visit(child, childKey)
    }
  }
  visit(input.tool_input ?? input.toolArgs ?? input)
  return [...found].map((file) =>
    isAbsolute(file) ? file : resolve(base, file),
  )
}

function createLinter() {
  return new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: [`**/dist/**`] },
      {
        files: [`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.mjs`, `**/*.jsx`],
        languageOptions: { parser: tsParser },
      },
      { linterOptions: { noInlineConfig: true } },
      { settings: oracleLintSettings },
      // `lint` passes only oracle files, chosen by `isOracleFile`, so the rules
      // apply to every file that it passes.
      {
        ...oraclePlugin.configs.recommended,
        files: [`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.mjs`, `**/*.jsx`],
      },
      // The reviewed exception list; check-registration-exceptions.mjs keeps
      // each file's count exact.
      registrationExceptionConfig,
    ],
  })
}

/** Lints the oracle files among `files`. */
async function lint(eslint, files) {
  const lintable = []
  for (const file of new Set(files)) {
    if (!existsSync(file) || relative(root, file).startsWith(`..`)) continue
    if (!isOracleFile(file)) continue
    if (await eslint.isPathIgnored(file)) continue
    lintable.push(file)
  }
  if (lintable.length === 0) return []
  const results = await eslint.lintFiles(lintable)
  // Keep oracle reports and files that cannot be parsed. This drops the
  // notices that the ignored directives have no effect.
  return results.map((result) => ({
    ...result,
    messages: result.messages.filter(
      (message) => message.fatal || message.ruleId?.startsWith(`oracle/`),
    ),
  }))
}

function reportText(results) {
  const lines = []
  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity < 2) continue
      lines.push(
        `${relative(root, result.filePath)}:${message.line}:${message.column} ` +
          `${message.message} (${message.ruleId ?? `parse`})`,
      )
    }
  }
  return lines.join(`\n`)
}

/**
 * Writes the report in the harness's format, after the line that names an
 * outer plugin, if any. A command-line run writes them to stderr, and exits 1
 * when there is a report. A hook hands them to the agent: a post-edit report
 * reaches the model beside the tool result, and a stop report makes the agent
 * take another turn. A run that could not lint (`scope` is `unavailable`)
 * reports its one line the same way, and so does an edit whose only line
 * names the plugin, except that every hook exits 0. A stop whose only line
 * names the plugin does not block: the lint ran.
 */
function respond(report, input, scope, notice) {
  const withNotice = (text) => [notice, text].filter(Boolean).join(`\n`)
  if (!isHook) {
    if (withNotice(report) !== ``)
      process.stderr.write(`${withNotice(report)}\n`)
    if (report !== ``) process.exitCode = 1
    return
  }
  if (report === `` && options.event === `stop`) {
    showUser(notice)
    return
  }
  if (scope === `unavailable` || report === ``) {
    tellAgent(withNotice(report), input, false)
    return
  }
  const header =
    scope === `edited`
      ? `Oracle lint reports for the file you edited, and the oracle files that depend on it:`
      : `Oracle lint reports in this branch's changed files. Fix them before finishing:`
  tellAgent(
    withNotice(
      `${header}\n${report}\nSee "How oracle work is scored" in AGENTS.md.`,
    ),
    input,
    true,
  )
}

/**
 * Shows a stop hook's informational line, if any, without blocking the stop.
 * Only a report, or a line that says the lint did not run, may block one: a
 * blocked stop costs the agent a turn. Claude Code, Codex, and Gemini CLI
 * show `systemMessage` to the user. Copilot's stop hook has no such field, so
 * it shows nothing. Codex requires JSON on stdout when a stop hook exits 0.
 */
function showUser(message) {
  if (message !== `` && options.format !== `copilot`)
    process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`)
  else if (options.format === `codex`) process.stdout.write(`{}\n`)
}

/**
 * Hands a hook's message to the agent. A stop message continues the turn
 * once: when the harness says a stop hook already continued this turn, the
 * message is left for the pre-commit hook and CI, so a message the agent
 * cannot act on does not loop. Claude Code and Codex return stderr to the
 * model on exit 2, which a report uses (`exitTwo`). Otherwise each harness
 * reads JSON on stdout from a hook that exits 0; Copilot treats a nonzero exit
 * as a warning, so it always needs the JSON.
 */
function tellAgent(message, input, exitTwo) {
  const { format, event } = options
  if (message === `` || (event === `stop` && input.stop_hook_active === true)) {
    // Codex requires JSON on stdout when a stop hook exits 0.
    if (format === `codex` && event === `stop`) process.stdout.write(`{}\n`)
    return
  }
  if (exitTwo && (format === `claude` || format === `codex`)) {
    process.stderr.write(`${message}\n`)
    process.exitCode = 2
    return
  }
  let output
  if (event === `stop`)
    output = {
      decision: format === `gemini` ? `deny` : `block`,
      reason: message,
    }
  else if (format === `copilot`) output = { additionalContext: message }
  else
    output = {
      hookSpecificOutput: {
        hookEventName: format === `gemini` ? `AfterTool` : `PostToolUse`,
        additionalContext: message,
      },
    }
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

/**
 * The oracle files to lint: every oracle file, or those that the named, edited,
 * or changed files affect.
 */
function selectFiles(input) {
  if (options.all) return { scope: `all`, files: oracleFilesInTree() }
  if (positionals.length > 0) {
    return {
      scope: `named`,
      files: affectedOracleFiles(positionals.map((file) => resolve(file))),
    }
  }
  const edited = options.event === `edit` && isHook ? editedFiles(input) : []
  return edited.length > 0
    ? { scope: `edited`, files: affectedOracleFiles(edited) }
    : { scope: `changed`, files: affectedOracleFiles(changedFiles()) }
}

/**
 * Lowered and removed run budgets, for a report over the branch's changed
 * files. Either can be deliberate, so it is a report for review, not a lint
 * error.
 */
function runBudgetReport(scope) {
  if (scope !== `changed`) return ``
  return loweredRunBudgetsBetween(root, mergeBase(root))
    .map(
      (budget) =>
        `${budget.file}: ${describeLoweredRunBudget(budget)}. Restore it, or explain why in the pull request.`,
    )
    .join(`\n`)
}

if (failure !== undefined) {
  respond(failure, input, `unavailable`)
} else if (delegate) {
  // The session's checkout runs its own copy, which writes the response.
  const result = spawnSync(
    process.execPath,
    [ownScript, ...process.argv.slice(2)],
    { cwd: root, input: inputText, stdio: [`pipe`, `inherit`, `inherit`] },
  )
  process.exitCode = result.status ?? 1
} else if (unavailable !== undefined) {
  respond(unavailable, input, `unavailable`)
} else {
  // A missing main branch, or an error thrown while linting, is reported in
  // one line, as a load failure is.
  try {
    const { scope, files } = selectFiles(input)
    const report = [
      reportText(await lint(createLinter(), files)),
      runBudgetReport(scope),
    ]
      .filter(Boolean)
      .join(`\n`)
    respond(report, input, scope, outerPlugin)
  } catch (error) {
    respond(failureLine(error), input, `unavailable`, outerPlugin)
  }
}
