---
'@tanstack/db': patch
---

Garbage collect collections that start syncing before anything subscribes to them.

`startGCTimer` only ran when the last subscriber left, so a collection whose subscriber count never rose above zero never armed it. Sync started from `startSync: true`, `preload()` or `startSyncImmediate()` therefore ran forever, and a live query started that way held a subscription on every collection it read from for the lifetime of the page — regardless of how short its `gcTime` was.

Framework adapters build their live query collection while rendering and subscribe once that render commits, so every render React, Vue, Svelte or Solid discards before committing — a suspended subtree, a render that throws, a time-sliced render restarted by an interleaved update — stranded a fully compiled query graph rooted at a long-lived source collection. Under a route that repeatedly re-rendered without committing this exhausted the renderer's heap.

Sync starting without a subscriber now arms the same GC timer, floored at 50ms so that a subscriber arriving with the commit is never beaten to it. Collections with `gcTime: 0` still opt out of GC entirely, and the timer armed when the last subscriber leaves still fires on `gcTime` exactly.
