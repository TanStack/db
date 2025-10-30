---
"@tanstack/db": patch
---

Fixed performance issue where using multiple `.where()` calls on queries without joins resulted in 40%+ slowdown. The optimizer now combines multiple WHERE clauses into a single AND expression, reducing the number of filter operators in the query pipeline from N to 1. This makes chaining `.where()` calls perform identically to using a single `.where()` with `and()`.
