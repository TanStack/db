---
'@tanstack/offline-transactions': patch
---

Fence each successful outbox clear deletion from overlapping reads, including when another deletion is still pending or fails.
