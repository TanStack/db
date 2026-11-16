# SQLite number equality and ordered pages: oracle review

Reviewed branch: `fix/sqlite-limit-and-number-prefilter`, two commits on
`21c52a07`. The first narrows safe-integer equality and membership in SQL. The
second applies `limit` and `offset` in SQL when SQL provably keeps and orders
the same rows as the in-memory pipeline.

## Contract and evidence

The JavaScript row evaluator and in-memory sort decide `loadSubset` results,
and SQL is a candidate read (PR #1997). Neither change may alter a public
result.

Number equality: the boolean-arity oracle gains number atoms over a field that
stores Dates beside numbers, and coerced twins over `1n`, `true`, `'1'`, the
epoch's ISO text, `NaN`, `1.5` and null. Before the change, its row-work law was
RED in 62 matrix cases and both direct number atoms (20 raw rows, no `WHERE`).
After it, the law is GREEN, and public rows match before and after. The Node
expression-index fixed filter gains safe-integer equality on a top-level and a
nested field. Both were RED before (no number predicate reached SQL) and are
GREEN with exact candidates, the bound number and the named index.

Ordered pages: the new ordered-page oracle runs 192 enumerated histories. On
the prior adapter, and after the number change alone, the 68 histories that
reach `page in SQL` were RED for the work law, and no history violated the page
or filter law. On the branch all 199 tests pass. Production mutants were RED
for the page law: null placement that ignores the `desc` negation (25
histories), the exact filter without kind guards (15), and paging without the
irregular-rows probe (12).

Suites on the branch, coverage disabled: SQLite core 104 files, 4,145 passed,
49 expected failures, 1 skipped, 2 todo; Node persistence 16 files, 265 passed.
Both package type checks and lint pass.

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law, its authority (the evaluator contract of PR #1997 and the paged-read goal) and its limits head the oracle and its `law` record. |
| ORC-002 | Applicable. The filter model is its own equality; the work premise reads stored values, not SQL. Order comes from production's unpaged request, a relation between two executions, not a copy of the comparator. |
| ORC-003 | Applicable. The oracle file states the laws, model, datasets, driver, checkpoint and limits beside the code. |
| ORC-004 | Applicable to the enumeration. Each dataset changes one fact of the plain dataset; the mutant and calibration results show which datasets distinguish which wrong design. The Date, BigInt, fraction, object, lone-surrogate and NUL datasets order alike in SQLite and JavaScript on this build and witness public rows only. |
| ORC-005 | Applicable. The real adapter runs on node:sqlite; a counting driver records the raw rows of each Collection SELECT; keys are observed at `loadSubset` return. |
| ORC-006 | Applicable. Three trace calibrations, one mutant driver bound to two histories, and three production mutants (run once, not checked in) fail at the named laws. |
| ORC-007 | Inapplicable. The property is enumerated, not generated. |
| ORC-008 | Inapplicable. No stateful model. |
| ORC-009 | Applicable. "Page in SQL" names the work law's premise; "irregular rows" names the stored values that SQLite and the in-memory sort may order differently. |
| ORC-010 | Applicable. The driver closes its database in `finally`; a failure keeps its checkpoint and law. |
| ORC-011 | Applicable. A shared fault in the in-memory sort would pass the page law; the filter law's independent equality and the work law do not depend on it. The comparator itself is outside this owner. |
| ORC-013 | Applicable. Each production mutant is rejected by a nearby dataset that differs from the plain one in a single value or key. |
| ORC-014 | Inapplicable. No controlled provider; node:sqlite is the real engine. |
| ORC-015 | Applicable. `page in SQL` and `page in memory` are declared enumerated states; the reach test reports 68 and 124. |
| ORC-016 | Applicable. The oracle file holds only `oracleProperty`; index lifecycle cases live in `sqlite-ordered-page.test.ts`. |

## Scope left open

Range filters (`gt`, `lt` and the cursor's `whereFrom`) keep the in-memory
page, so later pages of a scrolled list still read every row below the cursor.
Fractions, numbers past the signed 64-bit range, locale or custom string sort,
expression order fields, and `where` clauses with `or` or `not` also keep it.
Native hosts, OPFS workers and elapsed time are outside this owner.

## Follow-up: generated histories, gap report and code weight

Reviewed head: the follow-up commits on `3968a567` that end with the commit
adding this entry. The entry above describes `3968a567` and stays as recorded.

The ordered-page oracle replaced its enumeration with a generated grammar, the
boolean-arity oracle declared reach for its number atoms and now names the
adapter in `owns`, and a Node property generates safe-integer equality on an
indexed path. The grammar found one defect in the first version of this
change: an empty conjunction read every row. The production change otherwise
keeps its behavior and loses code: the exact filter returns only kind guards
over the safe prefilter, one helper finds a comparison's field and literal,
and the order probe finds the index of irregular rows in `sqlite_master`
within its one statement per order field.

### Evidence block

- **Law:** at `loadSubset` return, an ordered page holds exactly the unpaged
  request's rows at its offset; the unpaged request keeps the rows whose field
  equals a literal, a Date equal to its epoch milliseconds; and under the work
  law's premise SQLite returns no more stored rows than the page holds. A
  safe-integer `eq` or `in` on an indexed path has an exact SQL candidate that
  searches the named index. Authority: the adapter contract that the
  JavaScript evaluator and in-memory sort decide results with SQL as a
  candidate read (PR #1997), and the accepted goal that a paged live query
  reads its page.
- **Reach:** each normal campaign enforces a minimum through constructed
  histories, and each check rejects a construction that missed its state.
  `sqlite-persistence.ordered-page` (100 generated histories per campaign):
  `page in SQL` and `page in memory` at least 4 each; fixed seed 1116 gave 26
  and 82, one random run 29 and 79. `sqlite-persistence.boolean-arity` (150):
  `number equality decides a row in SQL` and `coerced number equality decides
  a row` at least 2 each; fixed seed 1994 gave 48 and 45, one random run 43
  and 40. `sqlite-persistence.expression-index.number-equality` (8): `a Date
  equals an eq literal` and `a Date equals an in literal` at least 1 each;
  fixed seed 1659005 gave 4 and 4, one random run 5 and 3.
- **RED:** with `src/sqlite-core-adapter.ts` from `21c52a07`, `npx vitest run
  tests/sqlite-ordered-page-oracle.test.ts` fails every `page in SQL`
  construction and both generated units under law `work`; the shrunk
  counterexample stores one row and asks for offset 1, and the adapter reads
  that row for an empty page. No history violates the page or filter law.
  `npx vitest run tests/sqlite-boolean-arity-oracle.test.ts` fails the four
  `number equality decides a row in SQL` constructions and both generated
  units in its work check (`and(eq-number)` reads 20 rows with no `WHERE`).
  With a core build of `21c52a07`, the Node property fails both constructions
  and both generated units under law `exact candidate`. On `10e91757`, the
  first version of this change, the `and()` and nested `and(and())` shapes
  fail the work law (one stored row at offset 1 reads that row for an empty
  page).
- **GREEN:** the same commands on the branch pass: 74 ordered-page tests and
  23 boolean-arity tests, and the Node file's 59 tests.
- **Mutant:** `node scripts/sqlite-page-mutants.mjs` applies thirteen
  production mutants in memory. Twelve fail a named law: S01 SQL null
  placement that ignores the `desc` negation, S03 the irregular-rows probe
  skipped, S04 a field mixing numbers and text, S05 text under a locale or
  custom sort, S08 high keys, and S09 an ignored offset fail `page`; S02 the
  kind guards dropped, S10 the original full read, S12 a zero bound kept in
  memory, and S13 an empty conjunction kept in memory fail `work`; S06 a
  number candidate without the Date's ISO text and S11 no number candidate
  fail boolean-arity's work check. S07 survives (see Limits).
- **Limits:** node:sqlite in one process, no cursor, join, order on a computed
  field, native host, OPFS worker or multi-process WAL, and raw rows are not
  elapsed time. S07, a membership whose literals mix kinds counted as exact,
  is an open gap: the prefilter gives a mixed list a candidate only for text
  that mixes plain characters with a lone surrogate, U+FFFD or NUL, and the
  SQLite builds of node:sqlite (3.54.1) and better-sqlite3 (3.53.2) decode a
  JSON-bound `"\ud800"` to bytes ED A0 80, distinct from U+FFFD (EF BF BD), so
  the candidate stays exact. A host whose SQLite decodes the escape lossily, or
  whose driver binds text only up to a NUL, would make it observable. The two
  drivers this review ran do neither; the browser and React Native drivers were
  not run. It needs a maintainer allowance.

### Gap report

`pnpm gap-report --package packages/db-sqlite-persistence-core --source
src/sqlite-core-adapter.ts --seed 1997 --only <mutants>` selects every mutant
of the functions this change edits or adds: 377 on `21c52a07` (the six edited
functions) and 554 on `6302035a` (those six and thirteen new ones). The
package's owners ran unchanged on each side; the only owner edit outside this
change makes `sync-metadata-missing-row-oracle.test.ts` write its `owns` as a
literal list, which both runs used, because the report refuses a computed one.
Both runs completed and were not provisional; each had 14 nondeterministic
tests, all `sqlite-resume.retired-storage` timing cases.

| Function | Killed before | Killed after |
| --- | ---: | ---: |
| `compileSafeSqlPrefilter` | 1 / 243 | 136 / 242 |
| `compileOrderByClauses` | 3 / 29 | 19 / 31 |
| `ensureIndexUnscheduled` | 4 / 33 | 27 / 46 |
| `markIndexRemovedUnscheduled` | 0 / 18 | 0 / 17 |
| `loadSubsetInternal` | 11 / 26 | 39 / 52 |
| `handleSchemaMismatch` | 1 / 28 | 1 / 27 |
| `sortsAsInMemory` | | 26 / 28 |
| `exactGuards` | | 35 / 36 |
| `exactLiteralKind` | | 14 / 19 |
| `numberEqualityCandidates` | | 7 / 8 |
| `indexedFieldPath` | | 6 / 8 |
| `compileFieldMembership` | | 4 / 6 |
| `isPageBound` | | 3 / 4 |
| `dropPersistedIndex` | | 0 / 4 |
| five other new helpers | | 26 / 26 |
| Total | 20 / 377 | 343 / 554 |

Every mutant killed before is killed after: 15 by the same stable key, and 5
whose statement this change rewrote by that statement's mutant (the
transaction of `ensureIndexUnscheduled`; `if (filter)`, its parameter push, and
the returned page of `loadSubsetInternal`, where `safePrefilter` became
`filter` and the return gained `pageInSql ?`).

`6302035a` moved the index lookup of `sortsAsInMemory` into the probe's
statement. The six mutants of the removed lookup left the report, four killed
and two open. Apart from the eight mutants below, every other mutant killed
on `f838f122`, the commit before it, is killed on `6302035a`: 341 by the same
stable key and 2 by the key that their statement now has (the probe's query,
and the last `return false`, whose ordinal moved).

Eight mutants reach the slow sync-metadata campaigns: one of `isPageBound`,
three of `compileOrderByClauses` and four of `loadSubsetInternal`, none on a
line that `6302035a` changed. Under the load of a whole selection each runs
for minutes, and its outcome varied between three runs of the same lines
(killed, timed out or survived). Run alone, all eight survive on `f838f122`
and on `6302035a`, so the table and the JSON count them as open.

The 211 mutants still alive are listed by key in
`2026-11-16-sqlite-ordered-page.json`. They stay open: 41 sit on lines this
change added or rewrote, and 170 on lines of the six edited functions that it
did not touch, which were gaps before it too. I ask for a maintainer allowance
for all of them. The 41, by reason:

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
  request has.
- 1 crashes the temporal oracle: with `!Number.isSafeInteger` gone, a `Date`
  literal reaches the number branch and the driver refuses to bind it. No
  oracle that observes rejections has a `Date` literal, and the ordered-page
  model has no authority for `Date`-literal equality.
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

### Code weight

`pnpm size:compare --packages db-sqlite-persistence-core --files` against
`21c52a07`, production bundle, at `6302035a`: the package grows 1,206 bytes
gzip and 1,053 brotli (at `3968a567` it grew 1,282 and 1,170), and
`sqlite-core-adapter.js` grows 3,255 minified bytes (3,987 at `3968a567`). The `app` scenario does not
change: it ships no SQLite persistence. The rest of the growth is the SQL text
of the kind guards, the irregular-rows predicate and the order probe.

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

### ORC-012 audit at this head

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. Each property's `law` record and opening prose state the law, its authority and its limits. |
| ORC-002 | Applicable. The ordered-page model is its own equality and a premise over stored values; order comes from the unpaged request. The boolean-arity model folds an independent truth table. The Node model walks the stored path. None calls the evaluator, the comparator or the SQL compiler. |
| ORC-003 | Applicable. The files keep the contract, model, grammar, driver and check beside their prose. |
| ORC-004 | Applicable. Reconstruction: sixteen fixed histories rebuild the enumerated datasets that rejected mutants, as members of the grammar. Ablation: without the zero-bound construction S12 survived; without the `and` shapes the empty-conjunction defect was invisible; without the locale and custom fixed histories S05 survived on the seeded campaigns. Range: limits 0..8 and one million, offsets absent or 0..8, integers -2..9, epochs 1, 2, 8 and 8.64e15. Exclusion: negative, fractional and unsafe limits and offsets, Date and NaN literals, and orders on computed fields are outside the grammar and its laws. |
| ORC-005 | Applicable. The real adapter runs on node:sqlite (core) and BetterSqlite3 (Node). The counting driver records raw rows per Collection SELECT; a rejected load is an observation. |
| ORC-006 | Applicable. Trace and driver calibrations, a missing-state calibration per builder, and thirteen checked-in production mutants; twelve fail at a named law, S07 survives. |
| ORC-007 | Applicable. Each generated property runs a fixed-seed campaign (1116, 1994, 1659005) and a random campaign with the same grammar, check and budget; failures print their seed, path and unit. |
| ORC-008 | Inapplicable. No stateful model. |
| ORC-009 | Applicable. `page in SQL` names the work law's premise, not production's decision; "irregular rows" names stored values that SQLite and the in-memory sort may order differently. |
| ORC-010 | Applicable. Drivers close their database in `finally`; a check judges recorded checkpoints before construction reach. |
| ORC-011 | Applicable. A shared fault in the in-memory sort would pass the page law; the filter and work laws do not depend on it. |
| ORC-013 | Applicable. Zero bounds, the latest valid epoch and the next integer, and tied rows with high keys sit on both sides of their boundaries. |
| ORC-014 | Inapplicable. No controlled provider. |
| ORC-015 | Applicable. Declared states, constructed builders with fresh objects, construction obligations judged by the check, and a missing-state calibration per builder; reach is in the evidence block. |
| ORC-016 | Applicable. The oracle files hold only `oracleProperty` registrations; index lifecycle cases stay in `sqlite-ordered-page.test.ts`. |
