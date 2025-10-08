---
"@tanstack/react-db": patch
"@tanstack/db": patch
---

Refactored live queries to execute eagerly during sync. Live queries now materialize their results immediately as data arrives from source collections, even while those collections are still in a "loading" state, rather than waiting for all sources to be "ready" before executing.
