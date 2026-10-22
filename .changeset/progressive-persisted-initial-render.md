---
'@tanstack/db': minor
'@tanstack/electric-db-collection': minor
'@tanstack/db-sqlite-persistence-core': minor
---

Allow persisted initial rendering from previously completed Electric progressive snapshots. Validate adapter-owned completion metadata and durable row-set evidence before local fallback. Cold, partial, and legacy progressive caches wait for network data; legacy cursors without completion evidence trigger a fresh full sync. Report unavailable snapshots without hanging initial-render waits on network failure.
