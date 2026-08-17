---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
---

Rebuild correlated include materialization as one D2 graph, fixing stale or missing nested results across route changes, batching, lazy loading, optimistic updates, and layered queries. Add canonical structural relation keys, abortable subset demand, and coherent publication for Collection-valued includes. Dispose delayed PowerSync subset hooks after cleanup, and prevent released Query Collection cache results from reaching the collection.
