---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Fix syncedData not updating when manual write operations (writeUpsert, writeInsert, etc.) are called after async operations in mutation handlers. Previously, the sync transaction would be blocked by the persisting user transaction, leaving syncedData stale until the next sync cycle.
