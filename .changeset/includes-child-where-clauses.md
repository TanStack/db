---
'@tanstack/db': patch
---

fix: pass child where clauses to loadSubset in includes

Pure-child WHERE clauses on includes subqueries (e.g., `.where(({ item }) => eq(item.status, 'active'))`) are now passed through to the child collection's `loadSubset`/`queryFn`, enabling server-side filtering. Previously only the correlation filter reached the sync layer; additional child filters were applied client-side only.
