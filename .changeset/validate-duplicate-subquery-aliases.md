---
"@tanstack/db": patch
---

Validate against duplicate collection aliases in subqueries. Prevents a bug where using the same alias for a collection in both parent and subquery causes empty results or incorrect aggregation values. Now throws a clear `DuplicateAliasInSubqueryError` when this pattern is detected, guiding users to rename the conflicting alias.
