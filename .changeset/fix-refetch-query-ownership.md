---
'@tanstack/query-db-collection': patch
---

Fix query ownership cleanup across overlapping refetch and observer lifecycles so removed rows do not remain visible because of stale persisted metadata.
