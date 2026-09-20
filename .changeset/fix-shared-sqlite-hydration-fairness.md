---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/electron-db-sqlite-persistence': patch
---

Prevent cold SQLite hydrations from being starved by unrelated queued writes when collections share a browser driver. Schedule each complete hydrate fairly while preserving transaction atomicity and leader-local persistence coordination.
