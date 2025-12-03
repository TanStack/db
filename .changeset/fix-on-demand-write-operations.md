---
"@tanstack/db": patch
"@tanstack/query-db-collection": patch
---

Fixed `SyncNotInitializedError` being thrown when calling write operations (`writeUpsert`, `writeInsert`, etc.) or mutations (`insert`, `update`, `delete`) on collections before sync is started. Previously, these operations required `startSync: true` to be explicitly set or `preload()` to be called first. Now, sync is automatically started when any write operation or mutation is called on an idle collection, enabling these operations to work immediately without explicit initialization.
