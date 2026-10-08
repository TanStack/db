---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
---

Keep source-backed persisted Collections usable when a writer tab closes after a commit but before its reply. Certify the original transaction with the new writer and reload peers without duplicating unchanged row events.
