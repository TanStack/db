---
'@tanstack/db': patch
---

Fix `isReady()` returning `true` while `toArray()` returns empty results. The status now correctly waits until data has been processed through the graph before marking ready.

Also fix duplicate key errors when live queries use joins with custom `getKey` functions. D2's incremental join can produce multiple outputs for the same key during a single graph run; this change batches all outputs into a single transaction to prevent conflicts.
