---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Settle subset loads only after their committed rows and events are visible. A
commit receipt now rejects with `AbortError` when cancellation wins before
application and ignores later aborts. Preserve causal publication,
cancellation, persistence, and error handling across the affected sync
adapters.
