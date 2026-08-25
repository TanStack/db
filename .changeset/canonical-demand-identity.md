---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Canonicalize equivalent loadSubset queries to one demand identity while preserving observable output aliases, exact projected values, and distinct ordered windows. Query DB now reuses the same canonical identity for its on-demand cache keys.
