---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/offline-transactions': patch
---

Preserve only captured accepted local inserts across a truncate. Preserve sparse-array length and RegExp state through ordered-query hashing, including hosts without a global File constructor. Prevent delayed replay reads from rerunning any transaction removed while the read was in flight, without rescanning the outbox.
