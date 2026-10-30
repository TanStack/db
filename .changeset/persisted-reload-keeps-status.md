---
'@tanstack/db-sqlite-persistence-core': patch
---

Keep a persisted Collection's status when another tab's commit reloads its rows. Before, a reload from durable rows could mark a tab `ready` while its own source was still loading, or move a tab whose initial sync failed from `error` to `ready`. Now only the Collection's own source changes its status.
