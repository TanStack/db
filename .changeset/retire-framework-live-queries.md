---
'@tanstack/angular-db': patch
'@tanstack/solid-db': patch
'@tanstack/svelte-db': patch
'@tanstack/vue-db': patch
---

Retire adapter-created live-query collections after their final subscriber leaves. Preserve explicit `gcTime` values and caller-supplied collections.
