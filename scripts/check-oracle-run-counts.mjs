#!/usr/bin/env node
/**
 * Reports oracle run budgets that a branch lowered.
 *
 * A generated property checks more histories with a larger budget. Lowering
 * one can make a failing property pass without any change that a lint rule can
 * see, because the new count is still a valid count. This check compares each
 * oracle file with its version at the merge-base and reports every budget that
 * went down. A lowered budget can be a deliberate choice, so the report is a
 * tripwire for the reviewer, not a failure: CI prints it as a warning, and the
 * agent hooks return it at the end of a turn.
 *
 * A budget is keyed by its registered property where the code names one
 * (`oraclePropertyOptions(n, 'p')`, `oracleRandomParameters(n, _, 'p')`, or
 * `{ property: 'p', defaultRuns: n }`), and otherwise by its fixed seed
 * (`{ seed: s, numRuns: oracleRuns(n) }`). A key or count is a literal, a
 * constant in the same file, or a constant that the file imports. An import
 * follows relative re-exports (`export { x } from`, `export * from`), so a
 * constant defined in a support module is tracked where the oracle uses it.
 *
 * An oracle file is checked when it changed, or when a module that it imports
 * (directly or through re-exports) changed.
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
  // Pipe stderr so that a failed attempt in `mergeBase` prints nothing.
  return execFileSync(`git`, args, {
    cwd,
    encoding: `utf8`,
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
 * A file that does not exist at a revision reads as undefined.
 */
class SourceReader {
  #repo
  #base
  #texts = new Map()
  #asts = new Map()

  constructor(repo, base) {
    this.#repo = repo
    this.#base = base
  }

  text(file, revision) {
    const key = `${revision}\0${file}`
    if (!this.#texts.has(key)) {
      let text
      if (revision === `head`) {
        const path = join(this.#repo, file)
        text = existsSync(path) ? readFileSync(path, `utf8`) : undefined
      } else {
        try {
          text = git(this.#repo, `show`, `${this.#base}:${file}`)
        } catch {
          text = undefined
        }
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
              jsx: file.endsWith(`.tsx`),
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
  const stem = target.replace(/\.(m?js|tsx?)$/, ``)
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`].find(
    (candidate) => reader.text(candidate, revision) !== undefined,
  )
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

/** The repository files that a head file imports or re-exports, transitively. */
function dependencies(file, reader) {
  const found = new Set()
  const pending = [file]
  while (pending.length > 0) {
    const current = pending.pop()
    const ast = reader.ast(current, `head`)
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
          `head`,
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

/** The oracle files at the base commit, and the oracle files that were added. */
function oracleFiles(repo, base, changed) {
  const isOracle = (file) => /oracle.*\.tsx?$/.test(basename(file))
  const atBase = git(repo, `ls-tree`, `-r`, `--name-only`, base)
    .split(`\n`)
    .filter(isOracle)
  return [...new Set([...atBase, ...[...changed].filter(isOracle)])]
}

/**
 * Every keyed run budget that the branch lowered in an oracle file, or in a
 * module that the oracle file imports. The head side is the working tree of
 * `repo`, and the base side is the commit `base`.
 */
export function loweredRunBudgetsBetween(repo, base) {
  const reader = new SourceReader(repo, base)
  const changed = new Set(
    git(repo, `diff`, `--name-only`, base).split(`\n`).filter(Boolean),
  )
  const lowered = []
  for (const file of oracleFiles(repo, base, changed)) {
    const affected = [file, ...dependencies(file, reader)].some((candidate) =>
      changed.has(candidate),
    )
    if (!affected) continue
    const previous = runBudgets(file, `base`, reader)
    const current = runBudgets(file, `head`, reader)
    for (const [key, was] of previous) {
      const now = current.get(key)
      if (now !== undefined && now < was) lowered.push({ file, key, was, now })
    }
  }
  return lowered
}

/** Every keyed run budget that the branch lowered, in this repository. */
export function loweredRunBudgets() {
  return loweredRunBudgetsBetween(root, mergeBase())
}

export function describeLoweredRunBudget({ key, was, now }) {
  return `${key}: run budget lowered from ${was} to ${now}`
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: options } = parseArgs({
    options: { format: { type: `string`, default: `text` } },
  })
  const lowered = loweredRunBudgets()
  for (const budget of lowered) {
    const message = describeLoweredRunBudget(budget)
    if (options.format === `github`) {
      console.log(
        `::warning file=${budget.file},title=Lowered oracle run budget::${message}`,
      )
    } else {
      console.log(`${budget.file}: ${message}`)
    }
  }
  process.exitCode = lowered.length > 0 && options.format === `text` ? 1 : 0
}
