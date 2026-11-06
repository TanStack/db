---
'@tanstack/rxdb-db-collection': patch
---

Reject an update whose document no longer exists in RxDB, for example because another tab deleted it while the update waited. The update now fails with `UpdateKeyNotFoundError` and its optimistic change rolls back. Before, the adapter skipped it and reported success, so the write was silently lost.
