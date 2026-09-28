---
'@tanstack/db-sqlite-persistence-core': patch
---

Batch cold full-replacement SQLite writes to reduce worker round trips while preserving one atomic persisted transaction.
