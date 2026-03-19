---
'@tanstack/query-db-collection': patch
---

fix: Prevent stale query cache from re-inserting deleted items when a destroyed observer is recreated with gcTime > 0.
