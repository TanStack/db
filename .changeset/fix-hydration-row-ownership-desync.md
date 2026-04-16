---
'@tanstack/query-db-collection': patch
---

Fix row-ownership desync that caused rows to be incorrectly deleted from `syncedData` when a query unmounted while another overlapping on-demand live query was still subscribed. `getHydratedOwnedRowsForQueryBaseline` and the `scanPersisted` path in `loadPersistedBaselineForQuery` now merge persisted owners into the existing in-memory `rowToQueries` entry instead of overwriting it, so ownership registered by active queries via `addRow` is preserved across hydration.
