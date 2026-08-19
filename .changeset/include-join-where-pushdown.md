---
"@tanstack/db": patch
---

Fix a join inside a correlated include ignoring the subquery's where filter and scanning the whole source collection. The inner-join active/lazy side selection now prefers a side that is already lazily loaded (bounded by the include's correlation) as the driving side, so the joined side loads keyed by the bounded rows instead of the bounded side being flooded with join keys from a full scan of the other side. Mount cost of the reported shape drops from linear in the source collection size (~290ms at 200k rows) to flat (~1ms), with identical results.
