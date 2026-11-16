// Mutants for SQLite pages and number equality, run by `oracle-mutants.mjs`
// against their owner oracles.
//
// Usage: node scripts/sqlite-page-mutants.mjs [--only=S01,S02] [--list]
// The review record `docs/contributing/oracle-reviews/
// 2026-11-16-sqlite-ordered-page.md` reports the sweep. The Node
// expression-index oracle reads the core package's build, which this
// in-memory transform cannot reach, so it is not an owner here.
import { runMutants } from './oracle-mutants.mjs'

const FILE = `packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts`

const MUTANTS = [
  {
    id: `S01`,
    find: '(clause.compareOptions.nulls === `first`) === (direction === `ASC`)',
    replace: 'clause.compareOptions.nulls === `first`',
    rationale:
      'SQL places nulls as the request says, ignoring that the in-memory sort negates a desc comparison',
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
].map((mutant) => ({ ...mutant, file: FILE }))

await runMutants({
  packageDir: `packages/db-sqlite-persistence-core`,
  oracles: [
    `tests/sqlite-ordered-page-oracle.test.ts`,
    `tests/sqlite-boolean-arity-oracle.test.ts`,
  ],
  mutants: MUTANTS,
  timeoutMs: 10 * 60_000,
})
