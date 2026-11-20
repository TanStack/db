// Mutants for SQLite pages and number equality.
//
// Each mutant replaces exact pieces of production code with a plausible wrong
// design: one `find` and `replace`, or `edits` when the design spans several
// places. The harness applies it in memory through
// `packages/db-sqlite-persistence-core/vitest.mutants.config.ts`, runs the
// owner oracles, and expects every mutant to fail a named law unless the
// mutant is marked `equivalent`. A mutant whose target no longer matches, or
// that never reached a transformed module, is an error: the list has drifted
// from the code. A failure that names no law, such as a setup error, is an
// error too. A kill prints the first failing test and the law that its oracle
// reported.
//
// Usage: node scripts/sqlite-page-mutants.mjs [--only=S01,S02] [--list]
// The review record `docs/contributing/oracle-reviews/
// 2026-11-16-sqlite-ordered-page.md` reports the sweep. The Node
// expression-index oracle reads the core package's build, which this
// in-memory transform cannot reach, so it is not an owner here.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, `..`)
const PACKAGE = join(ROOT, `packages/db-sqlite-persistence-core`)
const ORACLES = [
  `tests/sqlite-ordered-page-oracle.test.ts`,
  `tests/sqlite-boolean-arity-oracle.test.ts`,
]
const TIMEOUT_MS = 10 * 60_000
const FILE = `packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts`

const MUTANTS = [
  {
    id: `S01`,
    edits: [
      {
        find: 'clause.compareOptions.nulls === `first` ? `NULLS FIRST` : `NULLS LAST`',
        replace:
          '(clause.compareOptions.nulls === `first`) === (direction === `ASC`) ? `NULLS FIRST` : `NULLS LAST`',
      },
      {
        find: '`desc` &&\n            leftValue != null &&\n            rightValue != null\n',
        replace: '`desc`\n',
      },
    ],
    rationale:
      'the design before this fix: SQL and the in-memory sort negate a whole desc comparison, so nulls sit opposite to `nulls`',
  },
  {
    id: `S02`,
    find: 'sql: `(${safePrefilter!.sql}) AND ${guards.join(` AND `)}`,',
    replace: 'sql: safePrefilter!.sql,',
    rationale:
      'a page in SQL reads the safe prefilter without its kind guards, so coerced candidates take page rows',
  },
  {
    id: `S03`,
    find: '        values.irregular ||\n',
    replace: '',
    rationale:
      'paging ignores rows whose order value or key SQLite orders differently',
  },
  {
    id: `S04`,
    find: '        (values.low !== `null` && values.low !== values.high) ||\n',
    replace: '',
    rationale: 'paging ignores an order field that mixes numbers and text',
  },
  {
    id: `S05`,
    find: '(values.high === `text` && !lexical)',
    replace: 'false',
    rationale: 'text pages in SQL under a locale or custom sort',
  },
  {
    id: `S06`,
    find: '? [number, new Date(number).toISOString()]',
    replace: '? [number]',
    rationale:
      "a number equality candidate drops the Date's ISO text, so SQL loses a Date equal to its epoch milliseconds",
  },
  {
    id: `S07`,
    find: 'literals.some((value) => exactLiteralKind(value) !== kind)',
    replace: 'false',
    rationale: 'a membership whose literals mix kinds counts as exact',
    // An open gap, not a closure: the coverage map records it for a
    // maintainer allowance.
    equivalent:
      "only a string list that mixes plain text with a lone surrogate, U+FFFD or NUL reaches it, and node:sqlite's SQLite 3.54.1 decodes such a JSON-bound list without loss, so its candidate stays exact here",
  },
  {
    id: `S08`,
    find: ' OR ${irregularTextSql(`key`)})`',
    replace: ')`',
    rationale: 'keys with a code point at U+E000 or above page in SQL',
  },
  {
    id: `S09`,
    find: 'queryParams.push(options.limit!, options.offset ?? 0)',
    replace: 'queryParams.push(options.limit!, 0)',
    rationale: 'SQL pages from the first row whatever the offset',
  },
  {
    id: `S10`,
    find: '    let pageInSql =\n      pageable &&',
    replace: '    let pageInSql =\n      false &&',
    rationale:
      'the adapter before this change: a page reads every matching row',
  },
  {
    id: `S11`,
    find: '      if (numberValues)\n',
    replace: '      if (false)\n',
    rationale:
      'the adapter before this change: a number equality sends SQL no candidate',
  },
  {
    id: `S12`,
    find: 'Number.isSafeInteger(value) && value! >= 0',
    replace: 'Number.isSafeInteger(value) && value! > 0',
    rationale: 'a zero limit or offset keeps the page in memory',
  },
  {
    id: `S13`,
    find: '    return guards.every((guard): guard is Array<string> => guard !== undefined)',
    replace:
      '    return guards.length > 0 &&\n      guards.every((guard): guard is Array<string> => guard !== undefined)',
    rationale:
      'an empty conjunction keeps the page in memory, unlike an absent where',
  },
  {
    id: `S14`,
    find: 'path.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(path[0]!)',
    replace:
      'path.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))',
    rationale:
      'a nested ref counts as a top-level field, so it takes the number candidate and SQL paging although SQLite reads NULL where JavaScript reads a property',
  },
  {
    id: `S15`,
    find: '  if (Number.isNaN(left) || Number.isNaN(right)) {\n    return Number(Number.isNaN(left)) - Number(Number.isNaN(right))\n  }\n',
    replace: '',
    rationale:
      'the in-memory sort ties NaN with every value, unlike the comparator, which orders it above them',
  },
  {
    id: `S16`,
    find: "length(CAST('a' AS BLOB)) = 1 AND ",
    replace: '',
    rationale:
      'a UTF-16 database pages text and keys in SQL, where its bytes order them otherwise',
  },
  {
    id: `S17`,
    find: '    for (const clause of orderBy) {',
    replace: '    for (const clause of orderBy.slice(0, 1)) {',
    rationale: 'the probe checks only the first order term',
  },
  {
    id: `S18`,
    find: '  if (expression.name === `and`) {',
    replace: '  if (expression.name === `and` || expression.name === `or`) {',
    rationale:
      'an `or` of exact leaves counts as an exact conjunction, so its kind guards drop rows that one leaf keeps',
  },
  {
    id: `S19`,
    edits: [
      {
        find: '    const tableSql = quoteIdentifier(tableName)\n    for (const clause of orderBy) {',
        replace:
          '    const tableSql = quoteIdentifier(tableName)\n    const probed = ((this as unknown as { probed?: Set<string> }).probed ??= new Set())\n    const probe = JSON.stringify([tableName, orderBy])\n    if (probed.has(probe)) return true\n    for (const clause of orderBy) {',
      },
      {
        find: '        return false\n    }\n    return true\n  }',
        replace:
          '        return false\n    }\n    probed.add(probe)\n    return true\n  }',
      },
    ],
    rationale:
      'the adapter remembers a passing probe, so a row written later that breaks the premise still pages in SQL',
  },
  {
    id: `S20`,
    find: "WHEN 'array' THEN 1",
    replace: "WHEN 'array' THEN 0",
    rationale:
      'an order field that holds arrays pages in SQL, which compares their JSON text',
  },
  {
    id: `S21`,
    find: ' AND (instr(${text}, char(0)) > 0 OR ${text} GLOB ${HIGH_CODE_POINT_GLOB}))`',
    replace: ')`',
    rationale:
      'all non-ASCII text counts as irregular, so text below U+E000 never pages in SQL',
  },
].map((mutant) => ({ ...mutant, file: FILE }))

