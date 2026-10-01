---
'@tanstack/db': patch
---

Keep residual WHERE clauses marked as residual when the optimizer combines the remaining clauses of an outer-join query, so predicates pushed into a subquery are not pushed again on every pass until the iteration limit.
