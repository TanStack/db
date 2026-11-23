---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Forward a joined-filter window's filter to `loadSubset` as an optional `relations` hint, so an adapter can return only the root rows that pass. SQLite persistence admits the hint and does not transport it.
