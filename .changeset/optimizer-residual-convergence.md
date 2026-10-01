---
'@tanstack/db': patch
---

Keep pushed outer-join predicates residual across optimizer passes and preserve source-free WHERE clauses on joins. This prevents repeated filters and ensures joined queries still honor constant conditions.
