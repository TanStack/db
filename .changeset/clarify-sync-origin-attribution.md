---
'@tanstack/db': patch
---

Clarify that `$origin` reflects local key attribution during sync, rather than the causal writer of a source row. Fix attribution leaking from a truncate to a later source transaction in the same drain. Cover pending and overlapping mutations, ordered same-key source writes, and refused persisted inserts.
