---
'@tanstack/query-db-collection': patch
---

Prevent direct writes from automatically refetching active Query subsets. On-demand writes patch changed keys already present in active raw arrays or directly selected response arrays while preserving Query error and freshness state. Older in-flight results cannot undo an accepted write, and derived cache responses are not replayed over it on resubscribe. Callers choose when to refetch exact scoped results.
