---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
---

Restore synchronous readiness for warm on-demand queries, retain retry-stable Suspense resources before commit, and preserve persisted demand readiness across lifecycle transitions. Avoid redundant Electric refreshes when requesting subset snapshots.
