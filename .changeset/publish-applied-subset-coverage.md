---
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
---

Publish exact applied `loadSubset` coverage with retry-safe ownership cleanup,
invalidate deduplicated request evidence when its rows are released, and
preserve eager Query DB observation after cache removal.
