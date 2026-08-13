---
'@tanstack/vue-db': minor
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
'@tanstack/db': patch
---

Add `useLiveInfiniteQuery` as a Vue binding over the shared live-query window controller. Align infinite-query behavior across React, Vue, and Svelte, including safe page sizes, reactive page-depth preservation, ordered collection validation, and shared-window cleanup, while preserving existing adapter API contracts.
