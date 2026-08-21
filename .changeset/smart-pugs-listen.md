---
'@tanstack/db': minor
---

Add support for custom aggregate functions. `createAggregate(name, factory)` registers an aggregate and returns a typed helper for use in `select()`, and the lower-level `registerAggregate` / `unregisterAggregate` / `getRegisteredAggregates` APIs are available for dynamic registration. Custom aggregates work anywhere built-ins do, including `having` and `orderBy` via `$selected`.
