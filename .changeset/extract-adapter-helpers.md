---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/vue-db': patch
'@tanstack/svelte-db': patch
'@tanstack/solid-db': patch
'@tanstack/angular-db': patch
---

Extract shared live-query adapter helpers into `@tanstack/db`

Adds `isCollection`, `isSingleResultCollection`, and `getLiveQueryStatusFlags` to `@tanstack/db` and migrates all five framework adapters to use them. `isCollection` replaces the per-adapter duck-typing and Solid's `instanceof CollectionImpl` with one structural, multi-realm-safe guard (the `instanceof` form gave false negatives across dual-package boundaries). No behavior change; internal deduplication only.
