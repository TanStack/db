---
"@tanstack/db": patch
---

Stop pushing where clauses that target renamed subquery projections so alias remapping stays intact, preventing a bug where a where clause would not be executed correctly.
