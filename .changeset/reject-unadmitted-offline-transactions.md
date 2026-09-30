---
'@tanstack/offline-transactions': patch
---

Reject offline transactions that lose leadership before outbox admission so optimistic changes roll back instead of reporting false success.
