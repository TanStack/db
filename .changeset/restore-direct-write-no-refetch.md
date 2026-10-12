---
'@tanstack/query-db-collection': patch
---

Prevent direct writes from automatically refetching active Query subsets. On-demand writes patch changed keys already present in active raw arrays or directly selected response arrays, except when the Query is shared with another Collection. Eager writes also leave a shared Query unchanged when another Collection owns it. In both modes, cache patches preserve Query error, invalidation, and freshness state; an idle eager cache seed moves from pending to success without advancing its freshness timestamp. Direct writes no longer clear a prior fetch error or mark stale data fresh. Older in-flight or queued results cannot undo an accepted write, and derived cache responses are not replayed over it on resubscribe. Callers choose when to request current server rows; on-demand inserts without a subset owner remain caller-managed even after an empty refetch. Query Core 5.90.15 or later is required for post-write refetch replacement and error-state recovery.

A Collection that later joins a Query patched by another Collection's direct write fetches before accepting that local edit as server data. A disabled Collection waits for an explicit refetch instead. A fresh persisted Collection also refetches on a cached-row collision when it cannot recover the order of its stored direct write and that Query result.
