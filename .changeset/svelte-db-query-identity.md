---
'@tanstack/svelte-db': minor
---

**Breaking (1.0):** a `useLiveQuery` backed by a `DbClient` matches queries by identity hash, so it now throws `UnhashableQueryIRError` for a query without a stable IR identity unless it supplies a nonempty `queryKey`. It previously compiled the query without a hydration key. While such a hook is mounted, a different source Collection under a Collection ID it already read throws `SourceCollectionIdReuseError`, and every result property then throws instead of returning the previous query's state. Queries without a `DbClient` are unchanged.

A rejected client-backed query now releases every sync start it deferred, so `startSyncImmediate()` or another hook can still start that source. A setup that throws after the hook returns releases them when its live query is reclaimed. `useLiveInfiniteQuery` now uses the shared window binding from `@tanstack/db`.
