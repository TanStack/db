---
'@tanstack/query-db-collection': patch
---

Forward `gcTime` from `queryCollectionOptions` to the underlying TanStack Query observer. The `gcTime` option was previously documented in the config shape but silently dropped before reaching the observer, leaving consumers stuck on the `queryClient` default. Closes #1546.
