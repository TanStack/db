---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/electric-db-collection': patch
---

Allow eager persisted collections to become ready from either compatible SQLite hydration or an authoritative upstream snapshot. Serialize browser source snapshots with coordinator mutations and preserve exact startup, supersession, and durability failure behavior.
