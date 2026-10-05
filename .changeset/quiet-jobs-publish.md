---
'@tanstack/db-sqlite-persistence-core': patch
---

Allow committed source transactions to publish after subset hydrations queued ahead of them, without treating the publication delay as an open transaction crossing a hydration cycle.
