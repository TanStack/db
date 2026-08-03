---
'@tanstack/query-db-collection': minor
---

Add eager collection support for TanStack Query `initialData` and `initialDataUpdatedAt`, including wrapped response projection and collection-local initialization on shared QueryClient instances.

QueryClient-default `placeholderData` no longer materializes as collection rows, and QueryClient-default `initialData` no longer seeds on-demand subset observers.
