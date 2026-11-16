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
