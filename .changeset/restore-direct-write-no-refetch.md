---
'@tanstack/query-db-collection': patch
---

Prevent direct writes from automatically refetching active Query subsets. Patch changed rows already present in active on-demand caches so callers can choose when to refetch scoped results.
