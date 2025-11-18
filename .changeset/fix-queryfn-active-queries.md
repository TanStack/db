---
"@tanstack/query-db-collection": patch
---

fix: call queryFn with targeted WHERE clause for each active query during mutation refetch

Previously, when mutations triggered a refetch, the queryFn would be called once with the original query parameters (orderBy, limit, where). This caused:
1. Network inefficiency - fetching all N query results instead of just the mutated items
2. Data loss in on-demand mode - time-based queries (e.g., "last 10 items") would lose previously loaded items if they fell out of the ordered/limited result set

Now, when mutations trigger a refetch:
- queryFn is called N times in parallel (once per active query with a subscription)
- Each call uses a targeted WHERE clause for only the mutated item keys
- No orderBy or limit constraints are included
- Inactive queries (without subscriptions) are skipped entirely

This ensures mutated items are refreshed without losing other data in the collection.

Fixes #821
