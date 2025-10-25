---
"@tanstack/query-db-collection": patch
---

**Behavior change**: `utils.refetch()` now uses exact query key targeting (previously used prefix matching). This prevents unintended cascading refetches of related queries. For example, refetching `['todos', 'project-1']` will no longer trigger refetches of `['todos']` or `['todos', 'project-2']`.

Additionally, `utils.refetch()` now bypasses `enabled: false` to support manual/imperative refetch patterns (matching TanStack Query hook behavior) and returns `QueryObserverResult` instead of `void` for better DX.
