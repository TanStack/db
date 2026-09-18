---
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
---

Preserve collection key and adapter utility types throughout mutation handlers and nested transaction mutations. Prevent Query and Electric collections from exposing nonexistent cross-adapter utilities.
