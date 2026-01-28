---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Pass join information to queryFn in on-demand mode. This enables server-side joins before pagination, fixing inconsistent page sizes when queries combine pagination with filters on joined collections. The new `joins` array in `LoadSubsetOptions` contains collection ID, alias, join type, key expressions, and associated filters.
