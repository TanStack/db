---
'@tanstack/react-db': minor
---

**Breaking (1.0):** a live query whose IR has no stable identity, such as one using `fn.where`, `fn.select`, or `fn.having`, now throws `UnhashableQueryIRError` unless it supplies a nonempty `queryKey`. It previously warned in development and kept its first compilation. An empty `queryKey` now counts as none, as it already did for a `DbClient` preload, so a hook and a preload agree on the query's identity. A dependency array does not replace `queryKey`: in that mode the hook checks identity and claims source Collection IDs each time it binds a live query, including one that `useLiveSuspenseQuery` takes from its cache. A reused source Collection ID now throws `SourceCollectionIdReuseError`.

A rejected render now releases every sync start it deferred for a `DbClient` descriptor, so a later hook or `startSyncImmediate()` can start that source. A render that never commits, because a sibling threw or it suspended, releases them when its live query is reclaimed.
