---
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Propagate initial query sync failures through dependent live queries and readiness promises, including recovery and late subscribers, while preserving a ready cached snapshot on later refetch failures. Let sync adapters pass the original failure to `markError(error)` so readiness promises reject with that cause. Isolate adapter callbacks by sync session, preserve synchronous startup errors, and prevent rejected deduplicated subset requests from creating detached promise rejections.
