---
"@tanstack/db": patch
---

Fixed performance issue where using multiple `.where()` calls resulted in 40%+ slowdown by creating multiple filter operators in the query pipeline. The optimizer now implements the missing final step (step 3) of combining remaining WHERE clauses into a single AND expression. This applies to both queries with and without joins:
- Queries without joins: Multiple WHERE clauses are now combined before compilation
- Queries with joins: Remaining WHERE clauses after predicate pushdown are combined

This reduces filter operators from N to 1, making chained `.where()` calls perform identically to using a single `.where()` with `and()`.
