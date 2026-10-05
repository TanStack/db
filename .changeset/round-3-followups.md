---
'@tanstack/db': patch
---

Fix two rare sync edge cases. A ready callback error from a truncate committed during sync entry now surfaces when the sync function returns, as it does for `markReady()`, instead of stopping the sync function and moving the collection to `error`. Row metadata now keeps an explicit `metadata.row.set` when a canceled earlier sync transaction turns a later insert into an idempotent re-insert.
