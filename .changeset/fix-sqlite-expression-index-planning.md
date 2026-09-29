---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Preserve explicit source aliases without changing legacy property paths. Compile SQLite expression-index queries consistently, rebuild affected stale physical indexes, and reject BigInts outside SQLite's signed 64-bit range.
