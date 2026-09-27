---
'@tanstack/db': patch
---

Keep duplicate-key validation aligned with queued sync transactions. Quick delete-and-reinsert sequences now keep `subscribeChanges` in agreement, and canceling a queued delete cannot authorize a later insert to replace an existing row.
Late hydration chunks also cannot restore rows removed by applied adapter deletes or truncates.
