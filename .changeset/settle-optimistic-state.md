---
'@tanstack/db': minor
'@tanstack/query-db-collection': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Drop a transaction's optimistic state when its mutation function settles. A sync transaction committed while the transaction is persisting is accepted and held. It publishes together with that drop, and `isPersisted` settles after that publication. A mutation function that returns before its server row arrives shows the previous synced row until that row applies. A sync write is attributed `$origin: 'local'` only if it was accepted before the optimistic state dropped. A sync transaction still open at that point is not counted.

Breaking: remove the `begin({ immediate })` option from the sync API. Writes made while a mutation persists now queue behind it instead of applying at once.

Each sync transaction now has two moments: accepted and visible. `commit()` receipts and subset loads resolve when the rows are visible. Collection readiness (`preload`, `stateWhenReady`, `toArrayWhenReady`) resolves once the startup rows are accepted, so a mutation handler that awaits its own collection's readiness during startup settles. An accepted transaction always applies. Handler-facing writes resolve at acceptance, so a mutation handler can await them: Query Collection direct writes, persisted mutation confirmation, and the PowerSync mutation path. A handler that awaits an on-demand load of its own collection waits for itself.

A subset load whose caller aborts rejects with `AbortError` at every point: before the fetch, when the fetch fails because of the abort, after the fetch but before the commit, and between pages. Pages that were already accepted still apply, and a TrailBase load waits until they are visible.

Query Collection direct writes read and validate the accepted rows and update the Query cache after acceptance. A refetch no longer cancels an accepted result, so overlapping refetches of a persisted collection apply in order (#1990). An eager fetch that started before a direct write keeps the server's rows for every key the write did not touch and the accepted row for each key it did, in both the collection and the Query cache.

A DbClient hydration chunk is accepted ahead of a still-open source transaction, so readers of accepted rows see it and the source's `commit()` still commits its own writes.

Partial sync updates now keep an own `__proto__` field. Metadata-only sync writes no longer publish a spurious insert when they apply with a held transaction. A rollback keeps its delete event when a sync transaction for the same key is still open. When two completed transactions hold one key, the newer transaction's row stays visible. Canceling any sync transaction other than the open last one throws `SyncQueueInvariantError`.
