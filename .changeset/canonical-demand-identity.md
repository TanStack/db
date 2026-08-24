---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Canonicalize equivalent loadSubset queries to one demand identity while preserving distinct runtime values and window requests. Query DB now reuses the same canonical identity for its on-demand cache keys.
