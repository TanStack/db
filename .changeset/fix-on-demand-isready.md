---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Fix `isReady` tracking for on-demand live queries without orderBy. Previously, non-ordered live queries using `syncMode: 'on-demand'` were incorrectly marked as ready before data finished loading. Also fix `preload()` promises hanging when cleanup occurs before the collection becomes ready.
