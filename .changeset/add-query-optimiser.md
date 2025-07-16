---
"@tanstack/db": patch
---

Add query optimizer with predicate pushdown

Implements automatic query optimization that moves WHERE clauses closer to data sources, reducing intermediate result sizes and improving performance for queries with joins.
