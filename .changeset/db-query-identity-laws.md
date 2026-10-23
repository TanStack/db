---
'@tanstack/db': minor
---

Collect the helpers the framework adapters share into one adapter layer, exported from `@tanstack/db` and marked unstable for external use. It adds `identifyLiveQuery`, which checks a prepared query's identity and source Collection IDs for a hook that compares query identity, and `bindLiveQueryWindow`, the window binding every `useLiveInfiniteQuery` now uses. The window helpers that binding replaces are no longer exported.

Add `SourceCollectionIdReuseError`, which a mounted hook that compares query identity throws when a different source Collection appears under a Collection ID it already read.

`prepareLiveQueryValue` now releases the sync starts it deferred when preparation throws, such as when a collection descriptor's factory fails. Each released source follows its own start policy, so `startSyncImmediate()` or another hook can still start it.
