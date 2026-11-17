#!/usr/bin/env node
/**
 * Keeps the reviewed exception list of `oracle/no-unit-test` exact.
 *
 * `registrationExceptions` in scripts/oracle-lint-settings.mjs names the
 * oracle files that may still register plain tests, with the number of
 * reports that each has today and the work that retires it. ESLint turns the
 * rule off for those files only, so this check lints each of them with the
 * rule on and fails when:
 *
 * - a file's report count differs from its recorded count, in either
 *   direction: a new plain test is not hidden, and a converted one must be
 *   removed from the list;
 * - the list gains a file, or a file's count rises, against the merge-base:
 *   the list may only shrink.
 *
 * `pnpm lint:oracles` runs it after the oracle lint.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import tsParser from '@typescript-eslint/parser'
import oraclePlugin from '@tanstack/eslint-plugin-oracles'
import { ESLint } from 'eslint'
import { mergeBase } from './check-oracle-run-counts.mjs'
import {
  oracleLintSettings,
  registrationExceptions,
} from './oracle-lint-settings.mjs'

const root = resolve(fileURLToPath(new URL(`..`, import.meta.url)))
const RULE = `oracle/no-unit-test`

/** The report count of `oracle/no-unit-test` in each listed file, with the rule on. */
async function reportCounts(files) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: [`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.mjs`, `**/*.jsx`],
        languageOptions: { parser: tsParser },
      },
      { settings: oracleLintSettings },
      {
        ...oraclePlugin.configs.recommended,
        files: [`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.mjs`, `**/*.jsx`],
      },
    ],
  })
  const results = await eslint.lintFiles(files.map((file) => join(root, file)))
  return new Map(
    results.map((result) => [
      result.filePath.slice(root.length + 1),
      result.messages.filter((message) => message.ruleId === RULE).length,
    ]),
  )
}

/** The exception list at the merge-base, or undefined when it has none. */
async function baseExceptions() {
  const base = mergeBase(root)
  let text
  try {
    text = execFileSync(
      `git`,
      [`show`, `${base}:scripts/oracle-lint-settings.mjs`],
      { cwd: root, encoding: `utf8` },
    )
  } catch {
    return undefined
  }
  // The settings module imports nothing, so a copy of it loads on its own.
  const directory = mkdtempSync(join(tmpdir(), `registration-exceptions-`))
  try {
    const copy = join(directory, `oracle-lint-settings.mjs`)
    writeFileSync(copy, text)
    const module = await import(pathToFileURL(copy).href)
    return module.registrationExceptions
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const problems = []
const counts = await reportCounts(
  registrationExceptions.map(({ file }) => file),
)
for (const { file, reports, retiredBy } of registrationExceptions) {
  const actual = counts.get(file)
  if (actual === undefined) problems.push(`${file}: listed, but not linted`)
  else if (actual !== reports)
    problems.push(
      `${file}: ${actual} oracle/no-unit-test report(s), but the exception list records ${reports}. ${actual < reports ? `Lower the count, or remove the entry when it reaches 0` : `Register the new tests through oracleProperty`} (retired by ${retiredBy}).`,
    )
}
const base = await baseExceptions()
if (base !== undefined) {
  const before = new Map(base.map(({ file, reports }) => [file, reports]))
  for (const { file, reports } of registrationExceptions) {
    if (!before.has(file))
      problems.push(
        `${file}: added to the exception list; the list may only shrink.`,
      )
    else if (reports > before.get(file))
      problems.push(
        `${file}: its exception count rose from ${before.get(file)} to ${reports}; the list may only shrink.`,
      )
  }
}
if (problems.length > 0) {
  console.error(problems.join(`\n`))
  process.exitCode = 1
} else {
  console.log(
    `registration exceptions: ${registrationExceptions.length} file(s), every count exact`,
  )
}
