---
"@tanstack/db": patch
"@tanstack/query-db-collection": patch
---

Fixed `SyncNotInitializedError` being thrown when calling write operations (`writeUpsert`, `writeInsert`, etc.) on collections before sync is started. Previously, write operations required `startSync: true` to be explicitly set or `preload()` to be called first. Now, sync is automatically started when any write operation is called on an idle collection, enabling write operations to work immediately without explicit initialization.
