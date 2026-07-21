---
'@tanstack/query-db-collection': patch
---

fix: invalidate predicate-scoped cache entries on manual-sync writes

In `syncMode: 'on-demand'`, manual-sync writes (`writeInsert`, `writeUpdate`, `writeDelete`, `writeUpsert`, and `writeBatch`) no longer retain the full post-write `syncedData` snapshot in predicate-scoped Query cache entries. Those entries may also encode ordering and pagination, so a normalized collection snapshot cannot preserve their shape.

Inactive and disabled entries are now removed so a later subscription reruns `queryFn`. Fetchable active entries are refetched without replacing their scoped data with the normalized snapshot; stale notifications are ignored until a newer server result arrives. Eager collections still update their full-result cache in place.
