---
'@tanstack/offline-transactions': patch
---

Preserve pending callers and optimistic mutations when an offline executor is replaced. A successor over the same outbox settles the original callers when it retains the configured Collection objects in the same runtime.
