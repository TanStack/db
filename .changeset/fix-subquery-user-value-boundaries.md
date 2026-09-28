---
'@tanstack/db': patch
---

Preserve DISTINCT through joined subquery optimization. Keep user objects with query-expression-shaped fields intact in live-query results and predicate values.

`IR.isExpressionLike` now recognizes constructed IR expressions only. Plain objects with matching fields remain user data.
