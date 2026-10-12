---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Reject reuse of persisted collection options across direct Collections while keeping DbClient materializations independent. Pass fresh `persistedCollectionOptions(...)` to each direct `createCollection(...)`; DbClient descriptors remain reusable. Preserve the first Collection's ownership through cleanup and restart. Keep on-demand peer reloads and schema resets scoped to rows already visible when no subset demand remains. Correct changed or deleted visible rows without adding unrelated stored rows or replacing unconfirmed DbClient hydration seeds.
