---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/electron-db-sqlite-persistence': patch
---

Request an existing leader's route before the first coordinated write, without sending the mutation. Let leader election finish during scheduled hydration, and reject writes queued under a former leader before persistence.
