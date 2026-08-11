---
'@tanstack/db': minor
'@tanstack/react-db': patch
'@tanstack/vue-db': patch
'@tanstack/svelte-db': patch
'@tanstack/solid-db': patch
'@tanstack/angular-db': patch
---

Add an internal shared live-query observer and migrate all five framework adapters to it

Introduces `createLiveQueryObserver` in `@tanstack/db`: given a resolved live-query collection (or `null` for a disabled query) it owns the lifecycle every adapter used to re-implement — sync activation on first subscribe, change and status subscriptions, a snapshot with stable identity per state revision for wholesale consumers, and delivery of the raw `ChangeMessage[]` for granular consumers. React, Vue, Svelte, Solid, and Angular's live-query hooks now materialize from the observer instead of their own hand-rolled subscription/status/snapshot machinery, keeping each adapter's native reactivity and each adapter's data-loading policy (wholesale adapters subscribe without initial state; granular adapters seed from it).

The observer is an **internal, unstable contract** for TanStack DB's official adapters — it is exported so the adapter packages can consume it, but it is not a public extension point yet and its API may change in any release.

The migration also fixes several live-query lifecycle defects: status-only transitions (`error`, `cleaned-up`) now reach mounted consumers; snapshot identity is stable across unsubscribe/resubscribe and stays fresh while detached; dispatch is FIFO and non-reentrant with subscriptions identified by record rather than callback; disposing during the synchronous initial replay no longer leaks the collection subscription; subscribing after dispose throws instead of registering a dead listener; Solid guards its async resource continuations against superseded collections; and constructing an observer no longer activates sync (activation belongs to the first committed subscription).
