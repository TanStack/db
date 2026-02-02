---
'@tanstack/react-db': patch
---

Fix `useLiveInfiniteQuery` peek-ahead detection for `hasNextPage`. The initial query now correctly requests `pageSize + 1` items to detect whether additional pages exist, matching the behavior of subsequent page loads.
