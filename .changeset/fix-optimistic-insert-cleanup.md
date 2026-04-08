---
"@tanstack/db": patch
---

fix: clean up optimistic state when server returns a different key than the optimistic insert

When an `onInsert`/`onUpdate`/`onDelete` handler syncs server data back to the collection (via `writeInsert`, `writeUpdate`, `writeUpsert`, `writeDelete`, or `refetch`), the optimistic state under the original client key is now correctly removed if the server returns a different key. Previously, the client-key item persisted forever alongside the server-key item, causing duplication and stale `$synced: false` state.
