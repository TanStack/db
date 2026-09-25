---
'@tanstack/query-db-collection': patch
---

Fix explicit refetches so external calls wait for accepted results to reach Collection rows. Keep mutation-handler refetches at the Query fetch boundary to prevent circular waits.
