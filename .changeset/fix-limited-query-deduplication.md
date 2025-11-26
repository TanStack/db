---
"@tanstack/db": patch
---

Fixed incorrect deduplication of limited queries with different where clauses. Previously, a query like `{where: searchFilter, limit: 10}` could be incorrectly deduplicated against a prior query `{where: undefined, limit: 10}`, causing search/filter results to only show cached data. Now, limited queries are only deduplicated when their where clauses are structurally equal.
