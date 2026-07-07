---
'@tanstack/db': minor
'@tanstack/react-db': patch
'@tanstack/vue-db': patch
'@tanstack/svelte-db': patch
'@tanstack/solid-db': patch
'@tanstack/angular-db': patch
---

Add a shared live-query observer and migrate all five framework adapters to it

Introduces `createLiveQueryObserver` in `@tanstack/db`: given a resolved live-query collection (or `null` for a disabled query) it owns the shared lifecycle every adapter used to re-implement — start sync, subscribe to changes, the already-ready notify race, a stable per-revision snapshot for wholesale consumers, and delivery of the raw `ChangeMessage[]` for granular consumers. React, Vue, Svelte, Solid, and Angular's live-query hooks now materialize from the observer instead of their own hand-rolled subscription/status/snapshot machinery, keeping each adapter's native reactivity. No behavior change.
