---
'@tanstack/db': minor
'@tanstack/electric-db-collection': minor
'@tanstack/query-db-collection': minor
---

Preserve collection key and adapter utility types throughout mutation handlers and nested transaction mutations. Mutation keys now use the collection's declared key type instead of `any`; collections that use the default key type expose `string | number`. Prevent Query and Electric collections from exposing nonexistent cross-adapter utilities.
