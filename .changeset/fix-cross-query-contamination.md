---
'@tanstack/db': patch
---

Fix cross-query data contamination in `useLiveInfiniteQuery` when navigating between different queries on the same collection with `syncMode: 'on-demand'`. The first page now correctly loads from `loadSubset` instead of potentially stale local index data.
