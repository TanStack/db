---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Start idle collections only after mutation validation succeeds, and publish authoritative Query Collection refetch results without stale intermediate snapshots.
