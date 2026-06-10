---
'@tanstack/db': patch
---

Fix incorrect results from index-optimized `where` clauses that combine indexed and non-indexed conditions.

- `OR` expressions are now only served from indexes when every disjunct can use an index; otherwise the query falls back to a full scan. Previously, rows matched only by a non-indexed disjunct were missing from the result.
- `AND` expressions still use indexes for the conditions that have them, but the remaining conditions are now enforced by re-checking each candidate row against the full expression. Previously, non-indexed conditions were silently dropped, returning rows that did not match the query.
- Compound range conditions (e.g. `age > 5 AND age < 10`) combined with conditions on other fields no longer ignore those other conditions.
