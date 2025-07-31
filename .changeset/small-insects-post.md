---
"@tanstack/query-db-collection": patch
---

Move @tanstack/query-core from dependencies to peerDependencies to avoid version conflicts when users already have react-query or query-core installed. This is a non-breaking change as the package will continue to work with any 5.x version of query-core.
