---
'@tanstack/db': patch
---

Report pending joined subset demand through `isLoadingSubset` after a live query is ready. Retired demands stop contributing to loading even if their original transports have not settled.
