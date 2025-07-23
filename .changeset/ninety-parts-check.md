---
"@tanstack/query-db-collection": patch
"@tanstack/db": patch
---

Fix LiveQueryCollection hanging when source collections have no data

Fixed an issue where `LiveQueryCollection.preload()` would hang indefinitely when source collections call `markReady()` without data changes (e.g., when queryFn returns empty array). The LiveQueryCollection now properly detects when all source collections are ready, even without data changes, by polling collection status until all dependencies are ready.
