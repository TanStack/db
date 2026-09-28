---
'@tanstack/db': patch
---

Preserve DISTINCT and single-result query options through subquery optimization. Keep outer filters after DISTINCT and aggregate boundaries, and keep user objects with query-expression-shaped fields and containers intact in live-query results and predicate values. Reject duplicate `@tanstack/db` module instances in the same runtime.

`IR.isExpressionLike` now recognizes constructed IR expressions only. Plain objects with matching fields remain user data.
