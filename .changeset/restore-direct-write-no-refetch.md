---
'@tanstack/query-db-collection': patch
---

Prevent direct writes from automatically refetching active Query subsets. On-demand writes patch changed keys already present in active raw arrays or directly selected response arrays. In both eager and on-demand modes, cache patches preserve Query error, invalidation, and freshness state; direct writes no longer clear a prior fetch error or mark stale data fresh. Older in-flight or queued results cannot undo an accepted write, and derived cache responses are not replayed over it on resubscribe. Callers choose when to refetch exact scoped results. Query Core 5.90.20 or later is required so an explicit refetch can replace a pre-write request while its cache is empty.
