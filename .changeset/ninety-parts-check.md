---
"@tanstack/query-db-collection": patch
"@tanstack/db": patch
---

Fix LiveQueryCollection hanging when source collections have no data

Fixed an issue where `LiveQueryCollection.preload()` would hang indefinitely when source collections call `markReady()` without data changes (e.g., when queryFn returns empty array). 

The fix implements a proper event-based solution:
- Collections now emit empty change events when becoming ready with no data
- WHERE clause filtered subscriptions now correctly pass through empty ready signals
- Both regular and WHERE clause optimized LiveQueryCollections now work correctly with empty source collections
