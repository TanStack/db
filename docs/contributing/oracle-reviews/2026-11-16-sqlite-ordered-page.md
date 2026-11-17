# SQLite number equality and ordered pages: oracle review

Reviewed head: `608eb6da` on `fix/sqlite-limit-and-number-prefilter`, based on
`21c52a07`. The adapter last changed at `dc644d4f`, and the oracles at
`16f5f5e3`; `608eb6da` changes only an ordinary unit test. The gap report ran
at `9cc3549e`, then again at `16f5f5e3` for every mutant it left open, after a
commit that only adds a construction to the ordered-page oracle; the code
weight and the write cost were measured on the same adapter.

The change narrows safe-integer equality and membership on a top-level field
in SQL, and applies `limit` and `offset` in SQL when SQL provably keeps and
orders the same rows as the in-memory pipeline. The JavaScript row evaluator
and in-memory sort decide `loadSubset` results, and SQL is a candidate read
(PR #1997), so neither part may alter a public result. SQL pages only on a
UTF-8 database, whose bytes order text below U+E000 as JavaScript does. It
also fixes two differences between the in-memory sort and TanStack DB's
comparator, which `main` has too: `desc` placed nulls opposite to `nulls`, and
NaN tied with every value.

## Evidence block

- **Law:** at `loadSubset` return, an ordered page holds exactly the rows at
  its offset of TanStack DB's comparator order of the matching rows
  (`makeComparator` per term, then the key), or of the unpaged request where
  that comparator decides no single order; the unpaged request keeps the rows
  whose refs, read as JavaScript reads them, equal a literal, a Date equal to
  its epoch milliseconds; both hold before and after later writes; and under
  the work law's premise, which needs a UTF-8 database, SQLite returns no more
  stored rows than the page holds. A safe-integer `eq` or `in` on an indexed
  top-level field has an SQL candidate that searches the named index and holds
  the matches and, beside them, exactly the rows that hold a literal as a
  BigInt, a boolean or its Date's ISO text, which JavaScript drops; a nested
  ref keeps a full read. Authority: the adapter contract that
  the JavaScript evaluator and in-memory sort decide results with SQL as a
  candidate read (PR #1997); `makeComparator`, which orders live-query
  results; and the accepted goal that a paged live query reads its page.
- **Reach:** each normal campaign enforces a minimum through constructed
  histories, and each check rejects a construction that missed its states.
  `sqlite-persistence.ordered-page` (100 generated histories per campaign):
  `page in SQL` at least 7 and `page in memory` at least 8; `a null decides a
  descending page`, `a nested leaf keeps a JavaScript property`, `a nested
  order decides the page`, `a UTF-16 database orders text differently` and `a
  later write breaks the premise` at least 2 each; `a later term breaks the
  premise` and `an or keeps a row through one leaf` at least 1 each. In that
  order (SQL, memory, null, nested leaf, nested order, UTF-16, later write,
  later term, `or`), fixed seed 1116 gave 13, 87, 12, 2, 13, 4, 3, 3 and 1,
  and one random run 19, 81, 13, 2, 5, 4, 6, 2 and 0. The measured `the
  comparator orders the page` was 100 of 100 in both campaigns; the fixed
  history `rank mixes numbers and text` reaches the unpaged fallback.
  `sqlite-persistence.boolean-arity` (150): `number equality decides a row in
  SQL` and `coerced number equality decides a row` at least 2 each; fixed seed
  1994 gave 46 and 43, one random run 30 and 48.
  `sqlite-persistence.expression-index.number-equality` (8): `a Date equals an
  eq literal` and `a Date equals an in literal` at least 1 each; fixed seed
  1659005 gave 3 and 3, one random run 4 and 3.
- **RED:** `npx vitest run tests/sqlite-ordered-page-oracle.test.ts` at
  `16f5f5e3` with `src/sqlite-core-adapter.ts` from an earlier head:
  - `b39c83a8` (the head the second review read): 9 of 159 fail, all
    under `page`: both `a UTF-16 database orders text differently`
    constructions, `titles é and Ā on a UTF-16le database`, both generated
    units (each a UTF-16le history), and the two constructions' missing-state
    calibrations. SQL paged UTF-16le text and keys by bytes that put Ā before
    é.
  - `5e999a9b` (the head of the first round): 43 of 159 fail. Under `filter`:
    the nested-leaf constructions and fixed histories, whose number candidate
    drops the arrays, strings and PlainDates that JavaScript keeps. Under
    `page`: the nested-order constructions and `items of each kind by
    length`, which SQL pages by key because it reads every length as NULL;
    the descending-null constructions and fixed histories; both NaN
    histories; and the UTF-16le histories.
  - `21c52a07` (`main`): 47 of 159 fail. Under `page`, each a page that a
    descending null or NaN decides: the descending-null constructions and
    fixed histories, both NaN histories, the generated units, and other
    constructions whose generated order is descending over nulls. Under
    `work`, as `main` reads every row, the `page in SQL` constructions and
    fixed histories. No history fails the filter law, and `items of each kind
    by length` passes.
  The Node property's calibration `the candidate holds only the rows
  JavaScript keeps` fails law `candidate`: the exact candidate the first round
  claimed is false on its BigInt, boolean and ISO-text rows.
- **GREEN:** the same command on `16f5f5e3` passes all 159 ordered-page tests,
  `tests/sqlite-boolean-arity-oracle.test.ts` passes 23, and the Node
  `expression-index-oracle.test.ts` passes 59. `review-check.ts` and the
  UTF-16le reproduction print `same` against the build of this head.
- **Mutant:** `node scripts/sqlite-page-mutants.mjs` applies twenty-one
  production mutants in memory; a mutant counts as killed only when a failure
  names a law. Twenty are killed. Under `page`: S01 the old null design (SQL
  and the in-memory sort both negate a `desc` comparison), S03 the
  irregular-rows probe skipped, S04 a field mixing numbers and text, S05 text
  under a locale or custom sort, S08 high keys, S09 an ignored offset, S15
  NaN tied with every value, S16 a UTF-16 database paged in SQL, S17 a probe
  of the first order term only, S18 an `or` of exact leaves read as a
  conjunction, S19 a passing probe remembered across later writes, and S20
  arrays in an order field counted as regular. Under `filter`: S14 a nested
  ref taken as a top-level field. Under `work`: S02 the kind guards dropped,
  S10 the original full read, S12 a zero bound kept in memory, S13 an empty
  conjunction kept in memory, and S21 all non-ASCII text counted as
  irregular. S06 a number candidate without the Date's ISO text and S11 no
  number candidate fail boolean-arity's `existing SQLite judgment`. S07
  survives (see Limits). S16 to S21 survive every core oracle of `b39c83a8`.
- **Limits:** node:sqlite in one process, no cursor, join, order on a computed
  field, OPFS worker or multi-process WAL, and raw rows are not elapsed time.
  This change adds the adapter's first production reads of `sqlite_master`, in
  `ensureIndex` and in every pageable load. A one-off check under workerd
  (wrangler 4.158.0 `dev --local`, a Durable Object's SQLite) ran
  `ensureIndex` and pages by an integer and a text field in SQL with the
  owed rows, and moved the page to memory after a text rank was written; no
  checked-in test runs it. The Expo, Capacitor, React Native, Tauri, Electron
  and browser (wa-sqlite) hosts were not run. Where the comparator decides
  no single order, the page is only related to the unpaged request, and the
  page before the writes is not judged. Nested refs in the grammar read
  numbers. Two gaps stay open and need a maintainer allowance:
  - S07, a membership whose literals mix kinds counted as exact: the prefilter
    gives a mixed list a candidate only for text that mixes plain characters
    with a lone surrogate, U+FFFD or NUL, and the SQLite builds of node:sqlite
    (3.54.1) and better-sqlite3 (3.53.2) decode a JSON-bound `"\ud800"` to
    bytes ED A0 80, distinct from U+FFFD (EF BF BD), so the candidate stays
    exact. A host whose SQLite decodes the escape lossily, or whose driver
    binds text only up to a NUL, would make it observable; the browser and
    React Native drivers were not run.
  - `main`'s string, boolean and BigInt `eq` and `in` candidates read a nested
    ref's stored JSON too, so a Temporal getter of those kinds loses matches:
    `eq(d.monthCode, 'M01')`, `eq(d.inLeapYear, true)` and
    `eq(i.epochNanoseconds, 5000000n)` return no row on `21c52a07` and on this
    head. Giving them only to top-level fields would drop the candidate of
    every nested plain-object equality, so this change leaves them. The
    ordered-page oracle owns the cell; its grammar has no such getter.
  A top-level field named like an `Object.prototype` member, such as
  `constructor`, reads the inherited member in JavaScript where a row lacks
  it, and NULL in SQLite; no history names one.

## Gap report

`pnpm gap-report --package packages/db-sqlite-persistence-core --source
src/sqlite-core-adapter.ts --seed 1997 --only <mutants>` selects every mutant
of the functions this change edits or adds: 492 on `21c52a07` (the eight
edited functions) and 684 on this branch (those eight and thirteen new ones).
The `21c52a07` side ran in two parts: 377 for the six functions edited in the
first round, reported there, and 115 for `compareOrderByValues` and
`applyInMemoryOrderBy`, which this round edits. The package's owners ran
unchanged on each side; the only owner edit outside this change makes
`sync-metadata-missing-row-oracle.test.ts` write its `owns` as a literal list,
which every run used, because the report refuses a computed one. Every run
completed and was not provisional; each had 14 nondeterministic tests, all
`sqlite-resume.retired-storage` timing cases.

| Function | Killed before | Killed after |
| --- | ---: | ---: |
| `compileSafeSqlPrefilter` | 1 / 243 | 140 / 246 |
| `compareOrderByValues` | 11 / 84 | 75 / 94 |
| `applyInMemoryOrderBy` | 9 / 31 | 27 / 33 |
| `compileOrderByClauses` | 3 / 29 | 18 / 29 |
| `ensureIndexUnscheduled` | 4 / 33 | 27 / 46 |
| `markIndexRemovedUnscheduled` | 0 / 18 | 0 / 17 |
| `loadSubsetInternal` | 11 / 26 | 45 / 52 |
| `handleSchemaMismatch` | 1 / 28 | 1 / 27 |
| `sortsAsInMemory` | | 26 / 28 |
| `exactGuards` | | 35 / 36 |
| `exactLiteralKind` | | 14 / 19 |
| `numberEqualityCandidates` | | 8 / 8 |
| `indexedFieldPath` | | 6 / 8 |
| `compileFieldMembership` | | 4 / 6 |
| `isPageBound` | | 3 / 4 |
| `dropPersistedIndex` | | 0 / 4 |
| five other new helpers | | 27 / 27 |
| Total | 40 / 492 | 456 / 684 |

The rerun at `16f5f5e3` kills five mutants that survived at `9cc3549e`. Four
sit on the string-membership candidate this change rewrote; the new grammar
had moved the seeded histories that reached it, and the construction `page in
SQL under a text membership` now kills them under `work`. The fifth,
`compareOrderByValues`'s `&&` read as `||` on a line `main` already had,
falls to the random campaign on some seeds only. Every mutant of
`compareOrderByValues` and `applyInMemoryOrderBy` killed before is killed
after: 17 by the same key, and 3 in the `desc` statement this change
rewrote by the mutant of the same operator there. The first round found the
same for the six functions it edited. `isPageBound`'s `&&` read as `||` timed
out at `9cc3549e` and survived the rerun; the table and the JSON count every
mutant that no law killed as open.

The 228 mutants still alive are listed by key in
`2026-11-16-sqlite-ordered-page.json`. They stay open: 40 sit on lines this
change added or rewrote, and 188 on lines of the eight edited functions that
it did not touch, which were gaps before it too (by key, for the two
functions this round adds). I ask for a maintainer allowance for all of them.
The 40, by reason:

- 6 change text exactness that these hosts keep: `exactLiteralKind`'s NUL,
  U+FFFD and lone-surrogate exclusions (5) and the mixed-kind check of
  `exactGuards` (S07). See Limits.
- 17 change only which indexes exist: `indexedFieldPath`'s guard,
  `dropPersistedIndex`, the stale-predicate rebuild and the compiler-upgrade
  drop in `ensureIndexUnscheduled`, and the drops in
  `markIndexRemovedUnscheduled` and `handleSchemaMismatch`. A missing or extra
  index changes read and write cost, not a result; only an observation of the
  database schema could see them.
- 2 replace `return false` with `return undefined` in `sortsAsInMemory`, which
  its caller reads the same way.
- 4 drop or flip `supported: true` on candidate fragments whose callers read
  only their SQL and bindings.
- 7 sit in the range candidate that this change moved onto `refAndLiteral`.
  No core oracle judges range candidates; the Node expression-index oracle's
  range axis does, outside this package's report.
- 1 makes `isPageBound` accept a negative or fractional bound, which no legal
  request has; it timed out once and survived once.
- 1 lets `loadSubsetInternal` page without an order term; no history asks for
  that.
- 1 reads `guards.length` through the report's `?.` mutant, which the report
  counts as not distinguished; replacing `?.` with `.` in the source makes the
  page law reject the paged requests without a `where`.
- 1 keeps `pageInSql` after the bindings exceed the host's limit. It needs a
  paged exact request that binds more than 997 values, such as a BigInt
  membership of 998 values. The work law would then need to say that a host
  that cannot bind the page's values reads every row, a law decision for the
  maintainer.

## Code weight

`pnpm size:compare --packages db-sqlite-persistence-core --files` against
`21c52a07`, production bundle: the package grows 1,257 bytes gzip and 1,081
brotli, and `sqlite-core-adapter.js` grows 3,416 minified bytes. The `app`
scenario does not change: it ships no SQLite persistence. The growth is the
SQL text of the kind guards, the irregular-rows predicate and the order
probe, and the code that decides when a page is exact.

Refactors tried and dropped:

- Binding a number equality's candidates as one JSON list through the
  membership compiler saved about 60 minified bytes, but the fixed-filter law
  of the Node expression-index oracle requires the filter value itself as a
  bound parameter.
- Adding the kind guards to every prefilter, so the exact filter disappears,
  would make each read that pages in JavaScript evaluate the guards' JSON per
  candidate row.
- Dropping the expression-index requirement from the order probe would remove
  its index lookup, but would page unindexed fields in SQL after full-table
  probes on every load, a change of design, not a refactor.
- Dropping the stale-predicate rebuild in `ensureIndex` would leave a future
  release that changes the predicate unable to page until a manual rebuild.

## Write cost

Each `createIndex` index on a single top-level field also keeps a partial
index of the rows whose value or key SQLite may order differently, so every
write evaluates its predicate. 100,000 inserts in batches of 10,000 through
`applyCommittedTx` on node:sqlite in memory, five runs each, median:

| Indexed field holds | `21c52a07` | This change | Rows in the partial index | Database pages |
| --- | ---: | ---: | ---: | ---: |
| integers | 645 ms | 720 ms | 0 | 5,075 → 5,077 |
| Dates | 766 ms | 852 ms | 100,001 (every row) | 9,272 → 9,721 |

A field that holds Dates, fractions, BigInts, objects or arrays puts every row
in the partial index, so it pays this cost and never pages in SQL.

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. Each property's `law` record and opening prose state the law, its authority and its limits. |
| ORC-002 | Applicable. The ordered-page model is its own equality over JavaScript property reads, `makeComparator` from `@tanstack/db` (the comparator that orders live-query results, not the adapter's) with a key tie-break, writes that insert, merge or remove rows as the adapter's mutations are defined, and a premise over stored values; its UTF-16le order compares the bytes of each code unit, low byte first. The boolean-arity model folds an independent truth table. The Node model walks the stored path. None calls the adapter, its comparator or the SQL compiler. |
| ORC-003 | Applicable. The files keep the contract, model, grammar, driver and check beside their prose. |
| ORC-004 | Applicable. Reconstruction: twenty-seven fixed histories rebuild, as members of the grammar, the datasets that rejected mutants and the review's counterexamples. Ablation: the page law against the unpaged request alone passed S01, the old null design, on `5e999a9b`; the oracle of `5e999a9b`, which had no nested refs, passed S14's design; the oracle of `b39c83a8`, which wrote once, built only conjunctions, had ASCII text and keys on UTF-8, no arrays in an order field, and broke the premise only on the lead term, passed S16 to S21; without the zero-bound construction S12 survived; without the `and` shapes the empty-conjunction defect was invisible; without the locale and custom fixed histories S05 survived on the seeded campaigns. Range: limits 0..8 and one million, offsets absent or 0..8, integers -2..9, epochs 1, 2, 8 and 8.64e15, nested lengths 0..3 and years 2..3, zero to two writes, and UTF-8 or UTF-16le. Exclusion: negative, fractional and unsafe limits and offsets, Date and NaN literals, orders on computed fields, and nested refs that read a string, boolean or BigInt are outside the grammar and its laws. |
| ORC-005 | Applicable. The real adapter runs on node:sqlite (core) and BetterSqlite3 (Node). The counting driver records raw rows per Collection SELECT; a rejected load is an observation. |
| ORC-006 | Applicable. Trace and driver calibrations, a missing-state calibration per builder, and twenty-one checked-in production mutants; twenty fail at a named law, S07 survives. |
| ORC-007 | Applicable. Each generated property runs a fixed-seed campaign (1116, 1994, 1659005) and a random campaign with the same grammar, check and budget; failures print their seed, path and unit. |
| ORC-008 | Inapplicable. No stateful model. |
| ORC-009 | Applicable. `page in SQL` names the work law's premise, not production's decision; "irregular rows" names stored values that SQLite and the in-memory sort may order differently; the seven wrong-design states name the premise under which that design changes an observation. |
| ORC-010 | Applicable. Drivers close their database and restore the global Temporal in `finally`; a check judges recorded checkpoints before construction reach. |
| ORC-011 | Applicable. The in-memory sort shared the old null design with SQL, so the page law against the unpaged request missed it; the comparator model is the formulation that catches it, and the unpaged relation stays the formulation where the comparator decides no order. |
| ORC-013 | Applicable. Zero bounds, the latest valid epoch and the next integer, tied rows with high keys, `nulls` first and last in both directions, a nested plain object beside an array or a string of the same length, é and Ā in titles and keys on UTF-8 (SQL page) and on UTF-16le (memory), arrays alone in `rank` beside integers alone, an `or` beside a conjunction of the same exact leaves, and integer ranks before and after a write of the text `'4'` sit on both sides of their boundaries. |
| ORC-014 | Inapplicable. No controlled provider. |
| ORC-015 | Applicable. Declared states, constructed builders with fresh objects, construction obligations judged by the check, and a missing-state calibration per builder; reach is in the evidence block. |
| ORC-016 | Applicable. The oracle files hold only `oracleProperty` registrations; index lifecycle cases stay in `sqlite-ordered-page.test.ts`. |
