---
'@tanstack/db': patch
---

Preserve DISTINCT and single-result query options through subquery optimization. Keep outer filters after DISTINCT and aggregate boundaries, and keep user objects with query-expression-shaped fields and containers intact in live-query results and predicate values. Evaluate selected arrays of references and preserve user fields named `__refProxy`. Reject constructed values that cross `@tanstack/db` module copies while allowing independent SSR module loads.

`IR.isExpressionLike` now recognizes constructed IR expressions only. Plain objects with matching fields remain user data.
