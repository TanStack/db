---
'@tanstack/db': patch
---

fix(db): prevent live query from being marked ready before subset data is loaded

In on-demand sync mode, the live query collection was being marked as `ready` before
the subset data finished loading. This caused `useLiveQuery` to return `isReady=true`
with empty data, and `useLiveSuspenseQuery` to release suspense prematurely.

Changes:

- Update `updateLiveQueryStatus()` to check `isLoadingSubset` on the live query collection
  before marking it ready
- Listen for `loadingSubset:change` events on the live query collection to trigger
  the ready check when subset loading completes
- Fix race condition in `CollectionSubscriber` where the `status:change` listener was
  registered after checking the subscription status, which could cause the listener
  to miss status changes that occurred between the check and registration
