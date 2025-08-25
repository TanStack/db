---
"@tanstack/db": patch
---

Fix query optimizer to preserve outer join semantics by keeping residual WHERE clauses when pushing predicates to subqueries.
