---
'@tanstack/browser-db-sqlite-persistence': minor
'@tanstack/capacitor-db-sqlite-persistence': minor
'@tanstack/cloudflare-durable-objects-db-sqlite-persistence': minor
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/expo-db-sqlite-persistence': minor
'@tanstack/node-db-sqlite-persistence': minor
'@tanstack/react-native-db-sqlite-persistence': minor
'@tanstack/tauri-db-sqlite-persistence': minor
---

SQLite persistence wrappers now prune the `applied_tx` replay log by default so SQLite files no longer grow without bound. When prune options are omitted, wrappers that construct the shared SQLite core adapter apply `appliedTxPruneMaxRows: 1_000` and `appliedTxPruneMaxAgeSeconds: 86_400` (24h). Both remain overridable, and passing `0` disables that limit. The defaults are exported as `DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS` and `DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS` from the shared SQLite core package and re-exported by wrapper packages.

The shared SQLite core adapter now treats `applied_tx` as a bounded replay cache during `pullSince` recovery. If a recovery request starts before the retained replay window, `pullSince` returns `requiresFullReload: true` instead of returning partial deltas.
