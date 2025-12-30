---
"@tanstack/db": patch
---

fix(db): prevent live query from being marked ready before subset data is loaded

In on-demand sync mode, the live query collection was being marked as `ready` before
the subset data finished loading. This caused `useLiveQuery` to return `isReady=true`
with empty data, and `useLiveSuspenseQuery` to release suspense prematurely.

The fix adds a check in `updateLiveQueryStatus()` to ensure that the live query is not
marked ready while `isLoadingSubset` is true. Additionally, a listener is added for
`loadingSubset:change` events to trigger the ready check when subset loading completes.
