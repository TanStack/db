---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/electron-db-sqlite-persistence': patch
---

Wait for an initial leader route before a coordinated write. Let leader election finish during scheduled hydration, and reject writes queued under a former leader before persistence.
