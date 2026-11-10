---
'@tanstack/query-db-collection': patch
---

Remove obsolete persisted Query-owned rows on eager startup, including when initial data or cached results arrive before persisted restore. Preserve rows owned by other Queries.
