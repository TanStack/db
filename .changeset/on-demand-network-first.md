---
'@tanstack/db-sqlite-persistence-core': minor
---

`initialRender: { strategy: 'network-first' }` now works for on-demand persisted Collections, including Electric's `progressive` mode. Previously the configuration threw `InvalidPersistedCollectionConfigError`.

A subset load that settles online records persisted demand coverage for its exact demand. In a later session, a load of the same demand settles on its rows from SQLite once `networkTimeoutMs` (default 3 seconds) has passed, or at once if the network load fails. The network load keeps running, and its rows publish when they arrive. If it fails after that, the query stays ready. A demand that never settled online still waits for the network. Coverage proves that the rows were complete when they were loaded, not that they are still current. A source truncate or a cache-generation rotation clears it, and a load that a reset made obsolete records none. Coverage also ends when SQLite holds fewer rows for the demand than when it settled, for example after a source delete or Query DB retention expiry. A `refetch: true` load always waits for the network. An ordered window with a `limit` stays covered only while SQLite holds the same rows for it.

A query that joins eager and on-demand sources becomes ready when every eager source is ready, which network-first allows from its restored rows after the deadline, and every demand the query reaches on an on-demand source has settled. A network failure alone does not settle an on-demand demand that is not covered.

This applies only with the default single-process coordinator. With a multi-tab coordinator, such as `BrowserCollectionCoordinator`, on-demand loads still wait for the network.
