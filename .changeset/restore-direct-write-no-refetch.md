---
'@tanstack/query-db-collection': patch
---

Prevent direct writes from automatically refetching active Query subsets. On-demand writes patch changed keys already present in active raw arrays or directly selected response arrays, except when the Query is shared with another Collection. In both eager and on-demand modes, cache patches preserve Query error, invalidation, and freshness state; an idle eager cache seed moves from pending to success without advancing its freshness timestamp. Direct writes no longer clear a prior fetch error or mark stale data fresh. Older in-flight or queued results cannot undo an accepted write, and derived cache responses are not replayed over it on resubscribe. Callers choose when to refetch exact scoped results. Query Core 5.90.15 or later is required for post-write refetch replacement and error-state recovery.
