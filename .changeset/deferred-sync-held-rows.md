---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Keep a settled optimistic row visible while its server row waits behind an earlier persisted write. Previously, two quick writes to one row in a persisted Collection could briefly show the row before the second write.
