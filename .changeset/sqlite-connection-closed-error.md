---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
---

Add `SQLiteConnectionClosedError`. A browser OPFS connection now rejects requests made after close starts with this error instead of `InvalidPersistedCollectionConfigError`.
