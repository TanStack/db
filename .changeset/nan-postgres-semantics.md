---
'@tanstack/db': minor
---

Adopt PostgreSQL float semantics for `NaN` in `where` clauses and ordering.

`NaN` (and invalid `Date` values, whose timestamp is `NaN`) previously had no consistent order — `NaN === NaN` is `false` in JavaScript, so `NaN` compared unequal to everything and could not be sorted or indexed deterministically. Following PostgreSQL, `NaN` is now treated as **equal to itself** and **greater than every other non-null value**:

- `eq(row.value, NaN)` matches rows whose value is `NaN`; `inArray(row.value, [NaN, ...])` matches them too.
- Range comparisons treat `NaN` as the greatest value: `gt`/`gte` include it, `lt`/`lte` exclude it.
- Ordering by a field containing `NaN` is now deterministic, with `NaN` sorting last (and `null` still ordered by `NULLS FIRST`/`NULLS LAST`).

`null`/`undefined` are unaffected: they continue to use three-valued logic (a comparison with `null` yields `UNKNOWN`).

This makes results independent of whether a query is served from an index or a full scan.
