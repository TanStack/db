---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Forward a joined-filter window's filter to `loadSubset` as an optional `relations` hint, so an adapter can return only the root rows that pass. An adapter that applies the hint keeps its answer current as related rows change. No request sends the hint while a joined collection has a local write, and a window loaded with it reads its prefix again without it. SQLite persistence admits the hint and does not transport it.
