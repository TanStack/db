---
'@tanstack/db-sqlite-persistence-core': patch
---

Skip per-collection table setup when it is already complete. A reopened persisted collection now checks its tables, indexes, triggers, and bookkeeping rows in the same query that reads its registration, and runs the nine setup statements only when something is missing. This removes eight driver round trips per collection on each page load.
