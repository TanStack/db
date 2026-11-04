---
'@tanstack/rxdb-db-collection': patch
---

Remove a field from a synced row when an RxDB document update removes it. RxDB change events carry the whole document, so the adapter now replaces the row instead of merging the update into it.
