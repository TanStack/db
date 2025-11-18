---
"@tanstack/query-db-collection": patch
---

fix: only refetch active queries (queries with subscriptions) in mutation handlers

Previously, when mutations triggered a refetch, all queries would be refetched regardless of whether they had active subscriptions. This caused unnecessary network requests and could lead to data loss in on-demand mode with time-based queries (e.g., "last 10 items").

Now, the refetch function only refetches queries that have active subscriptions, avoiding these issues.

Fixes #821
