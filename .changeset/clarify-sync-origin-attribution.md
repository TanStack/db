---
'@tanstack/db': patch
---

Clarify that `$origin` reflects local key attribution during sync, rather than the causal writer of a source row. Document the failed-mutation boundary and add oracle coverage for refused persisted inserts and atomic same-key source writes.
