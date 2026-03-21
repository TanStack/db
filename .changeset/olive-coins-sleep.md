---
'@tanstack/db': patch
'@tanstack/offline-transactions': patch
'@tanstack/query-db-collection': patch
---

fix: prevent stale query refreshes from overwriting optimistic offline changes on reconnect

When reconnecting with pending offline transactions, query-backed collections now defer processing query refreshes until queued writes finish replaying, avoiding temporary reverts to stale server data.
