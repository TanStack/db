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
  registered after the snapshot was triggered. Now the subscription creation is split
  from snapshot triggering, allowing the listener to be registered BEFORE any async
  work starts. This ensures we never miss status transitions even if the loadSubset
  promise resolves synchronously.
- Add `deferSnapshot` option to `subscribeChanges()` to support the deferred snapshot
  pattern used by the race condition fix