function run(mutant) {
  const mark = join(mkdtempSync(join(tmpdir(), `db-mutant-`)), `applied`)
  return new Promise((done) => {
    execFile(
      `npx`,
      [
        `vitest`,
        `run`,
        `--config`,
        `vitest.mutants.config.ts`,
        `--bail`,
        `1`,
        ...ORACLES,
      ],
      {
        cwd: PACKAGE,
        timeout: TIMEOUT_MS,
        killSignal: `SIGKILL`,
        maxBuffer: 256 * 1024 * 1024,
        env: {
          ...process.env,
          CI: `1`,
          TANSTACK_DB_MUTANT: JSON.stringify(mutant),
          TANSTACK_DB_MUTANT_MARK: mark,
        },
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, ``)
        const failed = output.match(/^\s*×\s.*$/m)?.[0].trim()
        const law = output.match(
          /violated at checkpoint "[^"]*" \(law: ([^)]*)\)/,
        )?.[1]
        const applied =
          existsSync(mark) && readFileSync(mark, `utf8`).trim() !== ``
        if (!applied)
          done({ outcome: `not applied`, detail: output.slice(-2000) })
        else if (error?.killed) done({ outcome: `timeout` })
        else if (!error) done({ outcome: `survived` })
        // Only a failure that names a law kills; any other is an error.
        else if (failed && law)
          done({ outcome: `killed`, detail: `${failed} (law: ${law})` })
        else done({ outcome: `error`, detail: output.slice(-2000) })
      },
    )
  })
}

const only = process.argv
  .find((arg) => arg.startsWith(`--only=`))
  ?.slice(`--only=`.length)
  .split(`,`)
const selected = MUTANTS.filter((mutant) => !only || only.includes(mutant.id))
if (process.argv.includes(`--list`)) {
  for (const m of selected)
    console.log(`${m.id} ${m.equivalent ? `(equivalent) ` : ``}${m.rationale}`)
  process.exit(0)
}

// Validate every target before running anything.
const drifted = selected.filter((m) =>
  (m.edits ?? [m]).some(
    ({ find }) =>
      readFileSync(join(ROOT, m.file), `utf8`).split(find).length !== 2,
  ),
)
if (drifted.length > 0) {
  console.error(
    `mutant targets no longer match: ${drifted.map((m) => m.id).join(`, `)}`,
  )
  process.exit(1)
}

const failures = []
for (const mutant of selected) {
  const started = Date.now()
  const { outcome, detail } = await run(mutant)
  const expected = mutant.equivalent ? `survived` : `killed`
  const ok = outcome === expected || (mutant.equivalent && outcome === `killed`)
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(
    `${ok ? `ok ` : `BAD`} ${mutant.id} ${outcome} (${seconds}s) ${mutant.rationale}${detail && outcome === `killed` ? ` | ${detail}` : ``}`,
  )
  if (!ok) failures.push({ mutant, outcome, detail })
}
for (const { mutant, outcome, detail } of failures) {
  console.error(
    `\n${mutant.id} ${outcome}: ${mutant.rationale}\n${detail ?? ``}`,
  )
}
if (failures.length > 0) process.exit(1)
