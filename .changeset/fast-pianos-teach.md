---
"@tanstack/browser-db-sqlite-persistence": patch
"@tanstack/db-sqlite-persistence-core": patch
---

Fix SQLite expression-index matching for persisted ref filters by inlining JSON-path literals in runtime SQL compilation while keeping actual filter values bound.
