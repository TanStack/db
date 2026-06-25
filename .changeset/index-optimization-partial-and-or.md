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
- Index-optimized `eq` and `IN` against `NaN` no longer leak `NaN`-valued rows. `NaN` is never equal to itself, but indexes still return such rows, so these results are now re-filtered against the full expression.
- String range conditions (`gt`/`gte`/`lt`/`lte`) on a collection using locale string collation (the default) are no longer served by the index. The index orders strings with `localeCompare` while the `where` evaluator compares them with standard relational operators, so an index range lookup could omit matching rows; these conditions now fall back to a full scan.
- Range conditions whose operand is not ordered the same way by the index and the `where` evaluator (arrays, plain objects, Temporal values, invalid Dates) now fall back to a full scan instead of using the index, which could otherwise omit matching rows.
- Range conditions on an index created with a custom comparator now fall back to a full scan, since the comparator's ordering may not match the `where` evaluator's relational operators.
- Range conditions on a field that contains a `NaN` value (or an invalid Date) now fall back to a full scan. Such values have no well-defined order and break the index traversal, which could otherwise drop genuinely matching rows.
