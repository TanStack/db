---
'@tanstack/angular-db': patch
'@tanstack/react-db': patch
'@tanstack/solid-db': patch
'@tanstack/svelte-db': patch
'@tanstack/vue-db': patch
---

Preserve pre-created collection row, key, and utility types in React infinite
queries. Align conditional live-query result types with each framework's
disabled representation, including nullable collections, disabled statuses,
and empty single-result data in the empty-reactive bindings.
