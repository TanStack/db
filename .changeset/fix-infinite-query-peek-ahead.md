---
'@tanstack/react-db': patch
'@tanstack/db': patch
---

Fix `useLiveInfiniteQuery` peek-ahead detection for `hasNextPage`. The initial query now correctly requests `pageSize + 1` items to detect whether additional pages exist, matching the behavior of subsequent page loads.

Fix async on-demand pagination by ensuring the graph callback fires at least once even when there is no pending graph work, so that `loadMoreIfNeeded` is triggered after `setWindow()` increases the limit.
