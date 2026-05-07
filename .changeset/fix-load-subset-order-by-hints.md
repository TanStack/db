---
'@tanstack/db': patch
---

Fix `loadSubset` orderBy hints for subqueries with computed selected fields. We now stop ref-following on non-ref select expressions and only pass `orderBy`/`limit` hints when each `orderBy` ref resolves to a real source field.
