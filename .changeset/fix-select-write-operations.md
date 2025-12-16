---
'@tanstack/query-db-collection': patch
---

Fix writeInsert/writeUpsert throwing error when collection uses select option

When a Query Collection was configured with a `select` option to extract items from a wrapped API response (e.g., `{ data: [...], meta: {...} }`), calling `writeInsert()` or `writeUpsert()` would corrupt the query cache and trigger the error: "select() must return an array of objects".

The fix routes cache updates through a new `updateCacheData` function that preserves the wrapper structure by using the `select` function to identify which property contains the items array (via reference equality), then updates only that property while keeping metadata intact.
