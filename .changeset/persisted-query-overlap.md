---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/query-db-collection': patch
---

Keep accepted Query results and parallel mutation-handler writes in order when SQLite persistence overlaps a refetch. Refresh the Query cache when a queued write applies, so an earlier row cannot overwrite the latest durable value.
