---
'@tanstack/query-db-collection': minor
---

Validate a Query Collection direct write against every earlier sync commit, and order it before later refetch results.

Breaking: validation errors from `writeInsert`, `writeUpdate`, `writeDelete`, `writeUpsert` and `writeBatch` now reject the returned promise. Before, they were thrown synchronously. Await the promise and catch the error.

In a persisted collection, a direct write can now wait for an earlier sync commit's durable write before it applies. Before, a refetch could wait behind the persistence lock, and a direct write in that window validated against older rows: `writeUpdate` and `writeDelete` of a key that only the refetch held failed, and `writeInsert` of that key replaced it. A refetch that returns while the write waits is handled after the write. It keeps the write's rows if it started before the write was called, and it replaces them if it started after.

In a persisted collection, `writeInsert` of a key that is already in the synced store now rejects with `DuplicateKeySyncError`, as it does without persistence. Before, it silently replaced the row.
