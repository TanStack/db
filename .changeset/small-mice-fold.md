---
'@tanstack/query-db-collection': patch
---

fix: default persisted query retention to gcTime when omitted

When `persistedGcTime` is not provided, query collections now use the query's effective `gcTime` as the persisted retention TTL. This prevents unexpectedly early cleanup of persisted rows.
