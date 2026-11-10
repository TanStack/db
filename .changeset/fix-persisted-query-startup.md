---
'@tanstack/query-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Remove obsolete persisted rows when an eager source's first complete result overlaps SQLite restore. Query Collection also handles initial data and cached results while preserving rows owned by other Queries, including when a persisting optimistic transaction holds restored rows before publication. TrailBase also accepts a sync boundary without the optional metadata API.
