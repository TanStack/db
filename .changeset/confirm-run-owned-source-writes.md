---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Abort stale persisted source writes and preserve scoped recovery after cache-claim expiry. Bind native PowerSync confirmations to the writing Collection's sync run. Reject impossible TrailBase confirmations promptly while retaining fresh evidence across delayed responses and preventing older events from confirming new writes.
