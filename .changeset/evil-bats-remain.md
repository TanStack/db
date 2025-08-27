---
"@tanstack/db": patch
---

Fix bug that caused initial query results to have too few rows when query has orderBy, limit, and where clauses.
