---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
---

Retain query-backed rows until their explicit owners release them.

Harden Electric resume and lifecycle handling so partial updates cannot materialize unknown or moved-out rows, stale async work and waiters cannot cross cleanup or restart—including automatic garbage collection—and valid batches behave the same across callback partitions and persistence hydration.

Reduce live-update work to scale with the incoming batch instead of the full collection while preserving conservative reset recovery and committed mutation evidence.
