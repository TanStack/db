---
"@tanstack/query-db-collection": patch
"@tanstack/db": patch
---

fix(query-db-collection): use deep equality for object field comparison in query observer

Fixed an issue where updating object fields (non-primitives) with `refetch: false` in `onUpdate` handlers would cause the value to rollback to the previous state every other update. The query observer was using shallow equality (`===`) to compare items, which compares object properties by reference rather than by value. This caused the observer to incorrectly detect differences and write stale data back to syncedData. Now uses `deepEquals` for proper value comparison.
