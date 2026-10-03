---
'@tanstack/db': minor
'@tanstack/query-db-collection': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
---

Drop a transaction's optimistic state when its mutation function settles. A sync transaction committed while the transaction is persisting is accepted and held. It publishes together with that drop, and `isPersisted` settles after that publication. A mutation function that returns before its server row arrives shows the previous synced row until that row applies. A sync write is attributed `$origin: 'local'` only if it was committed before the optimistic state dropped.

Breaking: remove the `begin({ immediate })` option from the sync API. Writes made while a mutation persists now queue behind it instead of applying at once.

Each sync transaction now has two moments: accepted and visible. `commit()` receipts and subset loads resolve when the rows are visible. An accepted transaction always applies; an abort signal cancels a commit only before acceptance. Handler-facing writes resolve at acceptance, so a mutation handler can await them: Query Collection direct writes, persisted mutation confirmation, and the PowerSync mutation path. A handler that awaits an on-demand load of its own collection waits for itself.

Query Collection direct writes read and validate the accepted rows and update the Query cache after acceptance. A refetch no longer cancels an accepted result, so overlapping refetches of a persisted collection apply in order (#1990). An eager fetch that started before a direct write no longer overwrites that write when it returns.

Partial sync updates now keep an own `__proto__` field. Metadata-only sync writes no longer publish a spurious insert when they apply with a held transaction.
