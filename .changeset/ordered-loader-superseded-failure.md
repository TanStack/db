---
'@tanstack/db': patch
---

Keep ordered live queries accurate and loading when source work overlaps. A window with `orderBy` and `limit` no longer stops loading, keeps old rows, or holds acquisitions in these cases: a failed or superseded request, a truncate replay, a source change during a repair, or an on-demand joined source. Recovery after a failure uses one full-source read, and a window move whose load succeeded now resolves.

When an adapter's `unloadSubset` throws, TanStack DB now reports the error as an uncaught error and continues as if the release succeeded. The error is no longer a subset failure. It does not set `lastError` or `lastSubsetError`, fail a truncate replay, reject `setWindow()`, or dispose an Effect. `unsubscribe()`, `releaseSnapshot()`, and Effect `dispose()` no longer throw or reject with it.

The newest `setWindow()` call now wins. A pending source recovery that defers two calls no longer lets the older one set the window. A superseded call that succeeds now resolves only after the newest call settles, so awaiting it shows the window that won.
