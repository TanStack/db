---
'@tanstack/angular-db': patch
'@tanstack/db': patch
'@tanstack/solid-db': patch
'@tanstack/svelte-db': patch
'@tanstack/vue-db': patch
---

Retire adapter-created live-query collections after their final subscriber leaves. Treat an undefined `gcTime` as omitted, preserve explicit values and caller-supplied collections, and retain Solid projections while their Suspense boundary is pending.
