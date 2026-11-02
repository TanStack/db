---
'@tanstack/db-ivm': patch
---

Preserve unequal `distinct()` selections when their hashes collide. Keep support counts independent so incremental insertions and deletions affect only the matching selection.
