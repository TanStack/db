#!/usr/bin/env node
/**
 * Reports oracle run budgets that a branch lowered or removed.
 *
 * A generated property checks more histories with a larger budget. Lowering
 * one can make a failing property pass without any change that a lint rule can
 * see, because the new count is still a valid count. Removing one drops its
 * histories altogether. This check compares each oracle file's budgets with
 * their versions at the merge-base and reports every budget that went down,
 * and every budget that no tracked oracle file has any more. Either can be a
 * deliberate choice, so the report is a tripwire for the reviewer, not a
 * failure: CI prints it as a warning, and the agent hooks return it at the
 * end of a turn.
 *
 * A budget is keyed by its registered property where the code names one
 * (`oraclePropertyOptions(n, 'p')`, `oracleRandomParameters(n, _, 'p')`, or
 * `{ property: 'p', defaultRuns: n }`), and otherwise by its fixed seed
 * (`{ seed: s, numRuns: oracleRuns(n) }`). A key or count is a literal, a
 * constant in the same file, or a constant that the file imports. An import
 * follows relative re-exports (`export { x } from`, `export * from`), so a
 * constant defined in a support module is tracked where the oracle uses it.
 *
 * An oracle file's budgets are its own and those in the test modules that it
 * imports or re-exports, transitively, other than oracle files, which are
 * checked as themselves. So a campaign that moves into a support module keeps
 * its tracking. A budget that leaves one oracle file and appears in another,
 * where it was not at base, has moved, and its new count is compared. A key
 * that is in no tracked oracle file at head is reported as removed: the
 * maintainer decided on 2026-10-27 that a removal is reported like a lowered
 * budget, and that a move into an imported support module is not a removal.
 * A fixed seed is not unique, so a key that another oracle file already had at
 * base counts as present there, and is neither removed nor compared.
 *
 * An oracle file is a file whose name contains `oracle`, in TypeScript or
 * JavaScript. It is checked when it changed, or when a module that it imports
 * (directly or through re-exports) changed. Untracked files count as changed.
 *
 *   node scripts/check-oracle-run-counts.mjs [--format=text|github]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import tsParser from '@typescript-eslint/parser'

const root = fileURLToPath(new URL(`../`, import.meta.url))

function git(cwd, ...args) {
  // Pipe stderr so that a failed attempt in `mergeBase` prints nothing. An
  // oracle file can exceed the default 1 MiB output buffer.
  return execFileSync(`git`, args, {
    cwd,
    encoding: `utf8`,
    maxBuffer: 1024 * 1024 * 1024,
    stdio: [`ignore`, `pipe`, `pipe`],
  }).trim()
}

/**
 * The commit where this branch left main. Without one, the branch's own
 * history cannot be found, so this fails instead of comparing too little.
 */
export function mergeBase() {
  for (const branch of [`origin/main`, `main`]) {
    try {
      return git(root, `merge-base`, `HEAD`, branch)
    } catch {
      // Try the next branch.
    }
  }
  throw new Error(
    `Cannot find origin/main or main to compare this branch against. Run \`git fetch origin main\`.`,
  )
}

/**
 * Reads files at the base commit or in the working tree, and parses each once.
 * A file that does not exist at a revision reads as undefined. Any other
 * failure to read a file throws, so a budget is never compared with a file
 * that only seemed to be missing.
 */
class SourceReader {
  #repo
  #base
  #baseFiles
  #texts = new Map()
  #asts = new Map()

  constructor(repo, base) {
    this.#repo = repo
    this.#base = base
  }

  /** Every file at the base commit. */
  baseFiles() {
    this.#baseFiles ??= new Set(
      git(this.#repo, `ls-tree`, `-r`, `--name-only`, this.#base)
        .split(`\n`)
        .filter(Boolean),
    )
    return this.#baseFiles
  }

  text(file, revision) {
    const key = `${revision}\0${file}`
    if (!this.#texts.has(key)) {
      let text
      if (revision === `head`) {
        const path = join(this.#repo, file)
        text = existsSync(path) ? readFileSync(path, `utf8`) : undefined
      } else if (this.baseFiles().has(file)) {
        text = git(this.#repo, `show`, `${this.#base}:${file}`)
      }
      this.#texts.set(key, text)
    }
    return this.#texts.get(key)
  }

  ast(file, revision) {
    const key = `${revision}\0${file}`
    if (!this.#asts.has(key)) {
      const text = this.text(file, revision)
      this.#asts.set(
        key,
        text === undefined
          ? undefined
          : tsParser.parse(text, {
              range: true,
              loc: true,
              jsx: /\.[jt]sx$/.test(file),
            }),
      )
    }
    return this.#asts.get(key)
  }
}

function walk(node, visit) {
  if (node === null || typeof node !== `object`) return
  if (typeof node.type === `string`) visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (key === `parent`) continue
    if (Array.isArray(child)) child.forEach((item) => walk(item, visit))
    else if (child && typeof child.type === `string`) walk(child, visit)
  }
}

