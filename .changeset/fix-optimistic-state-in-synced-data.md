---
"@tanstack/query-db-collection": patch
---

Fixed bug where optimistic state leaked into syncedData when using writeInsert inside onInsert handlers. Previously, when syncing server-generated fields (like IDs or timestamps) using writeInsert within an onInsert handler, the QueryClient cache was updated with combined visible state (including optimistic changes), which triggered the query observer to write optimistic values back to syncedData. Now the cache is correctly updated with only server-confirmed state, ensuring syncedData maintains separation from optimistic state.
