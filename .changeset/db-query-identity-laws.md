---
'@tanstack/db': minor
---

Collect the helpers the framework adapters share into one adapter layer, exported from `@tanstack/db` and marked unstable for external use. It adds `identifyLiveQuery`, which checks a prepared query's identity and source Collection IDs for a hook that compares query identity, and `bindLiveQueryWindow`, the window binding every `useLiveInfiniteQuery` now uses. The window helpers that binding replaces are no longer exported.

Add `SourceCollectionIdReuseError`, which a mounted hook that compares query identity throws when a different source Collection appears under a Collection ID it already read.

Add `rejectLiveQueryInput` and `releaseDeferredOnReclaim` for framework hooks. The first releases the sync starts a rejected query deferred and rethrows the rejection. The second releases a render's deferred sync starts when garbage collection reclaims the live query it built, so a render that never commits, because a sibling threw or it suspended, does not keep its sources deferred. Each released source follows its own start policy, so `startSyncImmediate()` or another hook can still start it.
