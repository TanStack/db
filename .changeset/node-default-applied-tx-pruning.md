---
'@tanstack/node-db-sqlite-persistence': minor
'@tanstack/db-sqlite-persistence-core': patch
---

`createNodeSQLitePersistence` now prunes the `applied_tx` log by default so the SQLite file no longer grows without bound. When prune options are omitted, the node driver applies `appliedTxPruneMaxRows: 1_000` and `appliedTxPruneMaxAgeSeconds: 86_400` (24h). Both remain overridable, and passing `0` disables that limit. The defaults are exported as `DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS` and `DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS`.

The shared SQLite core adapter now treats `applied_tx` as a bounded replay cache during `pullSince` recovery. If a recovery request starts before the retained replay window, `pullSince` returns `requiresFullReload: true` instead of returning partial deltas. This safety fix applies to every SQLite persistence wrapper that opts into `applied_tx` pruning; this changeset only enables pruning by default for the Node wrapper.
