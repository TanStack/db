---
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/db': patch
---

`initialRender: { strategy: 'network-first' }` now works for on-demand persisted Collections, including Electric's `progressive` mode. Previously the configuration threw `InvalidPersistedCollectionConfigError`.

A subset load that settles online records persisted demand coverage for its exact demand. In a later session, a load of the same demand settles on its rows from SQLite once `networkTimeoutMs` (default 3 seconds) has passed, or at once if the network load fails. The network load keeps running, and its rows publish when they arrive. If it fails after that, the query stays ready. A demand that never settled online still waits for the network. Coverage proves that the rows were complete when they were loaded, not that they are still current. A source truncate or a cache-generation rotation clears it, and a load that a reset made obsolete records none.

For a query that joins eager and on-demand sources, the network-first wait ends only when every eager source has restored and every demand the query reaches on an on-demand source has settled.

This applies only with the default single-process coordinator. With a multi-tab coordinator, such as `BrowserCollectionCoordinator`, on-demand loads still wait for the network.
