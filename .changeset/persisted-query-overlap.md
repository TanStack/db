---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/query-db-collection': patch
---

Keep accepted Query results and later writes in order when SQLite persistence overlaps a refetch or an awaited mutation-handler write.
