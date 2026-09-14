---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/offline-transactions': patch
---

Restore accepted local inserts after an optimistic delete rolls back across a truncate. Preserve sparse-array length and RegExp state in ordered-query replacements, including hosts without a global File constructor. Prevent delayed replay reads from rerunning transactions whose durable acknowledgment already succeeded.
