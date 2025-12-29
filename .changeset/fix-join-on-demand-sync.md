---
"@tanstack/db": patch
---

Fix on-demand sync collections not loading data when used in join queries. Previously, collections with `syncMode: 'on-demand'` would remain idle when used as sources in join queries, causing empty results. Now `startSyncImmediate()` is called on all source collections in `subscribeToAllCollections()` to ensure sync is properly initialized.
