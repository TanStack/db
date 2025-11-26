---
"@tanstack/db": patch
---

Fixed `SyncNotInitializedError` being thrown when calling write operations (`writeUpsert`, `writeInsert`, etc.) on collections with `syncMode: 'on-demand'`. Previously, write operations required `startSync: true` to be explicitly set, even though on-demand collections don't fetch data automatically. Now, sync is automatically started for on-demand collections, enabling write operations to work immediately while maintaining the on-demand loading behavior.
