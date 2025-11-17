---
"@tanstack/query-db-collection": patch
---

Temporarily remove `loadSubset` call deduplication in query collection. We need to revisit our approach to deduplication to ensure correctness. See https://github.com/TanStack/db/issues/836 for discussion on the proper implementation strategy.
