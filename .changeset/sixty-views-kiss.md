---
"@tanstack/trailbase-db-collection": patch
"@tanstack/electric-db-collection": patch
"@tanstack/query-db-collection": patch
"@tanstack/rxdb-db-collection": patch
"@tanstack/angular-db": patch
"@tanstack/svelte-db": patch
"@tanstack/react-db": patch
"@tanstack/solid-db": patch
"@tanstack/db-ivm": patch
"@tanstack/vue-db": patch
"@tanstack/db": patch
---

Let collection.subscribeChanges return a subscription object. Move all data loading code related to optimizations into that subscription object.
