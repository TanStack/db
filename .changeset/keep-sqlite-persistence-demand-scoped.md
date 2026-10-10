---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Reject reuse of persisted collection options across direct Collections while keeping DbClient materializations independent. Preserve the first Collection's ownership through cleanup and restart. Keep on-demand full reloads scoped to rows already visible when no subset demand remains, and correct those rows when a peer reports a full reload.
