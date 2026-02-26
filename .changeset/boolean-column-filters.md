---
"@tanstack/db": patch
---

Support bare boolean column references in `where()` and `having()` clauses. Previously, filtering on a boolean column required `eq(col.active, true)`. Now you can write `.where(({ u }) => u.active)` and `.where(({ u }) => not(u.active))` directly.
