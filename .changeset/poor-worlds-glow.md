---
'@tanstack/db': patch
---

Added an `allowSyncWhilePersisting?: boolean` flag to core collection sync config. If present and true then this allows concurrent updates to sync into a collection whilst an optimistic transaction is persisting.
