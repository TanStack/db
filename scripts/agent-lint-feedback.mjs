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
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import tsParser from '@typescript-eslint/parser'
import { ESLint } from 'eslint'
import oraclePlugin from '@tanstack/eslint-plugin-oracles'
import { resolveImportedTestModule } from '@tanstack/eslint-plugin-oracles/rules/no-unit-test'
import {
  describeLoweredRunBudget,
  isOracleFile,
  loweredRunBudgetsBetween,
  mergeBase,
} from './check-oracle-run-counts.mjs'
import { oracleLintSettings } from './oracle-lint-settings.mjs'

const { values: options, positionals } = parseArgs({
  options: {
    format: { type: `string`, default: `text` },
    event: { type: `string`, default: `edit` },
    all: { type: `boolean`, default: false },
  },
  allowPositionals: true,
})

const formats = new Set([`claude`, `codex`, `gemini`, `copilot`, `text`])
if (!formats.has(options.format)) {
  throw new Error(`--format must be one of ${[...formats].join(`, `)}`)
}
if (![`edit`, `stop`].includes(options.event)) {
  throw new Error(`--event must be edit or stop`)
}
const isHook = options.format !== `text`
const inputText = isHook ? readFileSync(0, `utf8`) : ``
const input = inputText.trim() === `` ? {} : JSON.parse(inputText)
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
const delegate = root !== scriptRoot && existsSync(ownScript)

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
    ],
  })
}

// The lint cache holds each oracle file's messages under a key of its content,
// the test modules that it reaches (the rule reads them), the manifests that the
// rule reads, and the lint configuration. An entry is reused only while every
// part of its key is unchanged. ORACLE_LINT_CACHE_DIR overrides the directory,
// and an empty value turns the cache off.
const cacheDirectory =
  process.env.ORACLE_LINT_CACHE_DIR ??
  join(root, `node_modules`, `.cache`, `oracle-lint`)
const requireFromRoot = createRequire(join(root, `package.json`))
// A string literal that names a relative path: every import, export, and
// re-export source of a module is one, so this reaches each module the rule can.
const literalSpecifier = /(['"`])(\.[^'"`\n]*)\1/g

function digest(...parts) {
  const hash = createHash(`sha256`)
  for (const part of parts) hash.update(`${part.length}:${part}`)
  return hash.digest(`hex`)
}

/** The digest of a file's content, or of nothing when the file does not exist. */
function fileDigest(file) {
  return existsSync(file) ? digest(readFileSync(file, `utf8`)) : ``
}

/** The digest of the nearest package.json, which the rule reads for privacy. */
function manifestDigest(file) {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const manifest = join(directory, `package.json`)
    if (existsSync(manifest)) return fileDigest(manifest)
    if (dirname(directory) === directory) return ``
  }
}

/** The installed plugin's manifest and rule sources. */
function pluginDigest() {
  const manifest = requireFromRoot.resolve(`${pluginName}/package.json`)
  const sources = join(dirname(manifest), `src`)
  return digest(
    fileDigest(manifest),
    ...readdirSync(sources, { recursive: true })
      .filter((entry) => entry.endsWith(`.js`))
      .sort()
      .map((entry) => fileDigest(join(sources, entry))),
  )
}

let lintConfiguration
/**
 * The lint configuration: this script, the check that it reports with, the
 * settings module, ESLint's version, and the installed plugin's sources.
 */
function configuration() {
  lintConfiguration ??= digest(
    fileDigest(fileURLToPath(import.meta.url)),
    fileDigest(
      fileURLToPath(new URL(`./check-oracle-run-counts.mjs`, import.meta.url)),
    ),
    fileDigest(
      fileURLToPath(new URL(`./oracle-lint-settings.mjs`, import.meta.url)),
    ),
    ESLint.version,
    pluginDigest(),
  )
  return lintConfiguration
}

/** The test modules that a file reaches through imports, transitively, as the rule resolves them. */
function reachedModules(file) {
  const found = new Set()
  const pending = [file]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const [, , specifier] of readFileSync(current, `utf8`).matchAll(
      literalSpecifier,
    )) {
      const module = resolveImportedTestModule(current, specifier)
      if (module !== undefined && !found.has(module)) {
        found.add(module)
        pending.push(module)
      }
    }
  }
  return [...found].sort()
}

/** The cache key of an oracle file's lint messages. */
function lintKey(file) {
  return digest(
    configuration(),
    relative(root, file),
    ...[file, ...reachedModules(file)].flatMap((module) => [
      relative(root, module),
      fileDigest(module),
      manifestDigest(module),
    ]),
  )
}

/** A cached value, or undefined when there is none or it cannot be read. */
function readCache(name) {
  if (cacheDirectory === ``) return undefined
  try {
    return JSON.parse(
      readFileSync(join(cacheDirectory, `${name}.json`), `utf8`),
    )
  } catch {
    return undefined
  }
}

