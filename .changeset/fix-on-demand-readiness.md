---
'@tanstack/react-db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
---

Retain retry-stable Suspense resources and preserve persisted demand readiness across lifecycle transitions. Avoid redundant Electric refreshes when requesting subset snapshots, and declare React 18 as the minimum supported React version.
