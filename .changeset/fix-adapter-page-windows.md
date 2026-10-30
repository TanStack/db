---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/react-db': patch
'@tanstack/preact-db': patch
'@tanstack/vue-db': patch
'@tanstack/solid-db': patch
'@tanstack/angular-db': patch
'@tanstack/svelte-db': patch
---

Keep adapter-owned live queries and their source subscriptions when only the ordered query's finite `.limit()` or `.offset()` changes. Preserve exact requested bounds when moving page windows, and avoid React 18 layout-effect warnings during server rendering.
