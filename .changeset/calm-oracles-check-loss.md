---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
---

Retain query-backed rows until their explicit owners release them.

Reject partial Electric updates after an invalid persisted resume or snapshot reset. Preserve row identity across batch partitions and persistence hydration, keep overlapping reset generations isolated, and scope stream cleanup, transaction evidence, sync metadata, mutation matches, and transaction waiters to the collection lifecycle that created them. Bind lazy utilities before sync starts, retire every pending waiter on cleanup even when a persistence wrapper is still loading metadata, preserve committed match evidence across control-only callbacks, rehydrate persisted state after restart, and resolve conflicting resume metadata conservatively.
