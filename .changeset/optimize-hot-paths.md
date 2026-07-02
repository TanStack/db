---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/offline-transactions': patch
'@tanstack/react-db': patch
---

Optimize hot paths: Schwartzian transform for stable serialization sorting, splice-based queue flushing, Map-based transaction lookups, Set-based filtering, and lazy property access in useLiveQuery so status-only consumers skip full entry materialization.
