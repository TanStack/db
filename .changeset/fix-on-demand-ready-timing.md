---
'@tanstack/db': patch
---

fix(db): prevent live query from being marked ready before subset data is loaded

In on-demand sync mode, the live query collection was being marked as `ready` before
the subset data finished loading. This caused `useLiveQuery` to return `isReady=true`
with empty data, and `useLiveSuspenseQuery` to release suspense prematurely.

The root cause was a race condition: the `status:change` listener in `CollectionSubscriber`
was registered _after_ the snapshot was triggered. If `loadSubset` resolved quickly
(or synchronously), the `loadingSubset` status transition would be missed entirely,
so `trackLoadPromise` was never called on the live query collection.

Changes:

1. **Core fix - deferred snapshot triggering**: Split subscription creation from snapshot
   triggering using a new `deferSnapshot` option. This ensures the status listener is
   registered BEFORE any async work starts, so we never miss status transitions.

2. **Ready state gating**: `updateLiveQueryStatus()` now checks `isLoadingSubset` on the
   live query collection before marking it ready, and listens for `loadingSubset:change`
   to trigger the ready check when subset loading completes.
