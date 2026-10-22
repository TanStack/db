---
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/electron-db-sqlite-persistence': patch
---

Reloaded persisted collections now read their rows before they write a leader election term. A collection still takes its leader lock when it subscribes, but it reserves its durable term only after the database work already queued on the shared scheduler has settled, or as soon as something needs a leader during that election: a local write, a follower request, a sync commit during startup, or `ensureLeadership`. A need that an earlier leader already served does not let a later takeover skip the wait. A tab that takes over treats the departed leader's route as gone, so a sync commit queued behind one of its reads goes to the new leader and settles without waiting out an RPC timeout. The Electron renderer applies the same rule to its own hydrations. The renderer now has a hydration scope, so its startup runs as one hydration, as a Browser tab's does, and a restart keeps its metadata and row reads in one scope, so a term cannot run between them.

`ensureLeadership` now resolves when this node becomes leader, keeps its place in the Web Locks queue instead of replacing its lock request, and rejects if the coordinator is disposed.

Migration for custom persistence adapters: `runInRegularScope` is now a `RegularScope`, which must also provide `afterQueuedWork()`. It resolves once every operation queued or running on the adapter's scheduler at the call has settled. An adapter without a scheduler can return a promise that settles with its running hydrations. A coordinator now rejects an adapter whose `runInRegularScope` lacks `afterQueuedWork` with `InvalidPersistenceAdapterError`.
