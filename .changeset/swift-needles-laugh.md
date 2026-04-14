---
'@tanstack/db-sqlite-persistence-core': minor
---

Reconcile persisted SQLite indexes in the background so startup does not block on index creation, and drop stale persisted indexes by definition instead of by name.
