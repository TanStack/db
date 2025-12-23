---
'@tanstack/electric-db-collection': patch
---

Fix duplicate key error when overlapping subset queries return the same row with different values.

When multiple subset queries return the same row (e.g., different WHERE clauses that both match the same record), the server sends `insert` operations for each response. If the row's data changed between requests (e.g., timestamp field updated), this caused a `DuplicateKeySyncError`. The adapter now tracks synced keys and converts subsequent inserts to updates.
