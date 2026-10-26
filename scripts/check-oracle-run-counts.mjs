#!/usr/bin/env node
/**
 * Reports oracle run budgets that a branch lowered.
 *
 * A generated property checks more histories with a larger budget. Lowering
 * one can make a failing property pass without any change that a lint rule can
 * see, because the new count is still a valid count. This check compares each
 * changed oracle file with its version at the merge-base and reports every
 * budget that went down. A lowered budget can be a deliberate choice, so the
 * report is a tripwire for the reviewer, not a failure: CI prints it as a
 * warning, and the agent hooks return it at the end of a turn.
 *
 * A budget is keyed by its registered property where the code names one
 * (`oraclePropertyOptions(n, 'p')`, `oracleRandomParameters(n, _, 'p')`, or
 * `{ property: 'p', defaultRuns: n }`), and otherwise by its fixed seed
 * (`{ seed: s, numRuns: oracleRuns(n) }`). A constant bound to a number counts
 * as that number.
 *
 *   node scripts/check-oracle-run-counts.mjs [--format=text|github]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import tsParser from '@typescript-eslint/parser'

const root = fileURLToPath(new URL(`../`, import.meta.url))
function git(...args) {
  // Pipe stderr so that a failed attempt in `mergeBase` prints nothing.
  return execFileSync(`git`, args, {
    cwd: root,
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
      return git(`merge-base`, `HEAD`, branch)
    } catch {
      // Try the next branch.
    }
  }
  throw new Error(
    `Cannot find origin/main or main to compare this branch against. Run \`git fetch origin main\`.`,
  )
}

/** The number a node is, or that a constant in the same file is bound to. */
function numberOf(node, constants) {
  if (node?.type === `Literal` && typeof node.value === `number`) {
    return node.value
  }
  if (node?.type === `Identifier`) return constants.get(node.name)
  if (node?.type === `CallExpression` && node.callee.name === `oracleRuns`) {
    return numberOf(node.arguments[0], constants)
  }
  return undefined
}

function stringOf(node) {
  if (node?.type === `Literal` && typeof node.value === `string`) {
    return node.value
  }
  if (node?.type === `TemplateLiteral` && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  return undefined
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

function propertyValue(object, name) {
  return object.properties.find(
    (property) =>
      property.type === `Property` &&
      !property.computed &&
      (property.key.name ?? property.key.value) === name,
  )?.value
}

/** Every keyed run budget in one source file. */
function runBudgets(source, file) {
  const ast = tsParser.parse(source, {
    range: true,
    loc: true,
    jsx: file.endsWith(`.tsx`),
  })
  const constants = new Map()
  walk(ast, (node) => {
    if (
      node.type === `VariableDeclaration` &&
      node.kind === `const` &&
      node.declarations.length === 1
    ) {
      const [declaration] = node.declarations
      const value = numberOf(declaration.init, constants)
      if (declaration.id.type === `Identifier` && value !== undefined) {
        constants.set(declaration.id.name, value)
      }
    }
  })
  const budgets = new Map()
  const record = (key, value) => {
    if (key !== undefined && value !== undefined) budgets.set(key, value)
  }
  walk(ast, (node) => {
    if (node.type === `CallExpression` && node.callee.type === `Identifier`) {
      const [first, second, third] = node.arguments
      if (node.callee.name === `oraclePropertyOptions`) {
        const property = stringOf(second)
        if (property !== undefined) {
          record(`property ${property}`, numberOf(first, constants))
        }
      }
      if (node.callee.name === `oracleRandomParameters`) {
        const property = stringOf(third)
        if (property !== undefined) {
          record(`property ${property}`, numberOf(first, constants))
        }
      }
    }
    if (node.type === `ObjectExpression`) {
      const property = stringOf(propertyValue(node, `property`))
      const defaultRuns = numberOf(
        propertyValue(node, `defaultRuns`),
        constants,
      )
      if (property !== undefined) record(`property ${property}`, defaultRuns)
      const seed = numberOf(propertyValue(node, `seed`), constants)
      const numRuns = numberOf(propertyValue(node, `numRuns`), constants)
      if (seed !== undefined) record(`fixed seed ${seed}`, numRuns)
    }
  })
  return budgets
}

function changedOracleFiles(base) {
  return git(`diff`, `--name-only`, `--diff-filter=M`, base)
    .split(`\n`)
    .filter((file) => /oracle.*\.tsx?$/.test(basename(file)))
}

function show(revision, file) {
  try {
    return git(`show`, `${revision}:${file}`)
  } catch {
    return undefined
  }
}

/** Every keyed run budget that the branch lowered in a changed oracle file. */
export function loweredRunBudgets() {
  const base = mergeBase()
  const lowered = []
  for (const file of changedOracleFiles(base)) {
    const before = show(base, file)
    if (before === undefined) continue
    const after = readFileSync(join(root, file), `utf8`)
    const previous = runBudgets(before, file)
    const current = runBudgets(after, file)
    for (const [key, was] of previous) {
      const now = current.get(key)
      if (now !== undefined && now < was) lowered.push({ file, key, was, now })
    }
  }
  return lowered
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
