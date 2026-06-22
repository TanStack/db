---
'@tanstack/db': patch
---

Fix incorrect results from index-optimized `where` clauses that combine indexed and non-indexed conditions.

- `OR` expressions are now only served from indexes when every disjunct can use an index; otherwise the query falls back to a full scan. Previously, rows matched only by a non-indexed disjunct were missing from the result.
- `AND` expressions still use indexes for the conditions that have them, but the remaining conditions are now enforced by re-checking each candidate row against the full expression. Previously, non-indexed conditions were silently dropped, returning rows that did not match the query.
- Compound range conditions (e.g. `age > 5 AND age < 10`) combined with conditions on other fields no longer ignore those other conditions.
- Compound range conditions sharing the same boundary value (e.g. `age >= 5 AND age > 5`) now apply the strictest bound regardless of the order the conditions appear in, using the same value comparison semantics as the indexes (dates, locale strings, ...).
- Compound range conditions that only bound one side (e.g. `age > 5 AND age >= 8`) no longer return an empty result.
- Strict range comparisons (`gt`/`lt`) on BTree-indexed fields holding normalized values such as dates now correctly exclude the boundary value.
- Compound range conditions with a `null`/`undefined` bound (e.g. `gt(score, undefined)`) now re-filter against the full expression instead of returning index-ordered rows, matching the semantics of a full scan (a comparison against `null`/`undefined` is never true).
- Index-optimized `eq`, `IN`, and range queries on a field that has rows with `null`/`undefined` values no longer leak those rows into results. BTree indexes store and return such rows (they sort as the smallest key), but a comparison against `null`/`undefined` is never true, so these results are now re-filtered against the full expression to stay equivalent to a full scan.
