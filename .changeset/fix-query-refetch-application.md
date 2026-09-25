---
'@tanstack/query-db-collection': patch
---

Fix explicit refetches so calls normally wait for accepted results to reach Collection rows. While a mutation is persisting or its handler is active, use the Query fetch boundary to prevent circular waits and unrelated persistence delays. The handler parameter and matching mutation aliases share a scoped Collection view, which is not identity-equal to the external Collection.
