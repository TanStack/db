---
'@tanstack/query-db-collection': patch
---

Improve `queryCollectionOptions` type compatibility with TanStack Query option objects.

- Accept `queryFn` return types of `T | Promise<T>` instead of requiring `Promise<T>`.
- Align `enabled`, `staleTime`, `refetchInterval`, `retry`, and `retryDelay` with `QueryObserverOptions` typing.
- Support tagged `queryKey` values (`DataTag`) from `queryOptions(...)` spread usage.
- Preserve runtime safety: query collections still require an executable `queryFn`, and wrapped responses still require `select`.
