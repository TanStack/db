---
'@tanstack/db-sqlite-persistence-core': patch
---

Batch ordinary SQLite row and metadata writes, including repeated-key actions, to reduce storage calls while preserving mutation order and atomic commits.
