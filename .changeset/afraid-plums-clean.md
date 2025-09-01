---
"@tanstack/db": patch
---

Fixed an optimization bug where orderBy clauses using a single-column array were not recognized as optimizable. Queries that order by a single column are now correctly optimized even when specified as an array.
