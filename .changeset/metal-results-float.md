---
'@tanstack/db': patch
---

Fixed `acceptMutations` not persisting data in local-only collections with manual transactions. The mutation filter was comparing against a stale `null` collection reference instead of using the collection ID, causing all mutations to be silently dropped after the transaction's `mutationFn` resolved.
