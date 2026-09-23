---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Preserve explicit source aliases without changing legacy property paths. Compile SQLite expression-index queries consistently and reject BigInts outside SQLite's signed 64-bit range.
