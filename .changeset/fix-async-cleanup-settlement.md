---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
---

Wait for asynchronous adapter cleanup before a collection reaches `cleaned-up` or starts a replacement sync run. Preserve cleanup settlement through SQLite persistence, PowerSync, and Query Collection wrappers, including late hook cleanup and resource disposal failures.
