---
'@tanstack/query-db-collection': patch
---

Improve `queryCollectionOptions` type interoperability with TanStack Query option objects.

- Accept `queryFn` return types of `T | Promise<T>` instead of Promise-only contracts.
- Align `enabled`, `staleTime`, `refetchInterval`, `retry`, and `retryDelay` with `QueryObserverOptions` typing.
- Support tagged `queryKey` values (`DataTag`) from `queryOptions(...)` spread usage.
- Keep `queryFn` required in the final `queryCollectionOptions` config (including interop paths) so types match runtime expectations.
- Preserve runtime safety: query collections still require an executable `queryFn`, and wrapped responses still require `select`.
