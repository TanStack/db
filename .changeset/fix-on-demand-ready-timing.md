---
'@tanstack/db': patch
---

fix(db): prevent live query from being marked ready before subset data is loaded

In on-demand sync mode, the live query collection was being marked as `ready` before
the subset data finished loading. This caused `useLiveQuery` to return `isReady=true`
with empty data, and `useLiveSuspenseQuery` to release suspense prematurely.

The root cause was that `updateLiveQueryStatus()` was checking `isLoadingSubset` on the
live query collection itself, but the `loadSubset`/`trackLoadPromise` mechanism runs on
SOURCE collections during on-demand sync. The fix now correctly checks if any source
collection is loading subset data.

Changes:

- Add `anySourceCollectionLoadingSubset()` helper to check if any source collection
  has `isLoadingSubset=true`
- Update `updateLiveQueryStatus()` to use this helper instead of checking the live
  query collection's `isLoadingSubset`
- Listen for `loadingSubset:change` events on SOURCE collections (not the live query
  collection) to trigger the ready check when subset loading completes
- Fix race condition in `CollectionSubscriber` where the `status:change` listener was
  registered after checking the subscription status
