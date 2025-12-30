---
'@tanstack/react-db': patch
---

Fix `useLiveSuspenseQuery` releasing suspense before data is loaded in on-demand mode

When using `useLiveSuspenseQuery` with on-demand sync mode, the suspense boundary would sometimes release before the query's data was actually loaded. This happened because the live query collection was marked as `ready` immediately when the source collection was already `ready`, even though the `loadSubset` operation for the specific query hadn't completed yet.

The fix ensures that `useLiveSuspenseQuery` also suspends while `isLoadingSubset` is true, waiting for the initial subset load to complete before releasing the suspense boundary.
