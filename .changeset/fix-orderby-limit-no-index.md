---
'@tanstack/db': patch
---

fix: orderBy + limit queries crash when no index exists

When auto-indexing is disabled (the default), queries with `orderBy` and `limit` where the limit exceeds the available data would crash with "Ordered snapshot was requested but no index was found". The on-demand loader now correctly skips cursor-based loading when no index is available.
