---
"@tanstack/db": patch
---

Add acceptMutations utility for local collections in manual transactions. Local-only and local-storage collections now expose `utils.acceptMutations(transaction, collection)` that must be called in manual transaction `mutationFn` to persist mutations.
