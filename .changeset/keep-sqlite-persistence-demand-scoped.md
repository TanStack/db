---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Reject reuse of persisted collection options across direct Collections while keeping DbClient materializations independent. Keep on-demand full reloads scoped to active row demand so peer notifications do not load unrelated stored rows.
