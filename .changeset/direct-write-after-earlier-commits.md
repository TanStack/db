---
'@tanstack/query-db-collection': minor
---

Validate a Query Collection direct write against every earlier sync commit. In a persisted collection, a refetch can wait for the persistence lock before core accepts it. A direct write in that window used to validate against older rows: `writeUpdate` and `writeDelete` of a key that only the refetch held threw, and `writeInsert` of that key overwrote it. A direct write now waits until earlier commits are accepted.

Breaking: validation errors from `writeInsert`, `writeUpdate`, `writeDelete`, `writeUpsert` and `writeBatch` now reject the returned promise instead of throwing. `writeInsert` of a key that is already in the synced store now rejects with `DuplicateKeySyncError` in a persisted collection too.
