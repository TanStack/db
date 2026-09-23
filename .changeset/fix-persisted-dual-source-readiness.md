---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/electric-db-collection': patch
---

Allow eager persisted collections to become ready from either a compatible SQLite snapshot, including an empty snapshot, or an authoritative upstream snapshot. Keep usable local rows visible after a later upstream failure, while durable-write failures still enter the Collection error state and a later upstream ready signal may recover it. Serialize browser source snapshots with coordinator mutations and preserve exact startup, supersession, and durability failure behavior.
