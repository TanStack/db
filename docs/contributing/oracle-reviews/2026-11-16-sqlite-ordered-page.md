# SQLite number equality and ordered pages: oracle review

Reviewed head: `38161678` on `fix/sqlite-limit-and-number-prefilter`, based on
`21c52a07`. The adapter last changed at `65479140`. The gap report ran at
`efe139d1`, then again at `38161678` for every mutant it left open, after two
commits that only add or change fixed histories of the ordered-page oracle;
the code weight was measured on the same adapter.

The change narrows safe-integer equality and membership on a top-level field
in SQL, and applies `limit` and `offset` in SQL when SQL provably keeps and
orders the same rows as the in-memory pipeline. The JavaScript row evaluator
and in-memory sort decide `loadSubset` results, and SQL is a candidate read
(PR #1997), so neither part may alter a public result. It also fixes two
differences between the in-memory sort and TanStack DB's comparator, which
`main` has too: `desc` placed nulls opposite to `nulls`, and NaN tied with
every value.

## Evidence block

- **Law:** at `loadSubset` return, an ordered page holds exactly the rows at
  its offset of TanStack DB's comparator order of the matching rows
  (`makeComparator` per term, then the key), or of the unpaged request where
  that comparator decides no single order; the unpaged request keeps the rows
  whose refs, read as JavaScript reads them, equal a literal, a Date equal to
  its epoch milliseconds; and under the work law's premise SQLite returns no
  more stored rows than the page holds. A safe-integer `eq` or `in` on an
  indexed top-level field has an exact SQL candidate that searches the named
  index; a nested ref keeps a full read. Authority: the adapter contract that
  the JavaScript evaluator and in-memory sort decide results with SQL as a
  candidate read (PR #1997); `makeComparator`, which orders live-query
  results; and the accepted goal that a paged live query reads its page.
- **Reach:** each normal campaign enforces a minimum through constructed
  histories, and each check rejects a construction that missed its states.
  `sqlite-persistence.ordered-page` (100 generated histories per campaign):
  `page in SQL` and `page in memory` at least 5 each, and `a null decides a
  descending page`, `a nested leaf keeps a JavaScript property` and `a nested
  order decides the page` at least 2 each; fixed seed 1116 gave 15, 85, 14, 7
  and 12, one random run 12, 88, 14, 6 and 15. The measured `the comparator
  orders the page` was 100 of 100 in both campaigns; the fixed history `rank
  mixes numbers and text` reaches the unpaged fallback.
  `sqlite-persistence.boolean-arity` (150): `number equality decides a row in
  SQL` and `coerced number equality decides a row` at least 2 each; fixed seed
  1994 gave 46 and 43, one random run 48 and 46.
  `sqlite-persistence.expression-index.number-equality` (8): `a Date equals an
  eq literal` and `a Date equals an in literal` at least 1 each; fixed seed
  1659005 gave 3 and 3, one random run 4 and 3.
- **RED:** `npx vitest run tests/sqlite-ordered-page-oracle.test.ts` at
  `38161678` with `src/sqlite-core-adapter.ts` from an earlier head:
  - `21c52a07` (`main`): 37 of 111 fail. Under `page`: both `a null decides a
    descending page` constructions, both generated units and the descending
    fixed histories (in memory, `desc` with `nulls: 'first'` returns the
    non-null rows first), and `rank holds NaN` and `NaN on the lowest key,
    nulls last` (a NaN row on the page where the comparator owes a number).
    Under `work`, as before, the `page in SQL` constructions. No history fails
    the filter law; a nested-order construction fails only when its order is
    descending over null `items`.
  - `5e999a9b` (the head of the first review round): 35 of 111 fail. Under
    `filter`: both nested-leaf constructions, `items length equals 2` and
    `items year is 2 or 3`, whose number candidate drops the arrays, strings
    and PlainDates that JavaScript keeps. Under `page`: both nested-order
    constructions and `items of each kind by length`, which SQL pages by key
    because it reads every length as NULL, and which passes on `21c52a07`;
    the descending-null constructions and fixed histories, since SQL and the
    in-memory sort both negate nulls for `desc`; and both NaN histories.
- **GREEN:** the same command on `38161678` passes all 111 ordered-page tests,
  `tests/sqlite-boolean-arity-oracle.test.ts` passes 23, and the Node
  `expression-index-oracle.test.ts` passes 58, one fewer than before because its
  fixed filter no longer asserts a candidate for the nested `meta.order`.
- **Mutant:** `node scripts/sqlite-page-mutants.mjs` applies fifteen
  production mutants in memory; a mutant counts as killed only when a failure
  names a law. Fourteen are killed. S01 the old null design (SQL and the
  in-memory sort both negate a `desc` comparison), S03 the irregular-rows
  probe skipped, S04 a field mixing numbers and text, S05 text under a locale
  or custom sort, S08 high keys, S09 an ignored offset and S15 NaN tied with
  every value fail `page`; S14 a nested ref taken as a top-level field fails
  `filter`; S02 the kind guards dropped, S10 the original full read, S12 a
  zero bound kept in memory and S13 an empty conjunction kept in memory fail
  `work`; S06 a number candidate without the Date's ISO text and S11 no number
  candidate fail boolean-arity's `existing SQLite judgment`. S07 survives (see
  Limits).
- **Limits:** node:sqlite in one process, no cursor, join, order on a computed
  field, native host, OPFS worker or multi-process WAL, and raw rows are not
  elapsed time. Where the comparator decides no single order, the page is only
  related to the unpaged request. Nested refs in the grammar read numbers. Two
  gaps stay open and need a maintainer allowance:
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
| `compareOrderByValues` | 11 / 84 | 62 / 94 |
| `applyInMemoryOrderBy` | 9 / 31 | 27 / 33 |
| `compileOrderByClauses` | 3 / 29 | 17 / 29 |
| `ensureIndexUnscheduled` | 4 / 33 | 27 / 46 |
| `markIndexRemovedUnscheduled` | 0 / 18 | 0 / 17 |
| `loadSubsetInternal` | 11 / 26 | 39 / 52 |
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
| Total | 40 / 492 | 436 / 684 |

The rerun at `38161678` kills two mutants that survived at `efe139d1`:
`Number.isNaN(left)` read as `undefined`, on a line this round added, by the
fixed history `NaN on the lowest key, nulls last`, and `compareOrderByValues`
returning `undefined` for a greater string, by `title holds private-use and
astral text` once its nulls go last. Every mutant of
`compareOrderByValues` and `applyInMemoryOrderBy` killed before is killed
after: 17 by the same key, and 3 in the `desc` statement this change
rewrote by the mutant of the same operator there. The first round found the same for
the six functions it edited. `isPageBound`'s `&&` read as `||` timed out in
both runs under the load of the selection, and `compileOrderByClauses`
returning empty SQL timed out once and survived once; the table and the JSON
count every mutant that no law killed as open.

The 248 mutants still alive are listed by key in
`2026-11-16-sqlite-ordered-page.json`. They stay open: 40 sit on lines this
change added or rewrote, and 208 on lines of the eight edited functions that
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
  request has; it timed out.
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
`21c52a07`, production bundle, on the adapter of `034f0865`: the package grows 1,236 bytes gzip
and 1,109 brotli, and `sqlite-core-adapter.js` grows 3,382 minified bytes. The
`app` scenario does not change: it ships no SQLite persistence. The growth is
the SQL text of the kind guards, the irregular-rows predicate and the order
probe, and the code that decides when a page is exact; this round's null,
NaN and top-level checks add 127 minified bytes.

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

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. Each property's `law` record and opening prose state the law, its authority and its limits. |
| ORC-002 | Applicable. The ordered-page model is its own equality over JavaScript property reads, `makeComparator` from `@tanstack/db` (the comparator that orders live-query results, not the adapter's) with a key tie-break, and a premise over stored values. The boolean-arity model folds an independent truth table. The Node model walks the stored path. None calls the adapter, its comparator or the SQL compiler. |
| ORC-003 | Applicable. The files keep the contract, model, grammar, driver and check beside their prose. |
| ORC-004 | Applicable. Reconstruction: twenty-one fixed histories rebuild, as members of the grammar, the datasets that rejected mutants and the review's counterexamples. Ablation: the page law against the unpaged request alone passed S01, the old null design, on `5e999a9b`; the oracle of `5e999a9b`, which had no nested refs, passed S14's design; without the zero-bound construction S12 survived; without the `and` shapes the empty-conjunction defect was invisible; without the locale and custom fixed histories S05 survived on the seeded campaigns. Range: limits 0..8 and one million, offsets absent or 0..8, integers -2..9, epochs 1, 2, 8 and 8.64e15, nested lengths 0..3 and years 2..3. Exclusion: negative, fractional and unsafe limits and offsets, Date and NaN literals, orders on computed fields, and nested refs that read a string, boolean or BigInt are outside the grammar and its laws. |
| ORC-005 | Applicable. The real adapter runs on node:sqlite (core) and BetterSqlite3 (Node). The counting driver records raw rows per Collection SELECT; a rejected load is an observation. |
| ORC-006 | Applicable. Trace and driver calibrations, a missing-state calibration per builder, and fifteen checked-in production mutants; fourteen fail at a named law, S07 survives. |
| ORC-007 | Applicable. Each generated property runs a fixed-seed campaign (1116, 1994, 1659005) and a random campaign with the same grammar, check and budget; failures print their seed, path and unit. |
| ORC-008 | Inapplicable. No stateful model. |
| ORC-009 | Applicable. `page in SQL` names the work law's premise, not production's decision; "irregular rows" names stored values that SQLite and the in-memory sort may order differently; the three wrong-design states name the premise under which that design changes an observation. |
| ORC-010 | Applicable. Drivers close their database and restore the global Temporal in `finally`; a check judges recorded checkpoints before construction reach. |
| ORC-011 | Applicable. The in-memory sort shared the old null design with SQL, so the page law against the unpaged request missed it; the comparator model is the formulation that catches it, and the unpaged relation stays the formulation where the comparator decides no order. |
| ORC-013 | Applicable. Zero bounds, the latest valid epoch and the next integer, tied rows with high keys, `nulls` first and last in both directions, and a nested plain object beside an array or a string of the same length sit on both sides of their boundaries. |
| ORC-014 | Inapplicable. No controlled provider. |
| ORC-015 | Applicable. Declared states, constructed builders with fresh objects, construction obligations judged by the check, and a missing-state calibration per builder; reach is in the evidence block. |
| ORC-016 | Applicable. The oracle files hold only `oracleProperty` registrations; index lifecycle cases stay in `sqlite-ordered-page.test.ts`. |
