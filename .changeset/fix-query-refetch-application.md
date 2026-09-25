---
'@tanstack/query-db-collection': patch
---

Fix explicit refetches so external calls wait for accepted results to reach Collection rows. Keep mutation-handler refetches at the Query fetch boundary to prevent circular waits. The handler parameter and matching mutation aliases share a scoped Collection view, which is not identity-equal to the external Collection.