/** The repository path of a relative module, or undefined for a missing one. */
function resolveModule(fromFile, source, reader, revision) {
  if (!source.startsWith(`.`)) return undefined
  const target = posix.normalize(posix.join(posix.dirname(fromFile), source))
  const stem = target.replace(/\.(m?js|jsx|tsx?)$/, ``)
  return [
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.js`,
    `${stem}.mjs`,
    `${stem}.jsx`,
    `${stem}/index.ts`,
    `${stem}/index.js`,
  ].find((candidate) => reader.text(candidate, revision) !== undefined)
}

function nameOf(node) {
  return node.name ?? node.value
}

/**
 * The number or string that an expression is: a literal, a constant that the
 * file declares or imports, or `oracleRuns` of one of those.
 */
function valueOf(node, file, reader, revision, depth) {
  if (node === null || node === undefined || depth > 25) return undefined
  if (
    node.type === `Literal` &&
    (typeof node.value === `number` || typeof node.value === `string`)
  ) {
    return node.value
  }
  if (node.type === `TemplateLiteral` && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  if (node.type === `Identifier`) {
    return nameValue(node.name, file, reader, revision, depth + 1)
  }
  if (
    node.type === `CallExpression` &&
    node.callee.type === `Identifier` &&
    node.callee.name === `oracleRuns`
  ) {
    return valueOf(node.arguments[0], file, reader, revision, depth + 1)
  }
  return undefined
}

/** The value of a name in a file: an import, or a constant that the file declares. */
function nameValue(name, file, reader, revision, depth) {
  const ast = reader.ast(file, revision)
  if (ast === undefined || depth > 25) return undefined
  for (const statement of ast.body) {
    if (statement.type !== `ImportDeclaration`) continue
    for (const specifier of statement.specifiers) {
      if (specifier.local.name !== name) continue
      const target = resolveModule(
        file,
        statement.source.value,
        reader,
        revision,
      )
      if (target === undefined || specifier.type !== `ImportSpecifier`)
        return undefined
      return exportValue(
        target,
        nameOf(specifier.imported),
        reader,
        revision,
        depth + 1,
      )
    }
  }
  let found
  walk(ast, (node) => {
    if (
      found !== undefined ||
      node.type !== `VariableDeclaration` ||
      node.kind !== `const`
    )
      return
    for (const declarator of node.declarations) {
      if (declarator.id.type === `Identifier` && declarator.id.name === name) {
        found = {
          value: valueOf(declarator.init, file, reader, revision, depth + 1),
        }
        return
      }
    }
  })
  return found?.value
}

/** The value of an export of a module, following its re-exports. */
function exportValue(file, name, reader, revision, depth) {
  const ast = reader.ast(file, revision)
  if (ast === undefined || depth > 25) return undefined
  for (const statement of ast.body) {
    if (statement.type !== `ExportNamedDeclaration`) continue
    if (statement.declaration?.type === `VariableDeclaration`) {
      for (const declarator of statement.declaration.declarations) {
        if (
          declarator.id.type === `Identifier` &&
          declarator.id.name === name
        ) {
          return valueOf(declarator.init, file, reader, revision, depth + 1)
        }
      }
    }
    for (const specifier of statement.specifiers) {
      if (nameOf(specifier.exported) !== name) continue
      const local = nameOf(specifier.local)
      if (statement.source === null) {
        return nameValue(local, file, reader, revision, depth + 1)
      }
      const target = resolveModule(
        file,
        statement.source.value,
        reader,
        revision,
      )
      return target === undefined
        ? undefined
        : exportValue(target, local, reader, revision, depth + 1)
    }
  }
  for (const statement of ast.body) {
    if (
      statement.type !== `ExportAllDeclaration` ||
      statement.exported !== null
    )
      continue
    const target = resolveModule(file, statement.source.value, reader, revision)
    const value =
      target === undefined
        ? undefined
        : exportValue(target, name, reader, revision, depth + 1)
    if (value !== undefined) return value
  }
  return undefined
}

function propertyValue(object, name, file, reader, revision) {
  const property = object.properties.find(
    (candidate) =>
      candidate.type === `Property` &&
      !candidate.computed &&
      nameOf(candidate.key) === name,
  )
  return property === undefined
    ? undefined
    : valueOf(property.value, file, reader, revision, 0)
}

/** Every keyed run budget in one file at one revision. */
function runBudgets(file, revision, reader) {
  const ast = reader.ast(file, revision)
  const budgets = new Map()
  if (ast === undefined) return budgets
  const record = (key, value) => {
    if (key !== undefined && value !== undefined) budgets.set(key, value)
  }
  const value = (node) => valueOf(node, file, reader, revision, 0)
  walk(ast, (node) => {
    if (node.type === `CallExpression` && node.callee.type === `Identifier`) {
      const [first, second, third] = node.arguments
      if (node.callee.name === `oraclePropertyOptions`) {
        const property = value(second)
        if (typeof property === `string`)
          record(`property ${property}`, value(first))
      }
      if (node.callee.name === `oracleRandomParameters`) {
        const property = value(third)
        if (typeof property === `string`)
          record(`property ${property}`, value(first))
      }
    }
    if (node.type === `ObjectExpression`) {
      const property = propertyValue(node, `property`, file, reader, revision)
      if (typeof property === `string`) {
        record(
          `property ${property}`,
          propertyValue(node, `defaultRuns`, file, reader, revision),
        )
      }
      const seed = propertyValue(node, `seed`, file, reader, revision)
      if (typeof seed === `number`) {
        record(
          `fixed seed ${seed}`,
          propertyValue(node, `numRuns`, file, reader, revision),
        )
      }
    }
  })
  return budgets
}

/** The repository files that a file imports or re-exports, transitively. */
function dependencies(file, reader, revision) {
  const found = new Set()
  const pending = [file]
  while (pending.length > 0) {
    const current = pending.pop()
    const ast = reader.ast(current, revision)
    if (ast === undefined) continue
    for (const statement of ast.body) {
      if (
        (statement.type === `ImportDeclaration` ||
          statement.type === `ExportAllDeclaration` ||
          (statement.type === `ExportNamedDeclaration` && statement.source)) &&
        statement.source
      ) {
        const target = resolveModule(
          current,
          statement.source.value,
          reader,
          revision,
        )
        if (target !== undefined && !found.has(target)) {
          found.add(target)
          pending.push(target)
        }
      }
    }
  }
  return found
}

/** Whether a file is an oracle file, by the oracle naming rule. */
export function isOracleFile(file) {
  return /oracle.*\.(tsx?|m?js|jsx)$/.test(basename(file))
}

/**
 * The budgets that an oracle file uses at a revision: its own, and those in
 * the non-oracle modules that it reaches. Its own budget wins a shared key.
 */
function scopeBudgets(file, revision, reader) {
  const budgets = new Map()
  for (const module of dependencies(file, reader, revision)) {
    if (isOracleFile(module)) continue
    for (const [key, value] of runBudgets(module, revision, reader))
      budgets.set(key, value)
  }
  for (const [key, value] of runBudgets(file, revision, reader))
    budgets.set(key, value)
  return budgets
}

/**
 * Every keyed run budget that the branch lowered or removed, by the oracle
 * file that used it at base. A removed budget has no `now`. The head side is
 * the working tree of `repo`, and the base side is the commit `base`.
 */
export function loweredRunBudgetsBetween(repo, base) {
  const reader = new SourceReader(repo, base)
  const changed = new Set(
    [
      git(repo, `diff`, `--name-only`, base),
      git(repo, `ls-files`, `--others`, `--exclude-standard`),
    ]
      .flatMap((output) => output.split(`\n`))
      .filter(Boolean),
  )
  const oracles = [
    ...new Set(
      [...reader.baseFiles(), ...changed].filter((file) => isOracleFile(file)),
    ),
  ]
  const scopes = { base: new Map(), head: new Map() }
  const scope = (file, revision) => {
    if (!scopes[revision].has(file))
      scopes[revision].set(file, scopeBudgets(file, revision, reader))
    return scopes[revision].get(file)
  }
  const atHead = oracles.filter(
    (file) => reader.text(file, `head`) !== undefined,
  )
  const lowered = []
  for (const file of oracles) {
    if (reader.text(file, `base`) === undefined) continue
    const affected = [file, ...dependencies(file, reader, `head`)].some(
      (candidate) => changed.has(candidate),
    )
    if (!affected) continue
    for (const [key, was] of scope(file, `base`)) {
      let now = scope(file, `head`).get(key)
      if (now === undefined) {
        const holders = atHead.filter(
          (other) => other !== file && scope(other, `head`).has(key),
        )
        if (holders.length === 0) {
          lowered.push({ file, key, was })
          continue
        }
        // A key that another file already had at base is that file's own.
        const movedTo = holders.filter(
          (other) => !scope(other, `base`).has(key),
        )
        if (movedTo.length !== 1) continue
        now = scope(movedTo[0], `head`).get(key)
      }
      if (now < was) lowered.push({ file, key, was, now })
    }
  }
  return lowered
}

/** Every keyed run budget that the branch lowered or removed, in this repository. */
export function loweredRunBudgets() {
  return loweredRunBudgetsBetween(root, mergeBase())
}

export function describeLoweredRunBudget({ key, was, now }) {
  return now === undefined
    ? `${key}: run budget removed (was ${was})`
    : `${key}: run budget lowered from ${was} to ${now}`
}

// Importing this module, as the lint script does, must not run the report.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values: options } = parseArgs({
    options: { format: { type: `string`, default: `text` } },
  })
  const lowered = loweredRunBudgets()
  for (const budget of lowered) {
    const message = describeLoweredRunBudget(budget)
    if (options.format === `github`) {
      console.log(
        `::warning file=${budget.file},title=${budget.now === undefined ? `Removed` : `Lowered`} oracle run budget::${message}`,
      )
    } else {
      console.log(`${budget.file}: ${message}`)
    }
  }
  process.exitCode = lowered.length > 0 && options.format === `text` ? 1 : 0
}
