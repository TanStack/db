---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
---

Preserve persisted resume integrity with atomic SQLite baseline evidence and stale-writer rejection, expose persistence sync metadata as one versioned capability, and refresh uncertified Electric baselines before publishing resumed data.
