---
'@tanstack/node-db-sqlite-persistence': minor
---

`createNodeSQLitePersistence` now prunes the `applied_tx` log by default so the SQLite file no longer grows without bound. When prune options are omitted, the node driver applies `appliedTxPruneMaxRows: 1_000` and `appliedTxPruneMaxAgeSeconds: 86_400` (24h). Both remain overridable, and passing `0` disables that limit. The defaults are exported as `DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS` and `DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS`.