/** Stores a value. The cache is optional, so a failed write only costs a later lint. */
function writeCache(name, value) {
  if (cacheDirectory === ``) return
  try {
    mkdirSync(cacheDirectory, { recursive: true })
    const path = join(cacheDirectory, `${name}.json`)
    writeFileSync(`${path}.${process.pid}.tmp`, JSON.stringify(value))
    renameSync(`${path}.${process.pid}.tmp`, path)
  } catch {
    // Without a stored value, the next run lints the file again.
  }
}

/**
 * Lints the oracle files among `files`. A file whose key is cached keeps its
 * stored messages, and ESLint runs only on the others.
 */
async function lint(files) {
  const eslint = createLinter()
  const lintable = []
  for (const file of new Set(files)) {
    if (!existsSync(file) || relative(root, file).startsWith(`..`)) continue
    if (!isOracleFile(file)) continue
    if (await eslint.isPathIgnored(file)) continue
    lintable.push(file)
  }
  if (lintable.length === 0) return []
  const keys = cacheDirectory === `` ? undefined : lintable.map(lintKey)
  const stored = keys?.map((key) => readCache(key)) ?? []
  const missing = lintable.filter((_, index) => stored[index] === undefined)
  const linted = new Map()
  if (missing.length > 0) {
    // Keep oracle reports and files that cannot be parsed. This drops the
    // notices that the ignored directives have no effect.
    for (const result of await eslint.lintFiles(missing)) {
      linted.set(
        result.filePath,
        result.messages.filter(
          (message) => message.fatal || message.ruleId?.startsWith(`oracle/`),
        ),
      )
    }
  }
  return lintable.map((file, index) => {
    if (stored[index] !== undefined) {
      return { filePath: file, messages: stored[index] }
    }
    const messages = linted.get(file) ?? []
    if (keys !== undefined && linted.has(file))
      writeCache(keys[index], messages)
    return { filePath: file, messages }
  })
}

/**
 * The key of a stop report: the merge-base, the branch's changed files, the
 * configuration, and the lint keys of the selected oracle files.
 */
function stopKey(files, changed) {
  return digest(
    mergeBase(root),
    configuration(),
    ...changed.flatMap((file) => [relative(root, file), fileDigest(file)]),
    ...files.map(lintKey),
  )
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
 * Writes the report in the harness's format. A post-edit report reaches the
 * model beside the tool result. A stop report makes the agent take another
 * turn, once: when the harness says a stop hook already continued this turn,
 * the report is left for the pre-commit hook and CI, so a report the agent
 * cannot fix does not loop.
 */
function respond(report, input, scope) {
  const { format, event } = options
  if (!isHook) {
    if (report !== ``) {
      process.stderr.write(`${report}\n`)
      process.exitCode = 1
    }
    return
  }
  const header =
    scope === `edited`
      ? `Oracle lint reports for the file you edited, and the oracle files that depend on it:`
      : `Oracle lint reports in this branch's changed files. Fix them before finishing:`
  const reason = `${header}\n${report}\nSee "How oracle work is scored" in AGENTS.md.`
  if (report === `` || (event === `stop` && input.stop_hook_active === true)) {
    // Codex requires JSON on stdout when a stop hook exits 0.
    if (format === `codex` && event === `stop`) process.stdout.write(`{}\n`)
    return
  }
  if (format === `claude` || format === `codex`) {
    // Exit code 2 returns stderr to the model in both harnesses.
    process.stderr.write(`${reason}\n`)
    process.exitCode = 2
    return
  }
  if (format === `gemini`) {
    const output =
      event === `stop`
        ? { decision: `deny`, reason }
        : {
            hookSpecificOutput: {
              hookEventName: `AfterTool`,
              additionalContext: reason,
            },
          }
    process.stdout.write(`${JSON.stringify(output)}\n`)
    return
  }
  // Copilot treats a nonzero exit as a warning, so it needs JSON on stdout.
  const output =
    event === `stop`
      ? { decision: `block`, reason }
      : { additionalContext: reason }
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
  if (edited.length > 0) {
    return { scope: `edited`, files: affectedOracleFiles(edited) }
  }
  const changed = changedFiles()
  return { scope: `changed`, files: affectedOracleFiles(changed), changed }
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

if (delegate) {
  // The session's checkout runs its own copy, which writes the response.
  const result = spawnSync(
    process.execPath,
    [ownScript, ...process.argv.slice(2)],
    { cwd: root, input: inputText, stdio: [`pipe`, `inherit`, `inherit`] },
  )
  process.exitCode = result.status ?? 1
} else {
  const { scope, files, changed } = selectFiles(input)
  // A stop report depends only on the branch's changes and the oracle files it
  // selects. When their keys are unchanged, the last stop report is repeated.
  const stopCache =
    options.event === `stop` && scope === `changed` && cacheDirectory !== ``
  const key = stopCache ? stopKey(files, changed) : undefined
  const stored = stopCache ? readCache(`stop`) : undefined
  const hit = stopCache && stored?.key === key
  const report = hit
    ? stored.report
    : [reportText(await lint(files)), runBudgetReport(scope)]
        .filter(Boolean)
        .join(`\n`)
  if (stopCache && !hit) writeCache(`stop`, { key, report })
  respond(report, input, scope)
}
