---
"@tanstack/db-collections": patch
---

Replace `queryCollection.invalidate()` with `queryCollection.refetch()`.

This means that we actually wait for the collection to be updated before
discarding local optimistic state.
