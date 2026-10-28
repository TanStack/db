---
'@tanstack/preact-db': minor
---

Add `@tanstack/preact-db`, a Preact adapter with `useLiveQuery` and `useLiveInfiniteQuery`. Both compare query identity derived from the query IR on each render, require a `queryKey` for functional query variants, and pass the shared live-query and infinite-query conformance suites. Queries read concrete source Collections; `DbProvider` and collection descriptors are not supported yet.
