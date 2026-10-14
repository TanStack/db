---
'@tanstack/query-db-collection': patch
'@tanstack/db': patch
---

Keep served ordered pages whole when an on-demand Query Collection refetches. A refetch now reads each served ordered prefix with the same request shapes the ordered loader sends, so a row that moved between two served pages appears in the live query window. This covers `utils.refetch()` and Query refetches such as `invalidateQueries`. The `LoadSubsetOptions` and `LoadSubsetFn` docs now state this rule for sync adapters.
