---
'@tanstack/db': patch
---

fix(db): prevent live query from being marked ready before subset data is loaded

In on-demand sync mode, the live query collection was being marked as `ready` before
the subset data finished loading. This caused `useLiveQuery` to return `isReady=true`
with empty data, and `useLiveSuspenseQuery` to release suspense prematurely.

Changes:

- Add a check in `updateLiveQueryStatus()` to ensure that the live query is not
  marked ready while `isLoadingSubset` is true
- Add a listener for `loadingSubset:change` events to trigger the ready check when
  subset loading completes
- Register the `loadingSubset:change` listener before subscribing to avoid race conditions
- Fix race condition in `CollectionSubscriber` where the `status:change` listener was
  registered after checking the subscription status, causing missed `ready` events when
  `loadSubset` completed quickly
